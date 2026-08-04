-- =====================================================================
--  F-15: إغلاق ثغرة تصعيد الصلاحيات في دوال الإصلاح
-- ---------------------------------------------------------------------
--  المُكتشَف: أربع دوال SECURITY DEFINER بلا أي بوابة صلاحية، وممنوحة
--  لـ authenticated — أي أن أي مستخدم مسجَّل يستطيع استدعاءها:
--    ci_fix_enable_rls_all      → يفعّل RLS على جداول public
--    ci_fix_missing_grants      → يمنح صلاحيات على الجداول
--    ci_fix_bootstrap_profiles  → يُنشئ ملفات مستخدمين
--    ci_fix_super_admin_plans   → يعدّل خطط اشتراك السوبر أدمن
--
--  (الثلاث الأخرى — ci_fix_branch_* — كانت محميّة بـ is_super_admin
--   وعُدّلت في CI_AUTOMATION_REPAIR.sql لتقبل التشغيل النظامي أيضاً.)
--
--  العلاج: إضافة البوابة نفسها — سوبر أدمن أو تشغيل نظامي — بلا أي
--  تغيير في منطق الإصلاح، عبر حقن الشرط في أول جسم الدالة.
-- =====================================================================

do $$
declare
  f record; src text; body_start int; patched text; n int := 0;
  guard constant text :=
    E'\n  IF NOT (public.is_super_admin() OR public.ci_is_system_run()) THEN\n'
    || E'    RAISE EXCEPTION ''forbidden: super admin only'' USING ERRCODE = ''42501'';\n'
    || E'  END IF;\n';
begin
  for f in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname in ('ci_fix_enable_rls_all','ci_fix_missing_grants',
                         'ci_fix_bootstrap_profiles','ci_fix_super_admin_plans')
       and pg_get_functiondef(p.oid) not like '%ci_is_system_run%'
  loop
    src := f.def;
    -- نحقن البوابة بعد أول BEGIN التالية لقسم DECLARE
    body_start := position(E'\nBEGIN' in src);
    if body_start = 0 then body_start := position(E'\nbegin' in src); end if;
    if body_start = 0 then
      raise notice 'تعذّر تحديد بداية الجسم في %', f.proname;
      continue;
    end if;

    patched := substring(src from 1 for body_start + 6)   -- حتى نهاية كلمة BEGIN
            || guard
            || substring(src from body_start + 7);

    execute patched;
    n := n + 1;
  end loop;
  raise notice 'guarded % functions', n;
end $$;

-- سحب المنح المباشر من authenticated: الاستدعاء يمر عبر الغلاف أو السوبر أدمن
-- (البوابة داخل الدالة هي خط الدفاع الأول، وهذا خط ثانٍ.)
revoke execute on function public.ci_fix_enable_rls_all()     from authenticated;
revoke execute on function public.ci_fix_missing_grants()     from authenticated;
revoke execute on function public.ci_fix_bootstrap_profiles() from authenticated;
revoke execute on function public.ci_fix_super_admin_plans()  from authenticated;
