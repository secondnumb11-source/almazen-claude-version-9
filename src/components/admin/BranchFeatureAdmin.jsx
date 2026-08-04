/**
 * BranchFeatureAdmin — تفعيل/إيقاف ميزة الفروع لكل مستخدم على حدة
 * متاح حصرياً لحسابات super admin؛ الواجهة تُخفى لغيرهم و RPC نفسه يرفض غير السوبر أدمن.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../AuthContext'
import { useBranches } from '../../BranchContext'

export default function BranchFeatureAdmin() {
  const { isSuperAdmin, toast } = useAuth()
  const { reload } = useBranches()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [audit, setAudit] = useState([])
  const [showAudit, setShowAudit] = useState(false)

  const loadAudit = useCallback(async () => {
    if (!isSuperAdmin) return
    const { data, error } = await supabase.rpc('super_admin_list_audit', { _limit: 100 })
    if (error) toast('تعذّر جلب سجل التدقيق: ' + error.message, true)
    else setAudit(data || [])
  }, [isSuperAdmin, toast])

  const load = useCallback(async () => {
    if (!isSuperAdmin) return
    setLoading(true); setErr('')
    const { data, error } = await supabase.rpc('super_admin_list_users')
    if (error) setErr(error.message); else setRows(data || [])
    setLoading(false)
  }, [isSuperAdmin])

  useEffect(() => { load() }, [load])

  const toggle = async (row, next) => {
    setBusyId(row.user_id)
    const { error } = await supabase.rpc('set_user_feature', {
      _user_id: row.user_id, _feature: 'branches', _enabled: next,
    })
    setBusyId(null)
    if (error) return toast('تعذّر التحديث: ' + error.message, true)
    setRows(rs => rs.map(r => r.user_id === row.user_id ? { ...r, branches_enabled: next } : r))
    toast(next ? `✓ فُعِّلت ميزة الفروع لـ ${row.email}` : `✓ أُوقفت ميزة الفروع لـ ${row.email}`)
    reload()
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter(r =>
      (r.email || '').toLowerCase().includes(s) ||
      (r.full_name || '').toLowerCase().includes(s) ||
      (r.company_name || '').toLowerCase().includes(s))
  }, [rows, q])

  const onCount = rows.filter(r => r.branches_enabled).length

  if (!isSuperAdmin) {
    return <div className="panel"><p>🔒 هذه الشاشة متاحة لحسابات super admin فقط.</p></div>
  }

  return (
    <div className="panel">
      <h3>👑 التحكم بالميزات — نظام الفروع</h3>
      <p style={{ fontSize: 12, opacity: .75, margin: '8px 0 14px' }}>
        فعّل ميزة الفروع لكل مستخدم على حدة. المستخدم غير المُفعَّل يرى الأزرار لكن تظهر له
        رسالة «هذه الميزة من الباقة المتقدمة، للاستخدام تواصل مع الدعم».
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input placeholder="بحث بالبريد أو الاسم أو المنشأة…" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 240 }} />
        <button className="btn ghost" onClick={load} disabled={loading}>{loading ? '…' : '↻ تحديث'}</button>
        <button className="btn ghost" onClick={() => { setShowAudit(v => !v); if (!showAudit) loadAudit() }}>
          {showAudit ? '🗂️ إخفاء سجل التدقيق' : '🗂️ سجل التدقيق'}
        </button>
        <span style={{ fontSize: 12, opacity: .8 }}>مفعّل: {onCount} / {rows.length}</span>
      </div>

      {showAudit && (
        <div className="panel" style={{ padding: 10, marginBottom: 12, maxHeight: 260, overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <b>سجل تدقيق الفروع والميزات</b>
            <button className="btn btn-sm ghost" onClick={loadAudit}>↻</button>
            <span style={{ fontSize: 12, opacity: .7 }}>آخر {audit.length} حدث</span>
          </div>
          {audit.length === 0 ? <div style={{ fontSize: 12, opacity: .7 }}>لا توجد أحداث بعد.</div> : (
            <table className="tbl" style={{ fontSize: 12 }}>
              <thead><tr><th>الوقت</th><th>المنفذ</th><th>الإجراء</th><th>المستخدم/الفرع</th><th>التفاصيل</th></tr></thead>
              <tbody>
                {audit.map(a => (
                  <tr key={a.id}>
                    <td>{new Date(a.created_at).toLocaleString('ar-EG')}</td>
                    <td style={{ direction: 'ltr', textAlign: 'left' }}>{a.actor_email || '-'}</td>
                    <td>{a.action}</td>
                    <td style={{ direction: 'ltr', textAlign: 'left', fontSize: 11 }}>
                      {a.target_user_id ? `user:${String(a.target_user_id).slice(0, 8)}` : ''}
                      {a.branch_id ? ` branch:${String(a.branch_id).slice(0, 8)}` : ''}
                    </td>
                    <td style={{ fontSize: 11, opacity: .8, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.feature ? `${a.feature} · ` : ''}{JSON.stringify(a.payload).slice(0, 160)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {err && <p style={{ color: 'crimson' }}>خطأ: {err}</p>}

      <table className="tbl">
        <thead>
          <tr><th>المستخدم</th><th>البريد</th><th>المنشأة</th><th>الدور</th><th>فروعه</th><th>ميزة الفروع</th></tr>
        </thead>
        <tbody>
          {!loading && filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 18 }}>لا نتائج</td></tr>}
          {filtered.map(r => (
            <tr key={r.user_id}>
              <td>{r.full_name}</td>
              <td style={{ direction: 'ltr', textAlign: 'left' }}>{r.email}</td>
              <td>{r.company_name}</td>
              <td>{r.role}</td>
              <td>{r.branch_count}</td>
              <td>
                <button
                  className={'btn ' + (r.branches_enabled ? '' : 'ghost')}
                  disabled={busyId === r.user_id}
                  onClick={() => toggle(r, !r.branches_enabled)}
                >
                  {busyId === r.user_id ? '…' : (r.branches_enabled ? '✅ مفعّلة' : '⛔ موقوفة')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
