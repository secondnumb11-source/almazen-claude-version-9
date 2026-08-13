-- ============================================================================
-- إصلاح حقيقي لحزمة «المهام المجدولة» في مركز الاختبارات
-- طُبِّق على المشروع drowmezlcrvowuhqmfef بتاريخ 2026-08-12
-- ============================================================================
-- كان زر الإصلاح يرمي رسالة «يُصلَح بإعادة جدولة المهمة من ملف
-- CRON_SYSTEM_RUN_FIX.sql» — أي لا إصلاح فعلياً. هذه الدالة تنفّذ التصحيح.
--
-- تعالج سببين بنيويين يجعلان المهمة تبدو قائمة وهي لا تعمل:
--   (1) active = false: المهمة لا تُطلَق أصلاً.
--   (2) استدعاء دالة محصّنة بلا ضبط almazen.ci_system_run: تُرفض بـ
--       forbidden في كل تشغيل — وهو البند (3) في ci_cron_checks.
--
-- ما لا تفعله عمداً: لا تُشغّل أي مهمة فوراً. تشغيل booking_auto_checkout
-- يُغلق حجوزات ويغيّر بيانات مالية — قرار تشغيلي لا إصلاح بنيوي.
-- المهمة اليومية الفعّالة والمهيّأة التي لم تنجح خلال 48 ساعة تُبلَّغ
-- صراحةً كـ «يحتاج تدخّلاً يدوياً» بدل ادعاء إصلاحها.
--
-- إعادة الجدولة تحافظ على الاسم والتوقيت — لا يتغيّر أي سلوك قائم (قاعدة 54).
--
-- تحقّق مُعاد الإنتاج (2026-08-12):
--   PASS 1: أُنشئت مهمتان بعيب مُصطنَع بجدولة «31 فبراير» التي لا تحدث أبداً:
--           zz_probe_noflag (تستدعي ci_stability_suite بلا عَلَم)
--           zz_probe_off    (active = false)
--   PASS 2: بعد التشغيل صار أمر الأولى
--           " select set_config('almazen.ci_system_run','1',false),
--             public.ci_stability_suite(true); "
--           وصارت الثانية active = true.
--   PASS 3: حُذفت المهمتان التجريبيتان (0 بقايا)، و ci_cron_checks: 3/3 pass،
--           وإعادة التشغيل على نظام سليم تعيد «لم يُنفَّذ أي تغيير» (idempotent).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ci_fix_cron_jobs()
RETURNS TABLE(o_action text, o_target text, o_detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron', 'pg_temp'
AS $function$
declare r record; new_cmd text; n int := 0;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- (1) إعادة تفعيل المهام المعطَّلة
  for r in select jobid, jobname from cron.job where not active loop
    perform cron.alter_job(r.jobid, active := true);
    n := n + 1;
    o_action := 'تفعيل مهمة معطَّلة'; o_target := r.jobname;
    o_detail := 'كانت active = false فلا تُطلَق إطلاقاً';
    return next;
  end loop;

  -- (2) حقن عَلَم التشغيل النظامي في المهام التي تستدعي دوالّ محصّنة
  for r in
    select jobid, jobname, command
      from cron.job
     where active
       and command ~* 'public\.(ci_|booking_|voucher_|acct_|perf_|expense_|online_)'
       and command !~* 'almazen\.ci_system_run'
  loop
    new_cmd := ' select set_config(''almazen.ci_system_run'',''1'',false), '
               || regexp_replace(btrim(btrim(r.command), ';'), '^\s*select\s+', '', 'i')
               || '; ';
    perform cron.alter_job(r.jobid, command := new_cmd);
    n := n + 1;
    o_action := 'ضبط عَلَم التشغيل النظامي'; o_target := r.jobname;
    o_detail := 'كانت ستُرفض بـ forbidden في كل تشغيل';
    return next;
  end loop;

  -- (3) ما لا يُصلَح بنيوياً يُبلَّغ صراحةً بدل ادعاء إصلاحه
  for r in
    select j.jobid, j.jobname from cron.job j
     where j.active and j.schedule ~ '^[0-9*/, ]+ [0-9]+ \* \* \*$'
       and not exists (select 1 from cron.job_run_details d
                        where d.jobid = j.jobid and d.status = 'succeeded'
                          and d.start_time > now() - interval '48 hours')
  loop
    n := n + 1;
    o_action := 'يحتاج تدخّلاً يدوياً'; o_target := r.jobname;
    o_detail := 'الجدولة سليمة والمهمة مفعّلة — راجع سبب فشل التنفيذ في cron.job_run_details';
    return next;
  end loop;

  -- FOUND في plpgsql يعكس آخر حلقة FOR وحدها، فيلزم عدّاد صريح.
  if n = 0 then
    o_action := 'لم يُنفَّذ أي تغيير'; o_target := '—';
    o_detail := 'كل المهام مفعّلة ومهيّأة للتشغيل النظامي';
    return next;
  end if;
end $function$;

REVOKE ALL ON FUNCTION public.ci_fix_cron_jobs() FROM anon;
GRANT EXECUTE ON FUNCTION public.ci_fix_cron_jobs() TO authenticated;

-- فهرس المفتاح الأجنبي الناقص على zatca_credentials.branch_id.
-- الفهرس الفريد القائم يبدأ بـ company_id فلا يخدم البحث/الحذف حسب الفرع.
CREATE INDEX IF NOT EXISTS ix_zatca_credentials_branch_id
  ON public.zatca_credentials (branch_id)
  WHERE branch_id IS NOT NULL;
