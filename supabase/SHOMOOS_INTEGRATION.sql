-- =====================================================================
--  الربط مع منصة شموس (وزارة الداخلية) ووزارة السياحة
-- ---------------------------------------------------------------------
--  الحقيقة التي بُني عليها هذا الملف:
--  المواصفة التقنية لواجهة شموس ليست منشورة علناً — تُسلَّم للمتكاملين
--  المرخّصين عبر «علم/تقنين» بعد التعاقد. لذلك لا تُخترع هنا أي نقطة
--  اتصال ولا أسماء حقول وهمية.
--
--  ما يفعله هذا الملف فعلاً:
--   (1) يخزّن إعدادات الربط لكل منشأة (رقم المنشأة، رخصة السياحة،
--       المفتاح، عنوان الخدمة، البيئة) بحماية تمنع قراءة المفتاح لغير
--       أصحاب الصلاحية المالية في المنشأة نفسها.
--   (2) يبني حمولة التسجيل من بيانات النظام الحقيقية — نفس الحقول التي
--       يطلبها شموس عن النزيل — ويضعها في طابور جاهز للإرسال.
--   (3) يقيس الجاهزية: لكل حجز، هل كل حقل مطلوب موجود فعلاً؟ فيعرف
--       المستخدم قبل التعاقد ما ينقصه بالضبط.
--  فور تسليم المواصفة، لا يتبقى إلا مُرسِل HTTP يقرأ من هذا الطابور.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) إعدادات الربط لكل منشأة
-- ---------------------------------------------------------------------
create table if not exists public.shomoos_settings (
  company_id        uuid primary key references public.companies(id) on delete cascade,
  enabled           boolean not null default false,
  environment       text not null default 'sandbox',   -- sandbox | production
  facility_number   text,      -- رقم المنشأة لدى وزارة الداخلية
  tourism_license   text,      -- رقم رخصة وزارة السياحة
  facility_name     text,
  facility_city     text,
  api_base_url      text,      -- يُملأ من مواصفة مزوّد الخدمة بعد التعاقد
  api_key           text,      -- مفتاح الربط
  api_username      text,
  auto_send_checkin  boolean not null default true,
  auto_send_checkout boolean not null default true,
  last_status       text,
  last_checked_at   timestamptz,
  last_sent_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint shomoos_env check (environment in ('sandbox','production'))
);

alter table public.shomoos_settings enable row level security;
drop policy if exists shomoos_settings_all on public.shomoos_settings;
-- الصلاحية المالية فقط: المفتاح بيانات حسّاسة لا يراها كل موظف
create policy shomoos_settings_all on public.shomoos_settings for all to authenticated
  using (company_id = public.get_my_company_id()
         and (public.is_super_admin() or public.get_my_role() in ('owner','manager','accountant')))
  with check (company_id = public.get_my_company_id()
         and (public.is_super_admin() or public.get_my_role() in ('owner','manager','accountant')));
grant select, insert, update, delete on public.shomoos_settings to authenticated;

-- ---------------------------------------------------------------------
-- 2) طابور الإرسال — سجل كامل لكل محاولة تسجيل
-- ---------------------------------------------------------------------
create table if not exists public.shomoos_queue (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  booking_id    uuid references public.bookings(id) on delete set null,
  customer_id   uuid references public.customers(id) on delete set null,
  unit_id       uuid references public.units(id) on delete set null,
  event_type    text not null,          -- checkin | checkout | update
  payload       jsonb not null,
  status        text not null default 'pending',  -- pending | sent | failed | blocked
  attempts      int not null default 0,
  last_error    text,
  shomoos_ref   text,                   -- المرجع العائد من شموس بعد الإرسال
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  constraint shomoos_event check (event_type in ('checkin','checkout','update')),
  constraint shomoos_status check (status in ('pending','sent','failed','blocked'))
);
create index if not exists idx_shomoos_queue on public.shomoos_queue(company_id, status, created_at desc);
create index if not exists idx_shomoos_booking on public.shomoos_queue(booking_id);

alter table public.shomoos_queue enable row level security;
drop policy if exists shomoos_queue_all on public.shomoos_queue;
create policy shomoos_queue_all on public.shomoos_queue for all to authenticated
  using (company_id = public.get_my_company_id() or public.is_super_admin())
  with check (company_id = public.get_my_company_id() or public.is_super_admin());
