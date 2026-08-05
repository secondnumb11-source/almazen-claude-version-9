-- =====================================================================
--  عطل مُثبَت: حجوزات تبقى «مُسجَّل دخول» بعد انقضاء تاريخ خروجها
-- ---------------------------------------------------------------------
--  الدليل: 7 حجوزات حالتها checked_in وتاريخ خروجها مضى، أقدمها منذ
--  22 يوماً على الوحدة 102. ولا توجد أي آلية تُنهيها.
--
--  الأثر الحقيقي:
--   • الوحدة تبقى «مسكونة» فلا تظهر متاحة للحجز — خسارة تشغيلية مباشرة.
--   • تقارير الإشغال ومعدّل الدوران تُحتسب على إقامة منتهية.
--   • لا يُصدر محضر تسليم ولا تُبدأ دورة التنظيف.
--
--  التصميم: الإنهاء يمرّ عبر تحديث status إلى checked_out فقط، فيتكفّل
--  التريجر القائم sync_unit_status بضبط الوحدة إلى «تنظيف» وتسجيل وقت
--  الخروج. لا نلمس الوحدة مباشرةً حتى لا نزدوج مع منطق قائم يعمل.
--
--  مهلة السماح: يوم كامل بعد تاريخ الخروج، حتى لا يُغلق حجزاً يُخلى
--  متأخراً في نفس اليوم.
-- =====================================================================

create or replace function public.booking_auto_checkout(
  p_dry boolean default true,
  p_grace_days int default 1
) returns jsonb
language plpgsql security definer
set search_path to 'public','pg_temp'
as $$
declare r record; n int := 0; v_list jsonb := '[]'::jsonb;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for r in
    select b.id, b.company_id, b.check_out_date, u.unit_number
      from public.bookings b
      left join public.units u on u.id = b.unit_id
     where b.status::text = 'checked_in'
       and b.check_out_date < current_date - make_interval(days => greatest(0, p_grace_days))
     order by b.check_out_date
  loop
    n := n + 1;
    v_list := v_list || jsonb_build_object(
      'unit', coalesce(r.unit_number, '—'),
      'check_out_date', r.check_out_date,
      'days_overdue', (current_date - r.check_out_date));

    if not p_dry then
      -- التحديث وحده يكفي: التريجر يضبط الوحدة ويسجّل وقت الخروج
      update public.bookings
         set status = 'checked_out',
             actual_check_out = coalesce(actual_check_out, r.check_out_date::timestamptz + interval '12 hours'),
             notes = coalesce(nullif(notes,'') || ' | ', '')
                     || 'إخلاء تلقائي: انقضى تاريخ الخروج بـ '
                     || (current_date - r.check_out_date)::text || ' يوماً'
       where id = r.id;

      insert into public.system_alerts (company_id, source, severity, code, message, context)
      values (r.company_id, 'operations', 'medium', 'booking_auto_checkout',
              'أُنهي حجز تلقائياً بعد انقضاء تاريخ الخروج — راجع التسوية ومحضر التسليم',
              jsonb_build_object('booking_id', r.id, 'unit', r.unit_number,
                                 'check_out_date', r.check_out_date));
    end if;
  end loop;

  if not p_dry and n > 0 then
    insert into public.system_repair_log (check_id, status, source, category, executed_by, affected_rows, details)
    values ('booking_auto_checkout', 'success', 'system', 'data', auth.uid(), n,
            jsonb_build_object('closed', n, 'bookings', v_list));
  end if;

  return jsonb_build_object('ok', true, 'dry_run', p_dry, 'count', n, 'bookings', v_list);
end $$;
grant execute on function public.booking_auto_checkout(boolean, int) to authenticated;

-- ---------------------------------------------------------------------
-- فحوص دائمة على الحجوزات وحالات الوحدات
-- ---------------------------------------------------------------------
create or replace function public.ci_booking_checks()
returns table (o_suite text, o_name text, o_category text, o_status text,
               o_message text, o_meta jsonb, o_fix text)
