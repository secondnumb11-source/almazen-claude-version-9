import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'

// تحميل كسول للصفحات الثقيلة لتسريع الإقلاع والتنقل (Code Splitting)
const Maintenance = lazy(() => import('./pages/Maintenance.jsx'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Reports = lazy(() => import('./pages/Reports'))
const Assistant = lazy(() => import('./pages/Assistant'))
const ReportCenter = lazy(() => import('./pages/ReportCenter'))
const Settings = lazy(() => import('./pages/Settings'))
const CustomersManagement = lazy(() => import('./pages/CustomersManagement'))
const EmployeeManagement = lazy(() => import('./pages/EmployeeManagement'))
const EmployeeOps = lazy(() => import('./pages/EmployeeOps'))
const EjarPanel = lazy(() => import('./pages/EjarPanel'))
const ChannelManagerPanel = lazy(() => import('./pages/ChannelManagerPanel'))
const SettlementHistory = lazy(() => import('./pages/SettlementHistory'))
const AuditReport = lazy(() => import('./pages/AuditReport'))
// النظام المحاسبي الكامل — دفتر الأستاذ والقيود والميزان والتقارير
const GeneralLedgerPage = lazy(() => import('./pages/accounting/GeneralLedgerPage'))
const TrialBalancePage = lazy(() => import('./pages/accounting/TrialBalancePage'))
const JournalListPage = lazy(() => import('./pages/accounting/JournalListPage'))
const ChartOfAccountsPage = lazy(() => import('./pages/accounting/ChartOfAccountsPage'))
const CostCentersPage = lazy(() => import('./pages/accounting/CostCentersPage'))
const TaxCenterPage = lazy(() => import('./pages/accounting/TaxCenterPage'))
const ServicesPage = lazy(() => import('./pages/accounting/ServicesPage'))
const DeferredPage = lazy(() => import('./pages/accounting/DeferredPage'))
const AccountingSettingsPage = lazy(() => import('./pages/accounting/AccountingSettingsPage'))
const ReportsHubPage = lazy(() => import('./pages/accounting/ReportsHubPage'))
const TestsHubPage = lazy(() => import('./pages/accounting/TestsHubPage'))
const OdooPage = lazy(() => import('./pages/accounting/OdooPage'))
const DigitalDocsPage = lazy(() => import('./pages/accounting/DigitalDocsPage'))
const ShomoosPage = lazy(() => import('./pages/accounting/ShomoosPage'))
import { AuthProvider, useAuth } from './AuthContext'
import { supabase, hasSupabaseConfig } from './lib/supabase'
import Login from './pages/Login'
import Landing from './pages/Landing'
import Home from './pages/Home'
import PublicUnit from './pages/PublicUnit'
import TenantPortal from './pages/TenantPortal'
import ResetPassword from './pages/ResetPassword'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import AppSidebar from './components/AppSidebar'
import DrawerWidget from './components/DrawerWidget'
import RlsHealthBanner from './components/RlsHealthBanner'
import BackgroundIsolationMonitor from './components/BackgroundIsolationMonitor'
import ConfigErrorScreen from './components/ConfigErrorScreen'
import TrialBanner from './components/TrialBanner'
import TrialExpired from './pages/TrialExpired'
import { FullPageLoading } from './components/Skeleton'
import { ROLES } from './lib/helpers'
import { runDailyNotificationChecks } from './lib/notifications'
import DataSearch from './components/DataSearch'
import { getOfflineQueue, syncOfflineQueue } from './lib/offlineManager'

/** مفاتيح صفحات النظام المحاسبي — تُستخدم لبوابة صلاحية واحدة بدل شرط لكل صفحة. */
const ACCT_PAGES = new Set([
  'je-new', 'je-list', 'je-report', 'gl', 'coa', 'cost-centers', 'tb', 'tb-check',
  'vat', 'deferred-rev', 'deferred-exp', 'acct-settings', 'reports-hub', 'tests-hub', 'odoo',
  'digital-docs', 'shomoos',
])
const acctPage = (p) => ACCT_PAGES.has(p) || String(p).startsWith('services')

/**
 * يحدّد القسم الذي يفتحه الإشعار عند النقر عليه.
 * الأولوية للكيان المرفق (صيانة/وحدة/عميل) ثم لنوع الحدث، فإن لم يُعرف
 * يُفتح لوحة الوحدات لأنها أقرب سياق تشغيلي بدل ترك النقرة بلا أثر.
 */
function notifTarget(n) {
  const ev = n?.event_type || ''
  if (ev.startsWith('maintenance') || ev === 'handover') return 'maintenance'
  if (ev.startsWith('iqama') || ev === 'welcome_message' || ev.startsWith('contract')) return 'customers'
  if (ev === 'new_payment') return 'reports'
  if (ev === 'tenant_service_request') return 'maintenance'
  if (ev === 'new_booking' || ev === 'new_lease_started') return 'dash'
  if (n?.unit_id || n?.booking_id) return 'dash'
  if (n?.customer_id) return 'customers'
  return 'dash'
}

function Shell() {
  const { session, profile, company, access, loading, isOwner, canFinance, isSuperAdmin, toast } = useAuth()
  const [forceUpgrade, setForceUpgrade] = useState(false)
  const [page, setPage] = useState('home')
  // القيد المطلوب فتحه عند القدوم من دفتر الأستاذ أو من إشعار
  const [openEntryId, setOpenEntryId] = useState(undefined)
  // صلاحية دخول النظام المحاسبي — نفس صلاحية بقية الشاشات المالية
  const canAcct = canFinance || profile?.role === 'accountant'
  // السجل الذي طلب المستخدم فتحه من البحث — تقرؤه الصفحة الهدف وتُبرزه
  const [focusRecord, setFocusRecord] = useState(null)
  const [notifs, setNotifs] = useState([])
  const [evictionAlerts, setEvictionAlerts] = useState([])
  const [drawer, setDrawer] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [dashEditMode, setDashEditMode] = useState(false)
  const [isOffline, setIsOffline] = useState(!navigator.onLine)

  /**
   * ينقل إلى صفحة ويمرّر إليها السجل المطلوب فتحه من البحث.
   * القيد يُفتح مباشرةً في محرّره؛ وبقية الصفحات تستقبل السجل عبر
   * focusRecord فترشّح عليه بدل ترك المستخدم يبحث من جديد داخلها.
   */
  const openRecord = useCallback((targetPage, record) => {
    if (!targetPage) return
    if (record?.id && (targetPage === 'je-list' || targetPage === 'je-new')) {
      setOpenEntryId(record.id)
      setPage('je-list')
    } else {
      setOpenEntryId(undefined)
      setPage(targetPage)
    }
    setFocusRecord(record || null)
    if (window.innerWidth <= 768) setCollapsed(true)
  }, [])

  const [pendingSyncCount, setPendingSyncCount] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const presenceRef = useRef(null)

  const checkPendingQueue = () => {
    const queue = getOfflineQueue()
    setPendingSyncCount(queue.length)
  }

  // شبكة أمان لنظام الترشيح: إن سجّل المستخدم عبر رابط/كود ترشيح ولم يُربط الكود
  // بمنشأته لأي سبب، يُربط تلقائياً عند أول دخول ثم يُمسح الكود المخزّن.
  useEffect(() => {
    if (!profile?.company_id) return
    let code = ''
    try { code = (localStorage.getItem('almazen_referral_code') || '').trim().toUpperCase() } catch { /* ignore */ }
    if (!code) return
    let cancelled = false
    supabase.rpc('referral_register_signup', { p_code: code })
      .then(({ data }) => {
        if (cancelled) return
        if (data?.ok) toast(`تم تأكيد ترشيحك من ${data.referrer_name} — 3 أشهر مجانية بعد سداد الاشتراك`)
        try { localStorage.removeItem('almazen_referral_code') } catch { /* ignore */ }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [profile?.company_id, toast])


  useEffect(() => {
    checkPendingQueue()

    const handleOnline = async () => {
      setIsOffline(false)
      const queue = getOfflineQueue()
      if (queue.length > 0) {
        setIsSyncing(true)
        toast('📶 تم استعادة الاتصال بالشبكة! جاري مزامنة التحديثات التشغيلية...', false)
        const res = await syncOfflineQueue(supabase)
        setIsSyncing(false)
        checkPendingQueue()
        if (res.syncedCount > 0) {
          toast(`✨ تم مزامنة ${res.syncedCount} من العمليات التشغيلية بنجاح مع السيرفر!`, false)
        }
      } else {
        toast('📶 تم استعادة الاتصال بالشبكة بنجاح.', false)
      }
    }

    const handleOffline = () => {
      setIsOffline(true)
      toast('⚡ انقطع الاتصال بالشبكة — تم التبديل تلقائياً إلى وضع الحفظ التشغيلي المحلي', true)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [toast])

  const handleManualSync = async () => {
    setIsSyncing(true)
    const res = await syncOfflineQueue(supabase)
    setIsSyncing(false)
    checkPendingQueue()
    if (res.syncedCount > 0) {
      toast(`✨ تم مزامنة ${res.syncedCount} من العمليات المعلّقة بنجاح!`, false)
    } else {
      toast('لا توجد عمليات معلّقة للمزامنة حالياً.', false)
    }
  }

  useEffect(() => {
    if (!profile) return
    const load = async () => {
      const { data } = await supabase.from('notifications')
        .select('*').eq('company_id', profile.company_id)
        .order('created_at', { ascending: false }).limit(25)
      setNotifs(data || [])
    }
    load()

    // مولّد الإشعارات اليومي — محكوم بحارس داخلي يمنع تكراره أكثر من مرة
    // في اليوم لكل منشأة. كان يُستدعى مع كل تغيّر في كائن profile فيُنتج
    // حلقة: إدراج إشعار ← حدث Realtime ← إعادة تحميل ← استدعاء جديد.
    runDailyNotificationChecks(profile.company_id);

    const ch = supabase.channel(`notifs:${profile.company_id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `company_id=eq.${profile.company_id}` }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookings', filter: `company_id=eq.${profile.company_id}` }, (payload) => {
          toast(`🔔 حجز جديد قادم من ${payload.new.guest_name || 'عميل'}`, false)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'maintenance_requests', filter: `company_id=eq.${profile.company_id}` }, (payload) => {
          if (payload.new.urgency === 'urgent') {
              toast(`🚨 طلب صيانة عاجل جديد تم إضافته للتو`, true)
          } else {
              toast(`🛠️ طلب صيانة جديد تم تسجيله`, false)
          }
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
    // معرّف المنشأة لا هوية الكائن: profile يُعاد بناؤه مع كل تحديث،
    // فتُعاد كل الاشتراكات بلا داعٍ وتتكرر الاستعلامات.
  }, [profile?.company_id])

  // URL query parameter listener (e.g. ?action=maintenance from QR code scan)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('action') === 'maintenance') {
      setPage('maintenance')
    }
  }, [])

  useEffect(() => {
    if (!profile) return
    const loadEvictions = async () => {
      const today = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('bookings')
        .select('id, unit_id, check_out_date, customers(full_name), units(unit_number)')
        .eq('company_id', profile.company_id)
        .eq('status', 'checked_in')
        .eq('check_out_date', today)
      setEvictionAlerts(data || [])
    }
    loadEvictions()
    const t = setInterval(loadEvictions, 10 * 60 * 1000)
    return () => clearInterval(t)
  }, [profile?.company_id])

  // بث الحضور الحيّ (بديل TeamViewer): كل مستخدم يبث الصفحة الحالية عبر Realtime Presence
  // ليطّلع المدير/المحاسب على مَن هو متصل الآن وعلى أي شاشة، دون الحاجة لسجلات في قاعدة البيانات.
  useEffect(() => {
    if (!profile) return
    const ch = supabase.channel(`presence:${profile.company_id}`, {
      config: { presence: { key: profile.id } }
    })
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({
          user_id: profile.id,
          full_name: profile.full_name,
          role: profile.role,
          page,
          at: new Date().toISOString()
        })
      }
    })
    presenceRef.current = ch
    return () => { supabase.removeChannel(ch); presenceRef.current = null }
  }, [profile?.id, profile?.company_id])

  useEffect(() => {
    const ch = presenceRef.current
    if (!ch || !profile) return
    ch.track({
      user_id: profile.id,
      full_name: profile.full_name,
      role: profile.role,
      page,
      at: new Date().toISOString()
    })
  }, [page, profile])

  // تنبيه فوري للعمليات الحساسة (حذف/إلغاء/خصم/استرداد) لمَن لديه صلاحية مالية
  useEffect(() => {
    if (!profile || !canFinance) return
    const SENSITIVE = new Set(['delete', 'cancel', 'discount', 'refund', 'price_change'])
    const ACTION_AR = { delete: 'حذف', cancel: 'إلغاء', discount: 'خصم', refund: 'استرداد', price_change: 'تعديل سعر' }
    const ch = supabase.channel(`sensitive-ops:${profile.company_id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs', filter: `company_id=eq.${profile.company_id}` }, ({ new: row }) => {
        if (!row || row.company_id !== profile.company_id) return
        if (row.user_id === profile.id) return
        const sens = row.new_data?.sensitive === true || SENSITIVE.has(row.action)
        if (!sens) return
        const actor = row.new_data?.actor || 'موظف'
        const label = ACTION_AR[row.action] || row.action
        toast(`⚠️ عملية حساسة: ${label} بواسطة ${actor} — ${row.new_data?.summary || ''}`, true)
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [profile?.id, profile?.company_id, canFinance])

  // رابط الترشيح (?ref=CODE) يفتح مباشرة على صفحة تسجيل عميل جديد
  const [showLogin, setShowLogin] = useState(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).has('ref')
  })

  if (loading) return <FullPageLoading />
  if (!session || !profile) {
    return showLogin || session
      ? <Login onBack={() => setShowLogin(false)} />
      : <Landing onLogin={() => setShowLogin(true)} />
  }

  // فرض شاشة انتهاء التجربة / الاشتراك عند انقطاع الوصول
  if (access && access.active === false) {
    return <TrialExpired mode="expired" />
  }
  if (forceUpgrade) {
    return <TrialExpired mode="upgrade" />
  }

  // Context-aware notification routing
  const visibleNotifs = notifs.filter(n => {
    const isMaintenance = n.title?.includes('صيانة') || n.body?.includes('صيانة') || n.title?.includes('Maintenance');
    const isFinancial = n.title?.includes('مالي') || n.title?.includes('سداد') || n.title?.includes('دفع') || n.title?.includes('عقد');
    
    if (isMaintenance && !['employee', 'manager', 'owner', 'admin'].includes(profile.role)) return false;
    if (isFinancial && !canFinance) return false;
    return true;
  });

  const unread = visibleNotifs.filter(n => !n.read_at && n.channel === 'in_app').length + evictionAlerts.length
  const pageTitles = { 
    home:'الرئيسية', dash:'إدارة الوحدات', customers:'إدارة العملاء والمستأجرين', 
    ops:'العمليات اليومية', staff:'إدارة الموظفين', reports:'قسم المحاسبة', 
    center:'مركز التقارير والمراقبة', ejar:'التكامل مع منصة إيجار', 
    channels:'ربط منصات الحجز', maintenance:'إدارة الصيانة', 
    settings:'الإعدادات', superadmin: 'إدارة المنصة (SuperAdmin)',
    assistant: 'المساعد الذكي AI',
    settlements: 'سجل التسويات المحاسبية',
    audit: 'تقرير التدقيق المحاسبي'
  }

  return (
    <div className={'app-shell' + (collapsed ? ' sb-collapsed' : '')}>
      {/* مراقب عزل الحسابات — خلفي وصامت، يتحكم به Super Admin فقط */}
      <BackgroundIsolationMonitor />
      <AppSidebar 
        page={page} 
        setPage={setPage} 
        collapsed={collapsed} 
        onToggle={() => setCollapsed(c => !c)}
        onOpenRecord={openRecord}
        dashEditMode={dashEditMode}
        setDashEditMode={setDashEditMode}
      />
      {!collapsed && <div className="sb-mobile-backdrop" onClick={() => setCollapsed(true)} />}

      <div className="app-main">
        {(isOffline || pendingSyncCount > 0) && (
          <div style={{
            background: isOffline ? '#FEF2F2' : '#EFF6FF',
            borderBottom: `1px solid ${isOffline ? '#FECACA' : '#BFDBFE'}`,
            color: isOffline ? '#991B1B' : '#1E40AF',
            padding: '8px 16px',
            fontSize: '13px',
            fontWeight: '600',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            zIndex: 100
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>{isOffline ? '⚡ وضع عدم الاتصال (أوفلاين): يتم عرض البيانات التشغيلية المحفوظة محلياً للوحدات والعملاء.' : '🔄 توجد تحديثات تشغيلية محلياً جاهزة للمزامنة مع السيرفر.'}</span>
              {pendingSyncCount > 0 && <span className="chip chip-gold" style={{ fontSize: '11px', padding: '2px 8px' }}>({pendingSyncCount}) عمليات معلّقة</span>}
            </div>
            {!isOffline && pendingSyncCount > 0 && (
              <button className="btn btn-sm btn-blue" disabled={isSyncing} onClick={handleManualSync} style={{ padding: '4px 12px', fontSize: '12px' }}>
                {isSyncing ? 'جاري المزامنة...' : 'مزامنة التحديثات الآن 🚀'}
              </button>
            )}
          </div>
        )}
        <TrialBanner plan={access?.plan} secondsLeft={access?.seconds_left} onUpgrade={() => setForceUpgrade(true)} />
        <header className="app-header">
          <div className="hdr-title">
            <button className="hdr-mobile-toggle" onClick={() => setCollapsed(c => !c)}>☰</button>
            <h1>{pageTitles[page] || 'المازن'}</h1>
          </div>
          
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
            <DataSearch variant="header" onOpen={openRecord} />
          </div>

          <div className="hdr-actions">
            {/* منتقي الفرع العام — يؤثر على العرض الرئيسي والوحدات والعملاء والتقارير.
                مقفول لغير المصرّح لهم مع رسالة الباقة المتقدمة. */}
            <BranchFilter label="الفرع" compact />
            <button 
              className={`btn ${page === 'assistant' ? 'btn-gold' : 'btn-ghost'} btn-sm`} 
              onClick={() => setPage('assistant')}
              title="المساعد الذكي"
            >
              🤖 المساعد
            </button>

            {isSuperAdmin && (
              <button className="btn btn-gold btn-sm" onClick={() => setPage('superadmin')}>⚙️ إدارة النظام</button>
            )}
            <button className="bell" onClick={() => setDrawer(d => !d)} title="الإشعارات">
              🔔{unread > 0 && <span className="dot">{unread}</span>}
            </button>
            <div className="who">
              <b>{profile.full_name}</b>
              <span>{ROLES[profile.role]}</span>
            </div>
          </div>
        </header>

        {/* طبقة شفافة تغلق الإشعارات بالنقر خارج المربع — كانت اللوحة تُفتح ولا تُغلق أبداً */}
        {drawer && <div className="notif-backdrop" onClick={() => setDrawer(false)} aria-hidden="true" />}

        {drawer && (
          <div className="notif-drawer" role="dialog" aria-label="الإشعارات">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
              <h4 style={{ margin: 0 }}>الإشعارات</h4>
              <button
                className="notif-close"
                onClick={() => setDrawer(false)}
                title="إغلاق الإشعارات"
                aria-label="إغلاق الإشعارات"
              >✕</button>
              {unread > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={async () => {
                  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('company_id', profile.company_id).is('read_at', null);
                  setNotifs(n => n.map(x => ({ ...x, read_at: new Date().toISOString() })));
                }}>تحديد الكل كمقروء ✓</button>
              )}
            </div>
            {evictionAlerts.length > 0 && (
              <div className="notif-evict-section">
                <div className="notif-evict-hdr">⚠ إخلاء اليوم</div>
                {evictionAlerts.map(b => (
                  <div className="notif-item notif-evict" key={`ev-${b.id}`}>
                    <b>🚨 الوحدة {b.units?.unit_number || b.unit_id}</b>
                    <span>{b.customers?.full_name || 'مستأجر'} — موعد الإخلاء اليوم</span>
                  </div>
                ))}
              </div>
            )}
            {visibleNotifs.length === 0 && evictionAlerts.length === 0 && <div className="notif-item">لا توجد إشعارات بعد</div>}
            {visibleNotifs.map(n => (
              <button
                type="button"
                className={"notif-item notif-item-btn" + (!n.read_at ? " unread" : "")}
                key={n.id}
                title="فتح القسم الخاص بهذا الإشعار"
                onClick={async () => {
                  // النقر يفتح القسم المعني ويعلّم الإشعار مقروءاً في آن واحد
                  setPage(notifTarget(n))
                  setDrawer(false)
                  if (!n.read_at) {
                    const at = new Date().toISOString()
                    setNotifs(list => list.map(x => (x.id === n.id ? { ...x, read_at: at } : x)))
                    await supabase.from('notifications').update({ read_at: at }).eq('id', n.id)
                  }
                }}
              >
                <b>
                  {n.title}
                  {n.channel !== 'in_app' && <span className="chip" style={{ background: 'var(--soft)', color: 'var(--green)', marginRight: 4 }}>{n.channel === 'whatsapp' ? 'واتساب' : n.channel}</span>}
                  {!n.read_at && <span style={{ color: 'var(--primary)', fontSize: 10, marginRight: 4 }}>⚫ جديد</span>}
                </b>
                {n.body}
                <br /><time>{new Date(n.created_at).toLocaleString('ar-SA')}</time>
              </button>
            ))}
          </div>
        )}

        <div className="app-body">
          {/* RlsHealthBanner مخفي بناءً على طلب المستخدم */}
          <Suspense fallback={<FullPageLoading />}>
          {page === 'home' && <Home onNav={setPage} dashEditMode={dashEditMode} setDashEditMode={setDashEditMode} />}
          {page === 'dash' && <Dashboard editMode={dashEditMode} setEditMode={setDashEditMode} />}
          {page === 'customers' && <CustomersManagement />}
          {page === 'ops' && <EmployeeOps />}
          {page === 'staff' && canFinance && <EmployeeManagement />}
          {/* ===== النظام المحاسبي ===== */}
          {acctPage(page) && canAcct && (
            <>
              {page === 'je-new' && <JournalListPage initialEntryId={null} />}
              {page === 'je-list' && <JournalListPage key={openEntryId || 'list'} initialEntryId={openEntryId} />}
              {page === 'je-report' && <JournalListPage mode="report" />}
              {page === 'gl' && <GeneralLedgerPage onOpenEntry={(id) => { setOpenEntryId(id); setPage('je-list') }} />}
              {page === 'coa' && <ChartOfAccountsPage focusRecord={focusRecord} />}
              {page === 'cost-centers' && <CostCentersPage focusRecord={focusRecord} />}
              {page === 'tb' && <TrialBalancePage mode="full" />}
              {page === 'tb-check' && <TrialBalancePage mode="check" />}
              {page === 'vat' && <TaxCenterPage />}
              {page.startsWith('services') && <ServicesPage focusRecord={focusRecord} initialCategory={page.split(':')[1] || 'all'} />}
              {page === 'deferred-rev' && <DeferredPage kind="revenue" />}
              {page === 'deferred-exp' && <DeferredPage kind="expense" />}
              {page === 'acct-settings' && <AccountingSettingsPage />}
              {page === 'reports-hub' && <ReportsHubPage />}
              {page === 'digital-docs' && <DigitalDocsPage focusRecord={focusRecord} />}
              {page === 'tests-hub' && <TestsHubPage />}
              {page === 'odoo' && <OdooPage />}
              {page === 'shomoos' && <ShomoosPage />}
            </>
          )}

          {page === 'reports' && (canFinance || profile?.role === 'accountant') && <Reports />}
          {page === 'settlements' && (canFinance || profile?.role === 'accountant') && <SettlementHistory />}
          {page === 'audit' && ((canFinance || profile?.role === 'accountant')
            ? <AuditReport />
            : <div className="card" style={{ padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 32 }}>🔒</div>
                <h3>صلاحية غير كافية</h3>
                <p className="muted">تقرير التدقيق المحاسبي متاح لحسابات المالك والمدير والمحاسب.</p>
              </div>)}

          {page === 'assistant' && (canFinance || profile?.role === 'accountant') && <Assistant />}
          {page === 'center' && canFinance && <ReportCenter />}
          {page === 'ejar' && canFinance && <EjarPanel />}
          {page === 'channels' && canFinance && <ChannelManagerPanel />}
          {page === 'maintenance' && <Maintenance />}
          {page === 'settings' && canFinance && (
            <Settings
              dashEditMode={dashEditMode}
              setDashEditMode={setDashEditMode}
            />
          )}
          {page === 'referral' && <ReferralPanel />}
          {page === 'referral-track' && <ReferralTracking />}

          {page === 'admin-referrals' && (isSuperAdmin
            ? <SuperAdminReferrals />
            : <div className="card" style={{ padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 32 }}>🔒</div>
                <h3>صلاحية غير كافية</h3>
                <p className="muted">إدارة الترشيحات متاحة لحسابات السوبر أدمن فقط.</p>
              </div>)}
          {page === 'superadmin' && isSuperAdmin && <div className="panel">
            <SuperAdminAccounts />
          </div>}
          {page === 'activity-log' && (isSuperAdmin
            ? <SuperAdminActivityLog />
            : <div className="card" style={{ padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 32 }}>🔒</div>
                <h3>صلاحية غير كافية</h3>
                <p className="muted">سجل نشاط المنصة متاح لحسابات السوبر أدمن فقط.</p>
              </div>)}
          </Suspense>

        </div>
        <DrawerWidget />
      </div>
    </div>
  )
}

const SuperAdminAccounts = lazy(() => import('./components/SuperAdminAccounts'))
const SuperAdminActivityLog = lazy(() => import('./pages/SuperAdminActivityLog'))
const ReferralPanel = lazy(() => import('./components/ReferralPanel'))
const ReferralTracking = lazy(() => import('./components/ReferralTracking'))
const SuperAdminReferrals = lazy(() => import('./components/admin/SuperAdminReferrals'))


import { BranchProvider } from './BranchContext'
import BranchFilter from './components/BranchFilter'

export default function App() {
  // إذا كانت متغيرات .env ناقصة أو غير صحيحة، نُظهر شاشة تنبيه بدل الانهيار الصامت
  if (!hasSupabaseConfig) return <ConfigErrorScreen />
  const path = typeof window !== 'undefined' ? window.location.pathname : '/'
  if (path === '/reset-password') return <ResetPassword />
  if (path === '/privacy') return <Privacy />
  if (path === '/terms') return <Terms />
  const pubMatch = path.match(/^\/u\/([^/?#]+)/)
  if (pubMatch) return <PublicUnit slug={pubMatch[1]} />
  const portalMatch = path.match(/^\/portal\/([^/?#]+)/)
  if (portalMatch) return <TenantPortal token={portalMatch[1]} />
  return <AuthProvider><BranchProvider><Shell /></BranchProvider></AuthProvider>
}
