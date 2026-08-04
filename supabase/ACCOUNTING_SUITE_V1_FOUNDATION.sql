-- =====================================================================
--  الدفعة 1 — أساس الدورة المحاسبية الكاملة
-- ---------------------------------------------------------------------
--  يضيف: الفترات المالية، مراكز التكلفة، رموز الضريبة، كتالوج الخدمات،
--         الإيرادات/النفقات المؤجلة، إعدادات المحاسبة، وربط أودو.
--         ويوسّع القيود لتدعم دورة (مسودة ← ترحيل) والقيد العكسي.
--
--  مبدأ عدم الكسر: كل عمود جديد له قيمة افتراضية تُبقي السلوك الحالي
--  كما هو بالضبط. القيود التي تُنشئها المُشغّلات التلقائية تبقى
--  status='posted' كما كانت، والقيود اليدوية من الواجهة تبدأ 'draft'.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) أنواع مُعدّة
-- ---------------------------------------------------------------------
do $$ begin
  create type public.je_status as enum ('draft','posted','void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.cost_center_kind as enum ('department','branch','unit','project','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tax_kind as enum ('sales','purchase','both');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.deferral_kind as enum ('revenue','expense');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 1) الفترات المالية — بلا فترة مفتوحة لا يُرحَّل قيد
-- ---------------------------------------------------------------------
create table if not exists public.fiscal_periods (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  start_date   date not null,
  end_date     date not null,
  is_closed    boolean not null default false,
  closed_at    timestamptz,
  closed_by    uuid,
  created_at   timestamptz not null default now(),
  constraint fiscal_periods_range check (end_date >= start_date),
  constraint fiscal_periods_uniq unique (company_id, start_date, end_date)
);
create index if not exists idx_fiscal_periods_company on public.fiscal_periods(company_id, start_date desc);

-- ---------------------------------------------------------------------
-- 2) مراكز التكلفة — شجرة أصل/فروع، ويمكن ربطها بفرع أو وحدة
-- ---------------------------------------------------------------------
create table if not exists public.cost_centers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  code        text not null,
  name        text not null,
  kind        public.cost_center_kind not null default 'department',
  parent_id   uuid references public.cost_centers(id) on delete set null,
  branch_id   uuid references public.branches(id) on delete set null,
  unit_id     uuid references public.units(id) on delete set null,
  is_group    boolean not null default false,
  is_active   boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  constraint cost_centers_code_uniq unique (company_id, code)
);
create index if not exists idx_cost_centers_company on public.cost_centers(company_id, code);
create index if not exists idx_cost_centers_parent  on public.cost_centers(parent_id);

-- ---------------------------------------------------------------------
-- 3) رموز الضريبة — النسبة وحساب الضريبة المرتبط
-- ---------------------------------------------------------------------
create table if not exists public.tax_codes (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  code        text not null,
  name        text not null,
  rate        numeric(6,3) not null default 15,
  kind        public.tax_kind not null default 'both',
  account_id  uuid references public.chart_of_accounts(id) on delete set null,
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint tax_codes_code_uniq unique (company_id, code),
  constraint tax_codes_rate_range check (rate >= 0 and rate <= 100)
);
create index if not exists idx_tax_codes_company on public.tax_codes(company_id);

-- ---------------------------------------------------------------------
-- 4) كتالوج الخدمات
-- ---------------------------------------------------------------------
create table if not exists public.services_catalog (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  code               text not null,
  name               text not null,
  category           text,
  description        text,
  unit_price         numeric(14,2) not null default 0,
  cost_price         numeric(14,2) not null default 0,
  uom                text default 'خدمة',
  tax_code_id        uuid references public.tax_codes(id) on delete set null,
  income_account_id  uuid references public.chart_of_accounts(id) on delete set null,
  expense_account_id uuid references public.chart_of_accounts(id) on delete set null,
  cost_center_id     uuid references public.cost_centers(id) on delete set null,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint services_code_uniq unique (company_id, code)
);
create index if not exists idx_services_company on public.services_catalog(company_id, is_active);

-- ---------------------------------------------------------------------
-- 5) توسعة القيود: دورة الحفظ ثم الترحيل + القيد العكسي
-- ---------------------------------------------------------------------
alter table public.journal_entries
  add column if not exists status            public.je_status not null default 'posted',
  add column if not exists posted_at         timestamptz,
  add column if not exists posted_by         uuid,
  add column if not exists reversal_of_id    uuid references public.journal_entries(id) on delete set null,
  add column if not exists reversed_by_id    uuid references public.journal_entries(id) on delete set null,
  add column if not exists fiscal_period_id  uuid references public.fiscal_periods(id) on delete set null,
  add column if not exists reference         text,
  add column if not exists notes             text,
  add column if not exists updated_at        timestamptz not null default now();

