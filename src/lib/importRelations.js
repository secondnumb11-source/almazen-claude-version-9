/* ============================================================================
   محرك الربط وكشف التعارضات للعقود والحجوزات والفواتير
   يحوّل القيم النصية (اسم العميل / رقم الوحدة / رقم الحجز) إلى مفاتيح حقيقية
   ثم يُنتج تقرير تعارضات مفصّل: سبب الرفض + الأثر على كل سجل.
   ========================================================================== */
import { normalize, parseDate } from './importEngine'

/** الأهداف التي تحتاج ربطاً علائقياً */
export const RELATIONAL_TARGETS = ['contracts', 'bookings', 'invoices']

export const CONFLICT_TYPES = {
  LINK_NOT_FOUND:      { label: 'مفتاح ربط غير موجود', severity: 'error' },
  LINK_AMBIGUOUS:      { label: 'مفتاح ربط مكرر/غامض', severity: 'error' },
  LINK_MISSING_COLUMN: { label: 'عمود الربط غير مربوط', severity: 'error' },
  DATE_ORDER:          { label: 'ترتيب تواريخ غير منطقي', severity: 'error' },
  OVERLAP_IN_FILE:     { label: 'تعارض تواريخ داخل الملف', severity: 'error' },
  OVERLAP_IN_DB:       { label: 'تعارض تواريخ مع النظام', severity: 'error' },
  DUP_KEY_IN_FILE:     { label: 'مفتاح مكرر داخل الملف', severity: 'error' },
  KEY_EXISTS_IN_DB:    { label: 'المفتاح موجود في النظام', severity: 'warning' },
  AMOUNT_MISMATCH:     { label: 'عدم تطابق المبالغ', severity: 'warning' },
  PAID_EXCEEDS_TOTAL:  { label: 'المدفوع يتجاوز الإجمالي', severity: 'warning' },
  DATES_OUTSIDE_BOOKING: { label: 'تواريخ العقد خارج مدة الحجز', severity: 'warning' },
  UNIT_MISMATCH:       { label: 'الوحدة لا تطابق الحجز', severity: 'warning' },
}

const D = (v) => { const d = parseDate(v); return d ? String(d).slice(0, 10) : null }
const overlaps = (aIn, aOut, bIn, bOut) => !!(aIn && aOut && bIn && bOut) && aIn < bOut && bIn < aOut

function pushConflict(list, c) {
  const meta = CONFLICT_TYPES[c.type] || { label: c.type, severity: 'error' }
  list.push({ severity: meta.severity, typeLabel: meta.label, ...c })
  return list[list.length - 1]
}

/* ------------------------------ جلب المراجع ------------------------------- */
async function loadReference(supabase, companyId) {
  const [cust, units, bookings] = await Promise.all([
    supabase.from('customers').select('id, full_name, id_number, phone').eq('company_id', companyId).limit(20000),
    supabase.from('units').select('id, unit_number').eq('company_id', companyId).limit(20000),
    supabase.from('bookings').select('id, contract_number, ota_reservation_id, unit_id, customer_id, check_in_date, check_out_date, status')
      .eq('company_id', companyId).limit(20000),
  ])
  return { customers: cust.data || [], units: units.data || [], bookings: bookings.data || [] }
}

function indexBy(rows, keyFn) {
  const map = new Map()
  for (const r of rows) {
    const k = keyFn(r)
    if (!k) continue
    const cur = map.get(k)
    if (cur) cur.push(r); else map.set(k, [r])
  }
  return map
}

/* --------------------------- الربط + التعارضات ---------------------------- */
/**
 * @returns {{ links: Object[], conflicts: Object[], blockedRows: Set<number>, summary: Object }}
 */
