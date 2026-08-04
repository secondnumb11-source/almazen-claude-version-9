// ترجمة رسائل Supabase Auth الشائعة إلى العربية مع سبب واضح للمستخدم.
// يستقبل كائن الخطأ من Supabase ويعيد نصاً واحداً مفهوماً.

const MAP = [
  { re: /invalid login credentials/i, msg: 'بيانات الدخول غير صحيحة. تأكد من البريد/اسم المستخدم وكلمة المرور.' },
  { re: /email not confirmed/i, msg: 'لم يتم تأكيد البريد الإلكتروني بعد. افتح الرابط المرسل إلى بريدك أولاً.' },
  { re: /user not found/i, msg: 'لا يوجد حساب مسجّل بهذا البريد/المستخدم.' },
  { re: /user already registered|already been registered|duplicate key.*users/i, msg: 'هذا البريد مسجّل مسبقاً — استخدم "نسيت كلمة السر" إن لم تتذكرها.' },
  { re: /password should be at least/i, msg: 'كلمة المرور قصيرة جداً — الحد الأدنى 6 أحرف.' },
  { re: /weak.?password/i, msg: 'كلمة المرور ضعيفة — استخدم مزيجاً من حروف وأرقام ورموز.' },
  { re: /same.?password/i, msg: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية.' },
  { re: /email rate limit exceeded|over_email_send_rate_limit/i, msg: 'تم تجاوز الحد المسموح لإرسال الرسائل. انتظر دقيقة ثم أعد المحاولة.' },
  { re: /rate limit/i, msg: 'محاولات كثيرة خلال وقت قصير. انتظر قليلاً ثم أعد المحاولة.' },
  { re: /invalid.*(token|otp)|otp_expired|token has expired|expired.*(token|link)/i, msg: 'الرابط أو الرمز منتهي الصلاحية. اطلب رابطاً جديداً.' },
  { re: /invalid_grant/i, msg: 'الرابط غير صالح أو تم استخدامه — اطلب رابطاً جديداً.' },
  { re: /email address .* invalid|invalid email/i, msg: 'صيغة البريد الإلكتروني غير صحيحة.' },
  { re: /signup.?disabled|signups not allowed/i, msg: 'إنشاء الحسابات معطّل في الخادم. راجع مسؤول النظام.' },
  { re: /provider is not enabled/i, msg: 'طريقة تسجيل الدخول هذه غير مفعّلة في Supabase. فعّل Email Provider من لوحة Supabase → Authentication → Providers.' },
  { re: /وظيفة إرسال بريد المصادقة غير منشورة|function.*not.*found|Requested function was not found/i, msg: 'وظيفة إرسال بريد المصادقة غير منشورة. أعد نشر وظائف المشروع ثم جرّب مرة أخرى.' },
  { re: /AuthRetryableFetchError|Error sending recovery email|unexpected_failure|HTTP 500/i, msg: 'تعذر إرسال البريد الإلكتروني من خدمة المصادقة الحالية. يستخدم النظام الآن مسار Resend المباشر مع تحقق من المفتاح والدومين.' },
  { re: /عنوان المرسل غير موثق|EMAIL_FROM|domain.*not.*verified|onboarding@resend\.dev/i, msg: 'عنوان المرسل غير موثق في Resend. يجب ضبط EMAIL_FROM ببريد من دومين موثق في Resend.' },
  { re: /مفتاح Resend|RESEND_API_KEY|api.?key|unauthorized/i, msg: 'مفتاح Resend غير صحيح أو غير مضبوط. حدّث RESEND_API_KEY ثم أعد المحاولة.' },
  { re: /failed to fetch|network|networkerror|typeerror.*fetch/i, msg: 'تعذر الاتصال بالخادم — تحقق من اتصال الإنترنت ومن صحة VITE_SUPABASE_URL.' },
  { re: /jwt|invalid api key|no api key/i, msg: 'مفتاح Supabase غير صحيح — تحقق من VITE_SUPABASE_ANON_KEY في ملف .env.' },
  { re: /project.*paused|project is paused/i, msg: 'مشروع Supabase موقوف مؤقتاً. أعِد تشغيله من لوحة Supabase.' },
  { re: /captcha/i, msg: 'فشل التحقق (Captcha). أعد المحاولة أو أطفئ التحقق مؤقتاً من إعدادات Supabase.' },
  { re: /new row violates row-level security/i, msg: 'سياسات RLS ترفض العملية — نفّذ ملف إصلاح السياسات في SQL Editor.' },
]

export function translateAuthError(err) {
  if (!err) return 'خطأ غير معروف'
  if (typeof err === 'string') return err
  const raw = [err.message, err.error_description, err.msg].filter(Boolean).join(' ') || 'خطأ غير معروف'
  for (const { re, msg } of MAP) if (re.test(raw)) return msg
  // احتفظ بالكود الأصلي لتسهيل الدعم الفني
  const status = err.status ? ` (HTTP ${err.status})` : ''
  return raw + status
}

// يُنتج تفاصيل تشخيصية إضافية اختيارية للعرض تحت رسالة الخطأ الأساسية.
export function authErrorDetails(err) {
  if (!err || typeof err === 'string') return ''
  const parts = []
  if (err.status) parts.push('HTTP ' + err.status)
  if (err.code) parts.push('code: ' + err.code)
  if (err.name && err.name !== 'AuthError') parts.push(err.name)
  return parts.join(' · ')
}
