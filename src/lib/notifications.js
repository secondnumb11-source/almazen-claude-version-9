import { supabase } from './supabase'

/**
 * حارس التشغيل اليومي.
 *
 * السبب: كانت هذه الدالة تُستدعى من useEffect تابع لكائن `profile` الذي تتغيّر
 * هويته مع كل تحديث، وبلا أي حارس رغم اسمها «اليومية». وكل دورة تُطلق 8
 * استعلامات وتُدرج إشعارات، وإدراج الإشعار يُطلق اشتراك Realtime الذي يُعيد
 * التحميل — حلقة تغذية راجعة مكتملة.
 *
 * القياس على الإنتاج قبل الإصلاح: 821 طلب حجوزات في الساعة (تكرار كل 42 ثانية)
 * و388 صف إشعارات — وهو سبب بطء تحميل الصفحات والتنقل.
 *
 * الحارس بطبقتين: قفل في الذاكرة يمنع التشغيل المتوازي داخل نفس التبويب،
 * وطابع يوم في التخزين المحلي يمنع تكرار التشغيل خلال اليوم نفسه لكل منشأة.
 */
const RUN_STAMP_KEY = 'almazen.notifChecks.lastRun'
const inFlight = new Set()

function alreadyRanToday(company_id, dayStr) {
  try {
    const raw = JSON.parse(localStorage.getItem(RUN_STAMP_KEY) || '{}')
    return raw[company_id] === dayStr
  } catch { return false }
}

function markRanToday(company_id, dayStr) {
  try {
    const raw = JSON.parse(localStorage.getItem(RUN_STAMP_KEY) || '{}')
    raw[company_id] = dayStr
    localStorage.setItem(RUN_STAMP_KEY, JSON.stringify(raw))
  } catch { /* التخزين قد يكون معطّلاً — القفل في الذاكرة يبقى فعّالاً */ }
}

export async function runDailyNotificationChecks(company_id, { force = false } = {}) {
  if (!company_id) return;
  const today = new Date();
  const dayStr = today.toISOString().slice(0, 10);

  if (!force) {
    if (inFlight.has(company_id)) return;              // تشغيل جارٍ الآن
    if (alreadyRanToday(company_id, dayStr)) return;   // شُغّل اليوم بالفعل
  }
  inFlight.add(company_id);
  // يُعلَّم قبل البدء لا بعده: الفشل في المنتصف يجب ألا يُعيد فتح الحلقة
  markRanToday(company_id, dayStr);

  try {
    return await runChecks(company_id, today);
  } finally {
    inFlight.delete(company_id);
  }
}

async function runChecks(company_id, today) {
  
  // 1. Check contracts (bookings ending in 7, 3, 1 days)
  const daysToCheck = [7, 3, 1];
  for (const days of daysToCheck) {
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + days);
    const dateStr = targetDate.toISOString().split('T')[0];
    
    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, unit_id, customers(full_name), units(unit_number)')
      .eq('company_id', company_id)
      .eq('status', 'checked_in')
      .eq('check_out_date', dateStr);
      
    if (bookings && bookings.length > 0) {
      for (const b of bookings) {
        const evType = `contract_ending_${days}`;
        // check if notification already exists
        const { data: existing } = await supabase
          .from('notifications')
          .select('id')
          .eq('booking_id', b.id)
          .eq('event_type', evType)
          // فحص وجود لا جلب صف مضمون: single() يفشل عند صفر صف (وهي الحالة
          // الطبيعية هنا) فيُصدر 406، ويفشل أيضاً عند تعدد الصفوف فيصير
          // existing فارغاً ويُدرَج إشعار مكرر — أي يتعطّل منع التكرار نفسه.
          .limit(1)
          .maybeSingle();
          
        if (!existing) {
          await supabase.from('notifications').insert({
            company_id,
            target_role: 'manager',
            channel: 'in_app',
            event_type: evType,
            title: `عقد إيجار ينتهي بعد ${days} يوم`,
            body: `عقد إيجار الوحدة ${b.units?.unit_number} للمستأجر ${b.customers?.full_name} سينتهي في ${dateStr}.`,
            booking_id: b.id,
            unit_id: b.unit_id
          });
        }
      }
    }
  }

  // 2. Check employee visa/iqama expiry (in 30, 15, 7 days)
  const visaDays = [30, 15, 7, 3, 1];
  for (const days of visaDays) {
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + days);
    const dateStr = targetDate.toISOString().split('T')[0];
    
    const { data: staff } = await supabase
      .from('profiles')
      .select('id, full_name, iqama_expiry')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .eq('iqama_expiry', dateStr);
      
    if (staff && staff.length > 0) {
      for (const p of staff) {
        const evType = `iqama_expiring_${days}`;
        const { data: existing } = await supabase
          .from('notifications')
          .select('id')
          .eq('user_id', p.id)
          .eq('event_type', evType)
          // نفس السبب: فحص وجود، لا جلب صف مضمون.
          .limit(1)
          .maybeSingle();
          
        if (!existing) {
          await supabase.from('notifications').insert({
            company_id,
            target_role: 'manager',
            channel: 'in_app',
            event_type: evType,
            title: `انتهاء إقامة موظف بعد ${days} يوم`,
            body: `إقامة/تأشيرة الموظف ${p.full_name} ستنتهي بتاريخ ${dateStr}. يرجى اتخاذ الإجراءات اللازمة.`,
            user_id: p.id
          });
        }
      }
    }
  }
}
