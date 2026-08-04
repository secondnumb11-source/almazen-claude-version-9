-- =====================================================================
--  أدوات الأداء — للسوبر أدمن حصراً، وأثرها على النظام كله
-- ---------------------------------------------------------------------
--  فحص يقيس أسباب البطء الفعلية، وإصلاح يُطبَّق على كل المنشآت الحالية
--  والجديدة بلا أي إجراء من المستخدمين.
--
--  يعمل داخل قاعدة البيانات (لا HTTP ولا مفاتيح) لنفس سبب حزمة الاستقرار.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) الفحص
-- ---------------------------------------------------------------------
create or replace function public.ci_perf_scan()
returns table (o_kind text, o_target text, o_metric text, o_detail text, o_severity text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden: super admin only' using errcode = '42501';
  end if;

  -- (أ) فهارس ناقصة على أعمدة الربط — أهم سبب لبطء الاستعلامات
  return query
  select 'missing_index'::text,
         (c.relname || '.' || a.attname)::text,
         coalesce(s.n_live_tup, 0)::text || ' صف',
         ('مسح تسلسلي: ' || coalesce(s.seq_scan, 0)::text)::text,
         (case when coalesce(s.n_live_tup,0) > 500 then 'high'
               when coalesce(s.n_live_tup,0) > 50  then 'medium'
               else 'low' end)::text
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid
  left join pg_stat_user_tables s on s.relid = c.oid
  where ns.nspname = 'public' and c.relkind = 'r'
    and a.attname in ('company_id','branch_id','booking_id','unit_id','customer_id',
                      'entry_id','source_id','user_id','account_id','payment_id','expense_id')
    and a.attnum > 0 and not a.attisdropped
    and not exists (select 1 from pg_index i
                     where i.indrelid = c.oid and i.indkey[0] = a.attnum);

  -- (ب) جداول تُمسح تسلسلياً كثيراً
  return query
  select 'seq_scan'::text, relname::text,
         seq_scan::text || ' مسح',
         ('فهرسي: ' || coalesce(idx_scan,0)::text || ' — صفوف: ' || n_live_tup::text)::text,
         (case when seq_scan > 5000 then 'high' when seq_scan > 500 then 'medium' else 'low' end)::text
  from pg_stat_user_tables
  where schemaname = 'public' and seq_scan > 200 and n_live_tup > 20;

  -- (ج) تضخّم: صفوف ميتة تبطئ المسح
  return query
  select 'bloat'::text, relname::text,
         n_dead_tup::text || ' صف ميت',
         ('حيّ: ' || n_live_tup::text)::text,
         (case when n_dead_tup > 1000 then 'high' when n_dead_tup > 100 then 'medium' else 'low' end)::text
  from pg_stat_user_tables
  where schemaname = 'public' and n_dead_tup > 50;

  -- (د) جداول السجلات المتضخّمة — مؤشر حلقة طلبات أو تراكم
  return query
  select 'log_growth'::text, t::text, cnt::text || ' صف',
         'جدول سجلات — التقليم يُسرّع الاستعلامات'::text,
         (case when cnt > 20000 then 'high' when cnt > 5000 then 'medium' else 'low' end)::text
  from (
    select 'notifications' as t, count(*) as cnt from public.notifications
    union all select 'audit_logs', count(*) from public.audit_logs
    union all select 'system_repair_log', count(*) from public.system_repair_log
    union all select 'tenant_isolation_runs', count(*) from public.tenant_isolation_runs
    union all select 'ci_perf_samples', count(*) from public.ci_perf_samples
    union all select 'ota_webhook_logs', count(*) from public.ota_webhook_logs
  ) g
  where cnt > 1000;

  -- (هـ) اشتراكات Realtime: كل جدول منشور يُقيَّم على كل تغيير
  return query
  select 'realtime_publication'::text, tablename::text, '1 جدول منشور'::text,
         'يُقيَّم على كل تغيير في سجل WAL'::text, 'low'::text
  from pg_publication_tables where pubname = 'supabase_realtime';
end $$;

revoke all on function public.ci_perf_scan() from public, anon;
grant execute on function public.ci_perf_scan() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2) الإصلاح — على مستوى النظام كله
-- ---------------------------------------------------------------------
create or replace function public.ci_perf_optimize(
  p_dry_run    boolean default true,
  p_prune_days integer default 90
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r record; idx_made int := 0; pruned int := 0; n int;
  made jsonb := '[]'::jsonb; ix_name text;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden: super admin only' using errcode = '42501';
  end if;

  -- (أ) إنشاء الفهارس الناقصة على أعمدة الربط
  for r in
    select c.relname as tbl, a.attname as col
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where ns.nspname = 'public' and c.relkind = 'r'
      and a.attname in ('company_id','branch_id','booking_id','unit_id','customer_id',
                        'entry_id','source_id','user_id','account_id','payment_id','expense_id')
      and a.attnum > 0 and not a.attisdropped
      and not exists (select 1 from pg_index i
                       where i.indrelid = c.oid and i.indkey[0] = a.attnum)
  loop
    ix_name := 'ix_' || r.tbl || '_' || r.col;
    if length(ix_name) > 63 then ix_name := left(ix_name, 63); end if;
    idx_made := idx_made + 1;
    made := made || jsonb_build_object('index', ix_name, 'on', r.tbl || '(' || r.col || ')');
    continue when p_dry_run;
    begin
      execute format('create index if not exists %I on public.%I (%I)', ix_name, r.tbl, r.col);
    exception when others then
      made := made || jsonb_build_object('failed', ix_name, 'err', left(sqlerrm, 60));
      idx_made := idx_made - 1;
    end;
  end loop;

  -- (ب) تقليم سجلات قديمة (الإشعارات المقروءة وسجلات التشغيل)
  if not p_dry_run then
    delete from public.notifications
     where created_at < now() - make_interval(days => p_prune_days) and read_at is not null;
    get diagnostics n = row_count; pruned := pruned + n;

    delete from public.tenant_isolation_runs
     where created_at < now() - make_interval(days => p_prune_days);
    get diagnostics n = row_count; pruned := pruned + n;

    delete from public.ci_perf_samples
     where created_at < now() - make_interval(days => p_prune_days);
    get diagnostics n = row_count; pruned := pruned + n;
  else
    select (select count(*) from public.notifications
             where created_at < now() - make_interval(days => p_prune_days) and read_at is not null)
         + (select count(*) from public.tenant_isolation_runs
             where created_at < now() - make_interval(days => p_prune_days))
         + (select count(*) from public.ci_perf_samples
             where created_at < now() - make_interval(days => p_prune_days))
      into pruned;
  end if;

  -- (ج) تحديث إحصاءات المخطِّط
  if not p_dry_run then
    for r in select relname from pg_stat_user_tables where schemaname='public' and n_live_tup > 0 loop
      begin execute format('analyze public.%I', r.relname); exception when others then null; end;
    end loop;
  end if;

  if not p_dry_run then
    begin
      perform public.acct_log_repair(null, 'perf_optimize', 'success', idx_made + pruned,
        jsonb_build_object('indexes', idx_made, 'pruned_rows', pruned), 'manual');
    exception when others then null; end;
  end if;

  return jsonb_build_object(
    'status', case when p_dry_run then 'dry_run' else 'success' end,
    'indexes_created', idx_made,
    'rows_pruned', pruned,
    'details', made);
end $$;

revoke all on function public.ci_perf_optimize(boolean, integer) from public, anon;
grant execute on function public.ci_perf_optimize(boolean, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3) تسجيل في كتالوج الإصلاح + جدولة أسبوعية
-- ---------------------------------------------------------------------
insert into public.ci_fix_catalog (check_id, title, description, fix_function, scope, auto_apply)
values ('perf_optimize', 'تسريع النظام',
        'ينشئ الفهارس الناقصة على أعمدة الربط، ويقلّم السجلات القديمة، ويحدّث إحصاءات المخطِّط — لكل المنشآت.',
        'ci_perf_optimize', 'system', false)
on conflict (check_id) do update
  set title = excluded.title, description = excluded.description,
      fix_function = excluded.fix_function, scope = excluded.scope;

do $$
begin
  perform cron.unschedule('ci_perf_weekly')
   where exists (select 1 from cron.job where jobname = 'ci_perf_weekly');
  perform cron.schedule('ci_perf_weekly', '0 4 * * 0',
    $c$ select public.ci_perf_optimize(false, 90); $c$);
end $$;