grant select, insert, update, delete on public.shomoos_queue to authenticated;

-- ---------------------------------------------------------------------
-- 3) الحقول التي يطلبها شموس عن النزيل، ومصدر كل حقل في نظامنا
--    جدول مرجعي صريح: يجعل الجاهزية قابلة للقياس بدل الادّعاء.
-- ---------------------------------------------------------------------
create table if not exists public.shomoos_field_map (
  field_key    text primary key,
  label_ar     text not null,
  source_table text not null,
  source_col   text not null,
  required     boolean not null default true,
  notes        text
);

insert into public.shomoos_field_map (field_key, label_ar, source_table, source_col, required, notes) values
  ('guest_full_name',  'اسم النزيل الرباعي',        'customers', 'full_name',      true,  'كما في وثيقة الهوية'),
  ('guest_id_type',    'نوع الوثيقة',                'customers', 'id_type',        true,  'هوية وطنية / إقامة / جواز'),
  ('guest_id_number',  'رقم الوثيقة',                'customers', 'id_number',      true,  'الرقم المطبوع على الوثيقة'),
  ('guest_nationality','الجنسية',                    'customers', 'nationality',    true,  null),
  ('guest_birth_date', 'تاريخ الميلاد',              'customers', 'birth_date',     true,  null),
  ('guest_phone',      'رقم الجوال',                 'customers', 'phone',          true,  null),
  ('passport_number',  'رقم الجواز (لغير السعوديين)','customers', 'passport_number',false, 'مطلوب إن كانت الوثيقة جواز سفر'),
  ('unit_number',      'رقم الوحدة / الغرفة',        'units',     'unit_number',    true,  null),
  ('check_in_at',      'تاريخ ووقت الدخول',          'bookings',  'check_in_date',  true,  'يُفضّل actual_check_in إن وُجد'),
  ('check_out_at',     'تاريخ ووقت الخروج المتوقع',  'bookings',  'check_out_date', true,  null),
  ('facility_number',  'رقم المنشأة لدى الداخلية',   'shomoos_settings', 'facility_number', true, 'من حساب المنشأة في شموس'),
  ('tourism_license',  'رخصة وزارة السياحة',         'shomoos_settings', 'tourism_license', true, 'رخصة سارية شرط للتسجيل'),
  ('companions',       'بيانات المرافقين',           'booking_companions', 'full_name', false, 'كل مرافق باسمه ونوع ورقم وثيقته')
on conflict (field_key) do update
  set label_ar = excluded.label_ar, source_table = excluded.source_table,
      source_col = excluded.source_col, required = excluded.required, notes = excluded.notes;

alter table public.shomoos_field_map enable row level security;
drop policy if exists shomoos_map_read on public.shomoos_field_map;
create policy shomoos_map_read on public.shomoos_field_map for select to authenticated using (true);
grant select on public.shomoos_field_map to authenticated;

-- ---------------------------------------------------------------------
-- 4) بناء حمولة التسجيل من بيانات حقيقية
-- ---------------------------------------------------------------------
create or replace function public.shomoos_build_payload(p_booking uuid, p_event text default 'checkin')
returns jsonb
language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare b record; c record; u record; s record; comp jsonb;
begin
  select * into b from public.bookings where id = p_booking;
  if b.id is null then raise exception 'الحجز غير موجود' using errcode='42501'; end if;
  perform public.acct_guard(b.company_id);

  select * into c from public.customers where id = b.customer_id;
  select * into u from public.units where id = b.unit_id;
  select * into s from public.shomoos_settings where company_id = b.company_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'full_name', k.full_name, 'id_type', k.id_type::text,
           'id_number', k.id_number, 'relation', k.relation)), '[]'::jsonb)
    into comp
    from public.booking_companions k where k.booking_id = b.id;

  return jsonb_build_object(
    'event_type',       p_event,
    'facility_number',  s.facility_number,
    'tourism_license',  s.tourism_license,
    'facility_name',    coalesce(s.facility_name, (select name from public.companies where id = b.company_id)),
    'facility_city',    s.facility_city,
    'booking_reference',coalesce(b.contract_number, b.id::text),
    'guest', jsonb_build_object(
      'full_name',   c.full_name,
      'id_type',     c.id_type::text,
      'id_number',   c.id_number,
      'nationality', c.nationality,
      'birth_date',  c.birth_date,
      'phone',       c.phone,
      'passport_number', c.passport_number),
    'stay', jsonb_build_object(
      'unit_number',  u.unit_number,
      'check_in_at',  coalesce(b.actual_check_in, b.check_in_date::timestamptz),
      'check_out_at', coalesce(b.actual_check_out, b.check_out_date::timestamptz)),
    'companions', comp);
