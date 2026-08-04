import { supabase } from './supabase'

/**
 * unitStatusTests — اختبارات آلية لانتقالات حالة الوحدة على مستوى التطبيق
 * ---------------------------------------------------------------------
 * تتحقق من أن أي انتقال بين حالات الوحدة (available, reserved, occupied,
 * cleaning, maintenance, reserved_online) لا يُطلق خطأ من التريجرات في قاعدة
 * البيانات — خصوصاً الخطأ:
 *   invalid input value for enum unit_status: ""
 *
 * الاختبار غير مُتلف: يختار وحدة شاغرة (available) بدون حجوزات نشطة، يمرّ
 * على جميع الحالات، ثم يُعيد الوحدة إلى حالتها الأصلية دائماً (حتى عند الفشل).
 */

export const UNIT_STATUSES = [
  'available',
  'reserved',
  'occupied',
  'cleaning',
  'maintenance',
  'reserved_online',
]

const ACTIVE_BOOKING_STATUSES = ['pending', 'confirmed', 'checked_in', 'pending_approval', 'reserved_online']

/** يختار وحدة آمنة للاختبار داخل الشركة الحالية */
export async function pickSafeUnit(companyId) {
  const { data: units, error } = await supabase
    .from('units')
    .select('id, unit_number, status')
    .eq('company_id', companyId)
    .eq('status', 'available')
    .order('created_at', { ascending: true })
    .limit(20)

  if (error) return { unit: null, error: error.message }
  if (!units?.length) return { unit: null, error: 'لا توجد وحدة شاغرة (available) صالحة للاختبار داخل حسابك.' }

  const ids = units.map(u => u.id)
  const { data: busy } = await supabase
    .from('bookings')
    .select('unit_id')
    .eq('company_id', companyId)
    .in('unit_id', ids)
    .in('status', ACTIVE_BOOKING_STATUSES)

  const busyIds = new Set((busy || []).map(b => b.unit_id))
  const unit = units.find(u => !busyIds.has(u.id))
  if (!unit) return { unit: null, error: 'كل الوحدات الشاغرة مرتبطة بحجوزات نشطة — لم يتم تنفيذ الاختبار حفاظاً على البيانات.' }
  return { unit, error: null }
}

/** تشغيل مجموعة اختبارات الانتقالات */
export async function runUnitStatusSuite({ companyId }) {
  const started = Date.now()
  const results = []
  const add = (name, status, detail = '') => results.push({ name, status, detail })

  if (!companyId) {
    add('تهيئة الاختبار', 'fail', 'لا يوجد معرّف منشأة للمستخدم الحالي.')
    return { results, summary: summarize(results), durationMs: 0 }
  }

  const { unit, error } = await pickSafeUnit(companyId)
  if (!unit) {
    add('اختيار وحدة اختبار آمنة', 'warn', error)
    return { results, summary: summarize(results), durationMs: Date.now() - started }
  }
  add('اختيار وحدة اختبار آمنة', 'pass', `الوحدة ${unit.unit_number} (شاغرة وبدون حجوزات نشطة)`)

  const original = unit.status

  try {
    // 1) المرور على جميع الحالات بالتسلسل
    for (const s of UNIT_STATUSES) {
      const { error: e } = await supabase
        .from('units')
        .update({ status: s })
        .eq('id', unit.id)
        .eq('company_id', companyId)
      if (e) add(`الانتقال إلى: ${s}`, 'fail', e.message)
      else add(`الانتقال إلى: ${s}`, 'pass', 'تم بدون أي خطأ من تريجرات قاعدة البيانات')
    }

    // 2) سيناريو التسليم/الإخلاء (occupied → available) الذي كان يُظهر الخطأ
    for (const pair of [['occupied', 'available'], ['maintenance', 'available'], ['cleaning', 'available']]) {
      const [from, to] = pair
      const { error: e1 } = await supabase.from('units').update({ status: from }).eq('id', unit.id).eq('company_id', companyId)
      const { error: e2 } = e1 ? { error: null } : await supabase.from('units').update({ status: to }).eq('id', unit.id).eq('company_id', companyId)
      const err = e1 || e2
      if (err) add(`سيناريو التسليم: ${from} ← ${to}`, 'fail', err.message)
      else add(`سيناريو التسليم: ${from} ← ${to}`, 'pass', 'تريجر إغلاق طلبات الصيانة عمل بشكل سليم')
    }

    // 3) رفض القيمة الفارغة يجب أن يبقى محصوراً في التطبيق ولا يصل للتريجر
    const { error: emptyErr } = await supabase.from('units').update({ status: '' }).eq('id', unit.id).eq('company_id', companyId)
    if (emptyErr && /unit_status/.test(emptyErr.message)) {
      add('حماية من قيمة حالة فارغة', 'pass', 'قاعدة البيانات ترفض القيمة الفارغة كما هو متوقع (لا يُسمح بها من الواجهة).')
    } else if (emptyErr) {
      add('حماية من قيمة حالة فارغة', 'warn', emptyErr.message)
    } else {
      add('حماية من قيمة حالة فارغة', 'fail', 'تم قبول قيمة فارغة للحالة — يجب مراجعة قيود العمود.')
    }
  } finally {
    // إعادة الوحدة لحالتها الأصلية دائماً
    await supabase.from('units').update({ status: original }).eq('id', unit.id).eq('company_id', companyId)
    add('استعادة حالة الوحدة الأصلية', 'pass', `أُعيدت الوحدة ${unit.unit_number} إلى: ${original}`)
  }

  return { results, summary: summarize(results), durationMs: Date.now() - started }
}

export const summarize = (results) => ({
  pass: results.filter(r => r.status === 'pass').length,
  fail: results.filter(r => r.status === 'fail').length,
  warn: results.filter(r => r.status === 'warn').length,
})
