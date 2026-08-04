/**
 * bookingRules — قواعد الحجز وعدم التداخل (منطق نقي قابل للاختبار)
 * ------------------------------------------------------------------
 * نفس منطق قيد قاعدة البيانات no_double_booking:
 *   نطاق [check_in, check_out) — الخروج يوم الدخول لحجز آخر مسموح.
 * تُستخدم في الواجهة للفحص المسبق وفي اختبارات الانحدار الآلية.
 */

export const BLOCKING_STATUSES = ['confirmed', 'checked_in']

export const toDate = (v) => (v instanceof Date ? v : new Date(String(v) + (String(v).length === 10 ? 'T00:00:00Z' : '')))

/** تحقق من صحة نطاق التواريخ */
export function validateRange(checkIn, checkOut) {
  if (!checkIn || !checkOut) return { valid: false, reason: 'تواريخ الحجز مطلوبة' }
  const a = toDate(checkIn), b = toDate(checkOut)
  if (isNaN(a) || isNaN(b)) return { valid: false, reason: 'صيغة التاريخ غير صحيحة' }
  if (b <= a) return { valid: false, reason: 'تاريخ المغادرة يجب أن يكون بعد تاريخ الوصول' }
  return { valid: true, reason: '' }
}

/** تداخل نصف مفتوح [start, end) */
export function overlaps(aIn, aOut, bIn, bOut) {
  return toDate(aIn) < toDate(bOut) && toDate(bIn) < toDate(aOut)
}

/** هل الحجز يحجب الوحدة فعلياً؟ */
export const isBlocking = (booking) => BLOCKING_STATUSES.includes(String(booking?.status || ''))

/**
 * إيجاد التعارضات لحجز مقترح ضمن قائمة حجوزات الوحدة.
 * @returns {{available: boolean, conflicts: Array, reason: string}}
 */
export function findConflicts(existing, { unitId, checkIn, checkOut, excludeBookingId = null }) {
  const range = validateRange(checkIn, checkOut)
  if (!range.valid) return { available: false, conflicts: [], reason: range.reason }

  const conflicts = (existing || []).filter(b =>
    String(b.unit_id) === String(unitId) &&
    isBlocking(b) &&
    String(b.id) !== String(excludeBookingId ?? '') &&
    overlaps(checkIn, checkOut, b.check_in_date, b.check_out_date)
  )

  return {
    available: conflicts.length === 0,
    conflicts,
    reason: conflicts.length
      ? `الوحدة محجوزة في هذه الفترة (${conflicts[0].check_in_date} → ${conflicts[0].check_out_date})`
      : '',
  }
}

/** ترجمة أخطاء قاعدة البيانات إلى رسائل عربية واضحة */
export function translateBookingError(err) {
  const msg = String(err?.message || err || '')
  if (/no_double_booking|conflicting key|exclusion constraint/i.test(msg))
    return 'تعذّر الحفظ: يوجد حجز آخر يتداخل مع هذه الفترة على نفس الوحدة.'
  if (/bookings_check|check_out_date|check constraint/i.test(msg))
    return 'تواريخ الحجز غير صحيحة: تاريخ المغادرة يجب أن يكون بعد تاريخ الوصول.'
  if (/row-level security|permission denied/i.test(msg))
    return 'لا تملك صلاحية تنفيذ هذه العملية على هذه البيانات.'
  if (/invalid input value for enum/i.test(msg))
    return 'قيمة حالة غير صالحة — تم منع الحفظ للحفاظ على سلامة البيانات.'
  return msg || 'حدث خطأ غير متوقع'
}
