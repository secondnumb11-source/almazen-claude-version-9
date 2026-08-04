import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from './lib/supabase'

const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [company, setCompany] = useState(null)
  const [access, setAccess] = useState(null) // { plan, active, seconds_left, ends_at }
  const [profileLoadError, setProfileLoadError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState([])

  const toast = useCallback((msg, err = false) => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, err }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500)
  }, [])

  const TRIAL_DAYS = 7

  // احتياط واجهة: منشأة تجريبية بلا تاريخ انتهاء تُحتسب لها 7 أيام من تاريخ الإنشاء
  // (يمنع تحويل المستخدم الجديد خطأً لصفحة انتهاء التجربة قبل تنفيذ ملف SQL)
  const withTrialFallback = useCallback((row, companyRow) => {
    if (!row) return row
    const paidPlans = ['active', 'suspended', 'cancelled']
    if (row.active === true || paidPlans.includes(row.plan)) return row
    const base = companyRow?.trial_started_at || companyRow?.created_at
    if (!base) return row
    const endsAt = new Date(new Date(base).getTime() + TRIAL_DAYS * 86400000)
    const left = Math.floor((endsAt.getTime() - Date.now()) / 1000)
    if (row.trial_ends_at || row.ends_at || left <= 0) return row
    return { ...row, plan: 'trial', active: true, seconds_left: left, ends_at: endsAt.toISOString(), trial_ends_at: endsAt.toISOString() }
  }, [])

  const loadAccessState = useCallback(async (companyId, companyRow = null) => {
    if (!companyId) { setAccess(null); return }
    const { data, error } = await supabase.rpc('company_access_state', { _company: companyId })
    if (error) {
      // إذا لم تكن الدالة موجودة بعد (لم يُنفَّذ ملف SQL) نعتبر الحساب نشط لعدم كسر الأنظمة الحالية
      setAccess({ plan: 'active', active: true, seconds_left: null, ends_at: null, _fallback: true })
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    setAccess(withTrialFallback(row, companyRow) || { plan: 'active', active: true, seconds_left: null, ends_at: null })
  }, [withTrialFallback])


  const loadProfile = useCallback(async (uid) => {
    setProfileLoadError(null)
    // استخدام RPC بدلاً من استعلام الجدول المباشر لكسر حلقة التكرار (RLS Recursion)
    // دالة get_my_own_profile هي SECURITY DEFINER وتتجاوز السياسات لهذا الاستعلام فقط.
    const { data, error } = await supabase.rpc('get_my_own_profile')
    const p = (data && Array.isArray(data)) ? data[0] : (data || null)

    if (error) {
      setProfile(null); setCompany(null); setAccess(null)
      setProfileLoadError(error)
      const msg = error.code === '42P17'
        ? 'تعذر تحميل ملف المستخدم بسبب تعارض في سياسات قاعدة البيانات. نفّذ ملف إصلاح الإعداد ثم أعد تسجيل الدخول.'
        : 'تعذر تحميل ملف المستخدم: ' + error.message
      toast(msg, true)
      return
    }
    setProfile(p || null)
    if (p) {
      const { data: c } = await supabase.from('companies').select('*').eq('id', p.company_id).maybeSingle()
      setCompany(c || null)
      await loadAccessState(p.company_id, c)
    } else { setCompany(null); setAccess(null) }
  }, [toast, loadAccessState])

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (s) setTimeout(() => { loadProfile(s.user.id) }, 0)
      else { setProfile(null); setCompany(null); setAccess(null); setProfileLoadError(null) }
      if (event === 'SIGNED_OUT') setLoading(false)
    })
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) loadProfile(data.session.user.id).finally(() => setLoading(false))
      else setLoading(false)
    }).catch(() => setLoading(false))
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  // إعادة فحص حالة الوصول كل 5 دقائق لضمان انتهاء التجربة تلقائياً
  useEffect(() => {
    if (!company?.id) return
    const t = setInterval(() => loadAccessState(company.id, company), 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [company, loadAccessState])

  const refreshCompany = async () => {
    if (!profile) return
    const { data: c } = await supabase.from('companies').select('*').eq('id', profile.company_id).maybeSingle()
    setCompany(c)
    await loadAccessState(profile.company_id, c)
  }

  // مصدر وحيد لصلاحية السوبر أدمن: دالة is_super_admin في قاعدة البيانات.
  // لا توجد أي قائمة إيميلات مكررة في الواجهة — القرار الأمني في الـ DB فقط.
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  useEffect(() => {
    let cancelled = false
    if (!session?.user?.id) { setIsSuperAdmin(false); return }
    supabase.rpc('is_super_admin')
      .then(({ data, error }) => { if (!cancelled) setIsSuperAdmin(!error && data === true) })
      .catch(() => { if (!cancelled) setIsSuperAdmin(false) })
    return () => { cancelled = true }
  }, [session?.user?.id])


  useEffect(() => {
    if (session?.user?.email && company && (!company.email || company.email !== session.user.email)) {
      if (profile?.role === 'owner' || isSuperAdmin) {
        supabase.from('companies').update({ email: session.user.email }).eq('id', company.id).then();
      }
    }
    if (isSuperAdmin && company) {
      const nextYear = new Date();
      nextYear.setFullYear(nextYear.getFullYear() + 10); // Unlimited essentially
      const endsAt = nextYear.toISOString();
      if (company.plan !== 'active' || !company.subscription_ends_at) {
        supabase.from('companies').update({
          plan: 'active',
          subscription_ends_at: endsAt
        }).eq('id', company.id).then(({ error }) => {
          if (!error) {
            refreshCompany();
            toast('تم تمديد اشتراك الحساب الرئيسي لمالك المنصة');
          }
        });
      }
    }
  }, [session, company, profile, isSuperAdmin]);

  const value = {
    session, profile, company, access, profileLoadError, loading, toast,
    isOwner: profile?.role === 'owner',
    isSuperAdmin,
    canFinance: (isSuperAdmin || ['owner', 'manager', 'accountant'].includes(profile?.role)),
    reloadProfile: () => session && loadProfile(session.user.id),
    refreshAccess: () => company && loadAccessState(company.id, company),
    refreshCompany,
    signOut: () => supabase.auth.signOut()
  }

  return (
    <Ctx.Provider value={value}>
      {children}
      <div>{toasts.map(t =>
        <div key={t.id} className={'toast' + (t.err ? ' err' : '')} style={{ bottom: 22 + toasts.indexOf(t) * 62 }}>{t.msg}</div>)}
      </div>
    </Ctx.Provider>
  )
}
