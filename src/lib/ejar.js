/*
  ejar.js — طبقة المستأجر للربط مع منصة إيجار (التوثيق الرسمي لعقود الإيجار)
  ------------------------------------------------------------------------
  ملاحظة مهمة وصادقة: التسجيل الفعلي في إيجار عملية شراكة رسمية
  (اسمها الحكومي "التكامل الرقمي بين شبكة إيجار ومنصات التسويق العقاري")،
  وليست واجهة API عامة مفتوحة التوثيق. لا يوجد رابط REST منشور للعموم
  يمكن الاعتماد عليه هنا بثقة كاملة. لذلك:
  - كل ما هو مبني هنا (الجداول، الصلاحيات، الواجهات، هذه المكتبة،
    ودالة الحافة Edge Function) هو تكامل حقيقي وكامل من طرف نظام المازن.
  - نقطة النهاية الفعلية عند إيجار (EJAR_API_BASE_*) تبقى قيمة Placeholder
    يستبدلها فريقكم التقني بالعنوان الرسمي بعد استكمال اتفاقية الشراكة مع
    إيجار والحصول على بيانات الدخول (بالضبط كما هو الحال مع ZATCA في هذا
    النظام — البنية جاهزة 100%، والتفعيل الفعلي يحتاج اعتماد الطرف الثالث).
*/
import { supabase } from './supabase'

export const EJAR_STATUS = {
  not_linked:        { label: 'غير موثّق',            cls: 'chip-muted' },
  pending_landlord:  { label: 'بانتظار موافقة المؤجر', cls: 'chip-warn'  },
  pending_tenant:    { label: 'بانتظار موافقة المستأجر', cls: 'chip-warn' },
  registered:        { label: 'موثّق على إيجار ✓',      cls: 'chip-ok'    },
  rejected:          { label: 'مرفوض',                 cls: 'chip-danger' },
  cancelled:         { label: 'ملغي التوثيق',           cls: 'chip-muted' },
  expired:           { label: 'منتهي الصلاحية',         cls: 'chip-danger' },
}

// الحقول التي يتطلبها التسجيل الرسمي (مطابقة لما توثّقه إيجار: بيانات
// المؤجر والوسيط، بيانات العقار (رقم الصك)، أطراف العقد، مدة القيمة)
export function ejarMissingFields({ company, unit, customer, booking }) {
  const missing = []
  if (!company?.ejar_broker_license && !company?.cr_number) missing.push('رقم رخصة الوساطة أو السجل التجاري (إعدادات المنشأة)')
  if (!unit?.deed_number) missing.push('رقم الصك العقاري للوحدة')
  if (!customer?.id_number) missing.push('رقم هوية المستأجر')
  if (!customer?.phone) missing.push('جوال المستأجر')
  if (!booking?.check_in_date || !booking?.check_out_date) missing.push('تواريخ العقد')
  if (!booking?.total_amount) missing.push('قيمة الإيجار')
  return missing
}

/*
  إرسال الحجز لتوثيقه على إيجار — استدعاء دالة حافة (Edge Function)
  اسمها ejar-submit-contract. الدالة تُعيد جلب البيانات من قاعدة البيانات
  بنفسها بمفتاح service_role (لا نُرسل بيانات مالية من المتصفح مباشرة)،
  فلا نمرر هنا سوى معرّف الحجز.
*/
export async function submitToEjar(bookingId) {
  const { data, error } = await supabase.functions.invoke('ejar-submit-contract', {
    body: { booking_id: bookingId }
  })
  if (error) {
    throw new Error(
      error.message + ' — تأكد من نشر Edge Function باسم ejar-submit-contract ومن ضبط بيانات الاتصال في الإعدادات'
    )
  }
  return data
}

// تحديث حالة عقد سبق إرساله (استعلام دوري اختياري)
export async function syncEjarStatus(bookingId) {
  const { data, error } = await supabase.functions.invoke('ejar-sync-status', {
    body: { booking_id: bookingId }
  })
  if (error) {
    throw new Error(error.message + ' — تأكد من نشر Edge Function باسم ejar-sync-status')
  }
  return data
}

// اختبار بيانات الاتصال المُدخلة في الإعدادات (يستدعي نفس دالة الإرسال
// بوضع تجربة عبر Edge Function اختياري منفصل — إن لم يُنشر بعد نعرض رسالة واضحة)
export async function testEjarConnection() {
  const { data, error } = await supabase.functions.invoke('ejar-test-connection', {})
  if (error) throw new Error(error.message + ' — Edge Function اختبار الاتصال (ejar-test-connection) غير منشورة بعد')
  return data
}