-- القيود القديمة كلها مرحّلة فعلياً — نثبّت تاريخ الترحيل حتى تظهر التقارير صحيحة
update public.journal_entries
   set posted_at = coalesce(posted_at, created_at)
 where status = 'posted' and posted_at is null;

create index if not exists idx_je_status on public.journal_entries(company_id, status, entry_date desc);

alter table public.journal_entry_lines
  add column if not exists cost_center_id uuid references public.cost_centers(id) on delete set null,
  add column if not exists tax_code_id    uuid references public.tax_codes(id) on delete set null,
  add column if not exists tax_amount     numeric(14,2) not null default 0,
  add column if not exists party_type     text,
  add column if not exists party_name     text,
  add column if not exists service_id     uuid references public.services_catalog(id) on delete set null;

create index if not exists idx_jel_cost_center on public.journal_entry_lines(cost_center_id);
create index if not exists idx_jel_account     on public.journal_entry_lines(account_id);
create index if not exists idx_jel_entry       on public.journal_entry_lines(entry_id);

-- ---------------------------------------------------------------------
-- 6) الإيرادات والنفقات المؤجلة
-- ---------------------------------------------------------------------
create table if not exists public.deferred_schedules (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete cascade,
  kind                    public.deferral_kind not null,
  name                    text not null,
  source_type             text,
  source_id               uuid,
  deferred_account_id     uuid references public.chart_of_accounts(id) on delete set null,
  recognition_account_id  uuid references public.chart_of_accounts(id) on delete set null,
  cost_center_id          uuid references public.cost_centers(id) on delete set null,
  total_amount            numeric(14,2) not null,
  periodicity             text not null default 'monthly',   -- monthly | quarterly | yearly
  computation             text not null default 'by_months', -- by_months | by_days
  start_date              date not null,
  end_date                date not null,
  status                  text not null default 'running',   -- running | done | cancelled
  branch_id               uuid references public.branches(id) on delete set null,
  created_by              uuid,
  created_at              timestamptz not null default now(),
  constraint deferred_range check (end_date >= start_date),
  constraint deferred_periodicity check (periodicity in ('monthly','quarterly','yearly')),
  constraint deferred_computation check (computation in ('by_months','by_days')),
  constraint deferred_status check (status in ('running','done','cancelled'))
);
create index if not exists idx_deferred_company on public.deferred_schedules(company_id, status);

create table if not exists public.deferred_schedule_lines (
  id            uuid primary key default gen_random_uuid(),
  schedule_id   uuid not null references public.deferred_schedules(id) on delete cascade,
  period_date   date not null,
  amount        numeric(14,2) not null,
  recognized    boolean not null default false,
  entry_id      uuid references public.journal_entries(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_deferred_lines on public.deferred_schedule_lines(schedule_id, period_date);

-- ---------------------------------------------------------------------
-- 7) إعدادات المحاسبة — الحسابات الافتراضية والفترة المالية
-- ---------------------------------------------------------------------
create table if not exists public.accounting_settings (
  company_id                uuid primary key references public.companies(id) on delete cascade,
  fiscal_year_start_month   int not null default 1,
  fiscal_year_start_day     int not null default 1,
  vat_enabled               boolean not null default true,
  default_vat_rate          numeric(6,3) not null default 15,
  vat_output_account_id     uuid references public.chart_of_accounts(id) on delete set null,
  vat_input_account_id      uuid references public.chart_of_accounts(id) on delete set null,
  suspense_bank_account_id  uuid references public.chart_of_accounts(id) on delete set null,
  internal_transfer_account_id uuid references public.chart_of_accounts(id) on delete set null,
  deferred_revenue_account_id  uuid references public.chart_of_accounts(id) on delete set null,
  deferred_expense_account_id  uuid references public.chart_of_accounts(id) on delete set null,
  early_discount_gain_account_id uuid references public.chart_of_accounts(id) on delete set null,
  early_discount_loss_account_id uuid references public.chart_of_accounts(id) on delete set null,
  withholding_tax_account_id   uuid references public.chart_of_accounts(id) on delete set null,
  product_income_account_id    uuid references public.chart_of_accounts(id) on delete set null,
  product_expense_account_id   uuid references public.chart_of_accounts(id) on delete set null,
  deferred_periodicity      text not null default 'monthly',
  deferred_computation      text not null default 'by_months',
  lock_date                 date,
  updated_at                timestamptz not null default now(),
  constraint acct_settings_month check (fiscal_year_start_month between 1 and 12),
  constraint acct_settings_day   check (fiscal_year_start_day between 1 and 28)
);

-- ---------------------------------------------------------------------
-- 8) ربط أودو — لكل مستخدم على حدة، والمفتاح لا يُقرأ إلا لصاحبه
-- ---------------------------------------------------------------------
create table if not exists public.odoo_connections (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  company_id   uuid references public.companies(id) on delete cascade,
  base_url     text not null,
  db_name      text not null,
  login        text not null,
  api_key      text not null,
  is_active    boolean not null default true,
  last_status  text,
  last_checked_at timestamptz,
  last_sync_at timestamptz,
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint odoo_conn_user_uniq unique (user_id)
);

