-- =====================================================================
--  عطل صنفي مُثبَت: كل مهمة مجدولة تستدعي دالة محصّنة تفشل بصمت
-- ---------------------------------------------------------------------
--  الدليل من cron.job_run_details:
--    ci_stability_daily → failed: "forbidden: super admin only"
--    ci_perf_weekly / booking_auto_checkout_daily → لم تعملا قط بعد
--
--  السبب الجذري: الدوال المحصّنة تقبل ثلاثة مسارات —
--    is_super_admin()  أو  ci_is_service_role()  أو  ci_is_system_run()
--  و ci_is_system_run() تقرأ الإعداد almazen.ci_system_run = '1'.
--  مهمة cron تعمل بدور مالك الجدول: ليست سوبر أدمن، ولا دور خدمة،
--  ولا تضبط ذلك الإعداد — فتُرفض في كل مرة.
--
--  الأثر: حزمة الاستقرار اليومية لم تعمل ولا مرة، وكذلك تحسين الأداء
--  الأسبوعي، والإخلاء التلقائي الذي أضفتُه اليوم كان سيفشل بدوره.
--  وهذا بالضبط صنف العطل الذي وقع سابقاً في سلسلة cron→HTTP→مفتاح:
--  مهمة مجدولة تبدو قائمة وهي لا تعمل.
--
--  الإصلاح: ضبط العَلَم داخل أمر المهمة نفسه قبل الاستدعاء. الإعداد
--  محلي للجلسة (set_config بـ is_local=false داخل جلسة cron المنفصلة)
--  فلا يتسرّب إلى جلسات المستخدمين.
-- =====================================================================

do $$
declare j record;
begin
  -- (1) حزمة الاستقرار اليومية
  begin perform cron.unschedule('ci_stability_daily'); exception when others then null; end;
  perform cron.schedule('ci_stability_daily', '30 3 * * *',
    $cron$ select set_config('almazen.ci_system_run','1',false), public.ci_stability_suite(true); $cron$);

  -- (2) تحسين الأداء الأسبوعي
  begin perform cron.unschedule('ci_perf_weekly'); exception when others then null; end;
  perform cron.schedule('ci_perf_weekly', '0 4 * * 0',
    $cron$ select set_config('almazen.ci_system_run','1',false), public.ci_perf_optimize(false, 90); $cron$);

  -- (3) الإخلاء التلقائي اليومي
  begin perform cron.unschedule('booking_auto_checkout_daily'); exception when others then null; end;
  perform cron.schedule('booking_auto_checkout_daily', '30 2 * * *',
    $cron$ select set_config('almazen.ci_system_run','1',false), public.booking_auto_checkout(false, 1); $cron$);
end $$;

-- ---------------------------------------------------------------------
-- فحص دائم: مهمة مجدولة فشلت أو لم تعمل رغم حلول موعدها
-- ---------------------------------------------------------------------
create or replace function public.ci_cron_checks()
returns table (o_suite text, o_name text, o_category text, o_status text,
               o_message text, o_meta jsonb, o_fix text)
language plpgsql stable security definer
set search_path to 'public','cron','pg_temp' as $$
declare v int; nm text;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- (1) لا مهمة فشلت في آخر سبعة أيام
  select count(*), coalesce(string_agg(distinct j.jobname, '، '), '') into v, nm
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
   where d.status <> 'succeeded' and d.start_time > now() - interval '7 days';
  return query select 'cron','لا مهام مجدولة فاشلة','perf',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'كل المهام نجحت خلال أسبوع' else v || ' تشغيلة فاشلة: ' || nm end,
    jsonb_build_object('failed_runs', v), null::text;

  -- (2) كل مهمة يومية عملت خلال 48 ساعة
  select count(*), coalesce(string_agg(j.jobname, '، '), '') into v, nm
    from cron.job j
   where j.active and j.schedule ~ '^[0-9*/, ]+ [0-9]+ \* \* \*$'
     and not exists (select 1 from cron.job_run_details d
                      where d.jobid = j.jobid and d.status = 'succeeded'
                        and d.start_time > now() - interval '48 hours');
  return query select 'cron','كل مهمة يومية عملت خلال 48 ساعة','perf',
    case when v = 0 then 'pass' else 'warn' end,
    case when v = 0 then 'كل المهام اليومية تعمل'
         else v || ' مهمة لم تنجح خلال 48 ساعة: ' || nm end,
    jsonb_build_object('silent_jobs', v), null::text;

  -- (3) كل مهمة تستدعي دالة محصّنة تضبط عَلَم التشغيل النظامي
  select count(*), coalesce(string_agg(j.jobname, '، '), '') into v, nm
    from cron.job j
   where j.active
     and j.command ~* 'public\.(ci_|booking_|voucher_|acct_|perf_|expense_|online_)'
     and j.command !~* 'almazen\.ci_system_run';
  return query select 'cron','مهام الدوال المحصّنة تضبط عَلَم النظام','migration',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'كل المهام مهيّأة للتشغيل النظامي'
         else v || ' مهمة ستُرفض بـ forbidden: ' || nm end,
    jsonb_build_object('unflagged_jobs', v), null::text;
end $$;
revoke all on function public.ci_cron_checks() from public, anon;
grant execute on function public.ci_cron_checks() to authenticated;
