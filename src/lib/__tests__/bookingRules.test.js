import { describe, it, expect } from 'vitest'
import { findConflicts, overlaps, validateRange, translateBookingError, isBlocking } from '../bookingRules'

/**
 * اختبارات انحدار — قواعد الحجز وعدم التداخل.
 * أي تعديل لاحق يكسر قواعد التوفر سيُسقط هذه الاختبارات فوراً.
 */

const U = 'unit-1'
const bookings = [
  { id: 'b1', unit_id: U, status: 'confirmed', check_in_date: '2026-08-01', check_out_date: '2026-08-05' },
  { id: 'b2', unit_id: U, status: 'checked_in', check_in_date: '2026-08-10', check_out_date: '2026-08-15' },
  { id: 'b3', unit_id: U, status: 'cancelled', check_in_date: '2026-08-20', check_out_date: '2026-08-25' },
  { id: 'b4', unit_id: 'unit-2', status: 'confirmed', check_in_date: '2026-08-01', check_out_date: '2026-08-30' },
]

describe('validateRange', () => {
  it('يرفض التواريخ الناقصة', () => expect(validateRange('', '2026-08-02').valid).toBe(false))
  it('يرفض المغادرة قبل الوصول', () => expect(validateRange('2026-08-05', '2026-08-01').valid).toBe(false))
  it('يرفض نفس اليوم', () => expect(validateRange('2026-08-05', '2026-08-05').valid).toBe(false))
  it('يقبل نطاقاً صحيحاً', () => expect(validateRange('2026-08-01', '2026-08-02').valid).toBe(true))
})

describe('overlaps — نطاق نصف مفتوح [in, out)', () => {
  it('التلامس ليس تداخلاً', () => expect(overlaps('2026-08-05', '2026-08-08', '2026-08-01', '2026-08-05')).toBe(false))
  it('التداخل الجزئي يُكتشف', () => expect(overlaps('2026-08-04', '2026-08-08', '2026-08-01', '2026-08-05')).toBe(true))
  it('الاحتواء الكامل يُكتشف', () => expect(overlaps('2026-08-02', '2026-08-03', '2026-08-01', '2026-08-05')).toBe(true))
  it('الاحتواء العكسي يُكتشف', () => expect(overlaps('2026-07-30', '2026-08-20', '2026-08-01', '2026-08-05')).toBe(true))
})

describe('isBlocking', () => {
  it('confirmed و checked_in فقط تحجب', () => {
    expect(isBlocking({ status: 'confirmed' })).toBe(true)
    expect(isBlocking({ status: 'checked_in' })).toBe(true)
    expect(isBlocking({ status: 'pending' })).toBe(false)
    expect(isBlocking({ status: 'cancelled' })).toBe(false)
  })
})

describe('findConflicts', () => {
  it('يمنع الحجز المتداخل', () => {
    const r = findConflicts(bookings, { unitId: U, checkIn: '2026-08-03', checkOut: '2026-08-07' })
    expect(r.available).toBe(false)
    expect(r.conflicts.map(c => c.id)).toEqual(['b1'])
  })
  it('يسمح بالحجز في الفجوة بين حجزين', () => {
    const r = findConflicts(bookings, { unitId: U, checkIn: '2026-08-05', checkOut: '2026-08-10' })
    expect(r.available).toBe(true)
  })
  it('يتجاهل الحجوزات الملغاة', () => {
    const r = findConflicts(bookings, { unitId: U, checkIn: '2026-08-21', checkOut: '2026-08-23' })
    expect(r.available).toBe(true)
  })
  it('لا يخلط بين الوحدات', () => {
    const r = findConflicts(bookings, { unitId: U, checkIn: '2026-09-01', checkOut: '2026-09-03' })
    expect(r.available).toBe(true)
  })
  it('يستثني الحجز نفسه عند التعديل', () => {
    const r = findConflicts(bookings, { unitId: U, checkIn: '2026-08-01', checkOut: '2026-08-05', excludeBookingId: 'b1' })
    expect(r.available).toBe(true)
  })
  it('يكشف تداخل حجزين متزامنين على نفس الوحدة', () => {
    const first = { id: 'new1', unit_id: U, status: 'confirmed', check_in_date: '2026-12-01', check_out_date: '2026-12-05' }
    const r = findConflicts([...bookings, first], { unitId: U, checkIn: '2026-12-04', checkOut: '2026-12-06' })
    expect(r.available).toBe(false)
  })
  it('يرفض النطاق غير الصحيح قبل أي فحص', () => {
    const r = findConflicts(bookings, { unitId: U, checkIn: '2026-08-09', checkOut: '2026-08-09' })
    expect(r.available).toBe(false)
    expect(r.conflicts).toHaveLength(0)
  })
})

describe('translateBookingError', () => {
  it('يترجم خطأ التداخل', () =>
    expect(translateBookingError({ message: 'conflicting key value violates exclusion constraint "no_double_booking"' }))
      .toMatch(/يتداخل/))
  it('يترجم خطأ التواريخ', () =>
    expect(translateBookingError({ message: 'new row violates check constraint "bookings_check"' })).toMatch(/المغادرة/))
  it('يترجم خطأ الصلاحيات', () =>
    expect(translateBookingError({ message: 'new row violates row-level security policy' })).toMatch(/صلاحية/))
  it('لا ينهار مع مدخل فارغ', () => expect(typeof translateBookingError(null)).toBe('string'))
})
