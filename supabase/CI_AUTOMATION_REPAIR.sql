-- =====================================================================
--  إصلاح منظومة الفحص والإصلاح التلقائي
-- ---------------------------------------------------------------------
--  الأعطال المُثبتة:
--   F-11  : service_role لا يملك EXECUTE على 14 من 18 دالة ci_*.
--           النتيجة: ci_check_missing_rls و ci_check_branch_link_integrity
--           تفشلان بـ"permission denied" وتُسجَّلان warn/skip، بينما التقرير
--           يعلن "66 ناجح" — أي أن أهم فحصين أمنيين لم يُنفَّذا قط.
--           (مقيس: authenticated=نجح، service_role=رُفض، anon=رُفض)
--   F-11b : دوال ci_fix_* تشترط is_super_admin()، و service_role ليس سوبر
--           أدمن، فالإصلاح التلقائي مستحيل حتى مع منح EXECUTE.
--   F-14  : لا مُجدوِل يستدعي channex-process-queue إطلاقاً، فبقيت 3 مهام
--           push_availability معلّقة أقدمها 11 يوماً => خطر حجز مزدوج.
--
--  مبدأ الإصلاح: لا نُضعِف is_super_admin() إطلاقاً. نضيف بدلاً منها
--  «سياق تشغيل نظامي» transaction-local لا يستطيع ضبطه إلا غلاف
--  ci_system_apply_fixes() الممنوح لـ service_role وحده.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) سياق التشغيل النظامي — بديل آمن عن إضعاف بوابة السوبر أدمن
-- ---------------------------------------------------------------------
create or replace function public.ci_is_system_run()
returns boolean language sql stable
as $$ select coalesce(current_setting('almazen.ci_system_run', true), '') = '1' $$;

grant execute on function public.ci_is_system_run() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2) منح service_role تنفيذ كل دوال ci_* (بلا استثناء)
-- ---------------------------------------------------------------------
do $$
declare f record; n int := 0;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname like 'ci\_%'
  loop
    execute format('grant execute on function %s to service_role', f.sig);
    n := n + 1;
  end loop;
  raise notice 'granted service_role EXECUTE on % ci_* functions', n;
end $$;

-- ---------------------------------------------------------------------
-- 3) تعديل بوابة دوال الإصلاح: سوبر أدمن  أو  تشغيل نظامي
--    يُعاد تعريف كل دالة من تعريفها الحالي مع استبدال شرط البوابة فقط،
--    فلا يتغيّر منطق الإصلاح نفسه إطلاقاً.
-- ---------------------------------------------------------------------
do $$
declare f record; src text; patched text; n int := 0;
begin
  for f in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname like 'ci\_fix\_%'
  loop
    src := f.def;
    patched := replace(src,
      'IF NOT public.is_super_admin() THEN',
      'IF NOT (public.is_super_admin() OR public.ci_is_system_run()) THEN');
    patched := replace(patched,
      'if not public.is_super_admin() then',
      'if not (public.is_super_admin() or public.ci_is_system_run()) then');

    if patched <> src then
      execute patched;
      n := n + 1;
    end if;
  end loop;
  raise notice 'patched % ci_fix_* functions', n;
end $$;

-- ---------------------------------------------------------------------
-- 4) غلاف التشغيل النظامي — ممنوح لـ service_role وحده
--    هو الوحيد القادر على رفع علم ci_system_run، والعلم transaction-local.
-- ---------------------------------------------------------------------
create or replace function public.ci_system_apply_fixes()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare res jsonb;
begin
  perform set_config('almazen.ci_system_run', '1', true);   -- ينتهي بنهاية المعاملة
  select public.ci_apply_all_fixes() into res;
  perform set_config('almazen.ci_system_run', '0', true);
  return res;
end $$;

revoke all on function public.ci_system_apply_fixes() from public, anon, authenticated;
grant execute on function public.ci_system_apply_fixes() to service_role;

-- ---------------------------------------------------------------------
-- 5) توثيق مهام OTA العالقة
--    ملاحظة مهمة: القيد على الجدول يسمح بخمسة أنواع:
--      push_price, push_availability, push_restrictions,
--      pull_reservations, push_unit_status
--    لكن معالج channex-process-queue ينفّذ ثلاثة فقط:
--      push_price, push_availability, pull_reservations
--    => النوعان push_unit_status و push_restrictions مُعرَّفان بلا معالج.
--    لا كود حالي ولا تريجر يُدرجهما (تحقّقنا)، والصفّان الموجودان من نسخة
--    أقدم من الواجهة. الحالات المسموحة لا تشمل 'cancelled' فنكتفي بالتوثيق.
-- ---------------------------------------------------------------------
update public.ota_sync_queue
   set last_error = 'نوع غير منفَّذ في المعالج (push_unit_status) — صف قديم موقوف، لا يُعاد جدولته'
 where status = 'failed'
   and job_type = 'push_unit_status'
   and coalesce(last_error,'') not like 'نوع غير منفَّذ%';

-- ---------------------------------------------------------------------
-- 6) مُجدوِل تفريغ طابور OTA — كل 10 دقائق
--    كان غائباً تماماً: cron.job لم يحوِ سوى ci_schedule_tick و
--    maintenance_resync_hourly، فبقيت مهام الإتاحة معلّقة بلا معالج.
--    يُنشأ عبر دالة حتى نمرّر المفتاح من vault بدل تثبيته في نص الأمر.
-- ---------------------------------------------------------------------
create or replace function public.ci_ensure_ota_cron(p_service_key text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp', 'cron', 'extensions'
as $$
declare v_url text; v_cmd text;
begin
  if not public.is_super_admin() then
    raise exception 'forbidden: super admin only' using errcode = '42501';
  end if;

  v_url := 'https://drowmezlcrvowuhqmfef.supabase.co/functions/v1/channex-process-queue';
  v_cmd := format($f$
    select net.http_post(
      url := %L,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || %L),
      body := '{}'::jsonb
    );
  $f$, v_url, p_service_key);

  perform cron.unschedule('ota_process_queue')
   where exists (select 1 from cron.job where jobname = 'ota_process_queue');

  perform cron.schedule('ota_process_queue', '*/10 * * * *', v_cmd);
  return 'scheduled';
end $$;

revoke all on function public.ci_ensure_ota_cron(text) from public, anon;
grant execute on function public.ci_ensure_ota_cron(text) to authenticated, service_role;
