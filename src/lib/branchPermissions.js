/**
 * branchPermissions — مصدر واحد لقرارات الصلاحية في شاشة إدارة الفروع.
 * الواجهة تخفي غير المسموح، وهذه الطبقة تمنع تنفيذه حتى لو تلاعب أحدهم بالـ DOM.
 * الحماية النهائية تبقى في قاعدة البيانات (supabase/BRANCH_RBAC_HARDENING.sql).
 */

export const MANAGER_ROLES = ['owner', 'manager']

export function branchAbilities({ profile, isSuperAdmin, scopeCompanyId }) {
  const role = profile?.role || null
  const myCompanyId = profile?.company_id || null
  const activeCompanyId = scopeCompanyId || myCompanyId
  const sameCompany = !!activeCompanyId && activeCompanyId === myCompanyId
  const isManager = MANAGER_ROLES.includes(role)
  const isOwner = role === 'owner'
  const active = profile?.is_active !== false

  // إدارة الفروع: مالك/مدير داخل منشأته، أو super admin
  const canManageBranches = active && (isSuperAdmin || (isManager && sameCompany))

  return {
    role,
    myCompanyId,
    activeCompanyId,
    sameCompany,
    isSuperAdmin: !!isSuperAdmin,
    canView: !!activeCompanyId,
    canManageBranches,
    canAssignUsers: canManageBranches,
    // إنشاء الحسابات داخل المنشأة فقط — لا يُسمح به عبر تبديل نطاق الشركة
    canCreateUsers: active && isManager && sameCompany,
    // منح دور مدير متاح للمالك أو super admin فقط
    canGrantRole: (targetRole) =>
      targetRole === 'manager' ? (isOwner || !!isSuperAdmin) : canManageBranches,
    canSwitchCompany: !!isSuperAdmin,
  }
}

/** أدوار يُسمح بإنشائها من هذه الشاشة حسب دور المستخدم الحالي */
export function creatableRoles(abilities) {
  const base = [
    { value: 'employee', label: 'موظف' },
    { value: 'accountant', label: 'محاسب' },
  ]
  if (abilities.canGrantRole('manager')) base.push({ value: 'manager', label: 'مدير' })
  return base
}

/**
 * حارس تنفيذ — يُستدعى قبل كل عملية كتابة.
 * يرمي خطأ مفهوماً بدل إرسال طلب سيرفض من RLS.
 */
export function assertAllowed(allowed, message) {
  if (!allowed) {
    const e = new Error(message || 'لا تملك صلاحية تنفيذ هذا الإجراء.')
    e.code = 'FORBIDDEN_UI'
    throw e
  }
  return true
}