export async function resolveRelations({ supabase, companyId, targetKey, records, mapping = {}, options = {} }) {
  const conflicts = []
  const blocked = new Set()
  const links = records.map(() => ({}))
  if (!RELATIONAL_TARGETS.includes(targetKey) || !companyId || !records.length) {
    return { links, conflicts, blockedRows: blocked, summary: summarize(conflicts, records.length) }
  }

  const ref = await loadReference(supabase, companyId)
  const byName = indexBy(ref.customers, (c) => normalize(c.full_name))
  const byIdNo = indexBy(ref.customers, (c) => normalize(c.id_number))
  const byPhone = indexBy(ref.customers, (c) => normalize(c.phone))
  const byUnit = indexBy(ref.units, (u) => normalize(u.unit_number))
  const byBookingRef = new Map()
  for (const b of ref.bookings) {
    for (const k of [normalize(b.contract_number), normalize(b.ota_reservation_id)]) {
      if (k && !byBookingRef.has(k)) byBookingRef.set(k, [b])
      else if (k) byBookingRef.get(k).push(b)
    }
  }

  const block = (i) => blocked.add(i)
  const seenKeys = new Map()
  const fileIntervals = [] // { i, unitId, in, out }

  records.forEach((rec, i) => {
    const row = rec.index ?? i + 2
    const lk = rec.lookups || {}
    const data = rec.data || {}
    const link = links[i]

    /* ---------- العميل ---------- */
    if (targetKey === 'bookings') {
      const candidates =
        (normalize(lk.customer_id_number) && byIdNo.get(normalize(lk.customer_id_number))) ||
        (normalize(lk.customer_phone) && byPhone.get(normalize(lk.customer_phone))) ||
        (normalize(lk.customer_name) && byName.get(normalize(lk.customer_name))) || null
      const rawKey = lk.customer_id_number || lk.customer_phone || lk.customer_name
      if (!rawKey) {
        block(i)
        pushConflict(conflicts, {
          row, type: 'LINK_MISSING_COLUMN', field: 'customer_name', value: '—',
          reason: 'لم يتم ربط أي عمود يعرّف العميل (الاسم أو الهوية أو الجوال).',
          impact: 'سيُرفض السجل — الحجز يتطلب عميلاً مرتبطاً.',
          suggestion: 'ارجع لخطوة الربط واربط عمود «العميل» أو «هوية العميل».',
        })
      } else if (!candidates || !candidates.length) {
        block(i)
        pushConflict(conflicts, {
          row, type: 'LINK_NOT_FOUND', field: 'customer_name', value: rawKey,
          reason: `لا يوجد عميل مطابق للقيمة «${rawKey}» في قاعدة البيانات.`,
          impact: 'سيُرفض السجل ولن يُستورد الحجز.',
          suggestion: 'استورد العملاء أولاً من قسم «العملاء» ثم أعد استيراد الحجوزات.',
        })
      } else if (candidates.length > 1) {
        block(i)
        pushConflict(conflicts, {
          row, type: 'LINK_AMBIGUOUS', field: 'customer_name', value: rawKey,
          reason: `${candidates.length} عملاء يحملون نفس القيمة «${rawKey}».`,
          impact: 'سيُرفض السجل لتفادي ربطه بالعميل الخطأ.',
          suggestion: 'اربط عمود «هوية العميل» بدل الاسم لتمييز العملاء المتشابهين.',
        })
      } else link.customer_id = candidates[0].id

      /* ---------- الوحدة ---------- */
      const uKey = normalize(lk.unit_number)
      const uCands = uKey ? byUnit.get(uKey) : null
      if (!uKey) {
        block(i)
        pushConflict(conflicts, {
          row, type: 'LINK_MISSING_COLUMN', field: 'unit_number', value: '—',
          reason: 'عمود الوحدة غير مربوط أو فارغ في هذا الصف.',
          impact: 'سيُرفض السجل — الحجز يتطلب وحدة.',
          suggestion: 'اربط عمود «الوحدة» في خطوة الربط.',
        })
      } else if (!uCands || !uCands.length) {
        block(i)
        pushConflict(conflicts, {
          row, type: 'LINK_NOT_FOUND', field: 'unit_number', value: lk.unit_number,
          reason: `لا توجد وحدة برقم «${lk.unit_number}».`,
          impact: 'سيُرفض السجل ولن يُستورد الحجز.',
          suggestion: 'استورد الوحدات أولاً أو صحّح رقم الوحدة في الملف.',
        })
      } else if (uCands.length > 1) {
        block(i)
        pushConflict(conflicts, {
          row, type: 'LINK_AMBIGUOUS', field: 'unit_number', value: lk.unit_number,
          reason: `${uCands.length} وحدات تحمل الرقم «${lk.unit_number}».`,
          impact: 'سيُرفض السجل لتفادي حجز الوحدة الخطأ.',
          suggestion: 'وحّد أرقام الوحدات في النظام ثم أعد المحاولة.',
        })
      } else link.unit_id = uCands[0].id

      /* ---------- التواريخ والتعارضات ---------- */
      const ci = D(data.check_in_date), co = D(data.check_out_date)
      if (ci && co && co <= ci) {
        block(i)
        pushConflict(conflicts, {
          row, type: 'DATE_ORDER', field: 'check_out_date', value: `${ci} → ${co}`,
          reason: 'تاريخ الخروج مساوٍ أو أسبق من تاريخ الدخول.',
          impact: 'سيُرفض السجل — مدة الحجز غير صالحة.',
          suggestion: 'صحّح التواريخ في الملف أو تحقّق من تنسيق التاريخ (يوم/شهر/سنة).',
        })
      }
      const cancelled = String(data.status || '') === 'cancelled'
      if (link.unit_id && ci && co && !cancelled) {
        for (const prev of fileIntervals) {
          if (prev.unitId === link.unit_id && overlaps(ci, co, prev.in, prev.out)) {
            block(i)
            pushConflict(conflicts, {
              row, type: 'OVERLAP_IN_FILE', field: 'check_in_date', value: `${ci} → ${co}`,
              reason: `تعارض مع الصف ${prev.row} على نفس الوحدة «${lk.unit_number}» (${prev.in} → ${prev.out}).`,
              impact: 'سيُرفض هذا السجل ويُستورد الصف الأسبق فقط.',
              suggestion: 'احذف أحد الحجزين أو عدّل التواريخ داخل الملف.',
            })
            break
          }
        }
        if (options.checkDbOverlap !== false) {
          for (const b of ref.bookings) {
            if (b.unit_id !== link.unit_id) continue
            if (['cancelled'].includes(b.status)) continue
            if (normalize(b.contract_number) && normalize(b.contract_number) === normalize(data.contract_number)) continue
            if (overlaps(ci, co, D(b.check_in_date), D(b.check_out_date))) {
              block(i)
              pushConflict(conflicts, {
                row, type: 'OVERLAP_IN_DB', field: 'check_in_date', value: `${ci} → ${co}`,
                reason: `الوحدة محجوزة في النظام (${D(b.check_in_date)} → ${D(b.check_out_date)}) بالمرجع «${b.contract_number || b.ota_reservation_id || b.id.slice(0, 8)}».`,
                impact: 'سيُرفض السجل لمنع الحجز المزدوج على نفس الوحدة.',
                suggestion: 'ألغِ الحجز القائم أو عدّل تواريخ الحجز المستورد.',
              })
              break
            }
          }
        }
        fileIntervals.push({ i, row, unitId: link.unit_id, in: ci, out: co })
      }
    }

    /* ---------- العقود ---------- */
    if (targetKey === 'contracts') {
      const bKey = normalize(lk.booking_reference) || normalize(data.contract_number)
      let bk = bKey ? (byBookingRef.get(bKey) || [])[0] : null
      if (!bk && (lk.customer_name || lk.customer_id_number) && lk.unit_number) {
        const uid = (byUnit.get(normalize(lk.unit_number)) || [])[0]?.id
        const cid = ((normalize(lk.customer_id_number) && byIdNo.get(normalize(lk.customer_id_number))) ||
                     byName.get(normalize(lk.customer_name)) || [])[0]?.id
        if (uid && cid) bk = ref.bookings.find((b) => b.unit_id === uid && b.customer_id === cid) || null
      }
      if (!bk) {
        block(i)
        pushConflict(conflicts, {
          row, type: 'LINK_NOT_FOUND', field: 'booking_reference', value: lk.booking_reference || data.contract_number || '—',
          reason: 'لا يوجد حجز مطابق لرقم الحجز/العقد أو لتركيبة (العميل + الوحدة).',
          impact: 'سيُرفض السجل — العقد لا يُنشأ بدون حجز مرتبط.',
          suggestion: 'استورد الحجوزات أولاً ثم أعد استيراد العقود بنفس أرقام المراجع.',
        })
      } else {
        link.booking_id = bk.id
        const sd = D(data.start_date), ed = D(data.end_date)
        if (sd && ed && ed <= sd) {
          block(i)
          pushConflict(conflicts, {
            row, type: 'DATE_ORDER', field: 'end_date', value: `${sd} → ${ed}`,
            reason: 'تاريخ نهاية العقد مساوٍ أو أسبق من تاريخ البداية.',
            impact: 'سيُرفض السجل — مدة العقد غير صالحة.',
            suggestion: 'صحّح تواريخ العقد في الملف.',
          })
        } else if (sd && ed && (sd < D(bk.check_in_date) || ed > D(bk.check_out_date))) {
          pushConflict(conflicts, {
            row, type: 'DATES_OUTSIDE_BOOKING', field: 'start_date', value: `${sd} → ${ed}`,
            reason: `مدة العقد خارج مدة الحجز المرتبط (${D(bk.check_in_date)} → ${D(bk.check_out_date)}).`,
            impact: 'سيُستورد السجل لكن التقارير الزمنية قد تظهر فروقاً.',
            suggestion: 'وحّد تواريخ العقد مع تواريخ الحجز إن كان ذلك مقصوداً.',
          })
        }
        if (lk.unit_number) {
          const uid = (byUnit.get(normalize(lk.unit_number)) || [])[0]?.id
          if (uid && bk.unit_id && uid !== bk.unit_id) {
            pushConflict(conflicts, {
              row, type: 'UNIT_MISMATCH', field: 'unit_number', value: lk.unit_number,
              reason: 'الوحدة المذكورة في العقد تختلف عن وحدة الحجز المرتبط.',
              impact: 'سيُستورد العقد مرتبطاً بوحدة الحجز الفعلية.',
              suggestion: 'راجع رقم الوحدة في ملف العقود.',
            })
          }
        }
      }
    }

    /* ---------- الفواتير ---------- */
    if (targetKey === 'invoices') {
      const bKey = normalize(lk.booking_reference)
      if (bKey) {
        const cands = byBookingRef.get(bKey) || []
        if (!cands.length) {
          pushConflict(conflicts, {
            row, type: 'LINK_NOT_FOUND', field: 'booking_reference', value: lk.booking_reference,
            reason: `لا يوجد حجز بالمرجع «${lk.booking_reference}».`,
            impact: 'ستُستورد الفاتورة بدون ربط بالحجز (قد تختل تقارير الإيرادات لكل وحدة).',
            suggestion: 'استورد الحجوزات أولاً ليتم الربط تلقائياً.',
          })
        } else if (cands.length > 1) {
          pushConflict(conflicts, {
            row, type: 'LINK_AMBIGUOUS', field: 'booking_reference', value: lk.booking_reference,
            reason: `${cands.length} حجوزات تحمل نفس المرجع.`,
            impact: 'ستُستورد الفاتورة بدون ربط لتفادي الربط الخطأ.',
            suggestion: 'وحّد أرقام مراجع الحجوزات.',
          })
        } else link.booking_id = cands[0].id
      }
      const sub = Number(data.subtotal || 0)
      const vat = Number(data.vat_amount ?? 0)
      const tot = Number(data.total || 0)
      if (tot && Math.abs(sub + vat - tot) > 0.05) {
        pushConflict(conflicts, {
          row, type: 'AMOUNT_MISMATCH', field: 'total', value: `${sub} + ${vat} ≠ ${tot}`,
          reason: 'الإجمالي لا يساوي (الإجمالي قبل الضريبة + الضريبة).',
          impact: 'ستُستورد الفاتورة كما هي وقد تُظهر فروقاً محاسبية.',
          suggestion: 'صحّح أحد المبالغ أو اترك «قيمة الضريبة» فارغة لاحتسابها تلقائياً.',
        })
      }
      const paid = Number(lk.paid_amount ?? 0)
      if (paid && tot && paid > tot + 0.05) {
        pushConflict(conflicts, {
          row, type: 'PAID_EXCEEDS_TOTAL', field: 'paid_amount', value: `${paid} > ${tot}`,
          reason: 'المبلغ المدفوع أكبر من إجمالي الفاتورة.',
          impact: 'ستُستورد الفاتورة، ويُسجَّل الفرق كرصيد دائن للعميل.',
          suggestion: 'راجع سجل المدفوعات لهذه الفاتورة.',
        })
      }
    }

    /* ---------- تكرار المفتاح داخل الملف ---------- */
    const keyField = targetKey === 'invoices' ? 'invoice_number' : 'contract_number'
    const kv = normalize(data[keyField])
    if (kv) {
      if (seenKeys.has(kv)) {
        block(i)
        pushConflict(conflicts, {
          row, type: 'DUP_KEY_IN_FILE', field: keyField, value: data[keyField],
          reason: `المفتاح مكرر مع الصف ${seenKeys.get(kv)} داخل نفس الملف.`,
          impact: 'سيُرفض هذا السجل ويُحتفظ بأول ظهور للمفتاح.',
          suggestion: 'احذف الصفوف المكررة من الملف.',
        })
      } else seenKeys.set(kv, row)
    }
  })

  return { links, conflicts, blockedRows: blocked, summary: summarize(conflicts, records.length) }
}

