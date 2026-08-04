/**
 * SuperAdminActivityLog — سجل نشاط المنصة (سوبر أدمن فقط)
 * ---------------------------------------------------------------
 * • ترقيم صفحات افتراضي (50/صفحة) عبر دالة قاعدة بيانات مفهرسة.
 * • فلاتر متقدمة: الكيان، نوع العملية، المستخدم، المنشأة، نطاق تاريخ، بحث.
 * • تصدير CSV مع اختيار الأعمدة وتطبيق نفس الفلاتر الحالية.
 * • الوصول محصور بالسوبر أدمن على مستوى الواجهة وقاعدة البيانات معاً
 *   (super_admin_activity_log ترفض أي مستدعٍ غير سوبر أدمن).
 * صفحة قراءة فقط — لا تُعدّل أي بيانات.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { exportCSV } from '../lib/helpers'
import { reportIssue } from '../lib/systemMonitor'
import SystemAlertsPanel from '../components/SystemAlertsPanel'

const PAGE_SIZES = [25, 50, 100, 200]

const ACTION_LABEL = {
  subscription_change: 'تغيير اشتراك',
  booking_create: 'إنشاء حجز',
  booking_update: 'تعديل حجز',
  create: 'إنشاء', update: 'تعديل', delete: 'حذف',
  discount: 'طلب خصم', handover: 'تسليم/استلام',
}

const QUICK = [
  { k: 'all', label: 'الكل', icon: '📋' },
  { k: 'subscriptions', label: 'الاشتراكات', icon: '💳' },
  { k: 'bookings', label: 'الحجوزات', icon: '📅' },
  { k: 'branches', label: 'الفروع', icon: '🏬' },
]

const COLUMNS = [
  { k: 'at', label: 'الطابع الزمني' },
  { k: 'company', label: 'المنشأة' },
  { k: 'actor', label: 'المنفّذ' },
  { k: 'action', label: 'العملية' },
  { k: 'entity', label: 'القسم' },
  { k: 'summary', label: 'التفاصيل' },
  { k: 'dates', label: 'التواريخ' },
  { k: 'entity_id', label: 'معرّف السجل' },
]

const fmt = (v) => { if (!v) return '—'; try { return new Date(v).toLocaleString('ar-SA') } catch { return String(v) } }
const fmtDate = (v) => { if (!v) return '—'; try { return new Date(v).toISOString().slice(0, 10) } catch { return String(v) } }

export default function SuperAdminActivityLog() {
  const { isSuperAdmin, toast } = useAuth()
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  // فلاتر
  const [quick, setQuick] = useState('all')
  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')
  const [user, setUser] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  // ترقيم
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  // تصدير
  const [showExport, setShowExport] = useState(false)
  const [cols, setCols] = useState(() => COLUMNS.filter(c => c.k !== 'entity_id').map(c => c.k))

  const [facets, setFacets] = useState({ entities: [], actions: [], users: [], companies: [] })

  const effectiveEntity = quick === 'all' ? (entity || null)
    : quick === 'subscriptions' ? 'subscriptions'
      : quick === 'bookings' ? 'bookings' : 'branches'

  const params = useCallback((limit, offset) => ({
    p_entity: effectiveEntity,
    p_action: action || null,
    p_user: user || null,
    p_company: companyId || null,
    p_from: from ? new Date(from + 'T00:00:00').toISOString() : null,
    p_to: to ? new Date(to + 'T23:59:59').toISOString() : null,
    p_search: q.trim() || null,
    p_limit: limit,
    p_offset: offset,
  }), [effectiveEntity, action, user, companyId, from, to, q])

  const load = useCallback(async () => {
    if (!isSuperAdmin) return
    setLoading(true); setErr('')
    try {
      const { data, error } = await supabase.rpc('super_admin_activity_log', params(pageSize, (page - 1) * pageSize))
      if (error) throw error
      setRows(data || [])
      setTotal(data?.[0]?.total_count ? Number(data[0].total_count) : 0)
    } catch (e) {
      setErr(String(e?.message || e))
      reportIssue('activity_log', e, { page, pageSize })
    } finally { setLoading(false) }
  }, [isSuperAdmin, params, page, pageSize])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [quick, entity, action, user, companyId, from, to, q, pageSize])

  useEffect(() => {
    if (!isSuperAdmin) return
    supabase.rpc('super_admin_activity_facets').then(({ data }) => {
      if (data) setFacets({
        entities: data.entities || [], actions: data.actions || [],
        users: data.users || [], companies: data.companies || [],
      })
    }).catch(() => { /* الفلاتر الاختيارية لا تُعطّل الصفحة */ })
  }, [isSuperAdmin])

  const shape = (r) => {
    const nd = r.new_data || {}, od = r.old_data || {}
    let summary = nd.summary || ''
    let dates = ''
    if (r.entity === 'subscriptions') {
      dates = `${fmtDate(od.subscription_ends_at)} ← ${fmtDate(nd.subscription_ends_at)}`
      if (!summary) summary = `تغيير اشتراك ${nd.company_name || ''}`
    } else if (r.entity === 'bookings') {
      dates = nd.check_in_date ? `${nd.check_in_date} → ${nd.check_out_date}` : ''
    }
    return {
      id: r.id,
      at: r.created_at,
      company: r.company_name || '—',
      actor: r.actor_name || nd.actor || 'النظام',
      action: ACTION_LABEL[r.action] || r.action || '—',
      entity: r.entity || '—',
      summary: summary || `${r.action || ''} — ${r.entity || ''}`,
      dates,
      entity_id: r.entity_id || '—',
    }
  }

  const view = useMemo(() => rows.map(shape), [rows])
  const pages = Math.max(1, Math.ceil(total / pageSize))

  const doExport = async () => {
    if (!cols.length) return toast?.('اختر عموداً واحداً على الأقل', true)
    try {
      const { data, error } = await supabase.rpc('super_admin_activity_log', params(5000, 0))
      if (error) throw error
      const list = (data || []).map(shape)
      if (!list.length) return toast?.('لا توجد سجلات مطابقة للتصدير', true)
      const labels = Object.fromEntries(COLUMNS.map(c => [c.k, c.label]))
      exportCSV('activity-log.csv', list.map(r => Object.fromEntries(
        cols.map(k => [labels[k], k === 'at' ? fmt(r.at) : (r[k] ?? '—')])
      )))
      setShowExport(false)
      toast?.(`تم تصدير ${list.length} سجل`)
    } catch (e) {
      reportIssue('activity_log', e, { step: 'export' })
      toast?.('تعذّر التصدير: ' + (e?.message || e), true)
    }
  }

  if (!isSuperAdmin) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 32 }}>🔒</div>
        <h3>صلاحية غير كافية</h3>
        <p className="muted">سجل نشاط المنصة وتنبيهات النظام متاحة لحسابات السوبر أدمن فقط.</p>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="pg-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2>🗂️ سجل نشاط المنصة — الاشتراكات والحجوزات والتواريخ</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            {loading ? '⏳ تحديث…' : '🔄 تحديث'}
          </button>
          <button className="btn btn-gold btn-sm" onClick={() => setShowExport(true)}>⬇️ تصدير CSV</button>
        </div>
      </div>

      <SystemAlertsPanel />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0 8px' }}>
        {QUICK.map(t => (
          <button key={t.k}
            className={'btn btn-sm ' + (quick === t.k ? 'btn-gold' : 'btn-ghost')}
            onClick={() => { setQuick(t.k); setEntity('') }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        {quick === 'all' && (
          <select value={entity} onChange={e => setEntity(e.target.value)}>
            <option value="">كل الأقسام</option>
            {facets.entities.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        )}
        <select value={action} onChange={e => setAction(e.target.value)}>
          <option value="">كل العمليات</option>
          {facets.actions.map(x => <option key={x} value={x}>{ACTION_LABEL[x] || x}</option>)}
        </select>
        <select value={user} onChange={e => setUser(e.target.value)}>
          <option value="">كل المستخدمين</option>
          {facets.users.map(u => <option key={u.id} value={u.id}>{u.name || u.id.slice(0, 8)}</option>)}
        </select>
        <select value={companyId} onChange={e => setCompanyId(e.target.value)}>
          <option value="">كل المنشآت</option>
          {facets.companies.map(c => <option key={c.id} value={c.id}>{c.name || c.id.slice(0, 8)}</option>)}
        </select>
        <input placeholder="🔎 بحث في التفاصيل" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 200 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          من <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          إلى <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </label>
        <button className="btn btn-ghost btn-sm" onClick={() => {
          setQuick('all'); setEntity(''); setAction(''); setUser(''); setCompanyId(''); setQ(''); setFrom(''); setTo('')
        }}>♻️ مسح الفلاتر</button>
      </div>

      {err && <div className="card" style={{ padding: 12, color: 'var(--red, #b91c1c)' }}>تعذّر تحميل السجل: {err}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>الطابع الزمني</th><th>المنشأة</th><th>المنفّذ</th>
              <th>العملية</th><th>القسم</th><th>التفاصيل</th><th>التواريخ</th>
            </tr>
          </thead>
          <tbody>
            {!loading && view.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 18 }} className="muted">لا توجد سجلات مطابقة</td></tr>
            )}
            {view.map(r => (
              <tr key={r.id}>
                <td dir="ltr" style={{ whiteSpace: 'nowrap' }}>{fmt(r.at)}</td>
                <td>{r.company}</td>
                <td>{r.actor}</td>
                <td><span className="chip">{r.action}</span></td>
                <td>{r.entity}</td>
                <td>{r.summary}</td>
                <td dir="ltr" style={{ whiteSpace: 'nowrap' }}>{r.dates || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          إجمالي {total} سجل · صفحة {page} من {pages}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n} / صفحة</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" disabled={page <= 1 || loading} onClick={() => setPage(1)}>⏮</button>
          <button className="btn btn-ghost btn-sm" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>السابق</button>
          <button className="btn btn-ghost btn-sm" disabled={page >= pages || loading} onClick={() => setPage(p => p + 1)}>التالي</button>
          <button className="btn btn-ghost btn-sm" disabled={page >= pages || loading} onClick={() => setPage(pages)}>⏭</button>
        </div>
      </div>

      {showExport && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setShowExport(false)}>
          <div className="modal" style={{ width: 'min(520px,100%)' }}>
            <div className="modal-h"><h3>⬇️ تصدير CSV — اختيار الأعمدة</h3><button className="x" onClick={() => setShowExport(false)}>✕</button></div>
            <div className="modal-b">
              <p className="muted" style={{ fontSize: 12 }}>سيتم التصدير بنفس الفلاتر المطبّقة حالياً (حتى 5000 سجل).</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 8, marginTop: 10 }}>
                {COLUMNS.map(c => (
                  <label key={c.k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={cols.includes(c.k)}
                      onChange={e => setCols(prev => e.target.checked ? [...prev, c.k] : prev.filter(k => k !== c.k))} />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={() => setShowExport(false)}>إلغاء</button>
              <button className="btn btn-gold" onClick={doExport}>تصدير</button>
            </div>
          </div>
        </div>
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        السجل يُقرأ عبر دالة محمية ترفض أي مستدعٍ غير سوبر أدمن، وتستخدم فهارس على (created_at, entity, action, user_id) لضمان الأداء.
      </p>
    </div>
  )
}
