-- =====================================================================
--  عطل مُثبَت: الحجز الأونلاين لا يُغيّر حالة الوحدة
-- ---------------------------------------------------------------------
--  الدليل: enum حالات الحجز يحوي reserved_online، وحالات الوحدة تحوي
--  reserved_online، والواجهة تعرضه وردياً (#EC4899 والتدرّج
--  #FF6EA7→#FF2E93) بنص «حجز أونلاين» — لكن دالة sync_unit_status
--  تعالج أربع حالات فقط (confirmed / checked_in / checked_out /
--  cancelled) ولا تذكر reserved_online إطلاقاً.
--
--  الأثر: يصل حجز من Booking.com عبر Channex فتبقى الوحدة «متاحة»:
--   • لا تصير وردية ولا يُكتب عليها «محجوز أونلاين».
--   • تظهر شاغرة فيُحجز عليها محلياً — حجز مزدوج على غرفة واحدة.
--
--  وعطل ثانٍ في نفس الدالة: الإلغاء يحرّر الوحدة فقط إن كانت
--  'reserved'، فلو أُلغي حجز أونلاين بقيت الوحدة عالقة إلى الأبد.
-- =====================================================================

create or replace function public.sync_unit_status()
returns trigger
language plpgsql security definer
set search_path to 'public','pg_temp'
as $$
begin
  if new.status = 'confirmed' then
    update units set status = 'reserved' where id = new.unit_id;

  elsif new.status = 'reserved_online' then
    -- الحجز القادم من المنصات العالمية: الوحدة تصير «محجوزة أونلاين»
    -- فوراً فتظهر وردية في إدارة الوحدات ولا يُحجز عليها محلياً.
    update units set status = 'reserved_online' where id = new.unit_id;

  elsif new.status = 'checked_in' then
    update units set status = 'occupied' where id = new.unit_id;
    new.actual_check_in := coalesce(new.actual_check_in, now());

  elsif new.status = 'checked_out' then
    update units set status = 'cleaning' where id = new.unit_id;
    new.actual_check_out := coalesce(new.actual_check_out, now());

  elsif new.status = 'cancelled' then
    -- كان يحرّر 'reserved' فقط، فيبقى الحجز الأونلاين الملغى عالقاً.
    -- التحرير الآن يشمل الحالتين، ولا يمس المسكونة ولا الصيانة.
    update units set status = 'available'
     where id = new.unit_id and status in ('reserved', 'reserved_online');
    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------
-- تصحيح رجعي: وحدات عليها حجز أونلاين نشط ولم تُعلَّم
-- ---------------------------------------------------------------------
create or replace function public.online_booking_resync(p_dry boolean default true)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare n1 int := 0; n2 int := 0;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- (أ) وحدة عليها حجز أونلاين نشط لكنها ليست معلّمة كذلك
  if p_dry then
    select count(*) into n1 from public.units u
     where u.status::text not in ('reserved_online','occupied','maintenance')
       and exists (select 1 from public.bookings b
                    where b.unit_id = u.id and b.status::text = 'reserved_online');
  else
    with x as (
      update public.units u set status = 'reserved_online'
       where u.status::text not in ('reserved_online','occupied','maintenance')
         and exists (select 1 from public.bookings b
                      where b.unit_id = u.id and b.status::text = 'reserved_online')
      returning 1) select count(*) into n1 from x;
  end if;

  -- (ب) وحدة معلّمة «محجوز أونلاين» بلا حجز أونلاين نشط
  if p_dry then
    select count(*) into n2 from public.units u
     where u.status::text = 'reserved_online'
       and not exists (select 1 from public.bookings b
                        where b.unit_id = u.id and b.status::text = 'reserved_online');
  else
    with y as (
      update public.units u set status = 'available'
       where u.status::text = 'reserved_online'
         and not exists (select 1 from public.bookings b
                          where b.unit_id = u.id and b.status::text = 'reserved_online')
      returning 1) select count(*) into n2 from y;
  end if;

  if not p_dry and (n1 + n2) > 0 then
    insert into public.system_repair_log (check_id, status, source, category, executed_by, affected_rows, details)
    values ('online_booking_sync', 'success', 'system', 'data', auth.uid(), n1 + n2,
            jsonb_build_object('marked_online', n1, 'freed', n2));
  end if;

  return jsonb_build_object('ok', true, 'dry_run', p_dry, 'marked_online', n1, 'freed', n2);
end $$;
grant execute on function public.online_booking_resync(boolean) to authenticated;

-- ---------------------------------------------------------------------
-- فحوص دائمة على مسار الحجز الأونلاين
-- ---------------------------------------------------------------------
create or replace function public.ci_online_booking_checks()
returns table (o_suite text, o_name text, o_category text, o_status text,
               o_message text, o_meta jsonb, o_fix text)
language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v int; v2 int;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- (1) التريجر يعالج الحجز الأونلاين — سبب العطل الأصلي
  select count(*) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sync_unit_status'
     and pg_get_functiondef(p.oid) ilike '%reserved_online%';
  return query select 'ota','مزامنة حالة الوحدة تشمل الحجز الأونلاين','migration',
    case when v > 0 then 'pass' else 'fail' end,
    case when v > 0 then 'التريجر يحوّل الوحدة إلى «محجوز أونلاين» تلقائياً'
         else 'التريجر لا يعالج reserved_online — الوحدة تبقى متاحة وقد تُحجز مرتين' end,
    jsonb_build_object('handled', v > 0), null::text;

  -- (2) اتساق الوحدات مع حجوزاتها الأونلاين
  select count(*) into v from public.units u
   where u.status::text not in ('reserved_online','occupied','maintenance')
     and exists (select 1 from public.bookings b where b.unit_id=u.id and b.status::text='reserved_online');
  return query select 'ota','كل وحدة عليها حجز أونلاين معلّمة به','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'لا وحدة محجوزة أونلاين بلا تعليم'
         else v || ' وحدة عليها حجز أونلاين وتظهر متاحة — خطر الحجز المزدوج' end,
    jsonb_build_object('unmarked', v), 'online_booking_sync'::text;

  select count(*) into v2 from public.units u
   where u.status::text = 'reserved_online'
     and not exists (select 1 from public.bookings b where b.unit_id=u.id and b.status::text='reserved_online');
  return query select 'ota','لا وحدة عالقة على «محجوز أونلاين»','data',
    case when v2 = 0 then 'pass' else 'fail' end,
    case when v2 = 0 then 'لا وحدات عالقة' else v2 || ' وحدة عالقة بلا حجز أونلاين نشط' end,
    jsonb_build_object('stuck', v2), 'online_booking_sync'::text;

  -- (3) إعدادات القنوات
  select count(*) into v from public.channel_manager_settings where enabled;
  return query select 'ota','ربط منصات الحجز مفعّل','general',
    case when v > 0 then 'pass' else 'warn' end,
    v || ' منشأة مفعّلة الربط مع المنصات العالمية',
    jsonb_build_object('enabled_companies', v), null::text;

  -- (4) الطابور لا يتراكم
  select count(*) into v from public.ota_sync_queue
   where status = 'pending' and created_at < now() - interval '24 hours';
  return query select 'ota','لا مهام مزامنة راكدة فوق 24 ساعة','perf',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'الطابور يُفرَّغ أولاً بأول'
         else v || ' مهمة راكدة — تُفرَّغ تلقائياً عند دخول أول مستخدم' end,
    jsonb_build_object('stale', v), null::text;
end $$;
revoke all on function public.ci_online_booking_checks() from public, anon;
grant execute on function public.ci_online_booking_checks() to authenticated;

create or replace function public.online_booking_sync_all()
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare j jsonb; begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode='42501'; end if;
  j := public.online_booking_resync(false);
  return coalesce((j->>'marked_online')::int,0) + coalesce((j->>'freed')::int,0);
end $$;
revoke all on function public.online_booking_sync_all() from public, anon, authenticated;

insert into public.ci_fix_catalog (check_id, title, description, fix_function)
values ('online_booking_sync', 'مزامنة الحجوزات الأونلاين',
        'يُعلّم كل وحدة عليها حجز أونلاين نشط، ويحرّر العالقة بلا حجز',
        'online_booking_sync_all')
on conflict (check_id) do update
  set fix_function = excluded.fix_function,
      title = excluded.title, description = excluded.description;
