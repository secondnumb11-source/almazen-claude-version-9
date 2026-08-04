/**
 * BranchManagementSystem — النظام الموحّد لإدارة الفروع
 * ---------------------------------------------------------------
 * يدمج في شاشة واحدة:
 *   1) نظرة عامة    — مؤشرات الفروع والمستخدمين حسب الشركة
 *   2) الفروع        — إنشاء/تعديل/إيقاف/حذف الفروع (RLS: owner/manager أو super admin)
 *   3) المستخدمون    — إنشاء حسابات جديدة وإسنادها للفروع وتحديد الفرع الافتراضي
 *   4) الميزات       — تفعيل ميزة الفروع لكل مستخدم (super admin فقط، نفس الشاشة القديمة)
 *
 * التوافق مع النظام الحالي:
 *   - يبقى المصدر الوحيد للحقيقة الأمنية هو RLS (branches / user_branches).
 *   - يستخدم نفس BranchContext ويستدعي reload() بعد كل تعديل حتى يتزامن مبدّل الفروع.
 *   - يستخدم نفس آلية إنشاء الحسابات المعتمدة في «إدارة الموظفين»
 *     (adminSignupClient + profiles + staff_permissions) فلا يوجد نظامان متعارضان.
 *
 * مخطط قاعدة البيانات المُتحقَّق منه:
 *   branches(id, company_id, name, code, city, address, phone, is_active, created_by, created_at, updated_at)
 *   user_branches(user_id, branch_id, is_default, created_at)  PK(user_id, branch_id)
 *   profiles(id, company_id, role, full_name, username, is_active, phone, job_title, …)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  supabase,
  adminSignupClient,
  staffEmail,
  normalizeStaffUsername,
} from '../../lib/supabase'
import { useAuth } from '../../AuthContext'
import { useBranches, BRANCH_LOCKED_MESSAGE } from '../../BranchContext'
import BranchFeatureAdmin from '../admin/BranchFeatureAdmin'
import { branchAbilities, creatableRoles, assertAllowed } from '../../lib/branchPermissions'

const EMPTY_BRANCH = { name: '', code: '', city: '', address: '', phone: '', is_active: true }
const EMPTY_USER = { full_name: '', username: '', password: '', role: 'employee', job_title: '', phone: '', branch_id: '', is_default: true }
const EMPTY_FILTERS = { status: 'all', role: 'all', assignment: 'all', branch: 'all', city: 'all' }
const PAGE_SIZE = 20

function Pager({ page, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  if (pages <= 1) return null
  return (
    <div className="bms-bar" style={{ justifyContent: 'center', marginTop: 12 }}>
      <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>السابق</button>
      <span className="bms-muted">صفحة {page} من {pages}</span>
      <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>التالي</button>
    </div>
  )
}


const ROLE_LABEL = {
  owner: 'مالك', manager: 'مدير', accountant: 'محاسب',
  employee: 'موظف', staff: 'موظف', viewer: 'مشاهد',
}

/** ترجمة أخطاء قاعدة البيانات إلى رسائل مفهومة — منع ظهور أخطاء تقنية للمستخدم */
function explain(e) {
  const msg = String(e?.message || e || 'خطأ غير معروف')
  const code = e?.code || ''
  if (code === '23505' || /duplicate key/i.test(msg)) return 'السجل موجود مسبقاً (تكرار في البيانات).'
  if (code === '23503' || /foreign key/i.test(msg)) return 'لا يمكن الحذف: يوجد بيانات مرتبطة بهذا الفرع. أوقِف الفرع بدل حذفه.'
  if (code === '42501' || /row-level security|permission denied/i.test(msg))
    return 'لا تملك صلاحية تنفيذ هذا الإجراء. الإدارة متاحة لمالك المنشأة أو المدير فقط.'
  if (/already registered|already been registered/i.test(msg)) return 'اسم المستخدم مستخدم مسبقاً، اختر اسماً آخر.'
  if (/password/i.test(msg) && /6|short/i.test(msg)) return 'كلمة المرور قصيرة — 6 أحرف على الأقل.'
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'تعذّر الاتصال بالخادم. تحقق من الاتصال ثم أعد المحاولة.'
  return msg
}

const norm = (s) => String(s || '').trim().toLowerCase()

/**
 * لوحة وسم البيانات القديمة بالفروع.
 * السبب: السجلات التي أُنشئت قبل تفعيل الفروع تحمل branch_id فارغاً، فلا تظهر
 * عند اختيار فرع. التوريث التلقائي يعالج الجديد فقط، وهذه الأداة تعالج القديم.
 * تعمل بخطوتين: فحص (لا يكتب شيئاً) ثم تنفيذ صريح بموافقة المستخدم.
 */
