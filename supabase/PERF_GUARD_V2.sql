-- =====================================================================
--  حارس الأداء — منع تكرار البطء لا علاجه بعد وقوعه
-- ---------------------------------------------------------------------
--  ما أثبته القياس قبل كتابة هذا الملف:
--   • قاعدة البيانات ليست السبب: حجمها 26 ميجابايت، ومتوسط استعلام
--     PostgREST نحو 3 مللي ثانية، وتأخّر النسخ 56 بايت.
--   • السبب في العميل: حزمة كل صفحة تُنزَّل عند أول فتح (Settings وحدها
--     635 كيلوبايت)، والاستعلامات داخل الصفحة متسلسلة لا متوازية.
--  لذلك القياس هنا يقيس ما يراه المستخدم فعلاً — زمن فتح القسم في
--  متصفحه — لا زمن الاستعلام وحده.
-- =====================================================================

-- ميزانيات الأداء: الحد الذي يُعدّ ما فوقه بطئاً
insert into public.ci_perf_budgets (metric, warn_ms, fail_ms) values
  ('page_open',   1200, 2500),
  ('query',        400,  900),
  ('db_mean',      120,  300)
on conflict (metric) do update
  set warn_ms = excluded.warn_ms, fail_ms = excluded.fail_ms, updated_at = now();

-- ---------------------------------------------------------------------
-- 1) تقرير الأداء الفعلي المقاس من متصفحات المستخدمين
-- ---------------------------------------------------------------------
drop function if exists public.perf_page_report(int);
create or replace function public.perf_page_report(p_hours int default 24)
returns table (
  o_scope text, o_name text, o_samples int,
  o_p50 int, o_p95 int, o_max int, o_verdict text
)
language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v_warn int; v_fail int;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select warn_ms, fail_ms into v_warn, v_fail from public.ci_perf_budgets where metric = 'page_open';
  v_warn := coalesce(v_warn, 1200); v_fail := coalesce(v_fail, 2500);

  return query
  select s.scope, s.name, count(*)::int,
         percentile_disc(0.5) within group (order by s.duration_ms)::int,
         percentile_disc(0.95) within group (order by s.duration_ms)::int,
         max(s.duration_ms)::int,
         case
           when percentile_disc(0.95) within group (order by s.duration_ms) >= v_fail then 'بطيء'
           when percentile_disc(0.95) within group (order by s.duration_ms) >= v_warn then 'تحذير'
           else 'سليم' end
    from public.ci_perf_samples s
   where s.created_at > now() - make_interval(hours => greatest(1, p_hours))
   group by s.scope, s.name
   order by percentile_disc(0.95) within group (order by s.duration_ms) desc;
end $$;
grant execute on function public.perf_page_report(int) to authenticated;

-- ---------------------------------------------------------------------
-- 2) فحوص الأداء — تُشغَّل من قائمة الاختبارات، ولكل فحص إصلاح حقيقي
-- ---------------------------------------------------------------------
drop function if exists public.ci_perf_checks();
create or replace function public.ci_perf_checks()
returns table (o_suite text, o_name text, o_category text, o_status text,
               o_message text, o_meta jsonb, o_fix text)