-- ---------------------------------------------------------------------
-- 9) إعدادات لوحة البيانات الجانبية لكل مستخدم
-- ---------------------------------------------------------------------
alter table public.user_ui_settings
  add column if not exists sidebar jsonb;

-- ---------------------------------------------------------------------
-- 10) RLS — نفس نمط بقية الجداول: عزل بالمنشأة + سوبر أدمن
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'fiscal_periods','cost_centers','tax_codes','services_catalog',
    'deferred_schedules','accounting_settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_sel', t);
    execute format('drop policy if exists %I on public.%I', t||'_ins', t);
    execute format('drop policy if exists %I on public.%I', t||'_upd', t);
    execute format('drop policy if exists %I on public.%I', t||'_del', t);
    execute format($f$create policy %I on public.%I for select to authenticated
                     using (company_id = public.get_my_company_id() or public.is_super_admin())$f$, t||'_sel', t);
    execute format($f$create policy %I on public.%I for insert to authenticated
                     with check (company_id = public.get_my_company_id() or public.is_super_admin())$f$, t||'_ins', t);
    execute format($f$create policy %I on public.%I for update to authenticated
                     using (company_id = public.get_my_company_id() or public.is_super_admin())
                     with check (company_id = public.get_my_company_id() or public.is_super_admin())$f$, t||'_upd', t);
    execute format($f$create policy %I on public.%I for delete to authenticated
                     using (company_id = public.get_my_company_id() or public.is_super_admin())$f$, t||'_del', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- سطور الجدولة المؤجلة تتبع جدولها الأب
alter table public.deferred_schedule_lines enable row level security;
drop policy if exists deferred_lines_all on public.deferred_schedule_lines;
create policy deferred_lines_all on public.deferred_schedule_lines for all to authenticated
  using (exists (select 1 from public.deferred_schedules s
                  where s.id = schedule_id
                    and (s.company_id = public.get_my_company_id() or public.is_super_admin())))
  with check (exists (select 1 from public.deferred_schedules s
                  where s.id = schedule_id
                    and (s.company_id = public.get_my_company_id() or public.is_super_admin())));
grant select, insert, update, delete on public.deferred_schedule_lines to authenticated;

-- ربط أودو شخصي: كل مستخدم يرى سطره فقط — ولا حتى السوبر أدمن يقرأ مفاتيح غيره
alter table public.odoo_connections enable row level security;
drop policy if exists odoo_conn_own on public.odoo_connections;
create policy odoo_conn_own on public.odoo_connections for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.odoo_connections to authenticated;

-- ---------------------------------------------------------------------
-- 11) تهيئة البيانات الافتراضية لكل منشأة قائمة وجديدة
-- ---------------------------------------------------------------------
create or replace function public.acct_bootstrap_company(p_company uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_year int := extract(year from current_date)::int;
  v_created jsonb := '{}'::jsonb;
  v_vat_out uuid; v_vat_in uuid; v_def_rev uuid; v_def_exp uuid;
  v_n int;
begin
  if p_company is null then return jsonb_build_object('error','no_company'); end if;

  -- (أ) فترة مالية للسنة الجارية إن لم توجد
  insert into public.fiscal_periods (company_id, name, start_date, end_date)
  select p_company, 'السنة المالية ' || v_year,
         make_date(v_year,1,1), make_date(v_year,12,31)
  where not exists (
    select 1 from public.fiscal_periods f
     where f.company_id = p_company and current_date between f.start_date and f.end_date);

  -- (ب) حسابات الضريبة داخل شجرة الحسابات إن لم تكن موجودة
  insert into public.chart_of_accounts (company_id, code, name, account_type, is_group)
  select p_company, '2300', 'ضريبة القيمة المضافة المستحقة (مخرجات)', 'liability', false
  where not exists (select 1 from public.chart_of_accounts a where a.company_id=p_company and a.code='2300');
  insert into public.chart_of_accounts (company_id, code, name, account_type, is_group)
  select p_company, '1300', 'ضريبة القيمة المضافة القابلة للخصم (مدخلات)', 'asset', false
  where not exists (select 1 from public.chart_of_accounts a where a.company_id=p_company and a.code='1300');
  insert into public.chart_of_accounts (company_id, code, name, account_type, is_group)
  select p_company, '2400', 'الإيرادات المؤجلة', 'liability', false
  where not exists (select 1 from public.chart_of_accounts a where a.company_id=p_company and a.code='2400');
  insert into public.chart_of_accounts (company_id, code, name, account_type, is_group)
  select p_company, '1400', 'المصروفات المدفوعة مقدماً', 'asset', false
  where not exists (select 1 from public.chart_of_accounts a where a.company_id=p_company and a.code='1400');

  select id into v_vat_out from public.chart_of_accounts where company_id=p_company and code='2300' limit 1;
  select id into v_vat_in  from public.chart_of_accounts where company_id=p_company and code='1300' limit 1;
  select id into v_def_rev from public.chart_of_accounts where company_id=p_company and code='2400' limit 1;
  select id into v_def_exp from public.chart_of_accounts where company_id=p_company and code='1400' limit 1;

  -- (ج) رمزا الضريبة القياسيان في السعودية
  insert into public.tax_codes (company_id, code, name, rate, kind, account_id, is_default)
  select p_company, 'VAT15-S', 'ضريبة قيمة مضافة 15% — مبيعات', 15, 'sales', v_vat_out, true
  where not exists (select 1 from public.tax_codes t where t.company_id=p_company and t.code='VAT15-S');
  insert into public.tax_codes (company_id, code, name, rate, kind, account_id, is_default)
  select p_company, 'VAT15-P', 'ضريبة قيمة مضافة 15% — مشتريات', 15, 'purchase', v_vat_in, false
  where not exists (select 1 from public.tax_codes t where t.company_id=p_company and t.code='VAT15-P');
  insert into public.tax_codes (company_id, code, name, rate, kind, account_id, is_default)
  select p_company, 'VAT0', 'معفاة / صفرية', 0, 'both', null, false
  where not exists (select 1 from public.tax_codes t where t.company_id=p_company and t.code='VAT0');

  -- (د) الإعدادات المحاسبية
  insert into public.accounting_settings (company_id, vat_output_account_id, vat_input_account_id,
                                          deferred_revenue_account_id, deferred_expense_account_id)
  values (p_company, v_vat_out, v_vat_in, v_def_rev, v_def_exp)
  on conflict (company_id) do update
    set vat_output_account_id       = coalesce(public.accounting_settings.vat_output_account_id, excluded.vat_output_account_id),
        vat_input_account_id        = coalesce(public.accounting_settings.vat_input_account_id, excluded.vat_input_account_id),
        deferred_revenue_account_id = coalesce(public.accounting_settings.deferred_revenue_account_id, excluded.deferred_revenue_account_id),
        deferred_expense_account_id = coalesce(public.accounting_settings.deferred_expense_account_id, excluded.deferred_expense_account_id);

  -- (هـ) مراكز تكلفة أساسية: الإدارة العامة + مركز لكل فرع
  insert into public.cost_centers (company_id, code, name, kind, is_group)
  select p_company, 'CC-000', 'الإدارة العامة', 'department', true
  where not exists (select 1 from public.cost_centers c where c.company_id=p_company and c.code='CC-000');

  insert into public.cost_centers (company_id, code, name, kind, branch_id)
  select p_company, 'CC-BR-' || substr(replace(b.id::text,'-',''),1,6), b.name, 'branch', b.id
    from public.branches b
   where b.company_id = p_company
     and not exists (select 1 from public.cost_centers c where c.company_id=p_company and c.branch_id=b.id);

  select count(*) into v_n from public.cost_centers where company_id = p_company;
  v_created := jsonb_build_object(
    'company', p_company,
    'cost_centers', v_n,
    'tax_codes', (select count(*) from public.tax_codes where company_id=p_company),
    'fiscal_periods', (select count(*) from public.fiscal_periods where company_id=p_company));
  return v_created;
end $$;

revoke all on function public.acct_bootstrap_company(uuid) from public, anon, authenticated;

-- تشغيلها لكل المنشآت القائمة
do $$ declare c record; begin
  for c in select id from public.companies loop
    perform public.acct_bootstrap_company(c.id);
  end loop;
end $$;

-- ولكل منشأة جديدة تلقائياً
create or replace function public.fn_acct_bootstrap_on_company_insert()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
begin
  perform public.acct_bootstrap_company(new.id);
  return new;
end $$;

drop trigger if exists trg_acct_bootstrap on public.companies;
create trigger trg_acct_bootstrap after insert on public.companies
for each row execute function public.fn_acct_bootstrap_on_company_insert();
