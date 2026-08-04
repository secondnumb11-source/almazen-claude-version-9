/**
 * نظام إدارة الفروع — سياق التطبيق (Branch Context)
 * ---------------------------------------------------------------
 * الميزة اختيارية ولا تعمل لجميع المستخدمين:
 *  - التفعيل يتم لكل مستخدم على حدة عبر جدول user_feature_flags (feature = 'branches')
 *  - التحكم في التفعيل/الإيقاف متاح فقط لحسابات super admin الخمسة
 *  - المستخدم غير المصرّح له يرى الأزرار لكنه يتلقى رسالة الباقة المتقدمة
 *
 * الفلترة تحترم RLS: الاستعلامات تُقيَّد بـ branch_id فقط، وقاعدة البيانات
 * (سياسات "branch scope guard" + دالة branch_visible) هي مصدر الحقيقة الأمني.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { useAuth } from './AuthContext'

export const BRANCH_LOCKED_MESSAGE = 'هذه الميزة من الباقة المتقدمة، للاستخدام تواصل مع الدعم'
const STORAGE_KEY = 'almazen.branch.selected'
const UNASSIGNED_KEY = 'almazen.branch.includeUnassigned'

const BranchCtx = createContext(null)
export const useBranches = () => useContext(BranchCtx) || FALLBACK

// قيمة احتياطية تمنع الانهيار لو استُخدم الخطاف خارج المزوّد
const FALLBACK = {
  enabled: false, loading: false, branches: [], activeBranch: '', activeBranchName: '',
  setActiveBranch: () => {}, reload: async () => {}, requireFeature: () => false,
  scopeQuery: (q) => q, filterRows: (rows) => rows, lockedMessage: BRANCH_LOCKED_MESSAGE,
  includeUnassigned: true, setIncludeUnassigned: () => {},
}

export function BranchProvider({ children }) {
  const { session, profile, toast, isSuperAdmin } = useAuth()
  const companyId = profile?.company_id || null

  const [enabled, setEnabled] = useState(false)
  const [branches, setBranches] = useState([])
  const [myBranchIds, setMyBranchIds] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeBranch, setActiveBranchState] = useState('')

  /**
   * خيار المستخدم: إظهار السجلات غير الموسومة بفرع مع سجلات الفرع المختار.
   * الافتراضي مُفعَّل — البيانات التي أُنشئت قبل تفعيل الفروع تحمل branch_id = NULL،
   * وبدون هذا التسامح يُفرغ اختيار الفرع الشاشة تماماً.
   */
  const [includeUnassigned, setIncludeUnassignedState] = useState(() => {
    try { return localStorage.getItem(UNASSIGNED_KEY) !== '0' } catch { return true }
  })

  const setIncludeUnassigned = useCallback((on) => {
    setIncludeUnassignedState(!!on)
    try { localStorage.setItem(UNASSIGNED_KEY, on ? '1' : '0') } catch { /* معطّل */ }
  }, [])

  const setActiveBranch = useCallback((id) => {
    setActiveBranchState(id || '')
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id)
      else localStorage.removeItem(STORAGE_KEY)
    } catch { /* التخزين المحلي قد يكون معطلاً */ }
  }, [])

  const reload = useCallback(async () => {
    if (!session?.user?.id) { setEnabled(false); setBranches([]); return }
    setLoading(true)
    try {
      // 1) هل الميزة مفعّلة لهذا المستخدم؟ (has_feature دالة SECURITY DEFINER)
      let on = false
      const { data: flag, error: flagErr } = await supabase.rpc('has_feature', { _feature: 'branches' })
      if (!flagErr) on = flag === true
      // السوبر أدمن مفعّل دائماً حتى لو لم يُنشأ السجل بعد
      if (isSuperAdmin) on = true
      setEnabled(on)

      if (!on || !companyId) { setBranches([]); setMyBranchIds([]); return }

      // 2) الفروع المتاحة (RLS يقيّد النتيجة تلقائياً)
      const { data: rows } = await supabase
        .from('branches')
        .select('id, name, code, city, is_active')
        .eq('company_id', companyId)
        .order('name', { ascending: true })
      const list = rows || []
      setBranches(list)

      // 3) الفروع المُسندة للمستخدم — تحدّد الافتراضي المناسب
      const { data: mine } = await supabase
        .from('user_branches')
        .select('branch_id, is_default')
        .eq('user_id', session.user.id)
      const assigned = mine || []
      setMyBranchIds(assigned.map(r => r.branch_id))

      // 4) الافتراضي: آخر اختيار محفوظ إن كان ما زال مرئياً، ثم الفرع الافتراضي
      //    المُسند، ثم «كل الفروع» للمستخدم غير المقيّد بفرع.
      const visible = new Set(list.map(b => b.id))
      let saved = ''
      try { saved = localStorage.getItem(STORAGE_KEY) || '' } catch { saved = '' }
      const defaultAssigned = assigned.find(r => r.is_default)?.branch_id
      const firstAssigned = assigned[0]?.branch_id
      const next =
        (saved && visible.has(saved)) ? saved
        : (defaultAssigned && visible.has(defaultAssigned)) ? defaultAssigned
        : (assigned.length === 1 && visible.has(firstAssigned)) ? firstAssigned
        : ''
      setActiveBranchState(next)
    } finally {
      setLoading(false)
    }
  }, [session?.user?.id, companyId, isSuperAdmin])

  useEffect(() => { reload() }, [reload])

  /**
   * بوابة الصلاحية: تُستدعى عند ضغط أي زر خاص بالفروع.
   * ترجع true إذا كان المستخدم مصرّحاً له، وإلا تعرض رسالة الباقة المتقدمة.
   */
  const requireFeature = useCallback(() => {
    if (enabled) return true
    toast?.(BRANCH_LOCKED_MESSAGE, true)
    return false
  }, [enabled, toast])

  /** تقييد استعلام Supabase بالفرع النشط (لا يغيّر شيئاً عند «كل الفروع») */
  const scopeQuery = useCallback((query, column = 'branch_id') => {
    if (!enabled || !activeBranch || !query?.eq) return query
    // مع التسامح: صفوف الفرع + الصفوف غير الموسومة (لا تختفي البيانات القديمة)
    if (includeUnassigned && query?.or) {
      return query.or(`${column}.eq.${activeBranch},${column}.is.null`)
    }
    return query.eq(column, activeBranch)
  }, [enabled, activeBranch, includeUnassigned])

  /** تصفية مصفوفة محمّلة مسبقاً حسب الفرع النشط */
  const filterRows = useCallback((rows, key = 'branch_id') => {
    if (!enabled || !activeBranch || !Array.isArray(rows)) return rows || []
    // نفس منطق scopeQuery حتى لا تختلف الفلترة الخادمية عن المحلية
    return rows.filter(r => r?.[key] === activeBranch || (includeUnassigned && !r?.[key]))
  }, [enabled, activeBranch, includeUnassigned])

  const value = useMemo(() => ({
    enabled,
    loading,
    branches,
    myBranchIds,
    activeBranch,
    activeBranchName: branches.find(b => b.id === activeBranch)?.name || 'كل الفروع',
    setActiveBranch,
    reload,
    requireFeature,
    scopeQuery,
    filterRows,
    includeUnassigned,
    setIncludeUnassigned,
    lockedMessage: BRANCH_LOCKED_MESSAGE,
  }), [enabled, loading, branches, myBranchIds, activeBranch, setActiveBranch, reload, requireFeature, scopeQuery, filterRows, includeUnassigned, setIncludeUnassigned])

  return <BranchCtx.Provider value={value}>{children}</BranchCtx.Provider>
}
