-- ============================================================================
-- ثغرة حرجة: تجاوز acct_guard عبر منطق NULL ثلاثي القيم
-- طُبّقت على المشروع drowmezlcrvowuhqmfef بتاريخ 2026-08-12
-- ============================================================================
--
-- الوصف:
--   كان الحارس:
--       if not (public.is_super_admin() or v = public.get_my_company_id()) then
--           raise exception 'forbidden' ...
--
--   عندما لا تكون للمستدعي منشأة (anon غير مصادَق)، تعيد get_my_company_id()
--   القيمة NULL، فتصبح المقارنة  v = NULL  نتيجتها NULL لا false، ومن ثمّ:
--       not (false or NULL) = not NULL = NULL
--   و IF NULL لا يُنفَّذ إطلاقاً، فيمرّ الحارس صامتاً ويعيد v.
--
-- الأثر المُثبَت بإعادة إنتاج حيّة (قبل الإصلاح):
--   مستخدم غير مصادَق يعرف معرّف الشركة استطاع قراءة، عبر PostgREST RPC:
--     rpt_balance_sheet · trial_balance · rpt_income_statement · doc_registry_list
--   أي الميزانية العمومية وميزان المراجعة وقائمة الدخل وسجل المستندات كاملةً.
--   الدالة يستدعيها 29 موضعاً، وصلاحية EXECUTE عليها ممنوحة لـ PUBLIC.
--
-- الإصلاح:
--   مقارنة صريحة آمنة تجاه NULL. لم تتغيّر أي خاصية أخرى للدالة:
--   STABLE و SECURITY DEFINER و search_path و الصلاحيات كما هي تماماً.
--
-- التحقق بعد التنفيذ:
--   anon                        → forbidden (42501)   ✔
--   محاسب مصادَق على شركته      → البيانات كاملة       ✔
--   المسار الافتراضي (بلا شركة) → يعمل                ✔
--   محاسب يطلب شركة أخرى        → forbidden           ✔
--   المتصفح: 68 استدعاءً ناجحاً وصفر خطأ قبل الإصلاح وبعده.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.acct_guard(p_company uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
declare
  v uuid;
  v_mine uuid;
begin
  v_mine := public.get_my_company_id();
  v := coalesce(p_company, v_mine);
  if v is null then
    raise exception 'no_company' using errcode='42501';
  end if;
  if not public.is_super_admin() and (v_mine is null or v <> v_mine) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return v;
end
$function$;
