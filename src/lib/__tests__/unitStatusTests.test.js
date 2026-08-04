import { describe, it, expect } from 'vitest'
import { UNIT_STATUSES, summarize } from '../unitStatusTests'

// قيم enum unit_status كما هي في قاعدة البيانات (public.unit_status)
const DB_UNIT_STATUS = ['available', 'reserved', 'occupied', 'cleaning', 'maintenance', 'reserved_online']

describe('unit status transitions', () => {
  it('تغطي جميع قيم enum unit_status الموجودة في قاعدة البيانات', () => {
    expect([...UNIT_STATUSES].sort()).toEqual([...DB_UNIT_STATUS].sort())
  })

  it('لا تحتوي على قيمة فارغة (سبب خطأ invalid input value for enum)', () => {
    expect(UNIT_STATUSES.every(s => typeof s === 'string' && s.trim().length > 0)).toBe(true)
  })

  it('summarize يحسب النتائج بشكل صحيح', () => {
    const s = summarize([{ status: 'pass' }, { status: 'fail' }, { status: 'warn' }, { status: 'pass' }])
    expect(s).toEqual({ pass: 2, fail: 1, warn: 1 })
  })
})