language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v int; v2 int; v3 numeric; v_warn int; v_fail int; nm text;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select warn_ms, fail_ms into v_warn, v_fail from public.ci_perf_budgets where metric='page_open';
  v_warn := coalesce(v_warn,1200); v_fail := coalesce(v_fail,2500);

  -- (1) لا قسم يتجاوز ميزانية زمن الفتح
  select count(*), coalesce(string_agg(distinct nm2, '، '), '') into v, nm from (
    select s.name nm2
      from public.ci_perf_samples s
     where s.scope='page' and s.created_at > now() - interval '24 hours'
     group by s.name
    having percentile_disc(0.95) within group (order by s.duration_ms) >= v_fail) t;
  return query select 'perf','لا قسم يتجاوز ميزانية زمن الفتح','perf',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'كل الأقسام ضمن ' || v_fail || ' مللي ثانية'
         else v || ' قسماً بطيء: ' || nm end,
    jsonb_build_object('slow_pages', v, 'budget_ms', v_fail), 'perf_optimize'::text;

  -- (2) فهارس ناقصة على أعمدة الربط
  select count(*) into v from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname='public' and c.relkind='r' and a.attnum > 0 and not a.attisdropped
     and (a.attname like '%\_id' or a.attname = 'company_id')
     and not exists (select 1 from pg_index i
                      where i.indrelid = c.oid and a.attnum = any (i.indkey));
  return query select 'perf','كل أعمدة الربط مفهرسة','perf',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'لا فهارس ناقصة' else v || ' عموداً بلا فهرس' end,
    jsonb_build_object('missing_indexes', v), 'perf_optimize'::text;

  -- (3) صفوف ميتة تُبطئ المسح
  select count(*) into v from pg_stat_user_tables
   where schemaname='public' and n_dead_tup > 1000
     and n_dead_tup > greatest(n_live_tup, 1) * 0.2;
  return query select 'perf','لا جداول متضخّمة بصفوف ميتة','perf',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'كل الجداول نظيفة' else v || ' جدولاً يحتاج تنظيفاً' end,
    jsonb_build_object('bloated_tables', v), 'perf_optimize'::text;

  -- (4) جداول السجلات المتضخّمة — تُقلَّم دورياً
  -- LIMIT داخل فرع UNION يحتاج أقواس صريحة، وإلا فُسّر على الاستعلام كله
  select count(*) into v from (
    (select 1 from public.audit_logs where created_at < now() - interval '90 days' limit 1)
    union all
    (select 1 from public.ci_perf_samples where created_at < now() - interval '30 days' limit 1)) t;
  return query select 'perf','سجلات النظام مُقلَّمة','perf',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'لا سجلات قديمة متراكمة' else 'توجد سجلات أقدم من مدة الاحتفاظ' end,
    jsonb_build_object('prunable', v), 'perf_optimize'::text;

  -- (5) عدد جداول Realtime — كل جدول منشور يكلّف فكّ سجلّ لكل تعديل
  select count(*) into v from pg_publication_tables where pubname='supabase_realtime';
  return query select 'perf','عدد جداول البث اللحظي معقول','perf',
    case when v <= 8 then 'pass' else 'fail' end,
    v || ' جدولاً منشوراً للبث اللحظي' ||
      case when v > 8 then ' — كل جدول زائد يضاعف كلفة فكّ السجلّ' else '' end,
    jsonb_build_object('realtime_tables', v), null::text;

  -- (6) إحصاءات المخطِّط حديثة، وإلا اختار خططاً سيئة
  select count(*) into v from pg_stat_user_tables
   where schemaname='public' and n_live_tup > 500
     and coalesce(last_analyze, last_autoanalyze, '2000-01-01'::timestamptz) < now() - interval '7 days';
  return query select 'perf','إحصاءات المخطِّط محدّثة','perf',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'كل الجداول محلَّلة حديثاً' else v || ' جدولاً بإحصاءات قديمة' end,
    jsonb_build_object('stale_stats', v), 'perf_optimize'::text;

  -- (7) لا عيّنات أداء على الإطلاق يعني أن القياس نفسه معطّل
  select count(*) into v2 from public.ci_perf_samples
   where created_at > now() - interval '24 hours';
  return query select 'perf','قياس الأداء يعمل','perf',
    case when v2 > 0 then 'pass' else 'fail' end,
    case when v2 > 0 then v2 || ' عيّنة خلال 24 ساعة'
         else 'لا عيّنات — القياس لا يصل من المتصفحات' end,
    jsonb_build_object('samples_24h', v2), null::text;
end $$;
revoke all on function public.ci_perf_checks() from public, anon;
grant execute on function public.ci_perf_checks() to authenticated;

