-- ============================================================================
-- رمز QR يفتح المستند فعلاً — دالة جلب رمز التحقق
-- طُبِّقت على المشروع drowmezlcrvowuhqmfef بتاريخ 2026-08-18
-- ============================================================================
-- الحالة المقيسة قبل التعديل:
--   • doc_verify(p_code, p_hash) موجودة أصلاً ومنفَّذة لـ anon، وتتحقق من
--     الرمز والإلغاء وبصمة المحتوى، وتعيد حقولاً آمنة بلا بيانات شخصية.
--   • document_registry يحمل verify_code و content_hash و revoked_at.
--   • لكن لا مسار عام يعرض النتيجة، والواجهة لا تملك الرمز إطلاقاً —
--     الخطّافات تعيد المسلسل وحده. فكانت رموز QR على المطبوعات تُرمّز
--     JSON خاماً: من يمسحها بجواله يرى نصاً لا مستنداً، وبعضها كان يكشف
--     اسم المستأجر ورقم هويته في نص الرمز.
--
-- الأمان: الدالة للمصادَقين فقط ومقيَّدة بمنشأة المستدعي. لا تُمنح لـ anon —
-- الرمز نفسه هو السرّ الذي يفتح صفحة التحقق العامة، فمن يسرد الرموز يسرد
-- المستندات. والمسلسل فريد لكل منشأة لا عالمياً (3 مسلسلات مكرّرة عبر
-- منشآت مختلفة فعلاً)، فالتقييد بالمنشأة شرط صحّة لا احتياط.
--
-- تحقّق بعد التنفيذ:
--   • حمولة الزائر: kind · title · total · valid · issuer · serial ·
--     doc_date · issued_at — وصفر حقل شخصي (فحص مفاتيح آلي).
--   • مستند ملغى ⇒ valid=false «المستند ملغى» (داخل معاملة أُلغيت).
--   • بصمة خاطئة ⇒ valid=false «يُشتبه في تحريفه».
--   • منح anon على doc_verify_code = 0.
--   • الصفحة حيّاً: /doc/<code> تعرض البطاقة الخضراء وحقولها كاملة،
--     ورمز غير موجود يعرض البطاقة الحمراء. صفر خطأ صفحة.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.doc_verify_code(p_serial text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  select r.verify_code
    from public.document_registry r
   where r.serial = p_serial
     and r.revoked_at is null
     and (r.company_id = public.get_my_company_id() or public.is_super_admin())
   limit 1
$function$;

REVOKE ALL ON FUNCTION public.doc_verify_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doc_verify_code(text) TO authenticated;
