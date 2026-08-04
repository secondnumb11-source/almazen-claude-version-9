import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { ALERT_SOURCES } from '../lib/systemMonitor'

/**
 * SystemAlertsPanel — تنبيهات أخطاء الحجوزات/الفروع/سجل النشاط.
 * مرئي لحسابات السوبر أدمن فقط (RLS + حارس واجهة).
 */
const SEV = {
  critical: { label: 'حرج', color: '#b91c1c' },
  error: { label: 'خطأ', color: '#dc2626' },
  warn: { label: 'تحذير', color: '#b45309' },
  info: { label: 'معلومة', color: '#2563eb' },
}

const fmt = (v) => { try { return new Date(v).toLocaleString('ar-SA') } catch { return String(v || '—') } }

export default function SystemAlertsPanel({ limit = 50 }) {
  const { isSuperAdmin, toast } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState('all')

  const load = useCallback(async () => {
    if (!isSuperAdmin) return
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('super_admin_open_alerts', { p_limit: limit })
      if (error) throw error
      setRows(data || [])
    } catch (e) {
      toast?.('تعذّر تحميل التنبيهات: ' + (e?.message || e), true)
    } finally { setLoading(false) }
  }, [isSuperAdmin, limit, toast])

  useEffect(() => { load() }, [load])

  const resolve = async (id) => {
    try {
      await supabase.rpc('super_admin_resolve_alert', { p_id: id })
      setRows(r => r.filter(x => x.id !== id))
    } catch (e) { toast?.('تعذّر إغلاق التنبيه', true) }
  }

  if (!isSuperAdmin) return null

  const view = source === 'all' ? rows : rows.filter(r => r.source === source)

  return (
    <div className="card" style={{ padding: 14, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}>🚨 تنبيهات النظام المفتوحة ({rows.length})</h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <select value={source} onChange={e => setSource(e.target.value)}>
            <option value="all">كل المصادر</option>
            {Object.entries(ALERT_SOURCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            {loading ? '⏳' : '🔄'} تحديث
          </button>
        </div>
      </div>

      {view.length === 0
        ? <p className="muted" style={{ marginTop: 10 }}>لا توجد تنبيهات مفتوحة — النظام سليم ✅</p>
        : (
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table className="tbl">
              <thead>
                <tr><th>الوقت</th><th>المصدر</th><th>الخطورة</th><th>الرسالة</th><th>السياق</th><th></th></tr>
              </thead>
              <tbody>
                {view.map(a => (
                  <tr key={a.id}>
                    <td dir="ltr" style={{ whiteSpace: 'nowrap' }}>{fmt(a.created_at)}</td>
                    <td>{ALERT_SOURCES[a.source] || a.source}</td>
                    <td><span className="chip" style={{ color: (SEV[a.severity] || SEV.error).color }}>
                      {(SEV[a.severity] || SEV.error).label}</span></td>
                    <td style={{ maxWidth: 380 }}>{a.message}</td>
                    <td className="muted" style={{ fontSize: 11, maxWidth: 260, overflow: 'hidden' }} dir="ltr">
                      {a.context ? JSON.stringify(a.context).slice(0, 140) : '—'}
                    </td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => resolve(a.id)}>✔ إغلاق</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  )
}
