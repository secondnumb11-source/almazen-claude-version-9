import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { useBranches } from '../BranchContext'
import { SAR, num, today, exportCSV, PAY_METHODS } from '../lib/helpers'
import {
  fetchPaymentsRows, fetchBookingsRows, fetchTenantsRows, fetchExpensesRows,
  fetchMaintenanceRows, downloadWorkbook
} from '../lib/excel'
import { downloadPDF } from '../lib/pdf'
import TenantSummary from '../components/TenantSummary'

/* =====================================================================
   مركز التقارير الشامل — لوحة موحّدة تدمج منطق AccountantTools
   و ExtractionTools مع فلاتر متعددة (نطاق/وحدة/نوع بند/طريقة دفع/حالة/
   متأخرات/كاش/تحويل) + معاينة حيّة + تصدير CSV و Excel و PDF فاخر.
   + تبويب صيانة/خدمات مستقل، تقرير شامل للمحاسب لوحدة محددة،
   ملف تفصيلي للمستأجر مع الفاتورة (TenantSummary مدمج).
===================================================================== */
export default function ReportCenter() {
  const { profile } = useAuth()
  const isAccountant = profile?.role === 'accountant'
  const isOwnerLike = profile?.role === 'owner' || profile?.role === 'manager'
  const [tab, setTab] = useState('reports')

  return (
    <div>
      <div className="pg-title"><h2>مركز التقارير الشامل والمراقبة</h2></div>
      <div className="rc-tabs">
        <button className={tab === 'reports' ? 'on' : ''} onClick={() => setTab('reports')}>📊 التقارير الموحّدة</button>
        <button className={tab === 'maintenance' ? 'on' : ''} onClick={() => setTab('maintenance')}>🛠️ الصيانة والخدمات</button>
        <button className={tab === 'accountant' ? 'on' : ''} onClick={() => setTab('accountant')}>💼 التقرير الشامل للمحاسب</button>
        <button className={tab === 'tenant' ? 'on' : ''} onClick={() => setTab('tenant')}>👤 ملف المستأجر مع الفاتورة</button>
        <button className={tab === 'financial' ? 'on' : ''} onClick={() => setTab('financial')}>📈 لوحة الأداء المالي</button>
        {(isOwnerLike || isAccountant) && <button className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>👁️ مراقبة نشاط الموظفين</button>}
      </div>
      {tab === 'reports' && <UnifiedReports />}
      {tab === 'financial' && <FinancialDashboard />}
      {tab === 'maintenance' && <MaintenanceReport />}
      {tab === 'accountant' && <AccountantComprehensive />}
      {tab === 'tenant' && <TenantFileTab />}
      {tab === 'activity' && (isOwnerLike || isAccountant) && <ActivityMonitor />}
    </div>
  )
}


/* =================== التقارير الموحّدة =================== */
const PT = { rent: 'إيجار', down_payment: 'عربون', insurance: 'تأمين', penalty: 'غرامة', other: 'أخرى' }

