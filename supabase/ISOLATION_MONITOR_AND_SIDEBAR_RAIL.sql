-- =====================================================================
--  المازن — مراقبة عزل الحسابات (Multi-Tenant Isolation Monitor)
--  + إعدادات مسطرة الحركة الطولية للوحة الجانبية (Sidebar Rail)
--  نفّذ هذا الملف مرة واحدة في SQL Editor داخل مشروع Supabase.
--  الملف Idempotent — يمكن إعادة تنفيذه بأمان.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) إعدادات المراقب (سطر واحد عام) — يتحكم بها Super Admin فقط
-- ---------------------------------------------------------------------
create table if not exists public.isolation_monitor_settings (
  id                boolean primary key default true check (id),
  enabled           boolean not null default true,
  interval_minutes  integer not null default 30 check (interval_minutes between 1 and 1440),
  auto_fix          boolean not null default true,
  run_on_login      boolean not null default true,
  keep_runs         integer not null default 200 check (keep_runs between 10 and 5000),
  updated_by        uuid,
  updated_at        timestamptz not null default now()
);

grant select on public.isolation_monitor_settings to authenticated;
grant all    on public.isolation_monitor_settings to service_role;

alter table public.isolation_monitor_settings enable row level security;

drop policy if exists "monitor settings readable" on public.isolation_monitor_settings;
create policy "monitor settings readable"
  on public.isolation_monitor_settings for select to authenticated using (true);

drop policy if exists "monitor settings super admin write" on public.isolation_monitor_settings;
create policy "monitor settings super admin write"
  on public.isolation_monitor_settings for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

grant insert, update, delete on public.isolation_monitor_settings to authenticated;

insert into public.isolation_monitor_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2) سجل نتائج الفحوصات التلقائية
-- ---------------------------------------------------------------------
create table if not exists public.tenant_isolation_runs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid,
  user_id      uuid default auth.uid(),
  trigger      text not null default 'auto',   -- auto | manual | login
  passed       integer not null default 0,
  warned       integer not null default 0,
  failed       integer not null default 0,
  duration_ms  integer,
  results      jsonb not null default '[]'::jsonb,
  auto_fixed   jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists tenant_isolation_runs_created_idx
  on public.tenant_isolation_runs (created_at desc);
create index if not exists tenant_isolation_runs_company_idx
  on public.tenant_isolation_runs (company_id, created_at desc);

grant select, insert on public.tenant_isolation_runs to authenticated;
grant all on public.tenant_isolation_runs to service_role;

alter table public.tenant_isolation_runs enable row level security;

drop policy if exists "isolation runs insert own" on public.tenant_isolation_runs;
create policy "isolation runs insert own"
  on public.tenant_isolation_runs for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "isolation runs read own or super" on public.tenant_isolation_runs;
create policy "isolation runs read own or super"
  on public.tenant_isolation_runs for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "isolation runs super admin manage" on public.tenant_isolation_runs;
create policy "isolation runs super admin manage"
  on public.tenant_isolation_runs for delete to authenticated
  using (public.is_super_admin());

grant delete on public.tenant_isolation_runs to authenticated;

-- ---------------------------------------------------------------------
-- 3) كشف انحراف المخطط: أي جدول حسّاس فقد عمود company_id أو RLS
--    (SECURITY DEFINER — يقرأ الميتاداتا فقط، لا يُسرّب بيانات)
-- ---------------------------------------------------------------------
create or replace function public.isolation_schema_audit()
returns table (
  table_name        text,
  has_company_id    boolean,
  rls_enabled       boolean,
  policy_count      integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.relname::text,
    exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname in ('company_id','entry_id','branch_id')
        and a.attnum > 0 and not a.attisdropped
    ),
    c.relrowsecurity,
    (select count(*)::int from pg_policy p where p.polrelid = c.oid)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname = any (array[
      'bookings','units','customers','payments','expenses','maintenance_requests',
      'journal_entries','journal_entry_lines','chart_of_accounts','invoices',
      'audit_logs','notifications','branches','profiles','user_branches'
    ]);
$$;

revoke all on function public.isolation_schema_audit() from public;
grant execute on function public.isolation_schema_audit() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4) التصحيح التلقائي: إعادة تفعيل RLS على أي جدول حسّاس تم تعطيله
--    يعيد قائمة الجداول التي تم إصلاحها. Super Admin فقط.
-- ---------------------------------------------------------------------
create or replace function public.isolation_auto_fix()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  fixed jsonb := '[]'::jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'forbidden';
  end if;

  for r in
    select c.relname, c.oid
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity = false
      and c.relname = any (array[
        'bookings','units','customers','payments','expenses','maintenance_requests',
        'journal_entries','journal_entry_lines','chart_of_accounts','invoices',
        'audit_logs','notifications','branches','profiles','user_branches'
      ])
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    execute format('alter table public.%I force row level security', r.relname);
    fixed := fixed || jsonb_build_object('table', r.relname, 'action', 'enable_rls');
  end loop;

  return fixed;
end;
$$;

revoke all on function public.isolation_auto_fix() from public;
grant execute on function public.isolation_auto_fix() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5) إعدادات واجهة المستخدم — مسطرة الحركة الطولية للوحة الجانبية
-- ---------------------------------------------------------------------
create table if not exists public.user_ui_settings (
  user_id       uuid primary key default auth.uid(),
  sidebar_width integer,
  sidebar_rail  jsonb not null default jsonb_build_object(
    'accent',    '#C9A84C',
    'accent2',   '#0B1E3F',
    'thickness', 4,
    'height',    72,
    'glow',      55,
    'radius',    999,
    'style',     'gem'
  ),
  updated_at    timestamptz not null default now()
);

grant select, insert, update on public.user_ui_settings to authenticated;
grant all on public.user_ui_settings to service_role;

alter table public.user_ui_settings enable row level security;

drop policy if exists "ui settings own" on public.user_ui_settings;
create policy "ui settings own"
  on public.user_ui_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- تحديث الطابع الزمني تلقائياً
create or replace function public.touch_user_ui_settings()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists trg_touch_user_ui_settings on public.user_ui_settings;
create trigger trg_touch_user_ui_settings
  before update on public.user_ui_settings
  for each row execute function public.touch_user_ui_settings();
