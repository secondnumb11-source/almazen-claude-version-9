import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'

/*
  لوحة "نشاط وحدة سكنية" — للمدير/المحاسب فقط.
  - فلاتر: وحدة، فترة، نوع الإجراء، البحث النصي، الفرز، الترقيم.
  - إخفاء/تمويه الحقول الحساسة حسب دور المستخدم.
  - طباعة/تصدير PDF (عبر حوار طباعة المتصفح — "حفظ كـ PDF").
*/
const KINDS = ['إنشاء حجز', 'استلام (تسكين)', 'تسليم (إخلاء)', 'إلغاء حجز', 'استلام دفعة', 'إصدار فاتورة', 'تحديث تأمين']

export default function UnitActivityPanel() {
  const { profile, company } = useAuth()
  const role = profile?.role
  const isManager = role === 'owner' || role === 'manager'
  // المحاسب يرى المبالغ والإجراءات لكن الأرقام الشخصية (هاتف/هوية) مخفية
  const maskSensitive = !isManager

  const [units, setUnits] = useState([])
  const [unitId, setUnitId] = useState('')
  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
  const [from, setFrom] = useState(monthAgo)
  const [to, setTo] = useState(today)
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // فلاتر إضافية
  const [kindFilter, setKindFilter] = useState('')
  const [search, setSearch] = useState('')
  const [sortDir, setSortDir] = useState('desc') // desc = الأحدث، asc = الأقدم
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  useEffect(() => {
    if (!profile) return
    supabase.from('units').select('id, unit_number, category')
      .eq('company_id', profile.company_id).order('unit_number')
      .then(({ data }) => setUnits(data || []))
  }, [profile])

  const run = async () => {
    if (!unitId) return
    setBusy(true); setLoaded(false); setPage(1)
    try {
      const fromISO = from + 'T00:00:00'
      const toISO = to + 'T23:59:59'

      const { data: bks } = await supabase.from('bookings')
        .select(`id, contract_number, status, check_in_date, check_out_date,
                 actual_check_in, actual_check_out, total_amount, down_payment,
                 employee_id, cancelled_by, cancelled_at, cancel_reason, created_at,
                 customer:customers ( full_name, phone, id_number ),
                 employee:profiles!bookings_employee_id_fkey ( id, full_name, username, role ),
                 canceller:profiles!bookings_cancelled_by_fkey ( id, full_name, username, role )`)
        .eq('unit_id', unitId)
        .or(`created_at.gte.${fromISO},cancelled_at.gte.${fromISO},actual_check_in.gte.${fromISO},actual_check_out.gte.${fromISO}`)

      const bookingIds = (bks || []).map(b => b.id)

      let pays = []
      if (bookingIds.length) {
        const { data } = await supabase.from('payments')
          .select(`id, booking_id, amount, payment_type, method, payment_date,
                   reference_number, notes, created_at,
                   received:profiles!payments_received_by_fkey ( id, full_name, username, role )`)
          .in('booking_id', bookingIds)
          .gte('payment_date', from).lte('payment_date', to)
        pays = data || []
      }

      let invs = []
      if (bookingIds.length) {
        const { data } = await supabase.from('invoices')
          .select(`id, booking_id, invoice_number, invoice_type, total, issued_at,
                   issued:profiles!invoices_issued_by_fkey ( id, full_name, username, role )`)
          .in('booking_id', bookingIds)
          .gte('issued_at', fromISO).lte('issued_at', toISO)
        invs = data || []
      }

      let ins = []
      if (bookingIds.length) {
        const { data } = await supabase.from('insurance_records')
          .select(`id, booking_id, amount, status, deduction_amount, deduction_reason, updated_at,
                   updated:profiles!insurance_records_updated_by_fkey ( id, full_name, username, role )`)
          .in('booking_id', bookingIds)
          .gte('updated_at', fromISO).lte('updated_at', toISO)
        ins = data || []
      }

      const timeline = []
      const bkById = Object.fromEntries((bks || []).map(b => [b.id, b]))

      ;(bks || []).forEach(b => {
        const cust = b.customer?.full_name || '—'
        const phone = b.customer?.phone ? ` — ${maskPhone(b.customer.phone, maskSensitive)}` : ''
        if (b.created_at >= fromISO && b.created_at <= toISO) {
          timeline.push({
            at: b.created_at, kind: 'إنشاء حجز',
            detail: `عقد ${b.contract_number || b.id.slice(0, 8)} — المستأجر ${cust}${phone} — ${b.check_in_date} إلى ${b.check_out_date} — إجمالي ${Number(b.total_amount).toLocaleString()}`,
            _staff: b.employee, ref: b.contract_number || b.id.slice(0, 8),
          })
        }
        if (b.actual_check_in && b.actual_check_in >= fromISO && b.actual_check_in <= toISO) {
          timeline.push({
            at: b.actual_check_in, kind: 'استلام (تسكين)',
            detail: `المستأجر ${cust} — عقد ${b.contract_number || b.id.slice(0, 8)}`,
            _staff: b.employee, ref: b.contract_number || b.id.slice(0, 8),
          })
        }
        if (b.actual_check_out && b.actual_check_out >= fromISO && b.actual_check_out <= toISO) {
          timeline.push({
            at: b.actual_check_out, kind: 'تسليم (إخلاء)',
            detail: `المستأجر ${cust} — عقد ${b.contract_number || b.id.slice(0, 8)}`,
            _staff: b.employee, ref: b.contract_number || b.id.slice(0, 8),
          })
        }
        if (b.cancelled_at && b.cancelled_at >= fromISO && b.cancelled_at <= toISO) {
          timeline.push({
            at: b.cancelled_at, kind: 'إلغاء حجز',
            detail: `عقد ${b.contract_number || b.id.slice(0, 8)} — السبب: ${b.cancel_reason || '—'}`,
            _staff: b.canceller, ref: b.contract_number || b.id.slice(0, 8),
          })
        }
      })

      pays.forEach(p => {
        const b = bkById[p.booking_id]
        timeline.push({
          at: p.created_at, kind: 'استلام دفعة',
          detail: `${p.payment_type} — ${Number(p.amount).toLocaleString()} ر.س — ${p.method}${p.reference_number ? ' — مرجع ' + maskRef(p.reference_number, maskSensitive) : ''}${b ? ' — عقد ' + (b.contract_number || b.id.slice(0, 8)) : ''}`,
          _staff: p.received, ref: p.reference_number,
        })
      })

      invs.forEach(i => {
        const b = bkById[i.booking_id]
        timeline.push({
          at: i.issued_at, kind: 'إصدار فاتورة',
          detail: `${i.invoice_type === 'standard' ? 'ضريبية معتمدة' : 'ضريبية مبسّطة'} رقم ${i.invoice_number} — الإجمالي ${Number(i.total).toLocaleString()}${b ? ' — عقد ' + (b.contract_number || b.id.slice(0, 8)) : ''}`,
          _staff: i.issued, ref: i.invoice_number,
        })
      })

      ins.forEach(r => {
        const b = bkById[r.booking_id]
        timeline.push({
          at: r.updated_at, kind: 'تحديث تأمين',
          detail: `الحالة ${r.status} — قيمة ${Number(r.amount).toLocaleString()}${r.deduction_amount ? ' — خصم ' + r.deduction_amount : ''}${r.deduction_reason ? ' (' + r.deduction_reason + ')' : ''}${b ? ' — عقد ' + (b.contract_number || b.id.slice(0, 8)) : ''}`,
          _staff: r.updated,
        })
      })

      setRows(timeline)
      setLoaded(true)
    } finally { setBusy(false) }
  }

  // تطبيق الفلاتر والفرز والترقيم على مستوى الواجهة
  const filtered = useMemo(() => {
    let r = rows
    if (kindFilter) r = r.filter(x => x.kind === kindFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      r = r.filter(x =>
        (x.detail || '').toLowerCase().includes(q) ||
        (x.ref || '').toString().toLowerCase().includes(q) ||
        (x._staff?.full_name || '').toLowerCase().includes(q))
    }
    r = [...r].sort((a, b) => sortDir === 'desc' ? (a.at < b.at ? 1 : -1) : (a.at > b.at ? 1 : -1))
    return r
  }, [rows, kindFilter, search, sortDir])

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const curPage = Math.min(page, totalPages)
  const pageRows = filtered.slice((curPage - 1) * pageSize, curPage * pageSize)

  const staffMap = useMemo(() => {
    const m = {}
    filtered.forEach(r => { if (r._staff) m[r._staff.id] = r._staff })
    return m
  }, [filtered])

  const unit = units.find(u => u.id === unitId)

  const printPDF = () => {
    const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
      <title>تقرير نشاط وحدة ${unit?.unit_number || ''}</title>
      <style>
        @page { size: A4; margin: 14mm }
        body{font-family:'Segoe UI',Tahoma,sans-serif;padding:0;color:#111}
        h1{margin:0 0 4px;font-size:20px}
        .meta{color:#555;font-size:13px;margin-bottom:14px}
        .filters{background:#f7f7f7;border:1px solid #e5e5e5;padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:12px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #ccc;padding:6px 8px;text-align:right;vertical-align:top}
        th{background:#f4f4f4}
        tr:nth-child(even){background:#fafafa}
        .kind{font-weight:700;color:#0a5}
        .foot{margin-top:10px;font-size:11px;color:#666;text-align:center}
      </style></head><body>
      <h1>${company?.name || 'المنشأة'} — تقرير نشاط وحدة</h1>
      <div class="meta">
        الوحدة: <b>${unit?.unit_number || ''}</b> — الفترة: <b>${from}</b> إلى <b>${to}</b> —
        عدد الأحداث: <b>${filtered.length}</b> — أُصدر بواسطة: <b>${profile?.full_name || ''}</b> (${roleAr(role)})
      </div>
      <div class="filters">
        نوع الإجراء: <b>${kindFilter || 'الكل'}</b> — بحث: <b>${search || '—'}</b> — الفرز: <b>${sortDir === 'desc' ? 'الأحدث أولاً' : 'الأقدم أولاً'}</b>
        ${maskSensitive ? ' — <b>وضع الخصوصية مُفعّل (بعض الحقول مموّهة)</b>' : ''}
      </div>
      <table>
        <thead><tr><th>#</th><th>التاريخ والوقت</th><th>الإجراء</th><th>التفاصيل</th><th>المرجع</th><th>الموظف</th><th>الدور</th></tr></thead>
        <tbody>
          ${filtered.map((r, i) => `<tr>
            <td>${i + 1}</td>
            <td dir="ltr">${new Date(r.at).toLocaleString('ar-SA')}</td>
            <td class="kind">${r.kind}</td>
            <td>${r.detail}</td>
            <td dir="ltr">${r.ref || '—'}</td>
            <td>${r._staff?.full_name || '—'}${r._staff?.username ? ' (' + r._staff.username + ')' : ''}</td>
            <td>${roleAr(r._staff?.role)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="foot">طُبع في ${new Date().toLocaleString('ar-SA')} — لحفظ الملف كـ PDF اختر "حفظ كـ PDF" من حوار الطباعة.</div>
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),400)}</script>
      </body></html>`
    const w = window.open('', '_blank')
    w.document.write(html); w.document.close()
  }

  return (
    <div className="panel">
      <h3>نشاط وحدة سكنية — سجل تفصيلي لعمل الموظفين</h3>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
        اختر وحدة وفترة زمنية لعرض كل إجراء تم عليها ومن نفّذه.
        {maskSensitive && <span style={{ color: 'var(--gold)' }}> — وضع الخصوصية مفعّل لدورك: أرقام الهواتف/المراجع مموّهة.</span>}
      </p>
      <div className="grid3" style={{ marginBottom: 10 }}>
        <div className="fld"><label>الوحدة</label>
          <select value={unitId} onChange={e => setUnitId(e.target.value)}>
            <option value="">— اختر —</option>
            {units.map(u => <option key={u.id} value={u.id}>{u.unit_number} — {u.category}</option>)}
          </select></div>
        <div className="fld"><label>من تاريخ</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="fld"><label>إلى تاريخ</label><input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-gold btn-sm" disabled={busy || !unitId} onClick={run}>
          {busy ? '...جارٍ الجلب' : 'عرض النشاط'}
        </button>
        <button className="btn btn-sm" disabled={!filtered.length} onClick={printPDF}>🖨️ طباعة / حفظ PDF</button>
      </div>

      {loaded && (
        <>
          <div className="grid3" style={{ marginBottom: 8 }}>
            <div className="fld"><label>نوع الإجراء</label>
              <select value={kindFilter} onChange={e => { setKindFilter(e.target.value); setPage(1) }}>
                <option value="">الكل</option>
                {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </select></div>
            <div className="fld"><label>بحث نصي (تفاصيل/مرجع/موظف)</label>
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="اكتب للتصفية..." /></div>
            <div className="fld"><label>الفرز</label>
              <select value={sortDir} onChange={e => setSortDir(e.target.value)}>
                <option value="desc">الأحدث أولاً</option>
                <option value="asc">الأقدم أولاً</option>
              </select></div>
          </div>

          <div style={{ fontSize: 13, marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span>
              النتائج: <b>{total}</b> — الموظفون المشاركون: <b>{Object.keys(staffMap).length}</b> — الصفحة <b>{curPage}</b> / <b>{totalPages}</b>
            </span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ fontSize: 12 }}>لكل صفحة:</label>
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}>
                {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <button className="btn btn-sm" disabled={curPage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹ السابق</button>
              <button className="btn btn-sm" disabled={curPage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>التالي ›</button>
            </span>
          </div>

          <table className="tbl">
            <thead><tr>
              <th>#</th><th>التاريخ والوقت</th><th>الإجراء</th><th>التفاصيل</th>
              <th>المرجع</th><th>الموظف</th><th>الدور</th>
            </tr></thead>
            <tbody>
              {pageRows.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا توجد نتائج مطابقة للفلاتر</td></tr>}
              {pageRows.map((r, i) => (
                <tr key={i}>
                  <td>{(curPage - 1) * pageSize + i + 1}</td>
                  <td dir="ltr">{new Date(r.at).toLocaleString('ar-SA')}</td>
                  <td><b style={{ color: 'var(--gold)' }}>{r.kind}</b></td>
                  <td>{r.detail}</td>
                  <td dir="ltr">{maskRef(r.ref, maskSensitive) || '—'}</td>
                  <td>{r._staff?.full_name || '—'}{r._staff?.username && <div><small dir="ltr">{r._staff.username}</small></div>}</td>
                  <td>{roleAr(r._staff?.role)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

function roleAr(r) {
  return { owner: 'مالك', manager: 'مدير', accountant: 'محاسب', employee: 'موظف' }[r] || '—'
}
function maskPhone(v, mask) {
  if (!v) return ''
  if (!mask) return v
  const s = String(v)
  return s.length <= 4 ? '••••' : s.slice(0, 3) + '••••' + s.slice(-2)
}
function maskRef(v, mask) {
  if (!v) return v
  if (!mask) return v
  const s = String(v)
  return s.length <= 4 ? '••••' : s.slice(0, 2) + '•••' + s.slice(-2)
}
