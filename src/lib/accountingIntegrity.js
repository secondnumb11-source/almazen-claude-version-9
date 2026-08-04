/*
  محرّك فحص التكامل المحاسبي (Accounting Integrity Engine)
  ---------------------------------------------------------
  دوال نقيّة (بدون شبكة) تُستخدم في:
   1) اختبارات التكامل التلقائية التي تعمل في كل تعديل مستقبلي (CI).
   2) أدوات الفحص داخل التطبيق.
  الغرض: ضمان توازن القيود، اكتشاف الدفعات غير المرحّلة،
  والتحقق من صحة شكل الاستعلامات الأساسية (عزل الشركة والأعمدة المطلوبة).
*/

export const TOLERANCE = 0.01

const num = (v) => Number(v) || 0
export const round2 = (v) => Math.round(num(v) * 100) / 100

/** مجموع المدين / الدائن لمجموعة أسطر قيد */
export function entryTotals(lines = []) {
  return {
    debit: round2(lines.reduce((s, l) => s + num(l.debit), 0)),
    credit: round2(lines.reduce((s, l) => s + num(l.credit), 0)),
  }
}

/** هل القيد متوازن؟ */
export function isEntryBalanced(lines = [], tolerance = TOLERANCE) {
  if (!Array.isArray(lines) || lines.length < 2) return false
  const { debit, credit } = entryTotals(lines)
  if (debit <= 0 || credit <= 0) return false
  return Math.abs(debit - credit) <= tolerance
}

/** سطر مخالف: مدين ودائن معاً، أو كلاهما صفر، أو قيمة سالبة */
export function invalidLines(lines = []) {
  return lines.filter((l) => {
    const d = num(l.debit), c = num(l.credit)
    return d < 0 || c < 0 || (d > 0 && c > 0) || (d === 0 && c === 0)
  })
}

/**
 * اكتشاف القيود غير المتوازنة داخل مجموعة قيود.
 * entries: [{ id, entry_number, lines: [{debit, credit}] }]
 */
export function findUnbalancedEntries(entries = [], tolerance = TOLERANCE) {
  return entries
    .filter((e) => !isEntryBalanced(e.lines || [], tolerance))
    .map((e) => {
      const { debit, credit } = entryTotals(e.lines || [])
      return {
        id: e.id ?? null,
        entry_number: e.entry_number ?? null,
        debit,
        credit,
        difference: round2(debit - credit),
      }
    })
}

/**
 * اكتشاف الدفعات غير المرحّلة إلى دفتر اليومية.
 * تعتبر الدفعة مُرحّلة إذا وُجد قيد مصدره معرّف الدفعة أو معرّف الحجز المرتبط بها
 * (نفس منطق public.acct_payment_is_posted في قاعدة البيانات).
 */
export function findUnpostedPayments(payments = [], journalEntries = []) {
  const sources = new Set(
    journalEntries.map((j) => j.source_id).filter(Boolean),
  )
  return payments.filter(
    (p) =>
      num(p.amount) > 0 &&
      !sources.has(p.id) &&
      !(p.booking_id && sources.has(p.booking_id)),
  )
}

/** ملخّص جاهز للعرض/التسجيل */
export function summarizeIntegrity({ entries = [], payments = [] } = {}) {
  const unbalanced = findUnbalancedEntries(entries)
  const unposted = findUnpostedPayments(
    payments,
    entries.map((e) => ({ source_id: e.source_id })),
  )
  return {
    entries: entries.length,
    payments: payments.length,
    unbalanced: unbalanced.length,
    unposted: unposted.length,
    ok: unbalanced.length === 0 && unposted.length === 0,
    details: { unbalanced, unposted },
  }
}

/**
 * التحقق من صحة استعلام أساسي: يجب أن يكون مقيّداً بشركة المستخدم
 * وأن يطلب كل الأعمدة المطلوبة (منع كسر الشاشات بعد أي تعديل).
 * spec: { table, columns: string, filters: string[] }
 */
export function validateCoreQuery(spec = {}, requiredColumns = []) {
  const problems = []
  if (!spec.table) problems.push('اسم الجدول مفقود')
  const cols = String(spec.columns || '')
  const filters = spec.filters || []
  if (cols !== '*') {
    for (const c of requiredColumns) {
      if (!cols.split(',').map((s) => s.trim()).includes(c)) {
        problems.push(`العمود المطلوب مفقود: ${c}`)
      }
    }
  }
  if (!filters.includes('company_id')) problems.push('الاستعلام غير مقيّد بـ company_id')
  return { ok: problems.length === 0, problems }
}