-- =====================================================================
-- DOCUMENT_SERIALS_AND_MONITORING.sql   (idempotent — آمن للتشغيل مراراً)
-- 1) أرقام سيريال حقيقية ومحفوظة لكل المطبوعات (فواتير/عقود/سندات/مدفوعات/مصروفات)
-- 2) مراقبة وتنبيه للأخطاء (system_alerts) — مرئية للسوبر أدمن فقط
-- 3) زر إصلاح ذاتي آمن لكل المستخدمين (run_self_repair)
-- 4) سجل نشاط سوبر أدمن مع ترقيم صفحات وفلاتر متقدمة وأداء
-- 5) تحسين أداء فحص توفر الوحدات
-- كل الدوال SECURITY DEFINER مع تحقق صارم من الصلاحيات، ولا شيء منها
-- يعدّل بيانات قائمة إلا عبر run_self_repair (إصلاحات آمنة فقط).
-- =====================================================================

-- ---------------------------------------------------------------
-- 0) عدادات السيريال + سجل المستندات الصادرة
-- ---------------------------------------------------------------
create table if not exists public.document_serials (
  company_id uuid not null,
  doc_kind   text not null,
  year       int  not null,
  last_seq   bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (company_id, doc_kind, year)
);

create table if not exists public.document_registry (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  doc_kind     text not null,
  serial       text not null,
  entity_table text,
  entity_id    uuid,
  issued_by    uuid,
  issued_at    timestamptz not null default now(),
  meta         jsonb not null default '{}'::jsonb
);

create unique index if not exists uq_document_registry_serial
  on public.document_registry (company_id, serial);
create unique index if not exists uq_document_registry_entity
  on public.document_registry (company_id, doc_kind, entity_table, entity_id)
  where entity_id is not null;
create index if not exists idx_document_registry_company_at
  on public.document_registry (company_id, issued_at desc);

grant select on public.document_serials to authenticated;
grant all on public.document_serials to service_role;
grant select on public.document_registry to authenticated;
grant all on public.document_registry to service_role;

alter table public.document_serials  enable row level security;
alter table public.document_registry enable row level security;

drop policy if exists document_serials_sel on public.document_serials;
create policy document_serials_sel on public.document_serials
  for select to authenticated
  using (company_id = public.get_my_company_id() or public.is_super_admin());

drop policy if exists document_registry_sel on public.document_registry;
create policy document_registry_sel on public.document_registry
  for select to authenticated
  using (company_id = public.get_my_company_id() or public.is_super_admin());

-- بادئة كل نوع مستند
create or replace function public.document_prefix(p_kind text)
returns text language sql immutable as $$
  select case lower(coalesce(p_kind, 'doc'))
    when 'invoice'    then 'INV'
    when 'contract'   then 'CNT'
    when 'receipt'    then 'RV'
    when 'payment'    then 'PV'
    when 'voucher'    then 'VCH'
    when 'expense'    then 'EXP'
    when 'handover'   then 'HDV'
    when 'settlement' then 'STL'
    when 'statement'  then 'STM'
    when 'report'     then 'RPT'
    when 'unit'       then 'UNT'
    when 'employee'   then 'EMP'
    when 'customer'   then 'CUS'
    when 'quote'      then 'QTE'
    else upper(left(regexp_replace(coalesce(p_kind, 'doc'), '[^a-zA-Z]', '', 'g') || 'DOC', 3))
  end;
$$;