/** يدمج المفاتيح المحلولة داخل صف الإدراج */
export function applyRelationLinks(rowObject, link = {}, targetKey) {
  const out = { ...rowObject }
  if (link.customer_id) out.customer_id = link.customer_id
  if (link.unit_id) out.unit_id = link.unit_id
  if (link.booking_id) out.booking_id = link.booking_id
  if (targetKey === 'bookings') {
    if (out.base_price == null) out.base_price = out.total_amount ?? 0
    if (out.total_amount == null) out.total_amount = out.base_price ?? 0
    if (!out.rent_period) out.rent_period = 'daily'
    if (!out.status) out.status = 'confirmed'
  }
  if (targetKey === 'invoices') {
    const sub = Number(out.subtotal || 0)
    if (out.vat_rate == null) out.vat_rate = 15
    if (out.vat_amount == null) out.vat_amount = Math.round(sub * Number(out.vat_rate) / 100 * 100) / 100
    if (out.total == null) out.total = Math.round((sub + Number(out.vat_amount)) * 100) / 100
    if (!out.invoice_type) out.invoice_type = 'simplified'
  }
  if (targetKey === 'contracts' && !out.status) out.status = 'active'
  return out
}

export function summarize(conflicts, rowsTotal = 0) {
  const byType = {}
  for (const c of conflicts) {
    byType[c.type] = byType[c.type] || { type: c.type, label: c.typeLabel, severity: c.severity, count: 0, rows: [] }
    byType[c.type].count++
    if (byType[c.type].rows.length < 50) byType[c.type].rows.push(c.row)
  }
  const errors = conflicts.filter((c) => c.severity === 'error')
  return {
    rowsTotal,
    total: conflicts.length,
    errors: errors.length,
    warnings: conflicts.length - errors.length,
    rejectedRows: new Set(errors.map((c) => c.row)).size,
    byType: Object.values(byType).sort((a, b) => b.count - a.count),
  }
}

/** تصدير تقرير التعارضات كـ CSV */
export function conflictsToCsv(conflicts) {
  const head = ['الصف', 'النوع', 'الخطورة', 'الحقل', 'القيمة', 'السبب', 'الأثر', 'الإجراء المقترح']
  const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
  const lines = [head.map(esc).join(',')]
  for (const c of conflicts) {
    lines.push([c.row, c.typeLabel, c.severity === 'error' ? 'رفض' : 'تنبيه', c.field, c.value, c.reason, c.impact, c.suggestion].map(esc).join(','))
  }
  return '\uFEFF' + lines.join('\n')
}
