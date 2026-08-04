import { describe, it, expect } from 'vitest'
import {
  shouldShowMaintenanceBadge,
  isStaleTicket,
  computeTicketsToClose,
} from '../maintenanceSync'

const A = 'company-a'
const B = 'company-b'

const units = [
  { id: 'u1', company_id: A, status: 'available' },
  { id: 'u2', company_id: A, status: 'maintenance' },
  { id: 'u3', company_id: A, status: 'cleaning' },
  { id: 'u4', company_id: A, status: 'occupied' },
  { id: 'u5', company_id: B, status: 'available' },
  { id: 'u6', company_id: B, status: 'maintenance' },
]

describe('شارة الصيانة تعتمد على حالة الوحدة فقط', () => {
  it('لا تظهر على وحدة متاحة حتى مع وجود تذكرة مفتوحة', () => {
    expect(shouldShowMaintenanceBadge(units[0])).toBe(false)
  })
  it('تظهر على وحدة قيد الصيانة أو التنظيف', () => {
    expect(shouldShowMaintenanceBadge(units[1])).toBe(true)
    expect(shouldShowMaintenanceBadge(units[2])).toBe(true)
  })
  it('لا تظهر على وحدة مؤجّرة', () => {
    expect(shouldShowMaintenanceBadge(units[3])).toBe(false)
  })
})

describe('اكتشاف التذاكر المعلّقة', () => {
  it('تذكرة مفتوحة على وحدة متاحة = معلّقة', () => {
    expect(isStaleTicket({ unit_id: 'u1', status: 'open' }, units[0])).toBe(true)
    expect(isStaleTicket({ unit_id: 'u1', status: 'in_progress' }, units[0])).toBe(true)
  })
  it('تذكرة مفتوحة على وحدة قيد الصيانة ليست معلّقة', () => {
    expect(isStaleTicket({ unit_id: 'u2', status: 'open' }, units[1])).toBe(false)
  })
  it('تذكرة مغلقة ليست معلّقة', () => {
    expect(isStaleTicket({ unit_id: 'u1', status: 'done' }, units[0])).toBe(false)
  })
})

describe('التنظيف الشامل عبر عدة حسابات', () => {
  const tickets = [
    { id: 't1', company_id: A, unit_id: 'u1', status: 'open', opened_at: '2026-07-01' },
    { id: 't2', company_id: A, unit_id: 'u2', status: 'open', opened_at: '2026-07-02' },
    { id: 't3', company_id: A, unit_id: 'u2', status: 'in_progress', opened_at: '2026-07-05' },
    { id: 't4', company_id: A, unit_id: 'u2', status: 'done', opened_at: '2026-06-01' },
    { id: 't5', company_id: B, unit_id: 'u5', status: 'in_progress', opened_at: '2026-07-03' },
    { id: 't6', company_id: B, unit_id: 'u6', status: 'open', opened_at: '2026-07-04' },
    { id: 't7', company_id: B, unit_id: 'u1', status: 'open', opened_at: '2026-07-04' }, // تسرّب بين الحسابات
  ]
  const closed = computeTicketsToClose(units, tickets)

  it('يغلق التذاكر المعلّقة في كل الحسابات', () => {
    expect(closed).toContain('t1')
    expect(closed).toContain('t5')
  })
  it('يغلق التذاكر المكرّرة ويُبقي الأحدث فقط', () => {
    expect(closed).toContain('t2')
    expect(closed).not.toContain('t3')
  })
  it('لا يمس التذاكر الصحيحة ولا المغلقة', () => {
    expect(closed).not.toContain('t4')
    expect(closed).not.toContain('t6')
  })
  it('يتجاهل أي تذكرة تخالف عزل الحسابات', () => {
    expect(closed).not.toContain('t7')
  })
  it('تبقى الوحدات قيد الصيانة ظاهرة بالشارة بعد التنظيف', () => {
    expect(shouldShowMaintenanceBadge(units[1])).toBe(true)
    expect(shouldShowMaintenanceBadge(units[5])).toBe(true)
  })
})
