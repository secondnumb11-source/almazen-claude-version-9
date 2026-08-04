-- =====================================================================
--  حزمة اختبارات استقرار النظام — للسوبر أدمن حصراً
-- ---------------------------------------------------------------------
--  لماذا داخل قاعدة البيانات لا في دالة حافة؟
--    مُشغّل الحزمة الحالي (ci-run-suite) يُعرِّف اختباراته مكتوبةً في JS
--    داخل حزمة 7.8MB، فإضافة اختبار تتطلب إعادة نشرها كاملة — خطر على
--    تكامل يعمل. وقد رأينا في F-12 أن سلسلة cron→HTTP→مفتاح تنكسر بصمت
--    وتبقى معطلة أسابيع.
--    هذه الحزمة تعمل داخل القاعدة مباشرة: لا HTTP، لا مفاتيح، لا نشر.
--    وتكتب نتائجها في ci_test_runs / ci_test_results نفسها فتظهر في
--    لوحة السوبر أدمن الحالية بلا أي تعديل على الواجهة.
--
--  التغطية: كل عطل اكتُشف في تدقيق 2026-08-04 يصبح فحصاً دائماً.
--  النطاق: كل المنشآت الحالية والجديدة — الفحوص على مستوى النظام لا شركة.
--  الصلاحية: سوبر أدمن، أو التشغيل النظامي المجدول. لا أحد غيرهما.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) فحوص فردية — كل واحد يُرجع (status, message, meta)
-- ---------------------------------------------------------------------
-- إسقاط أولاً: create or replace لا يستطيع تغيير أعمدة الإخراج
drop function if exists public.ci_stab_checks();
create or replace function public.ci_stab_checks()
returns table (o_suite text, o_name text, o_category text, o_status text, o_message text, o_meta jsonb, o_fix text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare v int; v2 int; v3 numeric; j jsonb;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- ===================== المحاسبة =====================
  -- (1) توازن القيود: مدين = دائن لكل قيد
  select count(*) into v from (
    select je.id from public.journal_entries je
      left join public.journal_entry_lines l on l.entry_id = je.id
     group by je.id
    having coalesce(sum(l.debit),0) <> coalesce(sum(l.credit),0)) t;
  return query select 'accounting','توازن القيود المحاسبية','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then null else v || ' قيد غير متوازن' end,
    jsonb_build_object('unbalanced', v), 'accounting_repair'::text;

  -- (2) قيود بلا سطور
  select count(*) into v from public.journal_entries je
   where not exists (select 1 from public.journal_entry_lines l where l.entry_id = je.id);
  return query select 'accounting','لا توجد قيود فارغة','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then null else v || ' قيد بلا سطور' end,
    jsonb_build_object('empty_entries', v), 'accounting_repair'::text;

  -- (3) سطور يتيمة أو بحساب مجهول
  select count(*) into v from public.journal_entry_lines l
   where not exists (select 1 from public.journal_entries e where e.id = l.entry_id)
      or (l.account_id is not null
          and not exists (select 1 from public.chart_of_accounts a where a.id = l.account_id));
  return query select 'accounting','سلامة روابط سطور القيود','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then null else v || ' سطر يتيم أو بحساب مجهول' end,
    jsonb_build_object('orphan_lines', v), null::text;

  -- (4) اختراق عزل: سطر قيد يخص شركة غير شركة القيد
  select count(*) into v from public.journal_entry_lines l
    join public.journal_entries e on e.id = l.entry_id
    join public.chart_of_accounts a on a.id = l.account_id
   where a.company_id is not null and e.company_id is not null and a.company_id <> e.company_id;
  return query select 'isolation','لا تسرّب محاسبي بين المنشآت','rbac',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then null else v || ' سطر يخترق عزل المنشآت' end,
    jsonb_build_object('cross_company_lines', v), null::text;

  -- (5) معادلة الميزانية
  select round(
      sum(case when a.account_type::text='asset'     then coalesce(l.debit,0)-coalesce(l.credit,0) else 0 end)
    - sum(case when a.account_type::text='liability' then coalesce(l.credit,0)-coalesce(l.debit,0) else 0 end)
    - sum(case when a.account_type::text='equity'    then coalesce(l.credit,0)-coalesce(l.debit,0) else 0 end)
    - sum(case when a.account_type::text='revenue'   then coalesce(l.credit,0)-coalesce(l.debit,0) else 0 end)
    + sum(case when a.account_type::text='expense'   then coalesce(l.debit,0)-coalesce(l.credit,0) else 0 end), 2)
    into v3
    from public.journal_entry_lines l join public.chart_of_accounts a on a.id = l.account_id;
  return query select 'accounting','معادلة الميزانية متوازنة','data',
    case when coalesce(v3,0) = 0 then 'pass' else 'fail' end,
    case when coalesce(v3,0) = 0 then null else 'فارق ' || v3 || ' ر.س' end,
    jsonb_build_object('equation_diff', coalesce(v3,0)), null::text;

  -- (6) مستندات غير مرحّلة (السبب الجذري F-2/F-3)
  select count(*) into v from public.expenses e
   where not exists (select 1 from public.journal_entries je where je.source_id = e.id);
  select count(*) into v2 from public.payments p
   where p.payment_type::text not in ('settlement','refund')
     and not exists (select 1 from public.journal_entries je
                     where je.source_id = p.id
                        or (p.booking_id is not null and je.source_id = p.booking_id));
  return query select 'accounting','كل المستندات مرحّلة للدفاتر','data',
    case when v + v2 = 0 then 'pass' else 'fail' end,
    case when v + v2 = 0 then null else v || ' مصروف و ' || v2 || ' دفعة بلا قيد' end,
    jsonb_build_object('unposted_expenses', v, 'unposted_payments', v2), 'accounting_repair'::text;

  -- (7) ترقيم المستندات فريد داخل كل منشأة
  select (select count(*) from (select company_id, invoice_number from public.invoices
            group by 1,2 having count(*) > 1) x)
       + (select count(*) from (select company_id, voucher_type, voucher_number from public.vouchers
            group by 1,2,3 having count(*) > 1) y) into v;
  return query select 'accounting','ترقيم الفواتير والسندات فريد','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then null else v || ' رقم مكرر داخل نفس المنشأة' end,
    jsonb_build_object('duplicates', v), null::text;

  -- ===================== الأمان والعزل =====================
  -- (8) RLS مفعّل على كل جداول public
  select count(*) into v from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='public' and c.relkind='r' and c.relrowsecurity = false and c.relname not like 'pg_%';
  return query select 'security','RLS مفعّل على كل الجداول','rbac',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then null else v || ' جدول بلا RLS' end,
    jsonb_build_object('tables_without_rls', v), 'enable_rls_all'::text;

  -- (9) عزل التخزين (F-9): لا سياسة مفتوحة على storage.objects
  select count(*) into v from pg_policies
   where schemaname='storage' and tablename='objects'
     and coalesce(qual, with_check, '') = 'true'
     and 'authenticated' = any (string_to_array(trim(both '{}' from roles::text), ','));
  return query select 'security','عزل ملفات التخزين بين المنشآت','rbac',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then null else v || ' سياسة تخزين مفتوحة للجميع' end,
    jsonb_build_object('open_storage_policies', v), 'storage_isolation'::text;

  -- (10) دوال SECURITY DEFINER بلا بوابة صلاحية وممنوحة للمستخدمين (F-15)
  select count(*) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and coalesce(array_to_string(p.proacl, ','), '') like '%authenticated=X%'
     and p.proname like 'ci\_fix\_%'
     and pg_get_functiondef(p.oid) not ilike '%is_super_admin%';
  return query select 'security','دوال الإصلاح محميّة ببوابة صلاحية','rbac',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then null else v || ' دالة إصلاح بلا بوابة' end,
    jsonb_build_object('unguarded_fix_functions', v), null::text;

  -- (11) ملفات التخزين تتبع اصطلاح مجلد المنشأة
  select count(*) into v from storage.objects o
   where o.bucket_id not in ('portal-uploads','almazen-logos')
     and split_part(o.name, '/', 1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-';
  return query select 'security','مسارات التخزين مقيّدة بالمنشأة','rbac',
    case when v = 0 then 'pass' else 'warn' end,
    case when v = 0 then null else v || ' ملف خارج اصطلاح مجلد المنشأة' end,
    jsonb_build_object('unscoped_objects', v), null::text;

  -- ===================== الترشيحات =====================
  -- (12) لا مكافأة مُطبَّقة بلا اعتماد سوبر أدمن (F-6)
  select count(*) into v from public.referrals r
   where r.bonus_applied
     and not exists (select 1 from public.referral_rewards w
                      where w.referral_id = r.id and w.status in ('approved','paid'));
  return query select 'referrals','لا أشهر مجانية بلا اعتماد','rbac',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then null else v || ' إحالة مُنحت بلا موافقة' end,
    jsonb_build_object('unapproved_bonuses', v), null::text;

  -- (13) لا ازدواج مطالبة: إحالة محجوزة بإنجاز ولها طلب فردي أيضاً
  select count(*) into v from public.referrals r
   where r.milestone_consumed
     and exists (select 1 from public.referral_rewards w
                  where w.referral_id = r.id and w.beneficiary='referrer'
                    and w.tier='single' and w.status <> 'rejected');
  return query select 'referrals','لا ازدواج في مطالبات الإحالة','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then null else v || ' إحالة مُطالب بها مرتين' end,
    jsonb_build_object('double_claims', v), null::text;

  -- ===================== الفروع =====================
  -- (14) توريث الفرع (F-8): صفوف بلا فرع رغم أن أصلها موسوم
  select
    (select count(*) from public.bookings b join public.units u on u.id=b.unit_id
      where b.branch_id is null and u.branch_id is not null)
  + (select count(*) from public.payments p join public.bookings b on b.id=p.booking_id
      where p.branch_id is null and b.branch_id is not null)
  + (select count(*) from public.expenses e join public.units u on u.id=e.unit_id
      where e.branch_id is null and u.branch_id is not null)
    into v;
  return query select 'branches','توريث الفرع مكتمل','data',
    case when v = 0 then 'pass' else 'warn' end,
    case when v = 0 then null else v || ' صف بلا فرع رغم توفّره في أصله' end,
    jsonb_build_object('missing_branch_rows', v), 'branch_inheritance'::text;

  -- (15) تريجرات التوريث موجودة على كل الجداول المعنية
  select 7 - count(distinct c.relname) into v
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='public' and t.tgname = 'trg_inherit_branch_id' and not t.tgisinternal;
  return query select 'branches','تريجرات توريث الفرع مثبّتة','schema',
    case when v <= 0 then 'pass' else 'fail' end,
    case when v <= 0 then null else v || ' جدول بلا تريجر توريث' end,
    jsonb_build_object('missing_triggers', greatest(v,0)), null::text;

  -- ===================== الربط العالمي =====================
  -- (16) لا مهام OTA عالقة (F-14)
  select count(*) into v from public.ota_sync_queue
   where status = 'pending' and created_at < now() - interval '2 hours';
  return query select 'integrations','طابور المزامنة الخارجية غير عالق','general',
    case when v = 0 then 'pass' else 'warn' end,
    case when v = 0 then null else v || ' مهمة معلّقة أكثر من ساعتين — الإتاحة قد لا تصل لمنصات الحجز' end,
    jsonb_build_object('stale_pending', v), null::text;

  -- (17) أنواع مهام معرَّفة بلا معالج
  select count(*) into v from public.ota_sync_queue
   where status = 'failed' and coalesce(last_error,'') ilike '%غير مدعوم%';
  return query select 'integrations','كل أنواع مهام المزامنة مدعومة','general',
    case when v = 0 then 'pass' else 'warn' end,
    case when v = 0 then null else v || ' مهمة بنوع بلا معالج في دالة المعالجة' end,
    jsonb_build_object('unsupported_jobs', v), null::text;

  -- ===================== التشغيل الآلي =====================
  -- (18) صحة المهام المجدولة (F-12)
  select count(*) into v from cron.job where active;
  select count(*) into v2 from public.ci_schedules where enabled and last_run_at is null;
  return query select 'ops','المهام المجدولة تعمل','general',
    case when v > 0 and v2 = 0 then 'pass' else 'warn' end,
    case when v = 0 then 'لا مهام cron نشطة'
         when v2 > 0 then v2 || ' جدولة مفعّلة لم تعمل قط'
         else null end,
    jsonb_build_object('active_cron_jobs', v, 'never_ran_schedules', v2), null::text;

  -- (19) استدعاءات cron لا تفشل بالمصادقة
  select count(*) into v from net._http_response
   where created > now() - interval '2 hours' and status_code = 401;
  return query select 'ops','استدعاءات المهام المجدولة مُصادَق عليها','general',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then null else v || ' استدعاء مرفوض (401) خلال ساعتين — مفتاح خاطئ' end,
    jsonb_build_object('unauthorized_calls', v), null::text;

  -- (20) تنبيهات نظام مفتوحة
  select count(*) into v from public.system_alerts where not resolved and severity in ('high','critical');
  return query select 'ops','لا تنبيهات نظام حرجة مفتوحة','general',
    case when v = 0 then 'pass' else 'warn' end,
    case when v = 0 then null else v || ' تنبيه حرج بانتظار المعالجة' end,
    jsonb_build_object('open_critical_alerts', v), null::text;
end $$;

revoke all on function public.ci_stab_checks() from public, anon;
grant execute on function public.ci_stab_checks() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2) المُشغّل: ينفّذ الفحوص، يكتب النتائج، ويُصلح عند الطلب
-- ---------------------------------------------------------------------
create or replace function public.ci_stability_suite(p_apply_fixes boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_run uuid; c record; n_pass int := 0; n_fail int := 0; n_warn int := 0;
  fixes jsonb := '[]'::jsonb; part jsonb; t0 timestamptz := clock_timestamp();
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden: super admin only' using errcode = '42501';
  end if;

  insert into public.ci_test_runs (started_at, triggered_by, trigger_kind, status)
  values (now(), auth.uid(), 'auto', 'running')  -- القيد يسمح بـ manual/schedule/auto/post_deploy فقط
  returning id into v_run;

  for c in select * from public.ci_stab_checks() loop
    insert into public.ci_test_results (run_id, suite, name, category, status, message, meta, fix_check_id)
    values (v_run, c.o_suite, c.o_name, c.o_category, c.o_status, c.o_message, c.o_meta, c.o_fix);
    if    c.o_status = 'pass' then n_pass := n_pass + 1;
    elsif c.o_status = 'fail' then n_fail := n_fail + 1;
    else  n_warn := n_warn + 1;
    end if;
  end loop;

  -- الإصلاح الشامل: على مستوى النظام كله، كل المنشآت الحالية والجديدة
  if p_apply_fixes then
    perform set_config('almazen.ci_system_run', '1', true);

    begin
      select public.accounting_repair_all_companies(false) into part;
      fixes := fixes || jsonb_build_object('accounting', part);
    exception when others then
      fixes := fixes || jsonb_build_object('accounting_error', sqlerrm);
    end;

    begin
      part := '{}'::jsonb;
      declare co record; total int := 0; r jsonb;
      begin
        for co in select id from public.companies loop
          begin
            select public.branch_backfill_unassigned(co.id, false) into r;
            total := total + coalesce((r->>'affected_rows')::int, 0);
          exception when others then null;
          end;
        end loop;
        fixes := fixes || jsonb_build_object('branch_inheritance', total);
      end;
    exception when others then
      fixes := fixes || jsonb_build_object('branch_error', sqlerrm);
    end;

    begin
      perform public.ci_fix_enable_rls_all();
      fixes := fixes || jsonb_build_object('rls', 'applied');
    exception when others then
      fixes := fixes || jsonb_build_object('rls_error', sqlerrm);
    end;

    perform set_config('almazen.ci_system_run', '0', true);
  end if;

  update public.ci_test_runs
     set finished_at = now(),
         status = case when n_fail > 0 then 'failed' when n_warn > 0 then 'warned' else 'passed' end,
         totals = jsonb_build_object('total', n_pass + n_fail + n_warn,
                                     'passed', n_pass, 'failed', n_fail, 'warned', n_warn,
                                     'fixes_applied', case when p_apply_fixes then 1 else 0 end),
         perf = jsonb_build_object('duration_ms',
                  round(extract(epoch from (clock_timestamp() - t0)) * 1000)),
         notes = case when p_apply_fixes then 'حزمة استقرار النظام — مع إصلاح شامل' else 'حزمة استقرار النظام — فحص فقط' end
   where id = v_run;

  return jsonb_build_object(
    'run_id', v_run,
    'passed', n_pass, 'failed', n_fail, 'warned', n_warn,
    'fixes', fixes);
end $$;

revoke all on function public.ci_stability_suite(boolean) from public, anon;
grant execute on function public.ci_stability_suite(boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3) تسجيل الإصلاحات الجديدة في الكتالوج
-- ---------------------------------------------------------------------
insert into public.ci_fix_catalog (check_id, title, description, fix_function, scope, auto_apply)
values
  ('accounting_repair', 'ترحيل المستندات غير المرحّلة',
   'ينشئ قيوداً متوازنة لكل مصروف أو دفعة بلا قيد، لكل المنشآت.',
   'accounting_repair_all_companies', 'system', true),
  ('branch_inheritance', 'وسم البيانات بالفروع',
   'يشتق branch_id من الوحدة أو الحجز للصفوف غير الموسومة، لكل المنشآت.',
   'branch_backfill_unassigned', 'system', true),
  ('storage_isolation', 'عزل ملفات التخزين',
   'يعيد ضبط سياسات storage.objects لتقييد الوصول بمجلد المنشأة.',
   'ci_fix_storage_isolation', 'system', false)
on conflict (check_id) do update
  set title = excluded.title,
      description = excluded.description,
      fix_function = excluded.fix_function,
      scope = excluded.scope;

-- ---------------------------------------------------------------------
-- 4) جدولة يومية داخل القاعدة — بلا HTTP ولا مفاتيح
--    (سلسلة cron→HTTP→مفتاح هي بالضبط ما انكسر في F-12 وبقي أسابيع)
-- ---------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('ci_stability_daily')
   where exists (select 1 from cron.job where jobname = 'ci_stability_daily');
  perform cron.schedule('ci_stability_daily', '30 3 * * *',
    $c$ select public.ci_stability_suite(true); $c$);
end $$;
