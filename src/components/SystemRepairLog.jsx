import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { exportCSV } from '../lib/helpers'
import { downloadPDF } from '../lib/pdf'

const cell = { padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', verticalAlign: 'top' }

const STATUS_LABEL = {
  success: '✅ نجح',
  failed: '❌ فشل',
  dry_run: '🧪 تجريبي',
  partial: '⚠️ جزئي',
}

/**
 * SystemRepairLog — سجل تدقيق لكل عملية إصلاح نُفِّذت عبر edge function system_repair.
 * يعرض: التاريخ · نوع الإصلاح · المستخدم المنفِّذ · النتيجة · عدد الصفوف المتأثرة · التفاصيل.
 * مع تصفية وبحث (المستخدم / النوع / الحالة / المدى الزمني) وتصدير إلى CSV أو PDF.
 * القراءة محمية بسياسة RLS «super_admin can read repair log» على مستوى قاعدة البيانات،
 * بالإضافة إلى الحجب في الواجهة.
 */
export default function SystemRepairLog({ embedded = false, refreshKey = 0 }) {
  const { isSuperAdmin } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(null)

  const [q, setQ] = useState('')
  const [fUser, setFUser] = useState('')
  const [fType, setFType] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')

  const load = async () => {
    setLoading(true); setErr('')
    const { data, error } = await supabase
      .from('system_repair_log')
      .select('*')
      .order('executed_at', { ascending: false })
      .limit(1000)
    if (error) setErr(error.message)
    setRows(data || [])
    setLoading(false)
  }

  useEffect(() => { if (isSuperAdmin) load() }, [isSuperAdmin, refreshKey])

  const users = useMemo(
    () => [...new Set(rows.map(r => r.executed_by_email || r.executed_by).filter(Boolean))].sort(),
    [rows],
  )
  const types = useMemo(
    () => [...new Set(rows.map(r => r.check_id).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const from = fFrom ? new Date(fFrom + 'T00:00:00').getTime() : null
    const to = fTo ? new Date(fTo + 'T23:59:59').getTime() : null
    return rows.filter(r => {
      const who = r.executed_by_email || r.executed_by || ''
      if (fUser && who !== fUser) return false
      if (fType && r.check_id !== fType) return false
      if (fStatus && r.status !== fStatus) return false
      const t = r.executed_at ? new Date(r.executed_at).getTime() : null
      if (from && (!t || t < from)) return false
      if (to && (!t || t > to)) return false
      if (needle) {
        const hay = [who, r.check_id, r.status, r.error, JSON.stringify(r.details ?? {})]
          .join(' ').toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [rows, q, fUser, fType, fStatus, fFrom, fTo])

  const flatRows = () => filtered.map(r => ({
    'التاريخ والوقت': r.executed_at ? new Date(r.executed_at).toLocaleString('ar-SA') : '',
    'نوع الإصلاح': r.check_id || '',
    'المستخدم المنفِّذ': r.executed_by_email || r.executed_by || '',
    'النتيجة': STATUS_LABEL[r.status] || r.status || '',
    'صفوف متأثرة': r.affected_rows ?? 0,
    'الخطأ': r.error || '',
    'التفاصيل': JSON.stringify(r.details ?? {}),
  }))

  const activeFilters = {
    ...(q ? { 'بحث': q } : {}),
    ...(fUser ? { 'المستخدم': fUser } : {}),
    ...(fType ? { 'النوع': fType } : {}),
    ...(fStatus ? { 'الحالة': STATUS_LABEL[fStatus] || fStatus } : {}),
    ...(fFrom ? { 'من': fFrom } : {}),
    ...(fTo ? { 'إلى': fTo } : {}),
  }

  const doCSV = () => exportCSV(`system_repair_log_${new Date().toISOString().slice(0, 10)}.csv`, flatRows())
  const doPDF = () => downloadPDF({
    title: 'سجل عمليات إصلاح النظام',
    subtitle: `${filtered.length} عملية مطابقة للتصفية`,
    filters: activeFilters,
    summaryCards: [
      { label: 'إجمالي العمليات', value: String(filtered.length) },
      { label: 'ناجحة', value: String(filtered.filter(r => r.status === 'success').length) },
      { label: 'فاشلة', value: String(filtered.filter(r => r.status === 'failed').length) },
      { label: 'صفوف متأثرة', value: String(filtered.reduce((s, r) => s + (Number(r.affected_rows) || 0), 0)) },
    ],
    sheets: [{ name: 'سجل الإصلاح', rows: flatRows() }],
  })

  const resetFilters = () => { setQ(''); setFUser(''); setFType(''); setFStatus(''); setFFrom(''); setFTo('') }

  if (!isSuperAdmin) {
    return <div className="panel" style={{ padding: 20, color: 'var(--muted)' }}>هذه الصفحة متاحة لحسابات super admin فقط.</div>
  }

  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>📜 سجل عمليات الإصلاح</h3>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          {loading ? '⏳' : '🔄 تحديث'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={doCSV} disabled={!filtered.length}>⬇️ تصدير CSV</button>
        <button className="btn btn-ghost btn-sm" onClick={doPDF} disabled={!filtered.length}>🧾 تصدير PDF</button>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
          {filtered.length} من {rows.length} عملية
        </span>
      </div>

      <div style={{
        display: 'grid', gap: 8, marginBottom: 10,
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      }}>
        <input placeholder="🔍 بحث في النوع/المستخدم/التفاصيل" value={q} onChange={e => setQ(e.target.value)} />
        <select value={fUser} onChange={e => setFUser(e.target.value)}>
          <option value="">كل المستخدمين</option>
          {users.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={fType} onChange={e => setFType(e.target.value)}>
          <option value="">كل أنواع الإصلاح</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={fStatus} onChange={e => setFStatus(e.target.value)}>
          <option value="">كل النتائج</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} title="من تاريخ" />
        <input type="date" value={fTo} onChange={e => setFTo(e.target.value)} title="إلى تاريخ" />
        <button className="btn btn-ghost btn-sm" onClick={resetFilters}>↺ مسح التصفية</button>
      </div>

      {err && <div style={{ color: '#B91C1C', fontSize: 13, marginBottom: 8 }}>خطأ في القراءة: {err}</div>}
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'auto', maxHeight: 480 }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead style={{ background: '#F8FAFC', position: 'sticky', top: 0 }}>
            <tr>
              <th style={cell}>التاريخ والوقت</th>
              <th style={cell}>نوع الإصلاح</th>
              <th style={cell}>المستخدم المنفِّذ</th>
              <th style={cell}>النتيجة</th>
              <th style={cell}>صفوف متأثرة</th>
              <th style={cell}>تفاصيل</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ ...cell, textAlign: 'center', color: 'var(--muted)' }}>
                {rows.length ? 'لا توجد نتائج مطابقة للتصفية' : 'لا توجد عمليات إصلاح مسجّلة بعد'}
              </td></tr>
            ) : filtered.map(r => (
              <React.Fragment key={r.id}>
                <tr>
                  <td style={cell}>{r.executed_at ? new Date(r.executed_at).toLocaleString('ar-SA') : '—'}</td>
                  <td style={cell}><code>{r.check_id}</code></td>
                  <td style={cell}>{r.executed_by_email || r.executed_by || '—'}</td>
                  <td style={{ ...cell, fontWeight: 700, color: r.status === 'success' ? '#15803D' : r.status === 'failed' ? '#B91C1C' : '#B45309' }}>
                    {STATUS_LABEL[r.status] || r.status}
                    {r.error ? ` — ${r.error}` : ''}
                  </td>
                  <td style={cell}>{r.affected_rows ?? 0}</td>
                  <td style={cell}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setOpen(open === r.id ? null : r.id)}>
                      {open === r.id ? 'إخفاء' : 'عرض'}
                    </button>
                  </td>
                </tr>
                {open === r.id && (
                  <tr>
                    <td colSpan={6} style={{ ...cell, background: '#F9FAFB' }}>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'left', fontSize: 12 }}>
                        {JSON.stringify(r.details ?? {}, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )

  return embedded ? <div style={{ marginTop: 24 }}>{body}</div> : <div className="panel" style={{ padding: 20 }}>{body}</div>
}
