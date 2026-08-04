import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import {
  TARGETS, autoMapColumns, classifySheet, detectVendor, transformRow,
  dedupe, buildReport, normalize,
} from '../lib/importEngine'
import {
  resolveRelations, applyRelationLinks, conflictsToCsv, RELATIONAL_TARGETS,
} from '../lib/importRelations'
import { PROVIDERS, getCredentials, saveCredentials, deleteCredentials } from '../lib/importProviders'
import {
  appendAudit, loadAudit, deleteAuditEntry, clearAudit,
  exportReportExcel, exportReportCsv, exportReportJson, exportReportPdf,
  exportAuditExcel, exportAuditCsv, exportAuditJson,
} from '../lib/importAudit'

/* ============================================================================
   استيراد البيانات الذكي — معالج من 6 خطوات
   المصدر ← الكشف والتصنيف ← تأكيد خريطة الحقول ← المراجعة والإصلاح ← التنفيذ ← التقرير
============================================================================ */

const STEPS = [
  { key: 'source', label: 'الاتصال والجلب', icon: '📥' },
  { key: 'detect', label: 'الكشف والتصنيف', icon: '🧭' },
  { key: 'map', label: 'خريطة الحقول', icon: '🔗' },
  { key: 'normalize', label: 'قواعد التطبيع', icon: '🧪' },
  { key: 'review', label: 'المراجعة والإصلاح', icon: '🩺' },
  { key: 'run', label: 'التنفيذ', icon: '🚀' },
  { key: 'report', label: 'التقرير والتصدير', icon: '📄' },
]


const C = {
  navy: '#0A192F', gold: '#F5D97E', line: '#e3e8ef',
  ok: '#0f9d58', warn: '#b7791f', err: '#c53030', muted: '#64748b',
}

const box = { border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, background: '#fff' }
const btn = (primary) => ({
  padding: '9px 16px', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 700,
  border: primary ? 'none' : `1px solid ${C.line}`,
  background: primary ? C.navy : '#fff', color: primary ? C.gold : C.navy,
})
const chip = (bg, fg) => ({ background: bg, color: fg, padding: '2px 9px', borderRadius: 20, fontSize: 11.5, fontWeight: 700, display: 'inline-block' })

/* --------------------------- أدوات قراءة المصادر --------------------------- */
function parsePastedText(text) {
  const t = (text || '').trim()
  if (!t) return null
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      const j = JSON.parse(t)
      const arr = Array.isArray(j) ? j : (Array.isArray(j.data) ? j.data : [j])
      return arr.filter(r => r && typeof r === 'object')
    } catch { /* ليست JSON */ }
  }
  const delim = (t.split('\n')[0].match(/\t/g) || []).length >= (t.split('\n')[0].match(/[,;]/g) || []).length ? '\t'
    : (t.split('\n')[0].includes(';') ? ';' : ',')
  const wb = XLSX.read(t, { type: 'string', FS: delim })
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
}