end $$;
grant execute on function public.shomoos_build_payload(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5) قياس الجاهزية: ما الذي ينقص فعلاً قبل تفعيل الربط؟
-- ---------------------------------------------------------------------
drop function if exists public.shomoos_readiness(uuid);
create or replace function public.shomoos_readiness(p_company uuid default null)
returns table (o_item text, o_status text, o_detail text, o_count int)
language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v_co uuid; s record; v int; v_tot int;
begin
  v_co := public.acct_guard(p_company);
  select * into s from public.shomoos_settings where company_id = v_co;

  -- (أ) إعدادات المنشأة
  return query select 'رقم المنشأة لدى وزارة الداخلية',
    case when coalesce(s.facility_number,'') <> '' then 'pass' else 'fail' end,
    coalesce(nullif(s.facility_number,''), 'غير مُدخل — يُستخرج من حساب المنشأة في شموس'), 0;

  return query select 'رخصة وزارة السياحة',
    case when coalesce(s.tourism_license,'') <> '' then 'pass' else 'fail' end,
    coalesce(nullif(s.tourism_license,''), 'غير مُدخلة — رخصة سارية شرط للتسجيل في شموس'), 0;

  return query select 'مفتاح الربط (API Key)',
    case when coalesce(s.api_key,'') <> '' then 'pass' else 'fail' end,
    case when coalesce(s.api_key,'') <> '' then 'محفوظ' else 'غير محفوظ — يُصدر من حساب منشأتك بعد التعاقد' end, 0;

  return query select 'عنوان خدمة شموس',
    case when coalesce(s.api_base_url,'') <> '' then 'pass' else 'fail' end,
    coalesce(nullif(s.api_base_url,''), 'غير مُدخل — يُسلَّم مع المواصفة التقنية من مزوّد الخدمة'), 0;

  -- (ب) اكتمال بيانات النزلاء في الحجوزات النشطة
  select count(*) into v_tot from public.bookings b
   where b.company_id = v_co and b.status::text in ('confirmed','checked_in');

  select count(*) into v from public.bookings b
    join public.customers c on c.id = b.customer_id
   where b.company_id = v_co and b.status::text in ('confirmed','checked_in')
     and coalesce(c.full_name,'') <> '' and coalesce(c.id_number,'') <> ''
     and c.id_type is not null and coalesce(c.nationality,'') <> ''
     and c.birth_date is not null and coalesce(c.phone,'') <> '';

  return query select 'اكتمال بيانات النزلاء في الحجوزات النشطة',
    case when v_tot = 0 then 'pass' when v = v_tot then 'pass' else 'warn' end,
    case when v_tot = 0 then 'لا حجوزات نشطة حالياً'
         else v || ' من ' || v_tot || ' حجزاً بياناته كاملة وجاهزة للإرسال' end,
    greatest(v_tot - v, 0);

  -- تفصيل النواقص حقلاً بحقل حتى يعرف المستخدم ما يُكمله بالضبط
  select count(*) into v from public.bookings b join public.customers c on c.id=b.customer_id
   where b.company_id=v_co and b.status::text in ('confirmed','checked_in') and coalesce(c.id_number,'')='';
  return query select 'رقم وثيقة الهوية', case when v=0 then 'pass' else 'warn' end,
    case when v=0 then 'مكتمل لكل النزلاء' else v||' نزيلاً بلا رقم وثيقة' end, v;

  select count(*) into v from public.bookings b join public.customers c on c.id=b.customer_id
   where b.company_id=v_co and b.status::text in ('confirmed','checked_in') and c.birth_date is null;
  return query select 'تاريخ الميلاد', case when v=0 then 'pass' else 'warn' end,
    case when v=0 then 'مكتمل لكل النزلاء' else v||' نزيلاً بلا تاريخ ميلاد' end, v;

  select count(*) into v from public.bookings b join public.customers c on c.id=b.customer_id
   where b.company_id=v_co and b.status::text in ('confirmed','checked_in') and coalesce(c.nationality,'')='';
  return query select 'الجنسية', case when v=0 then 'pass' else 'warn' end,
    case when v=0 then 'مكتملة لكل النزلاء' else v||' نزيلاً بلا جنسية' end, v;

  select count(*) into v from public.bookings b join public.customers c on c.id=b.customer_id
   where b.company_id=v_co and b.status::text in ('confirmed','checked_in') and coalesce(c.phone,'')='';
  return query select 'رقم الجوال', case when v=0 then 'pass' else 'warn' end,
    case when v=0 then 'مكتمل لكل النزلاء' else v||' نزيلاً بلا رقم جوال' end, v;

  -- (ج) الطابور
  select count(*) into v from public.shomoos_queue where company_id=v_co and status='pending';
  return query select 'الطابور جاهز للإرسال', 'pass',
    v || ' سجل في انتظار تفعيل الربط', v;