-- ---------------------------------------------------------------------
-- 3) إجراء التسريع — يُطبَّق على مستوى النظام كله
-- ---------------------------------------------------------------------
create or replace function public.perf_optimize_now(p_dry boolean default false)
returns jsonb
language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_log jsonb := '[]'::jsonb; n int := 0; r record; v_sql text;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- (أ) فهارس ناقصة على أعمدة الربط
  for r in
    select n.nspname sch, c.relname tbl, a.attname col
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relkind='r' and a.attnum > 0 and not a.attisdropped
       and (a.attname like '%\_id' or a.attname = 'company_id')
       and not exists (select 1 from pg_index i
                        where i.indrelid = c.oid and a.attnum = any (i.indkey))
  loop
    v_sql := format('create index if not exists %I on %I.%I (%I)',
                    'idx_auto_' || r.tbl || '_' || r.col, r.sch, r.tbl, r.col);
    if not p_dry then execute v_sql; end if;
    n := n + 1;
  end loop;
  v_log := v_log || jsonb_build_object('action','إنشاء الفهارس الناقصة','rows',n);

  -- (ب) تقليم السجلات القديمة
  n := 0;
  if not p_dry then
    delete from public.ci_perf_samples where created_at < now() - interval '30 days';
    get diagnostics n = row_count;
  else
    select count(*) into n from public.ci_perf_samples where created_at < now() - interval '30 days';
  end if;
  v_log := v_log || jsonb_build_object('action','تقليم عيّنات الأداء','rows',n);

  n := 0;
  if not p_dry then
    delete from public.audit_logs where created_at < now() - interval '90 days';
    get diagnostics n = row_count;
  else
    select count(*) into n from public.audit_logs where created_at < now() - interval '90 days';
  end if;
  v_log := v_log || jsonb_build_object('action','تقليم سجل التدقيق','rows',n);

  -- (ج) تحديث إحصاءات المخطِّط
  if not p_dry then analyze; end if;
  v_log := v_log || jsonb_build_object('action','تحديث إحصاءات المخطِّط','rows',1);

  insert into public.system_repair_log (check_id, status, source, category, executed_by, affected_rows, details)
  values ('perf_optimize', 'success', 'super_admin', 'perf', auth.uid(),
          coalesce((select sum((e->>'rows')::int) from jsonb_array_elements(v_log) e), 0),
          jsonb_build_object('dry_run', p_dry, 'log', v_log));

  return jsonb_build_object('ok', true, 'dry_run', p_dry, 'log', v_log);
exception when others then
  return jsonb_build_object('ok', false, 'error', SQLERRM, 'log', v_log);
end $$;
grant execute on function public.perf_optimize_now(boolean) to authenticated;

-- ربط الإصلاح بكتالوج الإصلاحات حتى يعمل زر «إصلاح» في قائمة الاختبارات
insert into public.ci_fix_catalog (check_id, title, description, fix_function)
values ('perf_optimize', 'تسريع النظام',
        'ينشئ الفهارس الناقصة، ويقلّم السجلات القديمة، ويحدّث إحصاءات المخطِّط — على مستوى النظام كله',
        'perf_optimize_all')
on conflict (check_id) do update
  set fix_function = excluded.fix_function,
      title        = excluded.title,
      description  = excluded.description;

create or replace function public.perf_optimize_all()
returns integer language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare j jsonb;
begin
  -- بوابة صريحة: لا تُترك الحماية للدالة المستدعاة وحدها (دفاع بطبقتين)
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  j := public.perf_optimize_now(false);
  return coalesce((select sum((e->>'rows')::int) from jsonb_array_elements(j->'log') e), 0);
end $$;
revoke all on function public.perf_optimize_all() from public, anon, authenticated;

-- الأعمدة المضافة حديثاً في إعدادات المحاسبة تحتاج فهارسها كبقية أعمدة الربط
create index if not exists idx_acct_settings_inv_disc_cust
  on public.accounting_settings(invoice_discount_customer_account_id);
create index if not exists idx_acct_settings_inv_disc_vend
  on public.accounting_settings(invoice_discount_vendor_account_id);