function googleSheetCsvUrl(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (!m) return null
  const gid = (String(url).match(/[#&?]gid=(\d+)/) || [])[1] || '0'
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`
}

/* ============================== المكوّن ==================================== */
export default function DataImport() {
  const { profile, toast } = useAuth()
  const fileRef = useRef(null)

  const [step, setStep] = useState(0)
  const [sheets, setSheets] = useState([])          // [{name, headers, rows, target, confidence}]
  const [activeSheet, setActiveSheet] = useState(0)
  const [vendor, setVendor] = useState(null)
  const [mapping, setMapping] = useState({})
  const [scores, setScores] = useState({})
  const [suggestions, setSuggestions] = useState({})
  const [aiBusy, setAiBusy] = useState(false)
  const [aiNote, setAiNote] = useState(null)
  const [validation, setValidation] = useState(null)
  const [dupStrategy, setDupStrategy] = useState('skip')  // skip | update | insert
  const [skipInvalid, setSkipInvalid] = useState(true)
  const [checkDbOverlap, setCheckDbOverlap] = useState(true)
  const [conflictFilter, setConflictFilter] = useState('all')
  const [createMissingProperties, setCreateMissingProperties] = useState(true)
  const [pasteText, setPasteText] = useState('')
  const [sheetUrl, setSheetUrl] = useState('')
  const [progress, setProgress] = useState(null)
  const [report, setReport] = useState(null)
  const [busy, setBusy] = useState(false)
  const abortRef = useRef(false)                 // إلغاء آمن أثناء التشغيل
  const [cancelling, setCancelling] = useState(false)
  const [sourceTab, setSourceTab] = useState('connect') // 'connect' | 'fetch'
  const [normalizeRules, setNormalizeRules] = useState([])       // القواعد المقترحة من AI
  const [activeRuleIds, setActiveRuleIds] = useState({})         // { ruleId: true/false }
  const [normalizeBusy, setNormalizeBusy] = useState(false)


  const sheet = sheets[activeSheet]
  const targetKey = sheet?.target
  const target = targetKey ? TARGETS[targetKey] : null

  const notify = (m, err) => (toast ? toast(m, err) : console.log(m))

  /* ----------------------------- 1) المصادر ------------------------------- */
  const ingest = (list, sourceName) => {
    const prepared = list
      .filter(s => s.rows.length)
      .map(s => {
        const headers = Object.keys(s.rows[0] || {}).filter(h => String(h).trim() !== '')
        const cls = classifySheet(headers, s.rows.slice(0, 30))
        return { name: s.name, headers, rows: s.rows, target: cls.best.target, confidence: cls.best.confidence, ranked: cls.ranked }
      })
    if (!prepared.length) return notify('لا توجد بيانات قابلة للقراءة في المصدر', true)
    setSheets(prepared)
    setActiveSheet(0)
    setVendor(detectVendor(prepared[0].headers))
    setReport(null); setValidation(null); setAiNote(null)
    applyAutoMap(prepared[0])
    setStep(1)
    notify(`✓ تمت قراءة ${prepared.length} ورقة من ${sourceName} — إجمالي ${prepared.reduce((a, s) => a + s.rows.length, 0)} صف`)
  }

  const readWorkbook = (wb) =>
    wb.SheetNames.map(n => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }) }))

  const onFile = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      const isCsv = /\.(csv|txt|tsv)$/i.test(file.name)
      const wb = isCsv
        ? XLSX.read(await file.text(), { type: 'string' })
        : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      ingest(readWorkbook(wb), file.name)
    } catch (e) { notify('تعذّر قراءة الملف: ' + e.message, true) }
    setBusy(false)
  }

  const onPaste = () => {
    try {
      const rows = parsePastedText(pasteText)
      if (!rows?.length) return notify('لم أفهم النص — الصقه كـ CSV / TSV / JSON', true)
      ingest([{ name: 'نص ملصق', rows }], 'اللصق المباشر')
    } catch (e) { notify('تعذّر تحليل النص: ' + e.message, true) }
  }

  const onGoogleSheet = async () => {
    const url = googleSheetCsvUrl(sheetUrl)
    if (!url) return notify('رابط Google Sheets غير صالح', true)
    setBusy(true)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const wb = XLSX.read(await res.text(), { type: 'string' })
      ingest(readWorkbook(wb), 'Google Sheets')
    } catch (e) {
      notify('تعذّر جلب الجدول — تأكد أن المشاركة «أي شخص لديه الرابط». (' + e.message + ')', true)
    }
    setBusy(false)
  }

  const downloadTemplate = (key) => {
    const t = TARGETS[key]
    const cols = Object.entries(t.fields).filter(([, f]) => !f.skip)
    const header = Object.fromEntries(cols.map(([, f]) => [f.label, '']))
    const ws = XLSX.utils.json_to_sheet([header])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, t.label.slice(0, 28))
    XLSX.writeFile(wb, `قالب-${t.label}.xlsx`)
  }

  /* --------------------------- 2) التصنيف --------------------------------- */
  const applyAutoMap = (s, key) => {
    const tk = key || s.target
    const { mapping: m, scores: sc, suggestions: sg } = autoMapColumns(s.headers, tk, s.rows.slice(0, 40))
    setMapping(m); setScores(sc); setSuggestions(sg)
  }

  const changeTarget = (key) => {
    const next = sheets.map((s, i) => (i === activeSheet ? { ...s, target: key } : s))
    setSheets(next)
    applyAutoMap(next[activeSheet], key)
    setValidation(null)
  }

  const selectSheet = (i) => {
    setActiveSheet(i)
    setVendor(detectVendor(sheets[i].headers))
    applyAutoMap(sheets[i])
    setValidation(null); setReport(null)
  }

  /* ------------------------- الذكاء الاصطناعي ----------------------------- */
  const callAi = async (payload) => {
    const { data: sess } = await supabase.auth.getSession()
    const tokenValue = sess?.session?.access_token
    if (!tokenValue) throw new Error('انتهت الجلسة — أعد تسجيل الدخول')
    const { data, error } = await supabase.functions.invoke('ai-import-mapper', {
      body: payload,
      headers: { Authorization: `Bearer ${tokenValue}` },
    })
    if (error) {
      let details = error.message
      try { details = await error.context.text() } catch { /* ignore */ }
      throw new Error(details)
    }
    if (data?.error) throw new Error(data.error)
    return data
  }

  const aiClassify = async () => {
    if (!sheet) return
    setAiBusy(true); setAiNote(null)
    try {
      const d = await callAi({
        mode: 'classify',
        headers: sheet.headers,
        sampleRows: sheet.rows.slice(0, 8),
        targets: Object.entries(TARGETS).map(([k, t]) => ({ key: k, label: t.label })).map(x => x.key),
      })
      const r = d.result
      if (r?.target && TARGETS[r.target]) {
        changeTarget(r.target)
        setAiNote(`🤖 الذكاء الاصطناعي صنّف هذه الورقة كـ «${TARGETS[r.target].label}» بثقة ${Math.round((r.confidence || 0) * 100)}% — ${r.reason || ''}`)
      } else setAiNote('🤖 لم يتمكن الذكاء الاصطناعي من تحديد قسم مناسب — استخدم الاختيار اليدوي.')
    } catch (e) { notify('تعذّر تشغيل التصنيف الذكي: ' + e.message, true) }
    setAiBusy(false)
  }

  const aiMap = async () => {
    if (!sheet || !target) return
    setAiBusy(true); setAiNote(null)
    try {
      const fields = Object.entries(target.fields).filter(([, f]) => !f.skip)
        .map(([key, f]) => ({ key, label: f.label, type: f.type, required: !!f.required }))
      const d = await callAi({ mode: 'map', headers: sheet.headers, sampleRows: sheet.rows.slice(0, 8), fields })
      const next = { ...mapping }, nextScores = { ...scores }
      let changed = 0
      for (const m of d.result?.mappings || []) {
        if (!target.fields[m.field]) continue
        if (next[m.field] !== m.column) changed++
        next[m.field] = m.column
        nextScores[m.field] = m.confidence ?? 0.9
      }
      setMapping(next); setScores(nextScores); setValidation(null)
      setAiNote(`🤖 الذكاء الاصطناعي راجع الأعمدة وحدّث ${changed} ربط.`)
    } catch (e) { notify('تعذّر تشغيل المطابقة الذكية: ' + e.message, true) }
    setAiBusy(false)
  }

  const aiFix = async () => {
    if (!validation) return
    setAiBusy(true)
    try {
      const issues = validation.report.reasons.slice(0, 15).map(r => `${r.reason} (${r.count} صف)`).join('\n')
      const d = await callAi({ mode: 'fix', headers: sheet.headers, sampleRows: sheet.rows.slice(0, 5), issues })
      setValidation(v => ({ ...v, aiSuggestions: d.result?.suggestions || [] }))
    } catch (e) { notify('تعذّر جلب اقتراحات الإصلاح: ' + e.message, true) }
    setAiBusy(false)
  }

  /* --------- توليد قواعد التطبيع القابلة للمراجعة (AI) ---------- */
  const aiNormalize = async () => {
    if (!sheet || !target) return
    setNormalizeBusy(true)
    try {
      const fields = Object.entries(target.fields).filter(([, f]) => !f.skip)
        .map(([key, f]) => ({ key, label: f.label, type: f.type }))
      const d = await callAi({
        mode: 'normalize',
        headers: sheet.headers,
        sampleRows: sheet.rows.slice(0, 10),
        fields,
        mapping,
      })
      const rules = (d.result?.rules || []).map((r, i) => ({ ...r, id: r.id || `rule_${i}_${r.field}_${r.ruleType}` }))
      setNormalizeRules(rules)
      // تفعيل تلقائي للقواعد عالية الثقة
      const initial = {}
      for (const r of rules) initial[r.id] = (r.confidence ?? 0.7) >= 0.6 && r.severity !== 'critical'
      setActiveRuleIds(initial)
    } catch (e) { notify('تعذّر توليد قواعد التطبيع: ' + e.message, true) }
    setNormalizeBusy(false)
  }

  /** يطبّق القواعد المفعّلة على الصفوف الخام قبل transformRow */
  const applyNormalizationRules = (rows) => {
    const active = normalizeRules.filter(r => activeRuleIds[r.id])
    if (!active.length) return rows
    return rows.map(row => {
      const out = { ...row }
      for (const rule of active) {
        const col = rule.column
        if (!col || !(col in out)) continue
        const v = out[col]
        if (v == null || String(v).trim() === '') continue
        try {
          const s = String(v).trim()
          switch (rule.ruleType) {
            case 'trim': out[col] = s; break
            case 'case': out[col] = s.toLowerCase(); break
            case 'phone': {
              const digits = s.replace(/[^\d+]/g, '').replace(/^\+?966/, '0').replace(/^966/, '0')
              out[col] = digits.startsWith('0') ? digits.slice(0, 10) : digits
              break
            }
            case 'currency': out[col] = s.replace(/[^\d.-]/g, ''); break
            case 'id': out[col] = s.replace(/[^\d]/g, ''); break
            default: /* enum/date/split/merge/other → نتركها للـ transformRow */ break
          }
        } catch { /* تجاهل الأخطاء */ }
      }
      return out
    })
  }



  /* -------------------------- 4) التحقق والمراجعة -------------------------- */
  const missingRequired = useMemo(() => {
    if (!target) return []
    return Object.entries(target.fields)
      .filter(([k, f]) => f.required && !mapping[k])
      .map(([, f]) => f.label)
  }, [target, mapping])

  const runValidation = async () => {
    if (!sheet || !target) return
    if (missingRequired.length) return notify('أكمل ربط الحقول الإلزامية: ' + missingRequired.join('، '), true)
    setBusy(true)
    try {
      const normalizedRows = applyNormalizationRules(sheet.rows)
      const results = normalizedRows.map((raw, i) => ({ index: i + 2, raw, ...transformRow(raw, targetKey, mapping) }))

      const valid = results.filter(r => r.ok)
      const invalid = results.filter(r => !r.ok)

      let existingKeys = []
      const dedupeKey = target.dedupeKey
      if (dedupeKey && profile?.company_id) {
        const { data } = await supabase.from(target.table).select(dedupeKey)
          .eq('company_id', profile.company_id).limit(10000)
        existingKeys = (data || []).map(r => r[dedupeKey]).filter(Boolean)
      }
      const d = dedupe(valid, targetKey, existingKeys)

      // ---- ربط المفاتيح وكشف التعارضات (العقود/الحجوزات/الفواتير) ----
      let conflicts = [], linkSummary = null, linkByRow = {}
      if (RELATIONAL_TARGETS.includes(targetKey)) {
        const pool = [...d.unique, ...d.duplicatesInDb]
        const rel = await resolveRelations({
          supabase, companyId: profile.company_id, targetKey,
          records: pool, mapping, options: { checkDbOverlap },
        })
        conflicts = rel.conflicts
        linkSummary = rel.summary
        pool.forEach((rec, i) => { linkByRow[rec.index] = rel.links[i] })
        const rejectedRows = new Set(rel.conflicts.filter(c => c.severity === 'error').map(c => c.row))
        if (rejectedRows.size) {
          const reasonsFor = (row) => rel.conflicts
            .filter(c => c.row === row && c.severity === 'error')
            .map(c => ({ field: c.field, code: c.type, message: `${c.typeLabel}: ${c.reason}`, suggestion: c.suggestion }))
          const keep = (list) => list.filter(r => !rejectedRows.has(r.index))
          for (const rec of pool) {
            if (rejectedRows.has(rec.index)) invalid.push({ ...rec, ok: false, errors: reasonsFor(rec.index) })
          }
          d.unique = keep(d.unique)
          d.duplicatesInDb = keep(d.duplicatesInDb)
        }
      }

      const rep = buildReport({
        targetKey, rowsTotal: sheet.rows.length, results,
        inserted: 0, updated: 0, skipped: 0, failedRows: invalid, vendor,
      })
      setValidation({ results, valid, invalid, ...d, report: rep, dedupeKey, conflicts, linkSummary, linkByRow })
      setStep(4)
    } catch (e) { notify('فشل التحقق: ' + e.message, true) }
    setBusy(false)
  }

  /* ------------------------------ 5) التنفيذ ------------------------------ */
  const resolveProperties = async (records) => {
    const names = [...new Set(records.map(r => r.lookups?.property_name).filter(Boolean))]
    if (!names.length) return {}
    const { data } = await supabase.from('properties').select('id,name').eq('company_id', profile.company_id).limit(5000)
    const map = {}
    for (const p of data || []) map[normalize(p.name)] = p.id
    const missing = names.filter(n => !map[normalize(n)])
    if (missing.length && createMissingProperties) {
      const { data: created } = await supabase.from('properties')
        .insert(missing.map(name => ({ company_id: profile.company_id, name }))).select('id,name')
      for (const p of created || []) map[normalize(p.name)] = p.id
    }
    return map
  }

  const runImport = async () => {
    if (!validation) return
    if (!profile?.company_id) return notify('تعذّر تحديد الشركة — أعد تسجيل الدخول', true)
    setStep(5); setBusy(true)
    abortRef.current = false; setCancelling(false)
    const startedAt = new Date().toISOString()

    let toInsert = [...validation.unique]
    let toUpsert = []
    let skipped = validation.duplicatesInFile.length
    if (dupStrategy === 'update') toUpsert = validation.duplicatesInDb
    else if (dupStrategy === 'insert') toInsert = [...toInsert, ...validation.duplicatesInDb]
    else skipped += validation.duplicatesInDb.length
    if (!skipInvalid) { /* الصفوف غير الصالحة تبقى مرفوضة دائماً */ }

    const propMap = targetKey === 'units' ? await resolveProperties([...toInsert, ...toUpsert]) : {}
    const decorate = (rec) => {
      const row = { ...rec.data, company_id: profile.company_id }
      if (targetKey === 'units' && rec.lookups?.property_name) {
        const pid = propMap[normalize(rec.lookups.property_name)]
        if (pid) row.property_id = pid
      }
      if (RELATIONAL_TARGETS.includes(targetKey)) {
        Object.assign(row, applyRelationLinks(row, validation.linkByRow?.[rec.index] || {}, targetKey))
      }
      if (targetKey === 'invoices' && profile?.id) row.issued_by = profile.id
      if (targetKey === 'contracts' && profile?.id) row.created_by = profile.id
      if (['customers', 'expenses'].includes(targetKey) && profile?.id) row.created_by = profile.id
      if (profile?.branch_id && ['customers', 'units', 'expenses', 'properties', 'tenants', 'bookings', 'contracts', 'invoices'].includes(targetKey)) {
        row.branch_id = profile.branch_id
      }
      return row
    }

    const failedRows = [...validation.invalid]
    let inserted = 0, updated = 0
    const CHUNK = 100
    const jobs = [
      { list: toInsert, mode: 'insert' },
      { list: toUpsert, mode: 'upsert' },
    ]
    let done = 0
    const totalOps = toInsert.length + toUpsert.length
    setProgress({ done: 0, total: totalOps })
    let aborted = false

    for (const job of jobs) {
      for (let i = 0; i < job.list.length; i += CHUNK) {
        // إلغاء آمن: نتوقف على حدود الدفعة فقط — لا يُقطع أي طلب في منتصفه،
        // فتبقى السجلات المُدرجة سليمة ويُبنى تقرير جزئي دقيق.
        if (abortRef.current) { aborted = true; break }
        const slice = job.list.slice(i, i + CHUNK)
        const payload = slice.map(decorate)
        let error = null
        if (job.mode === 'insert') {
          ({ error } = await supabase.from(target.table).insert(payload))
        } else {
          ({ error } = await supabase.from(target.table).upsert(payload, { onConflict: validation.dedupeKey }))
        }
        if (error) {
          // إعادة المحاولة صفاً صفاً لعزل السجل المسبب للخطأ
          for (const rec of slice) {
            const one = decorate(rec)
            const r = job.mode === 'insert'
              ? await supabase.from(target.table).insert(one)
              : await supabase.from(target.table).upsert(one, { onConflict: validation.dedupeKey })
            if (r.error) {
              failedRows.push({ ...rec, errors: [{ field: '—', code: 'DB_ERROR', message: r.error.message, suggestion: dbHint(r.error.message) }] })
            } else if (job.mode === 'insert') inserted++
            else updated++
          }
        } else if (job.mode === 'insert') inserted += slice.length
        else updated += slice.length
        done += slice.length
        setProgress({ done, total: totalOps })
      }
      if (aborted) break
    }

    const rep = buildReport({
      targetKey, rowsTotal: sheet.rows.length, results: validation.results,
      inserted, updated,
      skipped: skipped + (aborted ? Math.max(0, totalOps - done) : 0),
      failedRows, vendor,
      startedAt, endedAt: new Date().toISOString(),
    })
    rep.cancelled = aborted
    if (aborted) rep.status = 'cancelled'
    setReport(rep); setBusy(false); setCancelling(false); setStep(6)
    // سجل تدقيق
    try {
      appendAudit({
        userId: profile?.id, userEmail: profile?.email, companyId: profile?.company_id,
        source: sheet?.name || '—', vendor: rep.vendor, targetLabel: rep.targetLabel, table: rep.table,
        rowsTotal: rep.rowsTotal, inserted: rep.inserted, updated: rep.updated, skipped: rep.skipped,
        failed: rep.failed, successRate: rep.successRate,
        mapping: { ...mapping }, dupStrategy,
        autoFixes: rep.autoFixes, reasons: rep.reasons, warnings: rep.warnings,
        status: aborted ? 'cancelled' : 'completed',
        cancelled: aborted,
      })
    } catch { /* ignore quota */ }
    notify(aborted
      ? `⛔ أُلغي الاستيراد بأمان — حُفظ ${inserted}${updated ? ` • حُدّث ${updated}` : ''} • تم تخطّي ${Math.max(0, totalOps - done)} سجل لم يُرسل`
      : `✓ اكتمل الاستيراد — أُضيف ${inserted}${updated ? ` • حُدّث ${updated}` : ''}${rep.failed ? ` • فشل ${rep.failed}` : ''}`,
      aborted)
  }

  const dbHint = (msg) => {
    const m = String(msg)
    if (m.includes('duplicate key')) return 'السجل موجود مسبقاً — اختر «تحديث السجلات المطابقة» في خطوة المراجعة.'
    if (m.includes('violates foreign key')) return 'قيمة مرتبطة غير موجودة — أنشئ السجل المرجعي أولاً (مثل العقار).'
    if (m.includes('invalid input value for enum')) return 'قيمة تصنيف غير مقبولة — عدّل ربط العمود أو صحّح القيمة في الملف.'
    if (m.includes('null value in column')) return 'حقل إلزامي فارغ في قاعدة البيانات — اربط العمود المناسب.'
    if (m.toLowerCase().includes('row-level security')) return 'صلاحيات غير كافية — تأكد من دورك في الشركة.'
    return 'راجع القيمة في الملف ثم أعد المحاولة.'
  }

  const downloadReport = () => {
    if (!report) return
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      'القسم': report.targetLabel, 'الجدول': report.table, 'نظام المصدر': report.vendor || '—',
      'إجمالي الصفوف': report.rowsTotal, 'مضاف': report.inserted, 'محدّث': report.updated,
      'متخطى': report.skipped, 'مرفوض': report.failed, 'نسبة النجاح %': report.successRate,
    }]), 'الملخص')
    if (report.reasons.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(report.reasons.map(r => ({ 'السبب': r.reason, 'عدد الصفوف': r.count }))), 'أسباب الرفض')
    if (report.warnings.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(report.warnings.map(r => ({ 'التنبيه': r.message, 'عدد الصفوف': r.count }))), 'التنبيهات')
    if (report.failedRows.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(report.failedRows.map(f => ({
        'رقم الصف': f.index, 'الأخطاء': (f.errors || []).map(e => e.message).join(' | '),
        'الحل المقترح': (f.errors || []).map(e => e.suggestion).filter(Boolean).join(' | '),
        ...f.raw,
      }))), 'الصفوف المرفوضة')
    }
    XLSX.writeFile(wb, `تقرير-استيراد-${report.targetLabel}-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const reset = () => {
    setSheets([]); setStep(0); setMapping({}); setScores({}); setSuggestions({})
    setValidation(null); setReport(null); setVendor(null); setProgress(null); setAiNote(null)
    setNormalizeRules([]); setActiveRuleIds({}); setSourceTab('connect')
  }


  /* ================================ العرض ================================= */
  return (
    <div style={{ display: 'grid', gap: 14 }}>

      {/* ─────────── بطاقة شرح الميزة الذكية ─────────── */}
      <div className="panel" style={{
        background: 'linear-gradient(135deg,#0A192F 0%,#0d2040 55%,#1a3670 100%)',
        color: C.gold, border: '1px solid rgba(245,217,126,.35)', boxShadow: '0 4px 24px rgba(11,30,63,.35)',
      }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 34 }}>🧠</span>
          <div>
            <h3 style={{ margin: 0, color: C.gold }}>جمع البيانات بالذكاء الاصطناعي</h3>
            <p style={{ margin: '4px 0 0', color: '#e8ecf3', fontSize: 13, lineHeight: 1.7 }}>
              انقل بياناتك كاملة من أي نظام منافس (إيجار، قيود، دفترة، Hostaway، Cloudbeds، Guesty، Booking، Airbnb، Odoo، QuickBooks، Zoho)
              إلى منصة المازن عبر معالج من ست خطوات: يقرأ الملف، يتعرّف على نظام المصدر، يصنّف كل ورقة إلى القسم الصحيح،
              يطابق الأعمدة بالذكاء الاصطناعي، يُصلح الأخطاء تلقائياً، ثم يوزّع السجلات على الجداول الصحيحة ويصدر تقريراً مفصلاً.
            </p>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 10, marginTop: 10 }}>
          {[
            ['🤖', 'مطابقة أعمدة بالذكاء الاصطناعي', 'نموذج Gemini يقرأ أسماء الأعمدة وعيّنات القيم ويقترح الربط الأدق.'],
            ['🧭', 'تصنيف تلقائي للأوراق', 'كل ورقة في الملف تُوجَّه للقسم الصحيح: عملاء، مستأجرون، وحدات، عقارات، حسابات، مصروفات، موظفون.'],
            ['🏷️', 'كشف نظام المصدر', 'بصمات جاهزة لـ 12 نظاماً منافساً تُفعِّل قالب الربط المناسب فوراً.'],
            ['🩺', 'إصلاح ذكي للأخطاء', 'توحيد الجوال والتواريخ والعملات، استنتاج نوع الهوية، وترجمة التصنيفات العربية/الإنجليزية.'],
            ['🔁', 'منع التكرار', 'مقارنة مع بياناتك الحالية مع خيار التخطي أو التحديث أو الإضافة.'],
            ['📄', 'تقرير مفصّل', 'الناجح والمرفوض وأسباب الرفض والتنبيهات، قابل للتنزيل كملف Excel.'],
          ].map(([ic, t, d]) => (
            <div key={t} style={{ background: 'rgba(255,255,255,.07)', borderRadius: 10, padding: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: C.gold }}>{ic} {t}</div>
              <div style={{ fontSize: 12, color: '#dbe3ee', marginTop: 4, lineHeight: 1.6 }}>{d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ─────────── شريط الخطوات ─────────── */}
      <div className="panel" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {STEPS.map((s, i) => (
          <React.Fragment key={s.key}>
            <button
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              style={{
                ...btn(i === step), opacity: i > step ? .45 : 1,
                cursor: i < step ? 'pointer' : 'default', padding: '7px 12px', fontSize: 12.5,
              }}>
              {s.icon} {i + 1}. {s.label}
            </button>
            {i < STEPS.length - 1 && <span style={{ color: C.muted }}>›</span>}
          </React.Fragment>
        ))}
        {sheets.length > 0 && <button onClick={reset} style={{ ...btn(false), marginInlineStart: 'auto' }}>↺ البدء من جديد</button>}
      </div>

      {/* ══════════════ الخطوة 1: المصدر ══════════════ */}
      {step === 0 && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="panel">
            <h4 style={{ marginTop: 0 }}>📥 اختر مصدر البيانات</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>

              <div style={box}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>📁 ملف Excel / CSV</div>
                <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 10px' }}>
                  ‎.xlsx / .xls / .csv / .tsv — يدعم الملفات متعددة الأوراق ويصنّف كل ورقة تلقائياً.
                </p>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" style={{ display: 'none' }}
                  onChange={e => onFile(e.target.files?.[0])} />
                <button style={btn(true)} onClick={() => fileRef.current?.click()} disabled={busy}>
                  {busy ? 'جارٍ القراءة…' : 'اختيار ملف'}
                </button>
              </div>

              <div style={box}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>📝 لصق مباشر</div>
                <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 8px' }}>الصق من Excel أو Google Sheets أو JSON — يُكتشف الفاصل تلقائياً.</p>
                <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={4}
                  placeholder={'الاسم\tالجوال\tرقم الهوية\nأحمد\t0551234567\t1012345678'}
                  style={{ width: '100%', border: `1px solid ${C.line}`, borderRadius: 8, padding: 8, fontSize: 12.5, fontFamily: 'monospace' }} />
                <button style={{ ...btn(true), marginTop: 8 }} onClick={onPaste}>تحليل النص</button>
              </div>

              <div style={box}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>🔗 رابط Google Sheets</div>
                <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 8px' }}>يجب أن تكون المشاركة «أي شخص لديه الرابط».</p>
                <input value={sheetUrl} onChange={e => setSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  style={{ width: '100%', border: `1px solid ${C.line}`, borderRadius: 8, padding: 8, fontSize: 12.5 }} />
                <button style={{ ...btn(true), marginTop: 8 }} onClick={onGoogleSheet} disabled={busy}>جلب البيانات</button>
            </div>
          </div>

          <ProviderConnectPanel onFetched={(rows, name) => ingest([{ name, rows }], name)} notify={notify} />
          <AuditLogPanel />

          </div>

          <div className="panel">
            <h4 style={{ marginTop: 0 }}>📋 القوالب الجاهزة لكل قسم</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 10 }}>
              {Object.entries(TARGETS).map(([k, t]) => (
                <div key={k} style={box}>
                  <div style={{ fontWeight: 800 }}>{t.icon} {t.label}</div>
                  <div style={{ fontSize: 12, color: C.muted, margin: '4px 0 8px', lineHeight: 1.6 }}>{t.hint}</div>
                  <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 8 }}>الوجهة: <code>{t.table}</code> • {t.section}</div>
                  <button style={btn(false)} onClick={() => downloadTemplate(k)}>⬇ تنزيل القالب</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ الخطوة 2: الكشف والتصنيف ══════════════ */}
      {step === 1 && sheet && (
        <div className="panel" style={{ display: 'grid', gap: 12 }}>
          <h4 style={{ margin: 0 }}>🧭 الكشف والتصنيف التلقائي</h4>

          {vendor && (
            <div style={{ ...box, borderColor: '#bfdbfe', background: '#eff6ff' }}>
              🏷️ تم التعرّف على نظام المصدر: <b>{vendor.name}</b> — بثقة {Math.round(vendor.confidence * 100)}%.
              تم تفعيل قالب الربط المناسب تلقائياً.
            </div>
          )}
          {aiNote && <div style={{ ...box, borderColor: '#c7d2fe', background: '#eef2ff', fontSize: 13 }}>{aiNote}</div>}

          {sheets.length > 1 && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>أوراق الملف ({sheets.length}) — اختر الورقة لاستيرادها:</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {sheets.map((s, i) => (
                  <button key={s.name + i} onClick={() => selectSheet(i)} style={{ ...btn(i === activeSheet), padding: '7px 12px', fontSize: 12.5 }}>
                    {s.name} <span style={{ opacity: .75 }}>({s.rows.length} صف → {TARGETS[s.target].label})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>القسم الوجهة داخل النظام:</span>
              <span style={chip('#ecfdf5', C.ok)}>الاقتراح التلقائي: {TARGETS[sheet.target].label} • ثقة {Math.round(sheet.confidence * 100)}%</span>
              <button style={{ ...btn(false), marginInlineStart: 'auto' }} onClick={aiClassify} disabled={aiBusy}>
                {aiBusy ? '⏳ جارٍ…' : '🤖 صنّف بالذكاء الاصطناعي'}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 8 }}>
              {Object.entries(TARGETS).map(([k, t]) => {
                const rank = sheet.ranked?.find(r => r.target === k)
                const active = k === targetKey
                return (
                  <button key={k} onClick={() => changeTarget(k)} style={{
                    ...box, textAlign: 'start', cursor: 'pointer',
                    borderColor: active ? C.navy : C.line, borderWidth: active ? 2 : 1,
                    background: active ? '#f8fafc' : '#fff',
                  }}>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{t.icon} {t.label}</div>
                    <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>
                      يُضاف إلى <code>{t.table}</code> — {t.section}
                    </div>
                    {rank && <div style={{ marginTop: 6 }}><span style={chip(rank.confidence > .6 ? '#ecfdf5' : '#f8fafc', rank.confidence > .6 ? C.ok : C.muted)}>ملاءمة {Math.round(rank.confidence * 100)}%</span></div>}
                  </button>
                )
              })}
            </div>
          </div>

          <PreviewTable headers={sheet.headers} rows={sheet.rows} />

          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn(true)} onClick={() => setStep(2)}>التالي: تأكيد خريطة الحقول ›</button>
            <button style={btn(false)} onClick={() => setStep(0)}>‹ رجوع</button>
          </div>
        </div>
      )}

      {/* ══════════════ الخطوة 3: خريطة الحقول ══════════════ */}
      {step === 2 && sheet && target && (
        <div className="panel" style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0 }}>🔗 تأكيد خريطة الحقول — {target.icon} {target.label}</h4>
            <span style={chip('#f1f5f9', C.muted)}>الوجهة: {target.table}</span>
            <button style={{ ...btn(false), marginInlineStart: 'auto' }} onClick={aiMap} disabled={aiBusy}>
              {aiBusy ? '⏳ جارٍ…' : '🤖 راجع المطابقة بالذكاء الاصطناعي'}
            </button>
            <button style={btn(false)} onClick={() => applyAutoMap(sheet)}>↺ إعادة المطابقة التلقائية</button>
          </div>
          {aiNote && <div style={{ ...box, borderColor: '#c7d2fe', background: '#eef2ff', fontSize: 13 }}>{aiNote}</div>}
          {missingRequired.length > 0 && (
            <div style={{ ...box, borderColor: '#fecaca', background: '#fef2f2', color: C.err, fontSize: 13 }}>
              ⚠️ حقول إلزامية غير مربوطة: <b>{missingRequired.join('، ')}</b>
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['حقل النظام', 'العمود في ملفك', 'ثقة المطابقة', 'عينة من القيم'].map(h => (
                    <th key={h} style={{ textAlign: 'start', padding: 9, borderBottom: `1px solid ${C.line}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(target.fields).filter(([, f]) => !f.skip).map(([key, f]) => {
                  const col = mapping[key] || ''
                  const sc = scores[key]
                  const sug = suggestions[key] || []
                  const sample = col ? sheet.rows.slice(0, 3).map(r => r[col]).filter(v => v !== '' && v != null).join(' • ') : ''
                  return (
                    <tr key={key} style={{ borderBottom: `1px solid ${C.line}` }}>
                      <td style={{ padding: 9 }}>
                        <b>{f.label}</b>{f.required && <span style={{ color: C.err }}> *</span>}
                        <div style={{ fontSize: 11, color: C.muted }}>{key} • {f.type}{f.virtual ? ' • ربط' : ''}</div>
                      </td>
                      <td style={{ padding: 9 }}>
                        <select value={col} onChange={e => { setMapping({ ...mapping, [key]: e.target.value || undefined }); setValidation(null) }}
                          style={{ minWidth: 190, padding: 6, borderRadius: 7, border: `1px solid ${col ? C.line : '#fca5a5'}` }}>
                          <option value="">— بدون ربط —</option>
                          {sheet.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                        {sug.length > 0 && (
                          <div style={{ marginTop: 5, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            {sug.filter(s => s.column !== col).slice(0, 3).map(s => (
                              <button key={s.column} onClick={() => { setMapping({ ...mapping, [key]: s.column }); setValidation(null) }}
                                title={`ثقة ${Math.round(s.score * 100)}%`}
                                style={{ ...chip('#f1f5f9', C.navy), border: 'none', cursor: 'pointer' }}>
                                اقتراح: {s.column} ({Math.round(s.score * 100)}%)
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: 9 }}>
                        {col
                          ? <span style={chip(sc >= .8 ? '#ecfdf5' : sc >= .55 ? '#fffbeb' : '#f1f5f9', sc >= .8 ? C.ok : sc >= .55 ? C.warn : C.muted)}>
                            {sc ? `${Math.round(sc * 100)}%` : 'يدوي'}
                          </span>
                          : <span style={chip('#f8fafc', C.muted)}>—</span>}
                      </td>
                      <td style={{ padding: 9, color: C.muted, fontSize: 12, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sample || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {(() => {
            const used = new Set(Object.values(mapping))
            const unused = sheet.headers.filter(h => !used.has(h))
            return unused.length > 0 && (
              <div style={{ ...box, background: '#fffbeb', borderColor: '#fde68a', fontSize: 12.5 }}>
                📎 أعمدة لم تُربط بأي حقل (سيتم تجاهلها): {unused.join('، ')}
              </div>
            )
          })()}

          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn(true)} onClick={() => { setNormalizeRules([]); setActiveRuleIds({}); setStep(3) }} disabled={missingRequired.length > 0}>
              التالي: قواعد التطبيع ›
            </button>
            <button style={btn(false)} onClick={() => setStep(1)}>‹ رجوع</button>
          </div>
        </div>
      )}

      {/* ══════════════ الخطوة 4: قواعد التطبيع القابلة للمراجعة ══════════════ */}
      {step === 3 && (
        <div className="panel" style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0 }}>🧪 قواعد التطبيع القابلة للمراجعة</h4>
            <span style={chip('#eef2ff', C.navy)}>قبل الاستيراد</span>
            <button style={{ ...btn(true), marginInlineStart: 'auto' }} onClick={aiNormalize} disabled={normalizeBusy}>
              {normalizeBusy ? '⏳ يفكّر…' : (normalizeRules.length ? '↻ إعادة توليد القواعد' : '🤖 اقتراح قواعد التطبيع')}
            </button>
          </div>
          <div style={{ ...box, fontSize: 13, background: '#f8fafc' }}>
            يقترح مساعد الذكاء الاصطناعي قواعد تنظيف محدّدة (تواريخ، جوّالات، عملات، تصنيفات…) مع مثال «قبل/بعد» لكل قاعدة.
            راجعها، فعّل ما يناسبك، ثم تابع الفحص. القواعد المفعّلة فقط ستُطبَّق على البيانات قبل الاستيراد.
          </div>

          {normalizeRules.length === 0 && !normalizeBusy && (
            <div style={{ ...box, textAlign: 'center', color: C.muted, padding: 26 }}>
              لا توجد قواعد بعد — اضغط «اقتراح قواعد التطبيع» ليحلّل الذكاء الاصطناعي عيّنات ملفك ويقترح قواعد قابلة للتطبيق.
            </div>
          )}

          {normalizeRules.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
                <button style={btn(false)} onClick={() => {
                  const all = {}; normalizeRules.forEach(r => all[r.id] = true); setActiveRuleIds(all)
                }}>✔ تفعيل الكل</button>
                <button style={btn(false)} onClick={() => setActiveRuleIds({})}>✖ إلغاء الكل</button>
                <span style={{ marginInlineStart: 'auto', color: C.muted, alignSelf: 'center' }}>
                  {Object.values(activeRuleIds).filter(Boolean).length} من {normalizeRules.length} قاعدة مُفعَّلة
                </span>
              </div>
              <div style={{ maxHeight: 420, overflow: 'auto', border: `1px solid ${C.line}`, borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['تفعيل', 'الحقل / العمود', 'النوع', 'الوصف', 'قبل → بعد', 'ثقة', 'الأثر'].map(h => (
                        <th key={h} style={{ textAlign: 'start', padding: 8, position: 'sticky', top: 0, background: '#f8fafc', borderBottom: `1px solid ${C.line}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {normalizeRules.map(r => {
                      const on = !!activeRuleIds[r.id]
                      const sev = r.severity === 'critical' ? C.err : r.severity === 'warning' ? C.warn : C.muted
                      return (
                        <tr key={r.id} style={{ borderTop: `1px solid ${C.line}`, background: on ? '#f0fdf4' : '#fff' }}>
                          <td style={{ padding: 8 }}>
                            <input type="checkbox" checked={on}
                              onChange={e => setActiveRuleIds(s => ({ ...s, [r.id]: e.target.checked }))} />
                          </td>
                          <td style={{ padding: 8 }}>
                            <b>{r.field}</b>
                            <div style={{ color: C.muted, fontSize: 11 }}>عمود: {r.column}</div>
                          </td>
                          <td style={{ padding: 8 }}>
                            <span style={chip('#eef2ff', C.navy)}>{r.ruleType}</span>
                          </td>
                          <td style={{ padding: 8, maxWidth: 280 }}>
                            {r.description}
                            {r.reason && <div style={{ color: C.muted, fontSize: 11, marginTop: 3 }}>{r.reason}</div>}
                          </td>
                          <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 11.5 }}>
                            <div style={{ color: C.err }}>{r.fromSample}</div>
                            <div style={{ color: C.ok }}>→ {r.toSample}</div>
                          </td>
                          <td style={{ padding: 8 }}>
                            <span style={chip(r.confidence >= 0.8 ? '#ecfdf5' : r.confidence >= 0.5 ? '#fffbeb' : '#f1f5f9',
                              r.confidence >= 0.8 ? C.ok : r.confidence >= 0.5 ? C.warn : C.muted)}>
                              {Math.round((r.confidence || 0) * 100)}%
                            </span>
                          </td>
                          <td style={{ padding: 8, color: sev }}>{r.affectedRows ?? 0} صف</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn(true)} onClick={runValidation} disabled={busy}>
              {busy ? 'جارٍ التحقق…' : (normalizeRules.length
                ? `تطبيق ${Object.values(activeRuleIds).filter(Boolean).length} قاعدة وفحص البيانات ›`
                : 'تخطي التطبيع وفحص البيانات ›')}
            </button>
            <button style={btn(false)} onClick={() => setStep(2)}>‹ تعديل الخريطة</button>
          </div>
        </div>
      )}

      {/* ══════════════ الخطوة 5: المراجعة والإصلاح ══════════════ */}
      {step === 4 && validation && (

        <div className="panel" style={{ display: 'grid', gap: 12 }}>
          <h4 style={{ margin: 0 }}>🩺 نتيجة الفحص قبل الاستيراد</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
            <Stat label="إجمالي الصفوف" value={sheet.rows.length} />
            <Stat label="جاهزة للإضافة" value={validation.unique.length} color={C.ok} />
            <Stat label="مكررة داخل الملف" value={validation.duplicatesInFile.length} color={C.warn} />
            <Stat label="موجودة مسبقاً" value={validation.duplicatesInDb.length} color={C.warn} />
            <Stat label="مرفوضة" value={validation.invalid.length} color={C.err} />
          </div>

          <div style={{ ...box, display: 'grid', gap: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>⚙️ سياسة التعامل مع التعارضات</div>
            {[
              ['skip', `تخطي السجلات الموجودة مسبقاً (مطابقة بـ ${validation.dedupeKey || 'بدون مفتاح'})`],
              ['update', 'تحديث السجلات الموجودة بالبيانات الجديدة'],
              ['insert', 'إضافتها كسجلات جديدة على أي حال'],
            ].map(([v, l]) => (
              <label key={v} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, opacity: validation.dedupeKey ? 1 : .5 }}>
                <input type="radio" checked={dupStrategy === v} disabled={!validation.dedupeKey}
                  onChange={() => setDupStrategy(v)} /> {l}
              </label>
            ))}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={skipInvalid} onChange={e => setSkipInvalid(e.target.checked)} />
              تجاوز الصفوف المرفوضة ومتابعة استيراد الباقي (موصى به)
            </label>
            {RELATIONAL_TARGETS.includes(targetKey) && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={checkDbOverlap} onChange={e => setCheckDbOverlap(e.target.checked)} />
                فحص تعارض التواريخ مع الحجوزات القائمة في النظام (منع الحجز المزدوج)
              </label>
            )}
            {targetKey === 'units' && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={createMissingProperties} onChange={e => setCreateMissingProperties(e.target.checked)} />
                إنشاء العقارات/المباني غير الموجودة تلقائياً وربط الوحدات بها
              </label>
            )}
          </div>

          {validation.report.autoFixes.length > 0 && (
            <div style={{ ...box, background: '#f0fdf4', borderColor: '#bbf7d0' }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6, color: C.ok }}>✨ إصلاحات تلقائية طُبِّقت</div>
              <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5, lineHeight: 1.8 }}>
                {validation.report.autoFixes.slice(0, 8).map((f, i) => <li key={i}>{f.message} <b>({f.count} صف)</b></li>)}
              </ul>
            </div>
          )}

          {validation.report.warnings.length > 0 && (
            <div style={{ ...box, background: '#fffbeb', borderColor: '#fde68a' }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6, color: C.warn }}>⚠️ تنبيهات</div>
              <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5, lineHeight: 1.8 }}>
                {validation.report.warnings.slice(0, 8).map((w, i) => <li key={i}>{w.message} <b>({w.count} صف)</b></li>)}
              </ul>
            </div>
          )}

          {validation.conflicts?.length > 0 && (
            <div style={{ ...box, background: '#fff7ed', borderColor: '#fed7aa', display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: '#9a3412' }}>
                  🔍 تقرير تعارضات المفاتيح والربط ({validation.conflicts.length})
                </div>
                <span style={chip('#fee2e2', C.err)}>رفض: {validation.linkSummary?.errors || 0}</span>
                <span style={chip('#fef9c3', C.warn)}>تنبيه: {validation.linkSummary?.warnings || 0}</span>
                <span style={chip('#e0f2fe', '#075985')}>صفوف متأثرة بالرفض: {validation.linkSummary?.rejectedRows || 0}</span>
                <button style={{ ...btn(false), marginInlineStart: 'auto' }}
                  onClick={() => {
                    const blob = new Blob([conflictsToCsv(validation.conflicts)], { type: 'text/csv;charset=utf-8' })
                    const a = document.createElement('a')
                    a.href = URL.createObjectURL(blob)
                    a.download = `conflicts-${targetKey}-${Date.now()}.csv`
                    a.click(); URL.revokeObjectURL(a.href)
                  }}>⬇️ تصدير تقرير التعارضات</button>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button style={{ ...btn(conflictFilter === 'all'), padding: '5px 11px', fontSize: 12 }}
                  onClick={() => setConflictFilter('all')}>الكل ({validation.conflicts.length})</button>
                {(validation.linkSummary?.byType || []).map(t => (
                  <button key={t.type} style={{ ...btn(conflictFilter === t.type), padding: '5px 11px', fontSize: 12 }}
                    onClick={() => setConflictFilter(t.type)}>
                    {t.severity === 'error' ? '⛔' : '⚠️'} {t.label} ({t.count})
                  </button>
                ))}
              </div>

              <div style={{ maxHeight: 320, overflow: 'auto', background: '#fff', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead><tr>
                    {['الصف', 'النوع', 'الحقل / القيمة', 'سبب التعارض', 'الأثر على السجل', 'الإجراء المقترح'].map(h => (
                      <th key={h} style={{ textAlign: 'start', padding: 7, position: 'sticky', top: 0, background: '#f8fafc' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {validation.conflicts
                      .filter(c => conflictFilter === 'all' || c.type === conflictFilter)
                      .slice(0, 200).map((c, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${C.line}` }}>
                        <td style={{ padding: 7, whiteSpace: 'nowrap' }}>#{c.row}</td>
                        <td style={{ padding: 7 }}>
                          <span style={chip(c.severity === 'error' ? '#fee2e2' : '#fef9c3', c.severity === 'error' ? C.err : C.warn)}>
                            {c.severity === 'error' ? 'رفض' : 'تنبيه'}
                          </span>{' '}{c.typeLabel}
                        </td>
                        <td style={{ padding: 7 }}><b>{c.field}</b><div style={{ color: C.muted }}>{c.value}</div></td>
                        <td style={{ padding: 7 }}>{c.reason}</td>
                        <td style={{ padding: 7, color: c.severity === 'error' ? C.err : C.warn }}>{c.impact}</td>
                        <td style={{ padding: 7, color: C.muted }}>{c.suggestion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {validation.invalid.length > 0 && (
            <div style={{ ...box, background: '#fef2f2', borderColor: '#fecaca' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: C.err }}>⛔ صفوف مرفوضة ({validation.invalid.length})</div>
                <button style={{ ...btn(false), marginInlineStart: 'auto' }} onClick={aiFix} disabled={aiBusy}>
                  {aiBusy ? '⏳ جارٍ…' : '🤖 اقترح حلولاً بالذكاء الاصطناعي'}
                </button>
              </div>
              <div style={{ maxHeight: 260, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead><tr style={{ background: '#fff' }}>
                    {['الصف', 'المشكلة', 'الحل المقترح'].map(h => <th key={h} style={{ textAlign: 'start', padding: 7, position: 'sticky', top: 0, background: '#fff' }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {validation.invalid.slice(0, 60).map((r, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${C.line}` }}>
                        <td style={{ padding: 7 }}>#{r.index}</td>
                        <td style={{ padding: 7 }}>{r.errors.map(e => e.message).join(' • ')}</td>
                        <td style={{ padding: 7, color: C.muted }}>{r.errors.map(e => e.suggestion).filter(Boolean).join(' • ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {validation.aiSuggestions?.length > 0 && (
                <div style={{ marginTop: 10, background: '#fff', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 6 }}>🤖 اقتراحات الذكاء الاصطناعي</div>
                  <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5, lineHeight: 1.8 }}>
                    {validation.aiSuggestions.map((s, i) => (
                      <li key={i}><b>{s.field}:</b> {s.problem} — <span style={{ color: C.ok }}>{s.fix}</span>
                        {s.autoApplicable && <span style={{ ...chip('#ecfdf5', C.ok), marginInlineStart: 6 }}>قابل للتطبيق تلقائياً</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div style={{ ...box, background: '#f8fafc', fontSize: 12.5 }}>
            📦 ستُضاف السجلات إلى جدول <b>{target.table}</b> ضمن <b>{target.section}</b>، مرتبطة بشركتك تلقائياً
            {targetKey === 'units' ? '، ومرتبطة بالعقار المطابق عند توفره.' : '.'}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn(true)} onClick={runImport} disabled={busy || (validation.unique.length + (dupStrategy !== 'skip' ? validation.duplicatesInDb.length : 0)) === 0}>
              🚀 تنفيذ الاستيراد
            </button>
            <button style={btn(false)} onClick={() => setStep(3)}>‹ رجوع لقواعد التطبيع</button>

          </div>
        </div>
      )}

      {/* ══════════════ الخطوة 5: التنفيذ ══════════════ */}
      {step === 5 && (
        <div className="panel" style={{ textAlign: 'center', padding: 34 }}>
          <div style={{ fontSize: 40 }}>🚀</div>
          <h4>جارٍ استيراد البيانات…</h4>
          <div style={{ background: '#f1f5f9', borderRadius: 20, height: 12, overflow: 'hidden', maxWidth: 460, margin: '14px auto' }}>
            <div style={{
              height: '100%', background: C.navy, transition: 'width .3s',
              width: progress?.total ? `${Math.round(progress.done / progress.total * 100)}%` : '10%',
            }} />
          </div>
          <div style={{ color: C.muted, fontSize: 13 }}>{progress ? `${progress.done} / ${progress.total} سجل` : 'التحضير…'}</div>
          <div style={{ marginTop: 16 }}>
            <button
              style={btn(false)}
              onClick={() => { abortRef.current = true; setCancelling(true) }}
              disabled={cancelling}
            >
              {cancelling ? '⏳ جارٍ الإيقاف بعد إنهاء الدفعة الحالية…' : '⛔ إلغاء آمن للاستيراد'}
            </button>
            <div style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>
              الإلغاء الآمن يوقف الإرسال عند حدود الدفعة الحالية — لن تُقطع أي عملية في منتصفها،
              وستظهر العملية في لوحة التدقيق بحالة «أُلغيت» مع الأعداد المحفوظة فعلياً.
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ الخطوة 6: التقرير ══════════════ */}
      {step === 6 && report && (
        <div className="panel" style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0 }}>📄 تقرير الاستيراد المفصّل</h4>
            <span style={chip('#f1f5f9', C.muted)}>{report.targetLabel} → {report.table}</span>
            {report.vendor && <span style={chip('#eff6ff', '#1d4ed8')}>المصدر: {report.vendor}</span>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginInlineStart: 'auto' }}>
              <button style={btn(true)} onClick={() => exportReportExcel(report)}>⬇ Excel</button>
              <button style={btn(false)} onClick={() => exportReportCsv(report)}>⬇ CSV</button>
              <button style={btn(false)} onClick={() => exportReportJson(report)}>⬇ JSON</button>
              <button style={btn(false)} onClick={() => exportReportPdf(report)}>⬇ PDF</button>
            </div>
            <button style={btn(false)} onClick={reset}>استيراد ملف آخر</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
            <Stat label="إجمالي الصفوف" value={report.rowsTotal} />
            <Stat label="سجلات مضافة" value={report.inserted} color={C.ok} />
            <Stat label="سجلات محدّثة" value={report.updated} color={C.ok} />
            <Stat label="متخطاة (مكررة)" value={report.skipped} color={C.warn} />
            <Stat label="مرفوضة" value={report.failed} color={C.err} />
            <Stat label="نسبة النجاح" value={`${report.successRate}%`} color={report.successRate > 90 ? C.ok : C.warn} />
          </div>

          {report.durationMs != null && (
            <div style={{ fontSize: 12.5, color: C.muted }}>⏱️ زمن التنفيذ: {(report.durationMs / 1000).toFixed(1)} ثانية</div>
          )}

          {report.reasons.length > 0 && (
            <div style={{ ...box, background: '#fef2f2', borderColor: '#fecaca' }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6, color: C.err }}>أسباب الرفض</div>
              <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                <tbody>
                  {report.reasons.map((r, i) => (
                    <tr key={i} style={{ borderTop: `1px solid #fecaca` }}>
                      <td style={{ padding: 6 }}>{r.reason}</td>
                      <td style={{ padding: 6, textAlign: 'end', fontWeight: 800 }}>{r.count} صف</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.warnings.length > 0 && (
            <div style={{ ...box, background: '#fffbeb', borderColor: '#fde68a' }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6, color: C.warn }}>تنبيهات للمستخدم</div>
              <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5, lineHeight: 1.8 }}>
                {report.warnings.map((w, i) => <li key={i}>{w.message} <b>({w.count})</b></li>)}
              </ul>
            </div>
          )}

          {report.autoFixes.length > 0 && (
            <div style={{ ...box, background: '#f0fdf4', borderColor: '#bbf7d0' }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6, color: C.ok }}>إصلاحات تلقائية طُبِّقت</div>
              <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5, lineHeight: 1.8 }}>
                {report.autoFixes.slice(0, 12).map((f, i) => <li key={i}>{f.message} <b>({f.count})</b></li>)}
              </ul>
            </div>
          )}

          <div style={{ ...box, background: '#f8fafc', fontSize: 12.5 }}>
            ✅ تم توزيع السجلات على <b>{report.section}</b> (جدول <code>{report.table}</code>). يمكنك مراجعتها الآن من التبويب المخصص لهذا القسم.
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------ مكوّنات مساعدة ----------------------------- */
function Stat({ label, value, color }) {
  return (
    <div style={{ ...box, textAlign: 'center', padding: 12 }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: color || C.navy }}>{value}</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{label}</div>
    </div>
  )
}

function PreviewTable({ headers, rows }) {
  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>معاينة أول 5 صفوف ({rows.length} صف • {headers.length} عمود)</div>
      <div style={{ overflowX: 'auto', border: `1px solid ${C.line}`, borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr style={{ background: '#f8fafc' }}>
            {headers.map(h => <th key={h} style={{ padding: 8, textAlign: 'start', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.line}` }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.slice(0, 5).map((r, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${C.line}` }}>
                {headers.map(h => <td key={h} style={{ padding: 8, whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(r[h] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ============================ لوحة الموفّرات ============================== */
function ProviderConnectPanel({ onFetched, notify }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState('hostaway')
  const [creds, setCreds] = useState({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const saved = getCredentials(active, 'global')
    setCreds(saved || {})
  }, [active])

  const provider = PROVIDERS[active]

  const doSave = () => {
    saveCredentials(active, 'global', creds)
    if (notify) notify(`✓ تم حفظ بيانات اعتماد ${provider.name}`)
  }
  const doDelete = () => {
    deleteCredentials(active, 'global'); setCreds({})
    if (notify) notify(`تم حذف بيانات اعتماد ${provider.name}`)
  }
  const doFetch = async (entKey) => {
    const ent = provider.entities[entKey]
    if (!ent) return
    setBusy(true)
    try {
      const rows = await ent.fetch(creds)
      if (!rows?.length) { if (notify) notify(`لم يتم جلب أي سجلات من ${provider.name}`, true); setBusy(false); return }
      onFetched(rows, `${provider.name} — ${ent.label}`)
    } catch (e) {
      if (notify) notify(`فشل الجلب: ${e.message}. قد تحتاج تشغيل الاستدعاء عبر Edge Function بسبب CORS.`, true)
    }
    setBusy(false)
  }

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <h4 style={{ margin: 0 }}>🔌 الاستيراد المباشر من مزوّدي إدارة العقارات (Hostaway / Guesty)</h4>
        <span style={{ marginInlineStart: 'auto', fontSize: 18 }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.values(PROVIDERS).map(p => (
              <button key={p.id} onClick={() => setActive(p.id)}
                style={{ ...btn(active === p.id), borderColor: p.color, ...(active === p.id ? { background: p.color, color: '#fff' } : {}) }}>
                {p.icon} {p.name}
              </button>
            ))}
          </div>
          <div style={box}>
            <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 8 }}>
              🔐 {provider.auth} — البيانات تُحفظ محلياً في متصفحك فقط.
              <a href={provider.docs} target="_blank" rel="noreferrer" style={{ marginInlineStart: 8, color: C.navy }}>وثائق API ↗</a>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
              {provider.fields.map(f => (
                <label key={f.key} style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
                  <span style={{ fontWeight: 700 }}>{f.label}{f.required && <span style={{ color: C.err }}> *</span>}</span>
                  <input type={f.type} placeholder={f.placeholder} value={creds[f.key] || ''}
                    onChange={e => setCreds(c => ({ ...c, [f.key]: e.target.value }))}
                    style={{ padding: 8, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12.5 }} />
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button style={btn(true)} onClick={doSave}>💾 حفظ الاعتمادات</button>
              <button style={btn(false)} onClick={doDelete}>🗑️ حذف</button>
              <span style={{ flex: 1 }} />
              {Object.entries(provider.entities).map(([k, ent]) => (
                <button key={k} style={btn(false)} disabled={busy} onClick={() => doFetch(k)}>
                  {busy ? '⏳' : '⤓'} جلب {ent.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ============================ لوحة سجل التدقيق =========================== */
function AuditLogPanel() {
  const [open, setOpen] = useState(false)
  const [logs, setLogs] = useState([])
  const refresh = () => setLogs(loadAudit())
  useEffect(() => { if (open) refresh() }, [open])

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <h4 style={{ margin: 0 }}>📚 سجل تدقيق عمليات الاستيراد</h4>
        <span style={chip('#f1f5f9', C.muted)}>{loadAudit().length} عملية</span>
        <span style={{ marginInlineStart: 'auto', fontSize: 18 }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button style={btn(true)} onClick={() => exportAuditExcel(logs)} disabled={!logs.length}>⬇ Excel</button>
            <button style={btn(false)} onClick={() => exportAuditCsv(logs)} disabled={!logs.length}>⬇ CSV</button>
            <button style={btn(false)} onClick={() => exportAuditJson(logs)} disabled={!logs.length}>⬇ JSON</button>
            <span style={{ flex: 1 }} />
            <button style={btn(false)} onClick={refresh}>↻ تحديث</button>
            <button style={btn(false)} onClick={() => { if (confirm('حذف كل السجل؟')) { clearAudit(); refresh() } }}>🗑 مسح الكل</button>
          </div>
          {!logs.length && <div style={{ ...box, textAlign: 'center', color: C.muted }}>لا توجد عمليات مسجّلة بعد.</div>}
          {logs.length > 0 && (
            <div style={{ overflowX: 'auto', border: `1px solid ${C.line}`, borderRadius: 10, maxHeight: 360, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                  {['الوقت', 'الحالة', 'المستخدم', 'المصدر', 'القسم', 'إجمالي', 'مضاف', 'محدّث', 'مرفوض', 'النجاح', ''].map(h =>
                    <th key={h} style={{ padding: 6, textAlign: 'start', borderBottom: `1px solid ${C.line}` }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {logs.map(l => (
                    <tr key={l.id} style={{ borderTop: `1px solid ${C.line}` }}>
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{new Date(l.timestamp).toLocaleString('ar-SA')}</td>
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                        {l.cancelled || l.status === 'cancelled'
                          ? <span style={chip('#FEF3C7', '#92400E')}>⛔ أُلغيت</span>
                          : <span style={chip('#DCFCE7', '#15803D')}>✓ مكتملة</span>}
                      </td>
                      <td style={{ padding: 6 }}>{l.userEmail || '—'}</td>
                      <td style={{ padding: 6 }}>{l.source} {l.vendor && <small style={{ color: C.muted }}>({l.vendor})</small>}</td>
                      <td style={{ padding: 6 }}>{l.targetLabel}</td>
                      <td style={{ padding: 6, textAlign: 'end' }}>{l.rowsTotal}</td>
                      <td style={{ padding: 6, textAlign: 'end', color: C.ok }}>{l.inserted}</td>
                      <td style={{ padding: 6, textAlign: 'end', color: C.ok }}>{l.updated}</td>
                      <td style={{ padding: 6, textAlign: 'end', color: C.err }}>{l.failed}</td>
                      <td style={{ padding: 6, textAlign: 'end', fontWeight: 700 }}>{l.successRate}%</td>
                      <td style={{ padding: 6 }}>
                        <button onClick={() => { deleteAuditEntry(l.id); setLogs(loadAudit()) }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.err }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