function UnifiedReports() {
  const { profile, company, toast } = useAuth()
  const { scopeQuery, activeBranch } = useBranches()
  const [units, setUnits] = useState([])
  const [sel, setSel] = useState({ payments: true, bookings: true, expenses: false, tenants: false, maintenance: false })
  const [f, setF] = useState({ from: '', to: '', unit: '', method: '', ptype: '', status: '', overdueOnly: false })
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)   // { name, rows }
  const [sheets, setSheets] = useState([])

  useEffect(() => {
    scopeQuery(supabase.from('units').select('unit_number').eq('company_id', profile.company_id))
      .order('unit_number').then(({ data }) => setUnits(data || []))
  }, [profile, activeBranch])

  const toggle = (k) => setSel(s => ({ ...s, [k]: !s[k] }))

  const filtersLabel = {
    'من': f.from || '—', 'إلى': f.to || '—', 'الوحدة': f.unit || 'الكل',
    'طريقة الدفع': f.method ? PAY_METHODS[f.method] : 'الكل',
    'نوع البند': f.ptype ? PT[f.ptype] : 'الكل',
    'الحالة': f.status || 'الكل',
    'المتأخرات فقط': f.overdueOnly ? 'نعم' : 'لا'
  }

  const buildSheets = async () => {
    const wanted = Object.entries(sel).filter(([, v]) => v).map(([k]) => k)
    if (!wanted.length) { toast('اختر مجموعة بيانات واحدة على الأقل', true); return null }
    const cid = profile.company_id
    const opts = { from: f.from || undefined, to: f.to || undefined, unit: f.unit || undefined }
    const out = []

    if (sel.payments) {
      let rows = await fetchPaymentsRows(supabase, cid, opts)
      if (f.method) rows = rows.filter(r => r['الطريقة'] === PAY_METHODS[f.method])
      if (f.ptype) rows = rows.filter(r => r['النوع'] === PT[f.ptype])
      out.push({ name: 'الدفعات', rows, numeric: ['المبلغ'] })
    }
    if (sel.bookings) {
      let rows = await fetchBookingsRows(supabase, cid, opts)
      if (f.status) rows = rows.filter(r => r['الحالة'] === f.status)
      if (f.overdueOnly) rows = rows.filter(r => num(r['المتبقي']) > 0)
      out.push({ name: 'الحجوزات', rows, numeric: ['الإجمالي', 'الخصم', 'العربون', 'التأمين', 'المدفوع', 'المتبقي'] })
    }
    if (sel.expenses) {
      const rows = await fetchExpensesRows(supabase, cid, opts)
      out.push({ name: 'المصروفات', rows, numeric: ['المبلغ'] })
    }
    if (sel.tenants) {
      const rows = await fetchTenantsRows(supabase, cid)
      out.push({ name: 'المستأجرون', rows, numeric: ['عدد الإقامات', 'إجمالي التعاقدات', 'إجمالي المدفوع', 'نقاط الولاء'] })
    }
    if (sel.maintenance) {
      const rows = await fetchMaintenanceRows(supabase, cid, opts)
      out.push({ name: 'الصيانة والخدمات', rows, numeric: ['التكلفة'] })
    }

    const summary = out.map(s => {
      const numCol = s.numeric?.[0]
      const total = numCol ? s.rows.reduce((t, r) => t + num(r[numCol]), 0) : s.rows.length
      return { 'المجموعة': s.name, 'عدد السجلات': s.rows.length, 'إجمالي الحقل الرئيسي': total }
    })
    out.unshift({ name: 'ملخص التقرير', rows: summary, numeric: ['عدد السجلات', 'إجمالي الحقل الرئيسي'] })
    return out
  }

  const runPreview = async () => {
    setBusy(true)
    try {
      const s = await buildSheets()
      if (!s) return
      setSheets(s)
      const firstData = s.find(x => x.name !== 'ملخص التقرير' && x.rows.length) || s[0]
      setPreview(firstData)
      const total = s.reduce((t, x) => t + x.rows.length, 0)
      toast(total ? `✓ جاهز: ${s.length} مجموعة و ${total} سجل` : 'لا توجد بيانات مطابقة للفلاتر', !total)
    } catch (e) { toast('خطأ: ' + e.message, true) } finally { setBusy(false) }
  }

  const doExport = async (fmt) => {
    setBusy(true)
    try {
      const s = sheets.length ? sheets : await buildSheets()
      if (!s) return
      const total = s.reduce((t, x) => t + x.rows.length, 0)
      if (!total) return toast('لا توجد بيانات للتصدير', true)
      const stamp = new Date().toISOString().slice(0, 10)
      const base = `مركز-التقارير-${company?.name || 'المازن'}-${stamp}`
      if (fmt === 'csv') {
        const data = s.find(x => x.name !== 'ملخص التقرير' && x.rows.length)
        if (!data) return toast('لا توجد بيانات للتصدير CSV', true)
        exportCSV(`${data.name}-${stamp}.csv`, data.rows)
      } else if (fmt === 'xlsx') {
        downloadWorkbook(base + '.xlsx', s)
      } else {
        downloadPDF({ title: 'مركز التقارير الشامل', subtitle: base, company, filters: filtersLabel, sheets: s })
      }
      toast(`✓ تم التصدير (${fmt.toUpperCase()})`)
    } catch (e) { toast('خطأ: ' + e.message, true) } finally { setBusy(false) }
  }

  const quick = (patch) => { setF({ ...f, ...patch }); setSheets([]); setPreview(null) }

  return (
    <div className="builder">
      <h3>لوحة موحّدة — اختر البيانات، طبّق الفلاتر، عاين ثم صدّر</h3>

      <div className="check-row">
        {[['payments', '💳 الدفعات'], ['bookings', '📋 الحجوزات والعقود'],
          ['expenses', '💸 المصروفات'], ['tenants', '👥 المستأجرون'],
          ['maintenance', '🛠️ الصيانة والخدمات']].map(([k, label]) => (
          <label key={k} className={sel[k] ? 'on' : ''}>
            <input type="checkbox" checked={sel[k]} onChange={() => toggle(k)} />{label}
          </label>
        ))}
      </div>

      <div className="grid3">
        <div><label>من تاريخ</label>
          <input type="date" value={f.from} onChange={e => quick({ from: e.target.value })} /></div>
        <div><label>إلى تاريخ</label>
          <input type="date" value={f.to} onChange={e => quick({ to: e.target.value })} /></div>
        <div><label>الوحدة</label>
          <select value={f.unit} onChange={e => quick({ unit: e.target.value })}>
            <option value="">جميع الوحدات</option>
            {units.map(u => <option key={u.unit_number}>{u.unit_number}</option>)}
          </select></div>
        <div><label>طريقة الدفع</label>
          <select value={f.method} onChange={e => quick({ method: e.target.value })}>
            <option value="">الكل</option>
            <option value="cash">كاش</option>
            <option value="bank_transfer">تحويل بنكي</option>
            <option value="card">بطاقة بنكية</option>
          </select></div>
        <div><label>نوع البند (للدفعات)</label>
          <select value={f.ptype} onChange={e => quick({ ptype: e.target.value })}>
            <option value="">الكل</option>
            {Object.entries(PT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label>حالة الحجز</label>
          <select value={f.status} onChange={e => quick({ status: e.target.value })}>
            <option value="">الكل</option>
            {['معلق', 'محجوز', 'ساكن', 'منتهي', 'ملغي', 'بانتظار موافقة الخصم'].map(s => <option key={s}>{s}</option>)}
          </select></div>
      </div>

      <label className={'ovd ' + (f.overdueOnly ? 'on' : '')} style={{ display: 'inline-flex', gap: 8, marginTop: 12, alignItems: 'center', cursor: 'pointer' }}>
        <input type="checkbox" checked={f.overdueOnly} onChange={e => quick({ overdueOnly: e.target.checked })} />
        عرض المتأخرات فقط (حجوزات بمتبقٍ &gt; 0)
      </label>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn btn-blue" disabled={busy} onClick={runPreview}>🔎 معاينة</button>
        <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => doExport('xlsx')}>📗 Excel</button>
        <button className="btn btn-blue btn-sm" disabled={busy} onClick={() => doExport('pdf')}>📄 PDF فاخر</button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => doExport('csv')}>📑 CSV</button>

        <button className="btn btn-ghost btn-sm" onClick={() => { const q = today(); quick({ from: q.slice(0, 8) + '01', to: q }) }}>هذا الشهر</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { const d = new Date(); quick({ from: new Date(d.getFullYear(), d.getMonth() - 2, 1).toISOString().slice(0, 10), to: today() }) }}>آخر 3 أشهر</button>
        <button className="btn btn-ghost btn-sm" onClick={() => quick({ from: `${new Date().getFullYear()}-01-01`, to: today() })}>هذه السنة</button>
        <button className="btn btn-ghost btn-sm" onClick={() => quick({ from: '', to: '', unit: '', method: '', ptype: '', status: '', overdueOnly: false })}>مسح</button>
      </div>

      {preview && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ margin: '0 0 8px' }}>معاينة: {preview.name} ({preview.rows.length} سجل)</h4>
          {preview.rows.length === 0 ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>لا توجد بيانات مطابقة.</p> : (
            <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
              <table className="tbl">
                <thead><tr>{Object.keys(preview.rows[0]).map(h => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{preview.rows.slice(0, 100).map((r, i) => <tr key={i}>{Object.entries(r).map(([k, v]) =>
                  <td key={k} className={typeof v === 'number' ? 'money' : ''}>{typeof v === 'number' ? SAR(v) : v}</td>)}</tr>)}</tbody>
              </table>
              {preview.rows.length > 100 && <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>عرض أول 100 صف — التصدير يشمل الكل.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* =================== مراقبة نشاط الموظفين (بديل TeamViewer) =================== */
const SENSITIVE_KINDS = new Set(['delete', 'cancel', 'discount', 'refund', 'price_change'])
const ACTION_AR = { create: 'إنشاء', update: 'تعديل', delete: 'حذف', cancel: 'إلغاء', discount: 'خصم', handover: 'تسليم/استلام', refund: 'استرداد', price_change: 'تعديل سعر' }
const ENTITY_AR = { bookings: 'حجز', units: 'وحدة', payments: 'دفعة', customers: 'مستأجر', discount_requests: 'طلب خصم', handovers: 'تسليم', expenses: 'مصروف' }
const PAGE_AR = { home: 'الرئيسية', dash: 'إدارة الوحدات', reports: 'بوابة المحاسب', center: 'مركز التقارير', ai: 'المساعد الذكي', settings: 'الإعدادات' }
const PAGE_SIZE = 25

function ActivityMonitor() {
  const { profile, isSuperAdmin } = useAuth()
  const [logs, setLogs] = useState([])
  const [staff, setStaff] = useState([])
  const [filter, setFilter] = useState({ user: '', sensitiveOnly: false, action: '', entity: '', from: '', to: '' })
  const [page, setPage] = useState(1)
  const [presence, setPresence] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const cid = profile.company_id
    const [{ data: al }, { data: ppl }] = await Promise.all([
      supabase.from('audit_logs').select('*, profiles(full_name, role)')
        .eq('company_id', cid).order('created_at', { ascending: false }).limit(1000),
      supabase.from('profiles').select('id, full_name, role').eq('company_id', cid)
    ])
    setLogs(al || [])
    setStaff(ppl || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [profile])

  useEffect(() => {
    const ch = supabase.channel(`audit-live:${profile.company_id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs', filter: `company_id=eq.${profile.company_id}` }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [profile])

  // الاشتراك في Realtime Presence لمعرفة الموظفين المتصلين حالياً وصفحاتهم.
  // نفس اسم القناة يُستخدم أيضاً في App.jsx (Shell) لبث حضور كل المستخدمين —
  // realtime-js يُعيد نفس كائن القناة لنفس الاسم، ولا يمكن استدعاء .on() بعد
  // أن أصبحت مُشتركة (subscribed) بالفعل من Shell. لذا: إن كانت القناة مُشتركة
  // مسبقاً نكتفي بقراءة حالتها دورياً بدل محاولة اشتراك جديد يُسبب انهياراً.
  useEffect(() => {
    if (!profile) return
    const ch = supabase.channel(`presence:${profile.company_id}`, {
      config: { presence: { key: profile.id } }
    })
    const sync = () => {
      const state = ch.presenceState()
      const list = Object.values(state).flat()
      setPresence(list)
    }
    if (ch.state === 'joined') {
      sync()
      const t = setInterval(sync, 4000)
      return () => clearInterval(t)
    }
    ch.on('presence', { event: 'sync' }, sync)
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({
          user_id: profile.id,
          full_name: profile.full_name,
          role: profile.role,
          page: 'center',
          at: new Date().toISOString()
        })
        sync()
      }
    })
    // لا نُزيل القناة هنا — فقد تكون نفس القناة المشتركة مع Shell في App.jsx
    return () => {}
  }, [profile])

  const isSensitive = (l) => l.new_data?.sensitive === true || SENSITIVE_KINDS.has(l.action)
  const filtered = logs.filter(l => {
    if (filter.user && l.user_id !== filter.user) return false
    if (filter.action && l.action !== filter.action) return false
    if (filter.entity && l.entity !== filter.entity) return false
    if (filter.sensitiveOnly && !isSensitive(l)) return false
    if (filter.from && l.created_at.slice(0, 10) < filter.from) return false
    if (filter.to && l.created_at.slice(0, 10) > filter.to) return false
    return true
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const curPage = Math.min(page, totalPages)
  const shown = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE)
  const sensitiveCount = filtered.filter(isSensitive).length

  // إعادة التصفح للصفحة الأولى عند تغيير الفلاتر
  useEffect(() => { setPage(1) }, [filter.user, filter.action, filter.entity, filter.sensitiveOnly, filter.from, filter.to])

  const exportFiltered = () => {
    if (!filtered.length) return
    const rows = filtered.map(l => ({
      'الوقت': new Date(l.created_at).toLocaleString('ar-SA'),
      'المنفّذ': l.profiles?.full_name || l.new_data?.actor || '—',
      'الدور': ({ owner: 'المدير', manager: 'مدير', accountant: 'محاسب', employee: 'موظف' }[l.profiles?.role]) || '—',
      'الإجراء': ACTION_AR[l.action] || l.action,
      'العنصر': ENTITY_AR[l.entity] || l.entity,
      'حساس': isSensitive(l) ? 'نعم' : 'لا',
      'التفاصيل': l.new_data?.summary || ''
    }))
    exportCSV(`نشاط-الموظفين-${today()}.csv`, rows)
  }

  const others = presence.filter(p => p.user_id !== profile.id)

  return (
    <div className="builder">
      <h3>مراقبة نشاط الموظفين — سجل الإجراءات المباشر</h3>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>
        بديل آمن للتحكم عن بُعد (TeamViewer): بدلاً من مشاركة الشاشة — غير الممكنة تقنياً في تطبيق ويب داخل المتصفح دون امتدادات خاصة — تعرض هذه اللوحة (1) الموظفين المتصلين الآن والشاشة التي يستعرضونها لحظياً، و(2) سجل كل إجراءاتهم مع التوقيت واسم المنفّذ، وتُبرز العمليات الحساسة (حذف، إلغاء، خصم، استرداد) بتنبيه واضح.
      </p>

      {/* الحضور الحيّ — من هو متصل الآن وعلى أي شاشة */}
      <div style={{ background: 'var(--soft, #f5f7fb)', borderRadius: 12, padding: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <b>🟢 الموظفون المتصلون الآن ({others.length})</b>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>تحديث مباشر عبر Realtime</span>
        </div>
        {others.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>لا يوجد موظفون آخرون متصلون حالياً.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {others.map((p, i) => (
              <div key={p.user_id + i} className="chip" style={{ background: '#fff', padding: '6px 12px', borderRadius: 20, border: '1px solid #e2e8f0', fontSize: 13 }}>
                <b>{p.full_name}</b>
                <span style={{ color: 'var(--muted)', marginInlineStart: 6 }}>
                  · {{ owner: 'المدير', manager: 'مدير', accountant: 'محاسب', employee: 'موظف' }[p.role] || p.role}
                </span>
                <span style={{ marginInlineStart: 8, color: 'var(--green, #16a34a)' }}>· شاشة: {PAGE_AR[p.page] || p.page}</span>
              </div>
            ))}
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, marginBottom: 0 }}>
          ملاحظة تقنية: التحكم الكامل بشاشة موظف بأسلوب TeamViewer يتطلب تطبيق سطح مكتب أو امتداداً للمتصفح — غير متاح داخل تطبيق ويب صرف. البديل المعتمد هنا: حضور مباشر + سجل إجراءات كامل + تنبيه فوري للعمليات الحساسة.
        </p>
      </div>

      <div className="kpis" style={{ marginBottom: 14 }}>
        <div className="kpi"><div className="v">{filtered.length}</div><div className="l">الإجراءات بعد الفلترة</div></div>
        <div className="kpi"><div className="v" style={{ color: 'var(--st-oc)' }}>{sensitiveCount}</div><div className="l">عمليات حساسة</div></div>
        <div className="kpi"><div className="v">{logs.length}</div><div className="l">إجمالي السجل (آخر 1000)</div></div>
        <div className="kpi"><div className="v">{staff.length}</div><div className="l">المستخدمون</div></div>
      </div>

      <div className="grid3" style={{ marginBottom: 12 }}>
        <div><label>الموظف</label>
          <select value={filter.user} onChange={e => setFilter({ ...filter, user: e.target.value })}>
            <option value="">كل المستخدمين</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
        <div><label>نوع الإجراء</label>
          <select value={filter.action} onChange={e => setFilter({ ...filter, action: e.target.value })}>
            <option value="">الكل</option>
            {Object.entries(ACTION_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div><label>نوع العنصر</label>
          <select value={filter.entity} onChange={e => setFilter({ ...filter, entity: e.target.value })}>
            <option value="">الكل</option>
            {Object.entries(ENTITY_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div><label>من تاريخ</label>
          <input type="date" value={filter.from} onChange={e => setFilter({ ...filter, from: e.target.value })} /></div>
        <div><label>إلى تاريخ</label>
          <input type="date" value={filter.to} onChange={e => setFilter({ ...filter, to: e.target.value })} /></div>
        <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer', margin: 0 }}>
            <input type="checkbox" checked={filter.sensitiveOnly} onChange={e => setFilter({ ...filter, sensitiveOnly: e.target.checked })} />
            الحساسة فقط
          </label>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button className="btn btn-ghost btn-sm" onClick={load}>↻ تحديث</button>
        <button className="btn btn-gold btn-sm" onClick={exportFiltered} disabled={!filtered.length}>📑 تصدير CSV ({filtered.length})</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setFilter({ user: '', sensitiveOnly: false, action: '', entity: '', from: '', to: '' })}>مسح الفلاتر</button>
      </div>

      {loading ? <p style={{ color: 'var(--muted)' }}>جارٍ التحميل…</p> :
        shown.length === 0 ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>لا توجد إجراءات مسجلة بعد. تُسجَّل العمليات الحساسة تلقائياً عند حدوثها.</p> : (
          <>
          <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>الوقت</th><th>المنفّذ</th><th>الدور</th><th>الإجراء</th><th>العنصر</th><th>التفاصيل</th></tr></thead>
              <tbody>
                {shown.map(l => (
                  <tr key={l.id} style={isSensitive(l) ? { background: '#FDECEC' } : undefined}>
                    <td dir="ltr" style={{ fontSize: 12 }}>{new Date(l.created_at).toLocaleString('ar-SA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{l.profiles?.full_name || l.new_data?.actor || '—'}</td>
                    <td style={{ fontSize: 12 }}>{{ owner: 'المدير', manager: 'مدير', accountant: 'محاسب', employee: 'موظف' }[l.profiles?.role] || '—'}</td>
                    <td>
                      {isSensitive(l) && <span style={{ marginInlineEnd: 4 }}>⚠️</span>}
                      {ACTION_AR[l.action] || l.action}
                    </td>
                    <td>{ENTITY_AR[l.entity] || l.entity}</td>
                    <td style={{ fontSize: 12 }}>{l.new_data?.summary || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              صفحة {curPage} من {totalPages} — عرض {shown.length} من {filtered.length} سجل
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" disabled={curPage <= 1} onClick={() => setPage(1)}>«</button>
              <button className="btn btn-ghost btn-sm" disabled={curPage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹ السابق</button>
              <button className="btn btn-ghost btn-sm" disabled={curPage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>التالي ›</button>
              <button className="btn btn-ghost btn-sm" disabled={curPage >= totalPages} onClick={() => setPage(totalPages)}>»</button>
            </div>
          </div>
          </>
        )}
    </div>
  )
}

/* =================== تقرير الصيانة والخدمات (مستقل) =================== */
function MaintenanceReport() {
  const { profile, company, toast } = useAuth()
  const { scopeQuery, activeBranch } = useBranches()
  const [units, setUnits] = useState([])
  const [f, setF] = useState({ from: '', to: '', unit: '' })
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    scopeQuery(supabase.from('units').select('unit_number').eq('company_id', profile.company_id))
      .order('unit_number').then(({ data }) => setUnits(data || []))
  }, [profile, activeBranch])

  const run = async () => {
    setBusy(true)
    try {
      const r = await fetchMaintenanceRows(supabase, profile.company_id, f)
      setRows(r)
      toast(r.length ? `✓ ${r.length} طلب صيانة/خدمة` : 'لا توجد بيانات مطابقة', !r.length)
    } catch (e) { toast('خطأ: ' + e.message, true) } finally { setBusy(false) }
  }

  useEffect(() => { run() }, [profile])

  const totalCost = rows.reduce((s, r) => s + num(r['التكلفة']), 0)

  const doExport = (fmt) => {
    if (!rows.length) return toast('لا توجد بيانات', true)
    const stamp = today()
    const sheets = [{ name: 'الصيانة والخدمات', rows, numeric: ['التكلفة'] }]
    if (fmt === 'xlsx') downloadWorkbook(`صيانة-${company?.name || 'المازن'}-${stamp}.xlsx`, sheets)
    else if (fmt === 'csv') exportCSV(`صيانة-${stamp}.csv`, rows)
    else downloadPDF({ title: 'تقرير الصيانة والخدمات', subtitle: `${company?.name || 'المازن'} — ${stamp}`, company, filters: { 'من': f.from || '—', 'إلى': f.to || '—', 'الوحدة': f.unit || 'الكل' }, sheets })
  }

  return (
    <div className="builder">
      <h3>تقرير الصيانة والخدمات</h3>
      <div className="grid3">
        <div><label>من</label><input type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></div>
        <div><label>إلى</label><input type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></div>
        <div><label>الوحدة</label>
          <select value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })}>
            <option value="">جميع الوحدات</option>
            {units.map(u => <option key={u.unit_number}>{u.unit_number}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-blue" disabled={busy} onClick={run}>🔎 تحديث</button>
        <button className="btn btn-gold btn-sm" disabled={busy || !rows.length} onClick={() => doExport('xlsx')}>📗 Excel</button>
        <button className="btn btn-blue btn-sm" disabled={busy || !rows.length} onClick={() => doExport('pdf')}>📄 PDF فاخر</button>
        <button className="btn btn-ghost btn-sm" disabled={busy || !rows.length} onClick={() => doExport('csv')}>📑 CSV</button>
      </div>
      <div className="kpis" style={{ marginTop: 14 }}>
        <div className="kpi"><div className="v">{rows.length}</div><div className="l">إجمالي الطلبات</div></div>
        <div className="kpi"><div className="v">{SAR(totalCost)}</div><div className="l">إجمالي التكاليف</div></div>
        <div className="kpi"><div className="v">{rows.filter(r => r['الحالة'] === 'مفتوح').length}</div><div className="l">مفتوح</div></div>
        <div className="kpi"><div className="v">{rows.filter(r => r['الحالة'] === 'منجز').length}</div><div className="l">منجز</div></div>
      </div>
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto', maxHeight: 480, overflowY: 'auto', marginTop: 12 }}>
          <table className="tbl">
            <thead><tr>{Object.keys(rows[0]).map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{Object.entries(r).map(([k, v]) =>
              <td key={k} className={typeof v === 'number' ? 'money' : ''}>{typeof v === 'number' ? SAR(v) : v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* =================== التقرير الشامل للمحاسب (وحدة محددة) =================== */
function AccountantComprehensive() {
  const { profile, company, toast } = useAuth()
  const { scopeQuery, activeBranch } = useBranches()
  const [units, setUnits] = useState([])
  const [unitId, setUnitId] = useState('')
  const [range, setRange] = useState({ from: '', to: '' })
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)

  

  useEffect(() => {
    scopeQuery(supabase.from('units').select('id, unit_number, category, daily_price, monthly_price, yearly_price')
      .eq('company_id', profile.company_id)).order('unit_number')
      .then(({ data }) => setUnits(data || []))
  }, [profile, activeBranch])

  const build = async () => {
    if (!unitId) return toast('اختر الوحدة أولاً', true)
    setBusy(true)
    try {
      const unit = units.find(u => u.id === unitId)
      const cid = profile.company_id
      const [bk, pay, exp, mn] = await Promise.all([
        scopeQuery(supabase.from('bookings')
          .select('id, check_in_date, check_out_date, status, base_price, discount_percent, discount_amount, total_amount, down_payment, insurance_amount, customers(full_name, phone, id_number)')
          .eq('company_id', cid).eq('unit_id', unitId)).order('check_in_date', { ascending: false }),
        scopeQuery(supabase.from('payments')
          .select('amount, payment_type, method, payment_date, bookings!inner(unit_id)')
          .eq('company_id', cid).eq('bookings.unit_id', unitId)),
        scopeQuery(supabase.from('expenses')
          .select('expense_date, category, amount, description')
          .eq('company_id', cid).eq('unit_id', unitId)),
        scopeQuery(supabase.from('maintenance_requests')
          .select('opened_at, request_type, status, cost, description')
          .eq('company_id', cid).eq('unit_id', unitId))
      ])
      const inRange = (d) => (!range.from || d >= range.from) && (!range.to || d <= range.to)
      const bookings = (bk.data || []).filter(b => inRange(b.check_in_date) || inRange(b.check_out_date))
      const payments = (pay.data || []).filter(p => inRange(p.payment_date))
      const expenses = (exp.data || []).filter(e => inRange(e.expense_date))
      const maint    = (mn.data  || []).filter(m => inRange((m.opened_at || '').slice(0, 10)))

      const revenue     = payments.filter(p => p.payment_type !== 'insurance').reduce((s, p) => s + Number(p.amount), 0)
      const insuranceIn = payments.filter(p => p.payment_type === 'insurance').reduce((s, p) => s + Number(p.amount), 0)
      const downSum     = bookings.reduce((s, b) => s + Number(b.down_payment || 0), 0)
      const totalContract = bookings.reduce((s, b) => s + Number(b.total_amount || 0), 0)
      const discount    = bookings.reduce((s, b) => s + Number(b.discount_amount || 0), 0)
      const overdue     = totalContract - revenue - downSum
      const expenseSum  = expenses.reduce((s, e) => s + Number(e.amount), 0)
      const maintSum    = maint.reduce((s, m) => s + Number(m.cost || 0), 0)
      const net         = revenue - expenseSum - maintSum

      setData({ unit, bookings, payments, expenses, maint,
        summary: { revenue, insuranceIn, downSum, totalContract, discount, overdue, expenseSum, maintSum, net } })
      toast(`✓ تقرير شامل جاهز — الوحدة ${unit.unit_number}`)
    } catch (e) { toast('خطأ: ' + e.message, true) } finally { setBusy(false) }
  }

  const doExport = (fmt) => {
    if (!data) return
    const s = data.summary
    const stamp = today()
    const summary = [
      { 'البند': 'الإجمالي التعاقدي', 'القيمة': s.totalContract },
      { 'البند': 'إجمالي الخصم', 'القيمة': s.discount },
      { 'البند': 'إجمالي العربون المحصل', 'القيمة': s.downSum },
      { 'البند': 'إجمالي التأمين المحصل', 'القيمة': s.insuranceIn },
      { 'البند': 'إجمالي الإيرادات (بدون التأمين)', 'القيمة': s.revenue },
      { 'البند': 'إجمالي المتأخر', 'القيمة': s.overdue },
      { 'البند': 'إجمالي المصروفات', 'القيمة': s.expenseSum },
      { 'البند': 'إجمالي تكاليف الصيانة', 'القيمة': s.maintSum },
      { 'البند': 'صافي الربح', 'القيمة': s.net },
      { 'البند': 'السعر اليومي', 'القيمة': Number(data.unit.daily_price || 0) },
      { 'البند': 'السعر الشهري', 'القيمة': Number(data.unit.monthly_price || 0) },
      { 'البند': 'السعر السنوي', 'القيمة': Number(data.unit.yearly_price || 0) }
    ]
    const sheets = [
      { name: 'ملخص الوحدة', rows: summary, numeric: ['القيمة'] },
      { name: 'الحجوزات', rows: data.bookings.map(b => ({
        'المستأجر': b.customers?.full_name, 'من': b.check_in_date, 'إلى': b.check_out_date,
        'الحالة': b.status, 'الأساسي': Number(b.base_price || 0), 'خصم %': Number(b.discount_percent || 0),
        'الإجمالي': Number(b.total_amount || 0), 'العربون': Number(b.down_payment || 0), 'التأمين': Number(b.insurance_amount || 0)
      })), numeric: ['الأساسي', 'الإجمالي', 'العربون', 'التأمين'] },
      { name: 'الدفعات', rows: data.payments.map(p => ({
        'التاريخ': p.payment_date, 'النوع': p.payment_type, 'الطريقة': PAY_METHODS[p.method] || p.method, 'المبلغ': Number(p.amount)
      })), numeric: ['المبلغ'] },
      { name: 'المصروفات', rows: data.expenses.map(e => ({
        'التاريخ': e.expense_date, 'النوع': e.category, 'الوصف': e.description || '—', 'المبلغ': Number(e.amount)
      })), numeric: ['المبلغ'] },
      { name: 'الصيانة', rows: data.maint.map(m => ({
        'التاريخ': m.opened_at?.slice(0, 10), 'النوع': m.request_type, 'الحالة': m.status, 'الوصف': m.description || '—', 'التكلفة': Number(m.cost || 0)
      })), numeric: ['التكلفة'] }
    ]
    const title = `التقرير الشامل — الوحدة ${data.unit.unit_number}`
    if (fmt === 'xlsx') downloadWorkbook(`تقرير-شامل-${data.unit.unit_number}-${stamp}.xlsx`, sheets)
    else downloadPDF({ title, subtitle: `${company?.name || 'المازن'} — ${stamp}`, company,
      filters: { 'الوحدة': data.unit.unit_number, 'من': range.from || '—', 'إلى': range.to || '—' }, sheets })
  }

  return (
    <div className="builder">
      <h3>💼 التقرير المحاسبي الشامل لوحدة محددة</h3>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>
        يعرض للوحدة المختارة: المصروفات، الإيرادات، مدة الإيجار، المدفوع، المتأخر، المتبقي، التأمين والعربون، السعر الأساسي والخصم، وصافي الربح — مع تصدير Excel/PDF بتنسيق مخصص للمحاسب.
      </p>
      <div className="grid3">
        <div><label>الوحدة</label>
          <select value={unitId} onChange={e => setUnitId(e.target.value)}>
            <option value="">— اختر —</option>
            {units.map(u => <option key={u.id} value={u.id}>{u.unit_number} — {u.category}</option>)}
          </select>
        </div>
        <div><label>من</label><input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></div>
        <div><label>إلى</label><input type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-blue" disabled={busy || !unitId} onClick={build}>🧮 توليد التقرير</button>
        <button className="btn btn-gold btn-sm" disabled={!data} onClick={() => doExport('xlsx')}>📗 Excel</button>
        <button className="btn btn-blue btn-sm" disabled={!data} onClick={() => doExport('pdf')}>📄 PDF فاخر</button>
      </div>

      {data && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ margin: '4px 0 10px' }}>ملخص الوحدة {data.unit.unit_number}</h4>
          <div className="kpis">
            <div className="kpi"><div className="v">{SAR(data.summary.revenue)}</div><div className="l">الإيرادات</div></div>
            <div className="kpi"><div className="v">{SAR(data.summary.expenseSum + data.summary.maintSum)}</div><div className="l">مصروفات + صيانة</div></div>
            <div className="kpi"><div className="v" style={{ color: data.summary.net >= 0 ? 'var(--green)' : 'var(--st-oc)' }}>{SAR(data.summary.net)}</div><div className="l">صافي الربح</div></div>
            <div className="kpi"><div className="v">{SAR(data.summary.overdue)}</div><div className="l">متأخرات</div></div>
            <div className="kpi"><div className="v">{SAR(data.summary.downSum)}</div><div className="l">عربون</div></div>
            <div className="kpi"><div className="v">{SAR(data.summary.insuranceIn)}</div><div className="l">تأمين</div></div>
            <div className="kpi"><div className="v">{data.bookings.length}</div><div className="l">حجوزات</div></div>
            <div className="kpi"><div className="v">{data.maint.length}</div><div className="l">طلبات صيانة</div></div>
          </div>
        </div>
      )}
    </div>
  )
}

/* =================== ملف المستأجر مع الفاتورة (يدمج TenantSummary) =================== */
function TenantFileTab() {
  const { profile, toast } = useAuth()
  const { scopeQuery, activeBranch } = useBranches()
  const [bookings, setBookings] = useState([])
  const [sel, setSel] = useState('')
  const [current, setCurrent] = useState(null)

  useEffect(() => {
    scopeQuery(supabase.from('bookings')
      .select('id, check_in_date, check_out_date, status, total_amount, down_payment, insurance_amount, discount_percent, discount_amount, unit_id, units(unit_number, category, is_furnished, furniture_checklist), customers(full_name, phone, id_number)')
      .eq('company_id', profile.company_id))
      .order('check_in_date', { ascending: false })
      .limit(300)
      .then(({ data }) => setBookings(data || []))
  }, [profile, activeBranch])

  const open = () => {
    if (!sel) return toast('اختر الحجز/المستأجر', true)
    const b = bookings.find(x => x.id === sel)
    if (b) setCurrent({ booking: b, unit: b.units })
  }

  return (
    <div className="builder">
      <h3>👤 ملف تفصيلي للمستأجر يُقدَّم مع الفاتورة</h3>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>
        يعرض للمستأجر: تاريخ الدخول/الخروج، مدة الإيجار، عدد الدفعات وتفاصيلها وتواريخها وطريقة الدفع،
        العربون والتأمين المدفوع، الإجمالي والمدفوع والمتبقي، وقائمة الأثاث الموثّقة — قابل للطباعة PDF من نافذة المتصفح.
      </p>
      <div className="grid3">
        <div style={{ gridColumn: 'span 2' }}>
          <label>اختر الحجز / المستأجر</label>
          <select value={sel} onChange={e => setSel(e.target.value)}>
            <option value="">— اختر —</option>
            {bookings.map(b => (
              <option key={b.id} value={b.id}>
                {b.customers?.full_name || 'بدون اسم'} — وحدة {b.units?.unit_number} — {b.check_in_date} → {b.check_out_date}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'end' }}>
          <button className="btn btn-blue" disabled={!sel} onClick={open}>📄 فتح الملف التفصيلي</button>
        </div>
      </div>
      {current && (
        <TenantSummary booking={current.booking} unit={current.unit} onClose={() => setCurrent(null)} />
      )}
    </div>
  )
}



/* =================== لوحة الأداء المالي =================== */
function FinancialDashboard() {
  const { profile, isSuperAdmin } = useAuth()
  const { scopeQuery, activeBranch } = useBranches()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      // نجمع إيرادات الحجوزات ومصروفات الصيانة لكل وحدة
      // يتم ذلك عن طريق استدعاء حسابات الإيرادات والمصروفات، أو من الجداول مباشرة لتبسيط العرض
      const { data: unitsData } = await scopeQuery(supabase.from('units').select('id, unit_number').eq('company_id', profile.company_id))
      const { data: bks } = await scopeQuery(supabase.from('bookings').select('unit_id, total_amount').eq('company_id', profile.company_id)).in('status', ['confirmed', 'checked_in', 'checked_out'])
      const { data: exps } = await scopeQuery(supabase.from('expenses').select('unit_id, amount, category').eq('company_id', profile.company_id))
      
      const res = (unitsData || []).map(u => {
        const uBks = (bks || []).filter(b => b.unit_id === u.id)
        const revenue = uBks.reduce((sum, b) => sum + num(b.total_amount), 0)
        const maintExps = (exps || []).filter(e => e.unit_id === u.id && e.category === 'maintenance')
        const maintCost = maintExps.reduce((sum, e) => sum + num(e.amount), 0)
        
        return {
          id: u.id,
          unit_number: u.unit_number,
          revenue,
          maintCost,
          maintRatio: revenue > 0 ? (maintCost / revenue) : 0
        }
      })
      setData(res.sort((a,b) => b.revenue - a.revenue))
      setLoading(false)
    }
    load()
  }, [profile])

  if (loading) return <div>جار التحميل...</div>

  return (
    <div className="panel">
      <h3 style={{ marginBottom: 16 }}>📈 لوحة الأداء المالي والتشغيلي للوحدات</h3>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
        تحليل ذكي للإيرادات المستندة إلى العقود مقابل مصاريف الصيانة لكل وحدة، لتقييم العائد الاستثماري (ROI).
      </p>
      <div className="grid3" style={{ marginBottom: 20 }}>
        {data.map(u => (
          <div key={u.id} className="card" style={{ padding: 15, background: u.maintRatio > 0.3 ? 'var(--danger-soft)' : 'var(--panel)' }}>
            <h4 style={{ margin: '0 0 10px', display: 'flex', justifyContent: 'space-between' }}>
              <span>الوحدة {u.unit_number}</span>
              <span className="money" style={{ fontSize: 15 }}>{SAR(u.revenue)} إيراد</span>
            </h4>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
              <span>مصاريف الصيانة:</span>
              <span style={{ color: 'var(--st-oc)', fontWeight: 'bold' }}>{SAR(u.maintCost)}</span>
            </div>
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', background: u.maintRatio > 0.3 ? 'var(--st-oc)' : 'var(--st-ok)', width: `${Math.min(u.maintRatio * 100, 100)}%` }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'left' }}>
              النسبة للإيراد: {(u.maintRatio * 100).toFixed(1)}%
            </div>
            {u.maintRatio > 0.3 && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#d32f2f', background: 'rgba(211, 47, 47, 0.1)', padding: 8, borderRadius: 6 }}>
                ⚠️ <b>تنبيه ذكي:</b> مصاريف الوحدة تجاوزت الحد الآمن (30%) من الإيراد. قد توجد مشكلة إنشائية أو تشغيلية تتطلب مراجعة.
              </div>
            )}
          </div>
        ))}
        {data.length === 0 && <div style={{ color: 'var(--muted)' }}>لا توجد بيانات متاحة</div>}
      </div>
    </div>
  )
}