-- إصدار (أو استرجاع) رقم سيريال حقيقي محفوظ في النظام
create or replace function public.issue_document_serial(
  p_kind text,
  p_entity_table text default null,
  p_entity_id uuid default null,
  p_meta jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.get_my_company_id();
  v_year int := extract(year from current_date)::int;
  v_seq bigint;
  v_serial text;
begin
  if v_company is null then
    raise exception 'لا يمكن إصدار رقم مستند بدون منشأة مرتبطة بالحساب';
  end if;

  -- إعادة استخدام السيريال إن كان المستند قد صدر سابقاً (منع التكرار)
  if p_entity_id is not null then
    select serial into v_serial
      from public.document_registry
     where company_id = v_company and doc_kind = lower(p_kind)
       and entity_table is not distinct from p_entity_table
       and entity_id = p_entity_id
     limit 1;
    if v_serial is not null then
      return v_serial;
    end if;
  end if;

  insert into public.document_serials (company_id, doc_kind, year, last_seq, updated_at)
  values (v_company, lower(p_kind), v_year, 1, now())
  on conflict (company_id, doc_kind, year)
  do update set last_seq = public.document_serials.last_seq + 1, updated_at = now()
  returning last_seq into v_seq;

  v_serial := public.document_prefix(p_kind) || '-' || v_year::text || '-' || lpad(v_seq::text, 5, '0');

  insert into public.document_registry (company_id, doc_kind, serial, entity_table, entity_id, issued_by, meta)
  values (v_company, lower(p_kind), v_serial, p_entity_table, p_entity_id, auth.uid(), coalesce(p_meta, '{}'::jsonb))
  on conflict do nothing;

  return v_serial;
end $$;

grant execute on function public.issue_document_serial(text, text, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------
-- 1) مراقبة وتنبيه الأخطاء — مرئية للسوبر أدمن فقط
-- ---------------------------------------------------------------
create table if not exists public.system_alerts (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid,
  user_id    uuid,
  source     text not null,               -- bookings | branches | activity_log | serials | app
  severity   text not null default 'error', -- info | warn | error | critical
  code       text,
  message    text not null,
  context    jsonb not null default '{}'::jsonb,
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_system_alerts_created on public.system_alerts (created_at desc);
create index if not exists idx_system_alerts_source  on public.system_alerts (source, created_at desc);
create index if not exists idx_system_alerts_open    on public.system_alerts (resolved, created_at desc);

grant select on public.system_alerts to authenticated;
grant all on public.system_alerts to service_role;
alter table public.system_alerts enable row level security;

-- القراءة للسوبر أدمن فقط (لا تسريب لأي مستخدم آخر)
drop policy if exists system_alerts_sel on public.system_alerts;
create policy system_alerts_sel on public.system_alerts
  for select to authenticated using (public.is_super_admin());

drop policy if exists system_alerts_upd on public.system_alerts;
create policy system_alerts_upd on public.system_alerts
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- الكتابة تتم فقط عبر الدالة (أي مستخدم يستطيع الإبلاغ عن خطأ دون رؤية السجل)
create or replace function public.log_system_alert(
  p_source text,
  p_message text,
  p_severity text default 'error',
  p_code text default null,
  p_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.system_alerts (company_id, user_id, source, severity, code, message, context)
  values (public.get_my_company_id(), auth.uid(),
          coalesce(nullif(p_source, ''), 'app'),
          case when lower(coalesce(p_severity,'error')) in ('info','warn','error','critical')
               then lower(p_severity) else 'error' end,
          nullif(p_code, ''), left(coalesce(p_message, 'خطأ غير معروف'), 2000),
          coalesce(p_context, '{}'::jsonb))
  returning id into v_id;
  return v_id;
exception when others then
  return null; -- التنبيه لا يجوز أن يُعطّل العملية الأساسية
end $$;

grant execute on function public.log_system_alert(text, text, text, text, jsonb) to authenticated;

-- عدّاد التنبيهات المفتوحة (للسوبر أدمن فقط)
create or replace function public.super_admin_open_alerts(p_limit int default 50)
returns setof public.system_alerts
language sql stable security definer set search_path = public as $$
  select * from public.system_alerts
   where public.is_super_admin() and resolved = false
   order by created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;
grant execute on function public.super_admin_open_alerts(int) to authenticated;

create or replace function public.super_admin_resolve_alert(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'غير مصرح';
  end if;
  update public.system_alerts set resolved = true where id = p_id;
  return true;
end $$;
grant execute on function public.super_admin_resolve_alert(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 2) سجل النشاط للسوبر أدمن — ترقيم صفحات + فلاتر متقدمة + إجمالي
-- ---------------------------------------------------------------
create index if not exists idx_audit_logs_user   on public.audit_logs (user_id, created_at desc);
create index if not exists idx_audit_logs_action on public.audit_logs (action, created_at desc);

create or replace function public.super_admin_activity_log(
  p_entity text default null,
  p_action text default null,
  p_user   uuid default null,
  p_company uuid default null,
  p_from   timestamptz default null,
  p_to     timestamptz default null,
  p_search text default null,
  p_limit  int default 50,
  p_offset int default 0
)
returns table (
  id uuid, company_id uuid, user_id uuid, action text, entity text,
  entity_id uuid, old_data jsonb, new_data jsonb, created_at timestamptz,
  company_name text, actor_name text, total_count bigint
)
language plpgsql stable security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit, 50), 500));
begin
  if not public.is_super_admin() then
    raise exception 'سجل نشاط المنصة متاح لحسابات السوبر أدمن فقط';
  end if;

  return query
  with base as (
    select a.*
      from public.audit_logs a
     where (p_entity is null or a.entity = p_entity)
       and (p_action is null or a.action = p_action)
       and (p_user   is null or a.user_id = p_user)
       and (p_company is null or a.company_id = p_company)
       and (p_from   is null or a.created_at >= p_from)
       and (p_to     is null or a.created_at <= p_to)
       and (
         p_search is null or p_search = '' or
         a.action ilike '%' || p_search || '%' or
         a.entity ilike '%' || p_search || '%' or
         coalesce(a.new_data->>'summary', '') ilike '%' || p_search || '%'
       )
  ), counted as (select count(*)::bigint c from base)
  select b.id, b.company_id, b.user_id, b.action, b.entity, b.entity_id,
         b.old_data, b.new_data, b.created_at,
         c.name, p.full_name, (select c2.c from counted c2)
    from base b
    left join public.companies c on c.id = b.company_id
    left join public.profiles  p on p.id = b.user_id
   order by b.created_at desc
   limit v_limit offset greatest(0, coalesce(p_offset, 0));
end $$;

grant execute on function public.super_admin_activity_log(text, text, uuid, uuid, timestamptz, timestamptz, text, int, int) to authenticated;

-- قوائم الفلاتر (سوبر أدمن فقط)
create or replace function public.super_admin_activity_facets()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'غير مصرح';
  end if;
  return jsonb_build_object(
    'entities', coalesce((select jsonb_agg(distinct entity) from public.audit_logs where entity is not null), '[]'::jsonb),
    'actions',  coalesce((select jsonb_agg(distinct action) from public.audit_logs where action is not null), '[]'::jsonb),
    'users',    coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name))
                            from public.profiles p
                           where p.id in (select distinct user_id from public.audit_logs where user_id is not null)), '[]'::jsonb),
    'companies',coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name))
                            from public.companies c
                           where c.id in (select distinct company_id from public.audit_logs where company_id is not null)), '[]'::jsonb)
  );
