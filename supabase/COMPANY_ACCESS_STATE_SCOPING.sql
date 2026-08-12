-- ============================================================================
-- إصلاح: تسريب حالة اشتراك أي شركة عبر company_access_state
-- طُبّقت على المشروع drowmezlcrvowuhqmfef بتاريخ 2026-08-12
-- ============================================================================
--
-- الخلل (مُثبَت بإعادة إنتاج حيّة):
--   company_access_state دالة SECURITY DEFINER وصلاحية EXECUTE عليها تصل إلى
--   anon، ولم تكن تتحقق من هوية المستدعي إطلاقاً. فأي شخص غير مصادَق يعرف
--   معرّف الشركة كان يقرأ حالة اشتراكها: الخطة، وهل هي نشطة، والثواني
--   المتبقية، وتاريخا البدء والانتهاء.
--
-- التحقق قبل التنفيذ (شرطا القاعدة 54):
--   • موضع استدعاء واحد فقط في التطبيق (src/AuthContext.jsx) يمرّر دائماً
--     شركة المستخدم نفسه بعد المصادقة.
--   • لا دالة أخرى في قاعدة البيانات تستدعيها، ولا سياسة RLS تشير إليها.
--   • مسار الخطأ في الواجهة يفشل بأمان (active: true)، فلا انقطاع خدمة.
--
-- الإصلاح:
--   حصر النتيجة على شركة المستدعي أو super admin. وُضع الشرط في WHERE لا في
--   IF: هنا NULL يُقصي الصف بشكل صحيح، بخلاف فخّ المنطق الثلاثي الذي أصاب
--   acct_guard (انظر ACCT_GUARD_NULL_BYPASS_FIX.sql).
--   تبقى اللغة sql و STABLE و SECURITY DEFINER و search_path والصلاحيات
--   دون أي تغيير.
--
-- التحقق بعد التنفيذ:
--   anon                       → []            ✔
--   محاسب مصادَق على شركته     → البيانات      ✔
--   محاسب يطلب شركة أخرى       → []            ✔
--   المتصفح: 68 استدعاءً ناجحاً وصفر خطأ، واللوحة تعرض بياناتها كما كانت.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.company_access_state(_company uuid)
 RETURNS TABLE(plan text, active boolean, seconds_left bigint, ends_at timestamp with time zone, starts_at timestamp with time zone, trial_ends_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with c as (
    select
      co.*,
      -- تاريخ انتهاء تجربة فعّال: المخزَّن، وإلا 7 أيام من بداية التجربة/الإنشاء
      coalesce(
        co.trial_ends_at,
        coalesce(co.trial_started_at, co.created_at, now()) + interval '7 days'
      ) as eff_trial_ends_at
    from public.companies co
    where co.id = _company
      -- حصر النطاق: شركة المستدعي نفسه، أو super admin.
      and (public.is_super_admin() or co.id = public.get_my_company_id())
  )
  select
    c.plan,
    case
      when c.activated_by_admin then true
      when c.plan = 'active'
           and (c.subscription_ends_at is null or c.subscription_ends_at > now()) then true
      when coalesce(c.plan, 'trial') not in ('active', 'suspended', 'cancelled')
           and c.eff_trial_ends_at > now() then true
      else false
    end as active,
    greatest(0, extract(epoch from
      coalesce(
        case when c.plan = 'active' then c.subscription_ends_at else null end,
        c.subscription_ends_at,
        c.eff_trial_ends_at
      ) - now())::bigint) as seconds_left,
    coalesce(c.subscription_ends_at, c.eff_trial_ends_at) as ends_at,
    coalesce(c.subscription_start, c.trial_started_at, c.created_at) as starts_at,
    c.eff_trial_ends_at as trial_ends_at
  from c;
$function$;
