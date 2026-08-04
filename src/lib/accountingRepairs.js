import { supabase } from './supabase'

/*
  جسر الإصلاح التلقائي (Auto-Repair Bridge)
  -----------------------------------------
  يربط كل اختبار محاسبي بدالة إصلاح فعلية في قاعدة البيانات
  (SECURITY DEFINER مقيّدة بشركة المستخدم) بحيث يمكن تنفيذ
  «إصلاح تلقائي» مباشرةً بجانب كل اختبار دون تدخل يدوي.
*/

export const REPAIR_ACTIONS = {
  chart:            { rpc: 'accounting_repair_chart',            label: 'إصلاح شجرة الحسابات' },
  orphans:          { rpc: 'accounting_repair_orphan_entries',   label: 'حذف القيود بدون أسطر' },
  dangling_source:  { rpc: 'accounting_repair_dangling_source',  label: 'إصلاح ربط القيد بمصدره' },
  insurance:        { rpc: 'accounting_repair_insurance',        label: 'إصلاح رصيد التأمينات' },
  unbalanced:       { rpc: 'accounting_repair_unbalanced',       label: 'موازنة القيود غير المتوازنة' },
  unposted_payments:{ rpc: 'accounting_repair_unposted_payments', label: 'ترحيل الدفعات غير المرحّلة' },

  all:              { rpc: 'accounting_auto_repair',             label: 'إصلاح محاسبي شامل' },
  all_companies:    { rpc: 'accounting_auto_repair_all',         label: 'إصلاح شامل لكل الشركات' },
}

/** ينفّذ إصلاحاً واحداً ويُعيد نتيجة موحّدة */
export async function runRepair(action, { companyId = null, dryRun = false } = {}) {
  const def = REPAIR_ACTIONS[action]
  if (!def) return { ok: false, message: `إجراء إصلاح غير معروف: ${action}` }
  const args = def.rpc === 'accounting_auto_repair_all'
    ? { p_dry_run: dryRun }
    : { p_company_id: companyId, p_dry_run: dryRun }
  const { data, error } = await supabase.rpc(def.rpc, args)
  if (error) return { ok: false, message: error.message, action, label: def.label }
  const rows = Number(data?.affected_rows || 0)
  return {
    ok: true,
    action,
    label: def.label,
    affected: rows,
    data,
    message: rows > 0 ? `${def.label}: تم إصلاح ${rows} سجل` : `${def.label}: لا توجد مشاكل تحتاج إصلاحاً`,
  }
}

/** إصلاح شامل ثم إعادة تشغيل الاختبارات */
export async function repairAndRerun(action, opts, rerun) {
  const res = await runRepair(action, opts)
  if (res.ok && typeof rerun === 'function') await rerun()
  return res
}
