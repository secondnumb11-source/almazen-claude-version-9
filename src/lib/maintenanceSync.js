/**
 * منطق نقي (بدون شبكة) لمزامنة حالة الصيانة — يُستخدم في الواجهة وفي الاختبارات.
 * القاعدة: شارة الصيانة تعتمد على حالة الوحدة فقط، لا على وجود تذاكر مفتوحة.
 */

export const OPEN_TICKET_STATUSES = ['open', 'in_progress']

/** هل تُعرض شارة الصيانة/التنظيف على بطاقة الوحدة؟ */
export function shouldShowMaintenanceBadge(unit) {
  return unit?.status === 'maintenance' || unit?.status === 'cleaning'
}

/** تذكرة معلّقة خاطئة: مفتوحة بينما الوحدة متاحة */
export function isStaleTicket(ticket, unit) {
  if (!ticket || !unit) return false
  if (ticket.unit_id !== unit.id) return false
  return OPEN_TICKET_STATUSES.includes(ticket.status) && unit.status === 'available'
}

/**
 * التذاكر التي يجب إغلاقها: المعلّقة على وحدات متاحة + المكررة
 * (يُبقى أحدث تذكرة مفتوحة لكل وحدة فقط).
 * العزل بين الحسابات محفوظ: المطابقة تتم عبر company_id + unit_id.
 */
export function computeTicketsToClose(units = [], tickets = []) {
  const unitById = new Map(units.map(u => [u.id, u]))
  const toClose = new Set()
  const newestOpenPerUnit = new Map()

  for (const t of tickets) {
    const u = unitById.get(t.unit_id)
    if (!u) continue
    if (u.company_id !== t.company_id) continue // لا تتخطَّ حدود الحساب أبداً
    if (!OPEN_TICKET_STATUSES.includes(t.status)) continue

    if (u.status === 'available') { toClose.add(t.id); continue }

    const prev = newestOpenPerUnit.get(t.unit_id)
    if (!prev) { newestOpenPerUnit.set(t.unit_id, t); continue }
    const older = new Date(prev.opened_at || 0) >= new Date(t.opened_at || 0) ? t : prev
    const newer = older === t ? prev : t
    toClose.add(older.id)
    newestOpenPerUnit.set(t.unit_id, newer)
  }

  return [...toClose]
}