language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v int;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*) into v from public.bookings
   where status::text = 'checked_in' and check_out_date < current_date - interval '1 day';
  return query select 'operations','لا حجوزات راكدة بعد تاريخ الخروج','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'كل الحجوزات المنتهية مُخلاة'
         else v || ' حجزاً ما زال «مُسجَّل دخول» بعد انقضاء تاريخ خروجه — الوحدة محجوزة بلا سبب' end,
    jsonb_build_object('stale_bookings', v), 'booking_checkout'::text;

  select count(*) into v from public.units u
   where u.status::text in ('occupied','reserved','reserved_online')
     and not exists (select 1 from public.bookings b
                      where b.unit_id = u.id
                        and b.status::text in ('confirmed','checked_in','reserved_online'));
  return query select 'operations','لا وحدة مشغولة بلا حجز نشط','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'حالات الوحدات متسقة مع حجوزاتها'
         else v || ' وحدة معلّمة مشغولة بلا حجز نشط' end,
    jsonb_build_object('orphan_occupied', v), 'unit_status_sync'::text;

  select count(*) into v from public.units u
   where u.status::text = 'available'
     and exists (select 1 from public.bookings b where b.unit_id = u.id and b.status::text = 'checked_in');
  return query select 'operations','لا وحدة متاحة وعليها نزيل','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'لا تعارض' else v || ' وحدة متاحة رغم وجود نزيل مسجَّل دخوله' end,
    jsonb_build_object('conflicting_units', v), 'unit_status_sync'::text;

  select count(*) into v from public.bookings a join public.bookings b
    on a.unit_id = b.unit_id and a.id < b.id
   and a.status::text in ('confirmed','checked_in') and b.status::text in ('confirmed','checked_in')
   and a.check_in_date < b.check_out_date and b.check_in_date < a.check_out_date;
  return query select 'operations','لا تداخل حجوزات على وحدة واحدة','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'لا تداخل' else v || ' تداخل حجوزات' end,
    jsonb_build_object('overlaps', v), null::text;

  select count(*) into v from public.units
   where unit_number ilike '%TEST%' or unit_number ilike 'ZZ%' or unit_number = 'test';
  return query select 'operations','لا وحدات اختبار في بيانات الإنتاج','data',
    case when v = 0 then 'pass' else 'warn' end,
    case when v = 0 then 'لا وحدات اختبار'
         else v || ' وحدة بأسماء اختبارية — راجعها واحذفها يدوياً إن لم تكن حقيقية' end,
    jsonb_build_object('test_units', v), null::text;
end $$;
revoke all on function public.ci_booking_checks() from public, anon;
grant execute on function public.ci_booking_checks() to authenticated;

-- ---------------------------------------------------------------------
-- مزامنة حالات الوحدات مع حجوزاتها
-- ---------------------------------------------------------------------
create or replace function public.unit_status_resync(p_dry boolean default true)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare n1 int := 0; n2 int := 0;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- (أ) وحدة مشغولة بلا حجز نشط → متاحة
  if p_dry then
    select count(*) into n1 from public.units u
     where u.status::text in ('occupied','reserved','reserved_online')
       and not exists (select 1 from public.bookings b where b.unit_id=u.id
                        and b.status::text in ('confirmed','checked_in','reserved_online'));
  else
    with x as (
      update public.units u set status = 'available'
       where u.status::text in ('occupied','reserved','reserved_online')
         and not exists (select 1 from public.bookings b where b.unit_id=u.id
                          and b.status::text in ('confirmed','checked_in','reserved_online'))
      returning 1) select count(*) into n1 from x;
  end if;

  -- (ب) وحدة متاحة وعليها نزيل مسجَّل دخوله → مشغولة
  if p_dry then
    select count(*) into n2 from public.units u
     where u.status::text = 'available'
       and exists (select 1 from public.bookings b where b.unit_id=u.id and b.status::text='checked_in');
  else
    with y as (
      update public.units u set status = 'occupied'
       where u.status::text = 'available'
         and exists (select 1 from public.bookings b where b.unit_id=u.id and b.status::text='checked_in')
      returning 1) select count(*) into n2 from y;
  end if;

  if not p_dry and (n1 + n2) > 0 then
    insert into public.system_repair_log (check_id, status, source, category, executed_by, affected_rows, details)
    values ('unit_status_sync', 'success', 'system', 'data', auth.uid(), n1 + n2,
            jsonb_build_object('freed', n1, 'occupied', n2));
  end if;

  return jsonb_build_object('ok', true, 'dry_run', p_dry, 'freed', n1, 'occupied', n2);
end $$;
grant execute on function public.unit_status_resync(boolean) to authenticated;

-- دوال الإصلاح للكتالوج
create or replace function public.booking_checkout_all()
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare j jsonb; begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode='42501'; end if;
  j := public.booking_auto_checkout(false, 1);
  return coalesce((j->>'count')::int, 0);
end $$;
revoke all on function public.booking_checkout_all() from public, anon, authenticated;

create or replace function public.unit_status_sync_all()
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare j jsonb; begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode='42501'; end if;
  j := public.unit_status_resync(false);
  return coalesce((j->>'freed')::int,0) + coalesce((j->>'occupied')::int,0);
end $$;
revoke all on function public.unit_status_sync_all() from public, anon, authenticated;

insert into public.ci_fix_catalog (check_id, title, description, fix_function) values
  ('booking_checkout', 'إخلاء الحجوزات المنتهية',
   'يُنهي كل حجز ما زال «مُسجَّل دخول» بعد انقضاء تاريخ خروجه بيوم، ويحرّر وحدته',
   'booking_checkout_all'),
  ('unit_status_sync', 'مزامنة حالات الوحدات',
   'يُصحّح الوحدات المعلَّمة مشغولة بلا حجز نشط، والمتاحة رغم وجود نزيل',
   'unit_status_sync_all')
on conflict (check_id) do update
  set fix_function = excluded.fix_function,
      title = excluded.title, description = excluded.description;

-- جدولة يومية داخل القاعدة: لا HTTP ولا مفاتيح، فلا تنكسر بصمت
do $$
begin
  perform cron.unschedule('booking_auto_checkout_daily');
exception when others then null;
end $$;

select cron.schedule(
  'booking_auto_checkout_daily', '30 2 * * *',
  $cron$ select public.booking_auto_checkout(false, 1); $cron$);