end $$;
grant execute on function public.super_admin_activity_facets() to authenticated;

-- ---------------------------------------------------------------
-- 3) إصلاح ذاتي آمن — متاح لجميع المستخدمين (على بيانات منشأتهم فقط)
-- ---------------------------------------------------------------
create or replace function public.run_self_repair()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.get_my_company_id();
  v_branch_fixed int := 0;
  v_contract_fixed int := 0;
  v_status_fixed int := 0;
begin
  if v_company is null then
    return jsonb_build_object('ok', false, 'message', 'لا توجد منشأة مرتبطة بالحساب');
  end if;

  -- (أ) حجوزات بلا فرع → ترث فرع الوحدة
  begin
    update public.bookings b
       set branch_id = u.branch_id
      from public.units u
     where b.unit_id = u.id
       and b.company_id = v_company
       and b.branch_id is null
       and u.branch_id is not null;
    get diagnostics v_branch_fixed = row_count;
  exception when others then v_branch_fixed := 0; end;

  -- (ب) حجوزات بلا رقم عقد → رقم مستقر مشتق من المعرّف
  begin
    update public.bookings b
       set contract_number = 'CNT-' || to_char(coalesce(b.created_at, now()), 'YYYY') || '-' || upper(left(replace(b.id::text, '-', ''), 8))
     where b.company_id = v_company
       and (b.contract_number is null or b.contract_number = '');
    get diagnostics v_contract_fixed = row_count;
  exception when others then v_contract_fixed := 0; end;

  -- (ج) وحدات معلّمة "محجوزة/مسكونة" بلا أي حجز نشط → إعادتها متاحة
  begin
    update public.units u
       set status = 'available'::unit_status
     where u.company_id = v_company
       and u.status in ('reserved'::unit_status, 'reserved_online'::unit_status)
       and not exists (
         select 1 from public.bookings b
          where b.unit_id = u.id
            and b.status in ('pending'::booking_status, 'confirmed'::booking_status, 'checked_in'::booking_status)
       );
    get diagnostics v_status_fixed = row_count;
  exception when others then v_status_fixed := 0; end;

  begin
    insert into public.system_repair_log (company_id, action, details)
    values (v_company, 'self_repair',
      jsonb_build_object('branch_fixed', v_branch_fixed, 'contract_fixed', v_contract_fixed,
                         'status_fixed', v_status_fixed, 'at', now(), 'by', auth.uid()));
  exception when others then null; end;

  return jsonb_build_object(
    'ok', true,
    'branch_fixed', v_branch_fixed,
    'contract_fixed', v_contract_fixed,
    'status_fixed', v_status_fixed
  );