function BranchBackfillPanel({ companyId, toast }) {
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)

  const run = async (dryRun) => {
    if (!companyId) return
    if (!dryRun && !window.confirm('سيتم وسم السجلات القديمة بفروعها المشتقة من الوحدة/الحجز. متابعة؟')) return
    setBusy(true)
    const { data, error } = await supabase.rpc('branch_backfill_unassigned', {
      p_company_id: companyId, p_dry_run: dryRun,
    })
    setBusy(false)
    if (error) return toast?.('تعذّر التنفيذ: ' + error.message, true)
    setPreview(data)
    if (!dryRun) toast?.(`✓ تم وسم ${data?.affected_rows ?? 0} سجلاً بفروعها`)
  }

  const rows = preview?.details ? Object.entries(preview.details).filter(([, v]) => v > 0) : []

  return (
    <div className="panel" style={{ borderInlineStart: '3px solid var(--gold)' }}>
      <h4 style={{ margin: '0 0 6px' }}>🔗 وسم البيانات القديمة بالفروع</h4>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
        السجلات المُنشأة قبل تفعيل الفروع غير موسومة بأي فرع. السجلات الجديدة تُوسم تلقائياً
        (الحجز يرث فرع الوحدة، والدفعة والفاتورة ترثان فرع الحجز، والقيد والسند يرثان فرع مصدرهما).
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => run(true)} disabled={busy || !companyId}>
          {busy ? '…' : '🔍 فحص بلا تعديل'}
        </button>
        <button className="btn btn-gold btn-sm" onClick={() => run(false)}
          disabled={busy || !companyId || !(preview?.affected_rows > 0)}>
          ✅ تنفيذ الوسم
        </button>
        {preview && (
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>
            {preview.affected_rows > 0
              ? `${preview.affected_rows} سجلاً قابلاً للوسم`
              : '✓ لا توجد سجلات بحاجة للوسم'}
          </span>
        )}
      </div>
      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {rows.map(([k, v]) => (
            <span key={k} className="chip" style={{ fontSize: 11.5 }}>{k}: <b>{v}</b></span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function BranchManagementSystem() {
  const { profile, isSuperAdmin, toast } = useAuth()
  const { enabled, reload: reloadBranchContext } = useBranches()

  const myCompanyId = profile?.company_id || null


  const [tab, setTab] = useState('overview')
  const [companies, setCompanies] = useState([])
  const [scopeCompany, setScopeCompany] = useState(myCompanyId || '')
  const [branches, setBranches] = useState([])
  const [users, setUsers] = useState([])
  const [links, setLinks] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [uq, setUq] = useState('')
  const [bf, setBf] = useState(EMPTY_FILTERS)
  const [uf, setUf] = useState(EMPTY_FILTERS)
  const [branchPage, setBranchPage] = useState(1)
  const [userPage, setUserPage] = useState(1)

  /** صلاحيات موحّدة — الواجهة والتنفيذ يقرآن من نفس المصدر */
  const abilities = useMemo(
    () => branchAbilities({ profile, isSuperAdmin, scopeCompanyId: scopeCompany || myCompanyId }),
    [profile, isSuperAdmin, scopeCompany, myCompanyId])
  const canManage = abilities.canManageBranches


  const [form, setForm] = useState(EMPTY_BRANCH)
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)

  const [nu, setNu] = useState(EMPTY_USER)
  const [showNewUser, setShowNewUser] = useState(false)

  useEffect(() => { if (myCompanyId && !scopeCompany) setScopeCompany(myCompanyId) }, [myCompanyId, scopeCompany])

  /* ---------- تحميل قائمة الشركات (super admin فقط) ---------- */
  const loadCompanies = useCallback(async () => {
    if (!isSuperAdmin) return
    const { data, error } = await supabase.from('companies').select('id, name').order('name')
    if (!error && data?.length) { setCompanies(data); return }
    const { data: rpcData } = await supabase.rpc('super_admin_get_all_companies')
    if (Array.isArray(rpcData)) {
      setCompanies(rpcData.map(c => ({ id: c.id || c.company_id, name: c.name || c.company_name || '—' })).filter(c => c.id))
    }
  }, [isSuperAdmin])

  /* ---------- تحميل الفروع والمستخدمين والإسنادات ---------- */
  const loadAll = useCallback(async () => {
    if (!enabled) return
    const cid = scopeCompany || myCompanyId
    if (!cid) return
    setLoading(true); setErr('')
    try {
      const [{ data: brs, error: be }, { data: ppl, error: pe }] = await Promise.all([
        supabase.from('branches')
          .select('id, company_id, name, code, city, address, phone, is_active, created_at')
          .eq('company_id', cid).order('name', { ascending: true }),
        supabase.from('profiles')
          .select('id, full_name, username, role, is_active, job_title, phone')
          .eq('company_id', cid).order('full_name', { ascending: true }),
      ])
      if (be) throw be
      if (pe) throw pe
      const list = brs || []
      setBranches(list)
      setUsers(ppl || [])

      if (list.length) {
        const { data: ub, error: ue } = await supabase
          .from('user_branches').select('user_id, branch_id, is_default')
          .in('branch_id', list.map(b => b.id))
        if (ue) throw ue
        setLinks(ub || [])
      } else setLinks([])
    } catch (e) {
      setErr(explain(e))
    } finally { setLoading(false) }
  }, [enabled, scopeCompany, myCompanyId])

  useEffect(() => { loadCompanies() }, [loadCompanies])
  useEffect(() => { loadAll() }, [loadAll])

  /* ---------- مشتقات ---------- */
  const companyName = useMemo(
    () => companies.find(c => c.id === (scopeCompany || myCompanyId))?.name || 'منشأتي',
    [companies, scopeCompany, myCompanyId])

  const linksOf = useCallback((branchId) => links.filter(l => l.branch_id === branchId), [links])
  const branchesOfUser = useCallback((userId) => links.filter(l => l.user_id === userId), [links])
  const userById = useCallback((id) => users.find(u => u.id === id), [users])

  const stats = useMemo(() => {
    const assigned = new Set(links.map(l => l.user_id))
    return {
      total: branches.length,
      active: branches.filter(b => b.is_active !== false).length,
      inactive: branches.filter(b => b.is_active === false).length,
      users: users.length,
      assigned: assigned.size,
      unassigned: users.filter(u => !assigned.has(u.id)).length,
    }
  }, [branches, users, links])

  /* ---------- البحث والتصفية المتقدمة ---------- */
  const cities = useMemo(
    () => Array.from(new Set(branches.map(b => (b.city || '').trim()).filter(Boolean))).sort(),
    [branches])
  const roles = useMemo(
    () => Array.from(new Set(users.map(u => u.role).filter(Boolean))).sort(),
    [users])

  const filteredBranches = useMemo(() => {
    const s = norm(q)
    return branches.filter(b => {
      if (s && ![b.name, b.code, b.city, b.address, b.phone].some(v => norm(v).includes(s))) return false
      if (bf.status === 'active' && b.is_active === false) return false
      if (bf.status === 'inactive' && b.is_active !== false) return false
      if (bf.city !== 'all' && norm(b.city) !== norm(bf.city)) return false
      const count = links.filter(l => l.branch_id === b.id).length
      if (bf.assignment === 'assigned' && count === 0) return false
      if (bf.assignment === 'unassigned' && count > 0) return false
      return true
    })
  }, [branches, links, q, bf])

  const filteredUsers = useMemo(() => {
    const s = norm(uq)
    return users.filter(u => {
      const mine = links.filter(l => l.user_id === u.id)
      if (s && ![u.full_name, u.username, ROLE_LABEL[u.role] || u.role, u.job_title, u.phone]
        .some(v => norm(v).includes(s))) return false
      if (uf.status === 'active' && u.is_active === false) return false
      if (uf.status === 'inactive' && u.is_active !== false) return false
      if (uf.role !== 'all' && u.role !== uf.role) return false
      if (uf.assignment === 'assigned' && mine.length === 0) return false
      if (uf.assignment === 'unassigned' && mine.length > 0) return false
      if (uf.branch !== 'all' && !mine.some(m => m.branch_id === uf.branch)) return false
      return true
    })
  }, [users, links, uq, uf])

  const bFiltered = q.trim() !== '' || bf.status !== 'all' || bf.city !== 'all' || bf.assignment !== 'all'
  const uFiltered = uq.trim() !== '' || uf.status !== 'all' || uf.role !== 'all' || uf.assignment !== 'all' || uf.branch !== 'all'
  const branchPages = Math.max(1, Math.ceil(filteredBranches.length / PAGE_SIZE))
  const userPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE))
  const safeBranchPage = Math.min(branchPage, branchPages)
  const safeUserPage = Math.min(userPage, userPages)
  const shownBranches = filteredBranches.slice((safeBranchPage - 1) * PAGE_SIZE, safeBranchPage * PAGE_SIZE)
  const shownUsers = filteredUsers.slice((safeUserPage - 1) * PAGE_SIZE, safeUserPage * PAGE_SIZE)


  /* ---------- الحماية: الميزة مقفولة ---------- */
  if (!enabled) {
    return (
      <div className="panel">
        <h3>🏢 نظام إدارة الفروع</h3>
        <p style={{ marginTop: 12 }}>🔒 {BRANCH_LOCKED_MESSAGE}</p>
      </div>
    )
  }

  /**
   * حارس التنفيذ — يُستدعى في بداية كل عملية كتابة.
   * حتى لو أُزيل تعطيل الأزرار من المتصفح، لن يُرسل أي طلب غير مصرّح به،
   * والطبقة النهائية سياسات RLS في قاعدة البيانات.
   */
  const guard = (extra = true, message) => {
    try {
      assertAllowed(canManage, 'الإدارة متاحة لمالك المنشأة أو المدير فقط — لديك صلاحية العرض فقط.')
      assertAllowed(profile?.is_active !== false, 'حسابك موقوف — لا يمكن تنفيذ عمليات الإدارة.')
      assertAllowed(extra, message)
      return true
    } catch (e) {
      toast(e.message, true)
      return false
    }
  }


  /* ---------- عمليات الفروع ---------- */
  const validateBranch = () => {
    const name = form.name.trim()
    if (!name) return 'اسم الفرع مطلوب.'
    if (name.length < 2) return 'اسم الفرع قصير جداً.'
    const dupName = branches.some(b => b.id !== editing && norm(b.name) === norm(name))
    if (dupName) return 'يوجد فرع بنفس الاسم في هذه المنشأة.'
    const code = (form.code || '').trim()
    if (code && branches.some(b => b.id !== editing && norm(b.code) === norm(code)))
      return 'رمز الفرع مستخدم في فرع آخر.'
    const phone = (form.phone || '').trim()
    if (phone && !/^[0-9+\-\s()]{7,20}$/.test(phone)) return 'رقم الهاتف غير صالح.'
    return ''
  }

  const saveBranch = async () => {
    if (!guard()) return
    const problem = validateBranch()
    if (problem) return toast(problem, true)
    const cid = scopeCompany || myCompanyId
    if (!cid) return toast('لم يتم تحديد المنشأة.', true)
    setBusy(true)
    try {
      const payload = {
        company_id: cid,
        name: form.name.trim(),
        code: (form.code || '').trim() || null,
        city: (form.city || '').trim() || null,
        address: (form.address || '').trim() || null,
        phone: (form.phone || '').trim() || null,
        is_active: form.is_active !== false,
      }
      const { error } = editing
        ? await supabase.from('branches').update(payload).eq('id', editing)
        : await supabase.from('branches').insert(payload)
      if (error) throw error
      toast(editing ? '✓ حُدّثت بيانات الفرع' : '✓ أُضيف الفرع بنجاح')
      setForm(EMPTY_BRANCH); setEditing(null); setShowForm(false)
      await loadAll(); await reloadBranchContext()
    } catch (e) { toast('تعذّر الحفظ: ' + explain(e), true) } finally { setBusy(false) }
  }

  const startEdit = (b) => {
    if (!guard()) return
    setEditing(b.id)
    setForm({ ...EMPTY_BRANCH, ...b, code: b.code || '', city: b.city || '', address: b.address || '', phone: b.phone || '' })
    setShowForm(true); setTab('branches')
  }

  const toggleActive = async (b) => {
    if (!guard()) return
    const count = linksOf(b.id).length
    if (b.is_active !== false && count > 0 &&
      !window.confirm(`الفرع «${b.name}» مُسند إليه ${count} مستخدم. إيقافه سيمنع عملهم عليه. متابعة؟`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('branches').update({ is_active: b.is_active === false }).eq('id', b.id)
      if (error) throw error
      toast(b.is_active === false ? '✓ فُعّل الفرع' : '✓ أُوقف الفرع')
      await loadAll(); await reloadBranchContext()
    } catch (e) { toast('تعذّر التحديث: ' + explain(e), true) } finally { setBusy(false) }
  }

  const removeBranch = async (b) => {
    if (!guard()) return
    const { data: usage, error: usageError } = await supabase.rpc('branch_delete_impact', { p_branch_id: b.id })
    if (!usageError && Number(usage?.total || 0) > 0)
      return toast(`لا يمكن حذف الفرع لارتباطه بـ ${usage.total} سجل تشغيلي. أوقفه بدلاً من ذلك.`, true)
    if (linksOf(b.id).length > 0) return toast('ألغِ إسناد المستخدمين من الفرع قبل حذفه.', true)
    if (!window.confirm(`حذف الفرع «${b.name}» نهائياً؟ لا يمكن التراجع.`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('branches').delete().eq('id', b.id)
      if (error) throw error
      toast('✓ حُذف الفرع')
      await loadAll(); await reloadBranchContext()
    } catch (e) { toast('تعذّر الحذف: ' + explain(e), true) } finally { setBusy(false) }
  }

  /* ---------- الإسناد ---------- */
  const assign = async (userId, branchId) => {
    if (!guard()) return
    if (!userId || !branchId) return toast('اختر المستخدم والفرع.', true)
    if (links.some(l => l.user_id === userId && l.branch_id === branchId))
      return toast('المستخدم مُسند لهذا الفرع مسبقاً.', true)
    setBusy(true)
    try {
      const first = branchesOfUser(userId).length === 0
      const { error } = await supabase.from('user_branches')
        .upsert({ user_id: userId, branch_id: branchId, is_default: first }, { onConflict: 'user_id,branch_id' })
      if (error) throw error
      toast('✓ أُسند المستخدم للفرع')
      await loadAll(); await reloadBranchContext()
    } catch (e) { toast('تعذّر الإسناد: ' + explain(e), true) } finally { setBusy(false) }
  }

  const unassign = async (userId, branchId) => {
    if (!guard()) return
    setBusy(true)
    try {
      const { error } = await supabase.from('user_branches').delete()
        .eq('user_id', userId).eq('branch_id', branchId)
      if (error) throw error
      // إن كان الفرع المحذوف هو الافتراضي، نرقّي أول فرع متبقٍ ليبقى للمستخدم فرع افتراضي واحد
      const rest = branchesOfUser(userId).filter(l => l.branch_id !== branchId)
      const wasDefault = branchesOfUser(userId).find(l => l.branch_id === branchId)?.is_default
      if (wasDefault && rest.length) {
        await supabase.from('user_branches').update({ is_default: true })
          .eq('user_id', userId).eq('branch_id', rest[0].branch_id)
      }
      toast('✓ أُلغي الإسناد')
      await loadAll(); await reloadBranchContext()
    } catch (e) { toast('تعذّر الإلغاء: ' + explain(e), true) } finally { setBusy(false) }
  }

  const makeDefault = async (userId, branchId) => {
    if (!guard()) return
    setBusy(true)
    try {
      // فرع افتراضي واحد لكل مستخدم — نُلغي البقية أولاً لمنع التعارض
      const { error: e1 } = await supabase.from('user_branches')
        .update({ is_default: false }).eq('user_id', userId).neq('branch_id', branchId)
      if (e1) throw e1
      const { error: e2 } = await supabase.from('user_branches')
        .update({ is_default: true }).eq('user_id', userId).eq('branch_id', branchId)
      if (e2) throw e2
      toast('✓ تم تعيين الفرع الافتراضي')
      await loadAll(); await reloadBranchContext()
    } catch (e) { toast('تعذّر التعيين: ' + explain(e), true) } finally { setBusy(false) }
  }

  /* ---------- إنشاء مستخدم جديد وإسناده مباشرة ---------- */
  const sameCompany = abilities.sameCompany
  const allowedRoles = creatableRoles(abilities)

  const createUser = async () => {
    if (!guard(abilities.canCreateUsers, 'إنشاء الحسابات متاح لمالك المنشأة أو المدير داخل منشأته فقط.')) return
    // منع منح دور أعلى من صلاحية المُنشئ حتى لو عُدّلت قائمة الأدوار من المتصفح
    if (!allowedRoles.some(r => r.value === nu.role))
      return toast('لا تملك صلاحية منح هذا الدور.', true)
    const full_name = nu.full_name.trim()
    const username = normalizeStaffUsername(nu.username || '')
    if (!full_name) return toast('الاسم الكامل مطلوب.', true)
    if (!/^[a-z0-9._-]{3,32}$/.test(username))
      return toast('اسم المستخدم: 3–32 حرفاً إنجليزياً/رقماً بدون مسافات.', true)
    if (users.some(u => norm(u.username) === username))
      return toast('اسم المستخدم مستخدم مسبقاً داخل المنشأة.', true)
    if ((nu.password || '').length < 6) return toast('كلمة المرور 6 أحرف على الأقل.', true)
    if (nu.branch_id && !branches.some(b => b.id === nu.branch_id))
      return toast('الفرع المختار غير صالح.', true)


    setBusy(true)
    try {
      const { data, error } = await adminSignupClient.auth.signUp({
        email: staffEmail(username),
        password: nu.password,
        options: { data: { company_id: myCompanyId, full_name, role: nu.role, username } },
      })
      if (error) throw error
      const uid = data?.user?.id
      if (!uid) throw new Error('لم يُنشأ المستخدم — تأكد من إيقاف "Confirm email" في إعدادات المصادقة.')

      const { error: pe } = await supabase.from('profiles').upsert({
        id: uid, company_id: myCompanyId, role: nu.role, full_name, username,
        job_title: nu.job_title.trim() || null, phone: nu.phone.trim() || null,
        created_by: profile?.id || null,
      })
      if (pe) throw pe

      // صلاحيات افتراضية — نتجاهل خطأ التكرار فقط
      const { error: se } = await supabase.from('staff_permissions').insert({
        staff_id: uid, user_id: uid, company_id: myCompanyId,
        can_discount: false, discount_max_percent: 10, can_cancel_booking: false,
        can_edit_data: true, can_upload_media: true, can_view_accountant: false, can_export_reports: false,
      })
      if (se && se.code !== '23505') throw se

      if (nu.branch_id) {
        const { error: ae } = await supabase.from('user_branches')
          .upsert({ user_id: uid, branch_id: nu.branch_id, is_default: nu.is_default !== false },
            { onConflict: 'user_id,branch_id' })
        if (ae) throw ae
      }

      toast(`✓ أُنشئ حساب ${full_name} — الدخول باسم المستخدم "${username}"`)
      setNu(EMPTY_USER); setShowNewUser(false)
      await loadAll(); await reloadBranchContext()
    } catch (e) { toast('تعذّر إنشاء الحساب: ' + explain(e), true) } finally { setBusy(false) }
  }

  /* ---------- الواجهة ---------- */
  const TABS = [
    { k: 'overview', label: 'نظرة عامة', icon: '📊' },
    { k: 'branches', label: 'الفروع', icon: '🏢' },
    { k: 'users', label: 'المستخدمون والإسناد', icon: '👥' },
    ...(isSuperAdmin ? [{ k: 'features', label: 'تفعيل الميزة', icon: '🎛️' }] : []),
  ]

  return (
    <div className="bms">
      <div className="panel bms-head">
        <div>
          <h3>🏢 نظام إدارة الفروع</h3>
          <p className="bms-sub">
            إدارة موحّدة للفروع والمستخدمين حسب المنشأة — {companyName}.
            المستخدم غير المُسند لأي فرع يرى بيانات المنشأة كاملة، والمُسند يرى فروعه فقط وفق سياسات الحماية.
          </p>
        </div>
        <div className="bms-head-actions">
          {isSuperAdmin && companies.length > 0 && (
            <select value={scopeCompany || ''} onChange={e => setScopeCompany(e.target.value)} style={{ minWidth: 200 }}>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <button className="btn btn-ghost btn-sm" onClick={loadAll} disabled={loading}>{loading ? '…' : '↻ تحديث'}</button>
        </div>
      </div>

      {!canManage && (
        <div className="panel bms-note">👁️ وضع العرض فقط — تعديل الفروع والإسناد متاح لمالك المنشأة أو المدير.</div>
      )}
      {err && <div className="panel bms-error">⚠️ {err}</div>}

      {canManage && <BranchBackfillPanel companyId={scopeCompany || profile?.company_id} toast={toast} />}

      <div className="settings-tabs bms-tabs">
        {TABS.map(t => (
          <button key={t.k} className={tab === t.k ? 'on' : ''} onClick={() => setTab(t.k)}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {tab !== 'features' && (
        <div className="kpis">
          <div className="kpi"><div className="v">{stats.total}</div><div className="l">إجمالي الفروع</div></div>
          <div className="kpi"><div className="v">{stats.active}</div><div className="l">فروع نشطة</div></div>
          <div className="kpi"><div className="v">{stats.inactive}</div><div className="l">فروع موقوفة</div></div>
          <div className="kpi"><div className="v">{stats.users}</div><div className="l">مستخدمو المنشأة</div></div>
          <div className="kpi"><div className="v">{stats.assigned}</div><div className="l">مُسندون لفروع</div></div>
          <div className="kpi"><div className="v">{stats.unassigned}</div><div className="l">بدون إسناد</div></div>
        </div>
      )}

      {tab === 'overview' && (
        <div className="panel">
          <h4>توزيع المستخدمين على الفروع</h4>
          {branches.length === 0 ? (
            <p className="bms-empty">لا توجد فروع بعد — ابدأ من تبويب «الفروع».</p>
          ) : (
            <div className="bms-cards">
              {branches.map(b => {
                const mine = linksOf(b.id)
                return (
                  <div key={b.id} className="bms-card">
                    <div className="bms-card-top">
                      <b>{b.name}</b>
                      <span className={'chip ' + (b.is_active === false ? 'bms-off' : 'bms-on')}>
                        {b.is_active === false ? 'موقوف' : 'نشط'}
                      </span>
                    </div>
                    <div className="bms-card-meta">
                      {b.code ? <span>الرمز: {b.code}</span> : null}
                      {b.city ? <span>{b.city}</span> : null}
                      {b.phone ? <span dir="ltr">{b.phone}</span> : null}
                    </div>
                    <div className="bms-card-users">
                      {mine.length === 0 ? <em>لا يوجد مستخدمون مُسندون</em> :
                        mine.map(m => (
                          <span key={m.user_id} className="bms-pill">
                            {userById(m.user_id)?.full_name || m.user_id.slice(0, 8)}
                            {m.is_default && <b title="الفرع الافتراضي"> ★</b>}
                          </span>
                        ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'branches' && (
        <>
          <div className="panel">
            <div className="bms-bar bms-filters">
              <input placeholder="بحث بالاسم أو الرمز أو المدينة أو الهاتف…" value={q}
                onChange={e => { setQ(e.target.value); setBranchPage(1) }} style={{ minWidth: 260, flex: 1 }} />
              <select value={bf.status} onChange={e => { setBf({ ...bf, status: e.target.value }); setBranchPage(1) }} title="حالة التفعيل">
                <option value="all">كل الحالات</option>
                <option value="active">نشط</option>
                <option value="inactive">موقوف</option>
              </select>
              <select value={bf.city} onChange={e => { setBf({ ...bf, city: e.target.value }); setBranchPage(1) }} title="المدينة">
                <option value="all">كل المدن</option>
                {cities.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={bf.assignment} onChange={e => { setBf({ ...bf, assignment: e.target.value }); setBranchPage(1) }} title="الإسناد">
                <option value="all">كل الفروع</option>
                <option value="assigned">لديه مستخدمون</option>
                <option value="unassigned">بدون مستخدمين</option>
              </select>
              {bFiltered && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setBf(EMPTY_FILTERS) }}>✕ مسح التصفية</button>
              )}
              {canManage && (
                <button className="btn btn-gold btn-sm" onClick={() => {
                  setShowForm(v => !v); setEditing(null); setForm(EMPTY_BRANCH)
                }}>{showForm ? '✕ إلغاء' : '+ فرع جديد'}</button>
              )}
            </div>
            {bFiltered && (
              <p className="bms-muted" style={{ marginTop: 6 }}>
                عرض {filteredBranches.length} من {branches.length} فرعاً
              </p>
            )}


            {showForm && canManage && (
              <div className="bms-form">
                <div className="grid3">
                  <div className="fld"><label>اسم الفرع *</label>
                    <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="فرع الرياض" /></div>
                  <div className="fld"><label>الرمز</label>
                    <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} dir="ltr" placeholder="RUH-01" /></div>
                  <div className="fld"><label>المدينة</label>
                    <input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
                  <div className="fld"><label>العنوان</label>
                    <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
                  <div className="fld"><label>الهاتف</label>
                    <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} dir="ltr" placeholder="0551234567" /></div>
                  <div className="fld"><label>الحالة</label>
                    <select value={form.is_active === false ? '0' : '1'} onChange={e => setForm({ ...form, is_active: e.target.value === '1' })}>
                      <option value="1">نشط</option><option value="0">موقوف</option>
                    </select></div>
                </div>
                <div className="bms-form-actions">
                  <button className="btn btn-gold btn-sm" disabled={busy} onClick={saveBranch}>
                    {busy ? '…' : editing ? 'حفظ التعديل' : '+ إضافة الفرع'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setShowForm(false); setEditing(null); setForm(EMPTY_BRANCH) }}>إلغاء</button>
                </div>
              </div>
            )}
          </div>

          <div className="panel">
            <table className="tbl">
              <thead>
                <tr><th>الفرع</th><th>الرمز</th><th>المدينة</th><th>الهاتف</th><th>المستخدمون</th><th>الحالة</th><th>إجراءات</th></tr>
              </thead>
              <tbody>
                {filteredBranches.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 18 }}>لا توجد فروع مطابقة</td></tr>
                )}
                {shownBranches.map(b => (
                  <tr key={b.id}>
                    <td><b>{b.name}</b>{b.address ? <div className="bms-muted">{b.address}</div> : null}</td>
                    <td dir="ltr">{b.code || '—'}</td>
                    <td>{b.city || '—'}</td>
                    <td dir="ltr">{b.phone || '—'}</td>
                    <td>{linksOf(b.id).length}</td>
                    <td><span className={'chip ' + (b.is_active === false ? 'bms-off' : 'bms-on')}>{b.is_active === false ? 'موقوف' : 'نشط'}</span></td>
                    <td>
                      <div className="bms-row-actions">
                        <button className="btn btn-ghost btn-sm" disabled={!canManage || busy} onClick={() => startEdit(b)}>تعديل</button>
                        <button className="btn btn-ghost btn-sm" disabled={!canManage || busy} onClick={() => toggleActive(b)}>
                          {b.is_active === false ? 'تفعيل' : 'إيقاف'}
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={!canManage || busy} onClick={() => removeBranch(b)}>حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={safeBranchPage} total={filteredBranches.length} onChange={setBranchPage} />
          </div>
        </>
      )}

      {tab === 'users' && (
        <>
          <div className="panel">
            <div className="bms-bar bms-filters">
              <input placeholder="بحث بالاسم أو اسم المستخدم أو المسمى أو الجوال…" value={uq}
                onChange={e => { setUq(e.target.value); setUserPage(1) }} style={{ minWidth: 260, flex: 1 }} />
              <select value={uf.status} onChange={e => setUf({ ...uf, status: e.target.value })} title="حالة التفعيل">
                <option value="all">كل الحالات</option>
                <option value="active">مفعّل</option>
                <option value="inactive">موقوف</option>
              </select>
              <select value={uf.role} onChange={e => setUf({ ...uf, role: e.target.value })} title="الدور">
                <option value="all">كل الأدوار</option>
                {roles.map(r => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
              </select>
              <select value={uf.branch} onChange={e => setUf({ ...uf, branch: e.target.value })} title="الفرع">
                <option value="all">كل الفروع</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <select value={uf.assignment} onChange={e => setUf({ ...uf, assignment: e.target.value })} title="الإسناد">
                <option value="all">الكل</option>
                <option value="assigned">مُسند لفرع</option>
                <option value="unassigned">بدون إسناد</option>
              </select>
              {uFiltered && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setUq(''); setUf(EMPTY_FILTERS) }}>✕ مسح التصفية</button>
              )}
              {abilities.canCreateUsers && (
                <button className="btn btn-gold btn-sm" onClick={() => setShowNewUser(v => !v)}>
                  {showNewUser ? '✕ إلغاء' : '+ إنشاء مستخدم وإسناده'}
                </button>
              )}
            </div>
            {uFiltered && (
              <p className="bms-muted" style={{ marginTop: 6 }}>
                عرض {filteredUsers.length} من {users.length} مستخدماً
              </p>
            )}

            {showNewUser && abilities.canCreateUsers && (

              <div className="bms-form">
                <div className="grid3">
                  <div className="fld"><label>الاسم الكامل *</label>
                    <input value={nu.full_name} onChange={e => setNu({ ...nu, full_name: e.target.value })} /></div>
                  <div className="fld"><label>اسم المستخدم *</label>
                    <input value={nu.username} onChange={e => setNu({ ...nu, username: e.target.value })} dir="ltr" placeholder="ahmad.s" /></div>
                  <div className="fld"><label>كلمة المرور *</label>
                    <input type="password" value={nu.password} onChange={e => setNu({ ...nu, password: e.target.value })} /></div>
                  <div className="fld"><label>الدور</label>
                    <select value={nu.role} onChange={e => setNu({ ...nu, role: e.target.value })}>
                      {allowedRoles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select></div>

                  <div className="fld"><label>المسمى الوظيفي</label>
                    <input value={nu.job_title} onChange={e => setNu({ ...nu, job_title: e.target.value })} /></div>
                  <div className="fld"><label>الجوال</label>
                    <input value={nu.phone} onChange={e => setNu({ ...nu, phone: e.target.value })} dir="ltr" /></div>
                  <div className="fld"><label>إسناد للفرع</label>
                    <select value={nu.branch_id} onChange={e => setNu({ ...nu, branch_id: e.target.value })}>
                      <option value="">— بدون إسناد (يرى كل المنشأة) —</option>
                      {branches.filter(b => b.is_active !== false).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select></div>
                  <div className="fld"><label>جعله الفرع الافتراضي</label>
                    <select value={nu.is_default ? '1' : '0'} disabled={!nu.branch_id}
                      onChange={e => setNu({ ...nu, is_default: e.target.value === '1' })}>
                      <option value="1">نعم</option><option value="0">لا</option>
                    </select></div>
                </div>
                <div className="bms-form-actions">
                  <button className="btn btn-gold btn-sm" disabled={busy} onClick={createUser}>{busy ? '…' : 'إنشاء الحساب'}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setShowNewUser(false); setNu(EMPTY_USER) }}>إلغاء</button>
                </div>
                <p className="bms-muted" style={{ marginTop: 8 }}>
                  يُنشأ الحساب بنفس آلية «إدارة الموظفين» (اسم مستخدم داخلي + صلاحيات افتراضية) فلا يوجد ازدواج بين النظامين.
                </p>
              </div>
            )}
          </div>

          <div className="panel">
            <table className="tbl">
              <thead>
                <tr><th>المستخدم</th><th>الدور</th><th>الفروع المُسندة</th><th>إسناد لفرع</th></tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: 18 }}>لا يوجد مستخدمون مطابقون</td></tr>
                )}
                {shownUsers.map(u => {
                  const mine = branchesOfUser(u.id)
                  const available = branches.filter(b => b.is_active !== false && !mine.some(m => m.branch_id === b.id))
                  return (
                    <tr key={u.id}>
                      <td>
                        <b>{u.full_name || '—'}</b>
                        <div className="bms-muted" dir="ltr">{u.username || u.id.slice(0, 8)}</div>
                      </td>
                      <td>{ROLE_LABEL[u.role] || u.role || '—'}</td>
                      <td>
                        {mine.length === 0 ? <em className="bms-muted">بدون إسناد — يرى كل المنشأة</em> : (
                          <div className="bms-chips">
                            {mine.map(m => {
                              const b = branches.find(x => x.id === m.branch_id)
                              return (
                                <span key={m.branch_id} className={'bms-pill' + (m.is_default ? ' is-default' : '')}>
                                  {b?.name || m.branch_id.slice(0, 8)}
                                  {m.is_default ? <b title="الفرع الافتراضي"> ★</b> : (
                                    <button className="bms-mini" disabled={!canManage || busy}
                                      title="اجعله الافتراضي" onClick={() => makeDefault(u.id, m.branch_id)}>☆</button>
                                  )}
                                  <button className="bms-mini" disabled={!canManage || busy}
                                    title="إلغاء الإسناد" onClick={() => unassign(u.id, m.branch_id)}>✕</button>
                                </span>
                              )
                            })}
                          </div>
                        )}
                      </td>
                      <td>
                        {available.length === 0 ? <span className="bms-muted">—</span> : (
                          <select value="" disabled={!canManage || busy}
                            onChange={e => e.target.value && assign(u.id, e.target.value)}>
                            <option value="">+ إسناد لفرع…</option>
                            {available.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                          </select>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <Pager page={safeUserPage} total={filteredUsers.length} onChange={setUserPage} />
          </div>
        </>
      )}

      {tab === 'features' && isSuperAdmin && <BranchFeatureAdmin />}
    </div>
  )
}
