import { supabase } from './supabase'

/**
 * systemMonitor — تسجيل ومراقبة أخطاء الحجوزات/الفروع/سجل النشاط
 * -----------------------------------------------------------------
 * • يكتب التنبيه في جدول system_alerts عبر دالة log_system_alert.
 * • القراءة محصورة بسياسة RLS في السوبر أدمن فقط (لا يظهر لأي مستخدم آخر).
 * • لا يمكن لفشل التسجيل أن يُعطّل العملية الأساسية إطلاقاً.
 */

export const ALERT_SOURCES = {
  bookings: 'الحجوزات',
  units: 'الوحدات',
  branches: 'الفروع',
  activity_log: 'سجل النشاط',
  serials: 'أرقام المستندات',
  storage: 'الملفات والحاويات',
  app: 'النظام',
}

const recent = new Map() // منع إغراق السجل بنفس الخطأ
const DEDUPE_MS = 30_000

export async function reportIssue(source, error, context = {}, { severity = 'error', code = null } = {}) {
  const message = typeof error === 'string'
    ? error
    : (error?.message || error?.error_description || 'خطأ غير معروف')
  const key = `${source}|${code || ''}|${message}`
  const now = Date.now()
  if (recent.get(key) && now - recent.get(key) < DEDUPE_MS) return null
  recent.set(key, now)

  try { console.warn(`[monitor:${source}]`, message, context) } catch { /* noop */ }

  try {
    const { data } = await supabase.rpc('log_system_alert', {
      p_source: source,
      p_message: message,
      p_severity: severity,
      p_code: code || error?.code || null,
      p_context: { ...context, href: typeof window !== 'undefined' ? window.location.href : null },
    })
    return data || null
  } catch {
    return null
  }
}

/** غلاف آمن: ينفّذ العملية ويسجّل أي خطأ تلقائياً ثم يعيد رميه */
export async function withMonitor(source, context, fn) {
  try {
    const result = await fn()
    if (result?.error) await reportIssue(source, result.error, context)
    return result
  } catch (e) {
    await reportIssue(source, e, context)
    throw e
  }
}

/** الإصلاح الذاتي الآمن — متاح لكل المستخدمين على بيانات منشأتهم فقط */
export async function runSelfRepair() {
  const startedAt = Date.now()
  const { data, error } = await supabase.rpc('run_self_repair')
  const ms = Date.now() - startedAt

  if (error) {
    // فشل تنفيذ الإصلاح — يُسجّل بتفاصيل كاملة للسوبر أدمن
    await reportIssue('app', error, {
      step: 'run_self_repair', phase: 'rpc_failed', duration_ms: ms,
      details: error?.details || null, hint: error?.hint || null,
    }, { severity: 'critical', code: error?.code || 'self_repair_failed' })
    throw error
  }

  const result = data || { ok: false, message: 'لم تُرجع الدالة أي نتيجة' }

  if (!result.ok) {
    await reportIssue('app', result.message || 'تعذّر تنفيذ الإصلاح الذاتي', {
      step: 'run_self_repair', phase: 'rejected', duration_ms: ms, result,
    }, { severity: 'warn', code: 'self_repair_rejected' })
    return result
  }

  const fixed = {
    bookings: Number(result.branch_fixed || 0),
    contracts: Number(result.contract_fixed || 0),
    units: Number(result.status_fixed || 0),
  }
  const total = fixed.bookings + fixed.contracts + fixed.units

  // تسجيل نتيجة كل عملية إصلاح (نجاح كذلك) لتتبّع أي تعارض في الحجوزات/الفروع
  await reportIssue('app', total
    ? `إصلاح ذاتي: ${fixed.bookings} حجز/فرع · ${fixed.contracts} رقم عقد · ${fixed.units} حالة وحدة`
    : 'إصلاح ذاتي: فحص مكتمل بدون أخطاء', {
    step: 'run_self_repair', phase: 'completed', duration_ms: ms, fixed, result,
  }, { severity: total ? 'warn' : 'info', code: 'self_repair_done' })

  if (Array.isArray(result.errors) && result.errors.length) {
    await reportIssue('bookings', `تعارضات لم يتمكّن الإصلاح الذاتي من حلّها (${result.errors.length})`, {
      step: 'run_self_repair', phase: 'conflicts', conflicts: result.errors.slice(0, 50),
    }, { severity: 'error', code: 'self_repair_conflicts' })
  }

  return { ...result, fixed, total, duration_ms: ms }
}