end $$;

grant execute on function public.run_self_repair() to authenticated;

-- ---------------------------------------------------------------
-- 4) أداء فحص توفر الوحدة — مسار سريع + فهرس داعم
-- ---------------------------------------------------------------
create index if not exists idx_bookings_unit_active_dates
  on public.bookings (unit_id, check_in_date, check_out_date)
  where status in ('confirmed'::booking_status, 'checked_in'::booking_status);

create or replace function public.check_unit_availability(
  _unit_id uuid,
  _check_in date,
  _check_out date,
  _exclude_booking uuid default null
)
returns table (available boolean, conflicts jsonb)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare v_has boolean;
begin
  -- مسار سريع: يستخدم فهرس GIST (no_double_booking) ويتوقف عند أول تعارض
  select exists (
    select 1 from public.bookings b
     where b.unit_id = _unit_id
       and b.status in ('confirmed'::booking_status, 'checked_in'::booking_status)
       and (_exclude_booking is null or b.id <> _exclude_booking)
       and daterange(b.check_in_date, b.check_out_date, '[)')
           && daterange(_check_in, _check_out, '[)')
  ) into v_has;

  if not v_has then
    return query select true, '[]'::jsonb;
  end if;

  return query
  select false, coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'check_in_date', b.check_in_date,
           'check_out_date', b.check_out_date, 'status', b.status)), '[]'::jsonb)
    from public.bookings b
   where b.unit_id = _unit_id
     and b.status in ('confirmed'::booking_status, 'checked_in'::booking_status)
     and (_exclude_booking is null or b.id <> _exclude_booking)
     and daterange(b.check_in_date, b.check_out_date, '[)')
         && daterange(_check_in, _check_out, '[)');
end $$;

grant execute on function public.check_unit_availability(uuid, date, date, uuid) to authenticated;

analyze public.bookings;
analyze public.audit_logs;

-- ---------------------------------------------------------------
-- 6) تسجيل رقم مستند مُولَّد مسبقاً (فواتير/عقود لها ترقيمها الخاص)
--    idempotent: إعادة التسجيل لا تُنشئ صفوفاً مكرّرة.
-- ---------------------------------------------------------------
create or replace function public.register_document_serial(
  p_kind text,
  p_serial text,
  p_entity_table text default null,
  p_entity_id uuid default null,
  p_meta jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := public.get_my_company_id();
begin
  if v_company is null or coalesce(nullif(trim(p_serial), ''), '') = '' then
    return null;
  end if;

  insert into public.document_registry
    (company_id, doc_kind, serial, entity_table, entity_id, issued_by, meta)
  values
    (v_company, lower(coalesce(p_kind, 'doc')), trim(p_serial),
     p_entity_table, p_entity_id, auth.uid(), coalesce(p_meta, '{}'::jsonb))
  on conflict do nothing;

  return trim(p_serial);
exception when others then
  return null; -- التسجيل لا يجوز أن يُعطّل إصدار المستند
end $$;

grant execute on function public.register_document_serial(text, text, text, uuid, jsonb) to authenticated;
