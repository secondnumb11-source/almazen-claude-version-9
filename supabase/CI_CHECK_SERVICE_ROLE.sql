-- =====================================================================
--  تمكين المُجدوِل من تنفيذ فحوص النظام
-- ---------------------------------------------------------------------
--  بعد منح service_role حق EXECUTE تغيّر الخطأ من "permission denied"
--  إلى "forbidden" — أي أن البوابة الداخلية is_super_admin() داخل دوال
--  ci_check_* هي المانع. دالة الحافة ci-run-suite تستدعي بمفتاح الخدمة،
--  فلا مستخدم لها ولا صلاحية سوبر أدمن.
--
--  العلاج: تمييز جلسة service_role كما تضبطها PostgREST فعلاً
--  (request.jwt.claims → role) وقبولها في دوال الفحص فقط.
--  ⚠️ الفحوص قراءة تشخيصية بحتة — لا تُعدّل بيانات. أما دوال الإصلاح
--  فتبقى محكومة بـ (سوبر أدمن أو التشغيل النظامي) دون توسيع.
-- =====================================================================

create or replace function public.ci_is_service_role()
returns boolean
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
    ''
  ) = 'service_role'
$$;

grant execute on function public.ci_is_service_role() to authenticated, service_role;

-- حقن القبول في بوابة كل دالة فحص
do $$
declare f record; src text; patched text; n int := 0;
begin
  for f in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname like 'ci\_check\_%'
       and pg_get_functiondef(p.oid) ilike '%is_super_admin%'
       and pg_get_functiondef(p.oid) not like '%ci_is_service_role%'
  loop
    src := f.def;
    patched := replace(src,
      'IF NOT public.is_super_admin() THEN',
      'IF NOT (public.is_super_admin() OR public.ci_is_service_role() OR public.ci_is_system_run()) THEN');
    patched := replace(patched,
      'if not public.is_super_admin() then',
      'if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then');
    patched := replace(patched,
      'IF NOT (public.is_super_admin() OR public.ci_is_system_run()) THEN',
      'IF NOT (public.is_super_admin() OR public.ci_is_service_role() OR public.ci_is_system_run()) THEN');

    if patched <> src then
      execute patched;
      n := n + 1;
    end if;
  end loop;
  raise notice 'patched % ci_check_* functions', n;
end $$;