end $$;
grant execute on function public.shomoos_readiness(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6) إدراج في الطابور — يدوياً أو تلقائياً عند تسجيل الدخول
-- ---------------------------------------------------------------------
create or replace function public.shomoos_enqueue(p_booking uuid, p_event text default 'checkin')
returns uuid language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare b record; v_id uuid; v_payload jsonb; v_missing text := '';
begin
  select * into b from public.bookings where id = p_booking;
  if b.id is null then raise exception 'الحجز غير موجود' using errcode='42501'; end if;
  perform public.acct_guard(b.company_id);

  v_payload := public.shomoos_build_payload(p_booking, p_event);

  -- لا يُرسل سجل ناقص: يُدرج بحالة blocked مع بيان النقص بدل رفضه بصمت
  if coalesce(v_payload#>>'{guest,full_name}','') = '' then v_missing := v_missing || 'الاسم، '; end if;
  if coalesce(v_payload#>>'{guest,id_number}','') = '' then v_missing := v_missing || 'رقم الوثيقة، '; end if;
  if coalesce(v_payload#>>'{guest,nationality}','') = '' then v_missing := v_missing || 'الجنسية، '; end if;
  if coalesce(v_payload#>>'{guest,birth_date}','') = '' then v_missing := v_missing || 'تاريخ الميلاد، '; end if;

  insert into public.shomoos_queue
    (company_id, booking_id, customer_id, unit_id, event_type, payload, status, last_error)
  values (b.company_id, b.id, b.customer_id, b.unit_id, p_event, v_payload,
          case when v_missing = '' then 'pending' else 'blocked' end,
          nullif('بيانات ناقصة: ' || rtrim(v_missing, '، '), 'بيانات ناقصة: '))
  returning id into v_id;

  return v_id;
end $$;
grant execute on function public.shomoos_enqueue(uuid, text) to authenticated;

-- تريجر: كل تسجيل دخول فعلي يدخل الطابور تلقائياً إن كان الربط مفعّلاً
create or replace function public.fn_shomoos_on_checkin()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare s record;
begin
  select * into s from public.shomoos_settings where company_id = new.company_id;
  if s.company_id is null or not s.enabled then return new; end if;

  if s.auto_send_checkin and new.actual_check_in is not null
     and (old.actual_check_in is null or old.actual_check_in <> new.actual_check_in) then
    perform public.shomoos_enqueue(new.id, 'checkin');
  end if;
  if s.auto_send_checkout and new.actual_check_out is not null
     and (old.actual_check_out is null or old.actual_check_out <> new.actual_check_out) then
    perform public.shomoos_enqueue(new.id, 'checkout');
  end if;
  return new;
exception when others then
  -- فشل التسجيل في الطابور لا يجوز أن يمنع تسجيل دخول النزيل
  return new;
end $$;

drop trigger if exists trg_shomoos_checkin on public.bookings;
create trigger trg_shomoos_checkin after update on public.bookings
for each row execute function public.fn_shomoos_on_checkin();
