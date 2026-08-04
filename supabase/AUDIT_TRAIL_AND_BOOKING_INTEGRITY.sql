-- =====================================================================
-- AUDIT_TRAIL_AND_BOOKING_INTEGRITY.sql
-- 1) سجل نشاط موحّد (audit_logs) لتغييرات الاشتراكات والحجوزات مع الطابع الزمني
-- 2) دالة فحص توفر الوحدة قبل الحجز (منع التداخل بين الحجوزات المتزامنة)
-- ملاحظة استقرار: كل المشغّلات (triggers) محاطة بـ EXCEPTION WHEN OTHERS
-- فلا يمكن لأي خطأ في التسجيل أن يُعطّل عملية الحجز أو تعديل الاشتراك.
-- الملف idempotent (يمكن تشغيله أكثر من مرة بأمان).
-- =====================================================================

-- ---------------------------------------------------------------
-- 1) تسجيل تغييرات الاشتراك على جدول companies
-- ---------------------------------------------------------------
create or replace function public.trg_fn_audit_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _changed boolean := false;
begin
  begin
    _changed :=
      (new.plan is distinct from old.plan)
      or (new.subscription_status is distinct from old.subscription_status)
      or (new.subscription_ends_at is distinct from old.subscription_ends_at)
      or (new.subscription_end is distinct from old.subscription_end)
      or (new.subscription_start is distinct from old.subscription_start)
      or (new.trial_ends_at is distinct from old.trial_ends_at)
      or (new.activated_by_admin is distinct from old.activated_by_admin);

    if _changed then
      insert into public.audit_logs (company_id, user_id, action, entity, entity_id, old_data, new_data)
      values (
        new.id,
        auth.uid(),
        'subscription_change',
        'subscriptions',
        new.id,
        jsonb_build_object(
          'plan', old.plan,
          'subscription_status', old.subscription_status,
          'subscription_ends_at', old.subscription_ends_at,
          'trial_ends_at', old.trial_ends_at,
          'activated_by_admin', old.activated_by_admin
        ),
        jsonb_build_object(
          'plan', new.plan,
          'subscription_status', new.subscription_status,
          'subscription_ends_at', new.subscription_ends_at,
          'trial_ends_at', new.trial_ends_at,
          'activated_by_admin', new.activated_by_admin,
          'company_name', new.name,
          'at', now(),
          'summary', concat(
            'تغيير اشتراك: ', coalesce(new.name, ''),
            ' — الباقة ', coalesce(old.plan::text, '—'), ' ← ', coalesce(new.plan::text, '—'),
            ' | الانتهاء ', coalesce(old.subscription_ends_at::text, '—'), ' ← ',
            coalesce(new.subscription_ends_at::text, '—')
          )
        )
      );
    end if;
  exception when others then
    null; -- التسجيل لا يجب أن يُعطّل العملية الأساسية
  end;
  return new;
end;
$$;

drop trigger if exists trg_audit_subscription on public.companies;
create trigger trg_audit_subscription
after update on public.companies
for each row execute function public.trg_fn_audit_subscription();

-- ---------------------------------------------------------------
-- 2) تسجيل تغييرات الحجوزات (إنشاء / حالة / تواريخ / وحدة)
-- ---------------------------------------------------------------
create or replace function public.trg_fn_audit_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _unit text;
begin
  begin
    select u.unit_number into _unit from public.units u where u.id = new.unit_id;

    if tg_op = 'INSERT' then
      insert into public.audit_logs (company_id, user_id, action, entity, entity_id, old_data, new_data)
      values (new.company_id, auth.uid(), 'booking_create', 'bookings', new.id, null,
        jsonb_build_object(
          'status', new.status, 'unit_id', new.unit_id, 'unit_number', _unit,
          'check_in_date', new.check_in_date, 'check_out_date', new.check_out_date,
          'total_amount', new.total_amount, 'at', now(),
          'summary', concat('حجز جديد على الوحدة ', coalesce(_unit, '—'),
                            ' من ', new.check_in_date, ' إلى ', new.check_out_date,
                            ' — الحالة ', new.status)
        ));
    elsif (new.status is distinct from old.status)
       or (new.check_in_date is distinct from old.check_in_date)
       or (new.check_out_date is distinct from old.check_out_date)
       or (new.unit_id is distinct from old.unit_id) then
      insert into public.audit_logs (company_id, user_id, action, entity, entity_id, old_data, new_data)
      values (new.company_id, auth.uid(), 'booking_update', 'bookings', new.id,
        jsonb_build_object('status', old.status, 'unit_id', old.unit_id,
                           'check_in_date', old.check_in_date, 'check_out_date', old.check_out_date),
        jsonb_build_object(
          'status', new.status, 'unit_id', new.unit_id, 'unit_number', _unit,
          'check_in_date', new.check_in_date, 'check_out_date', new.check_out_date, 'at', now(),
          'summary', concat('تعديل حجز الوحدة ', coalesce(_unit, '—'),
                            ' — الحالة ', coalesce(old.status::text, '—'), ' ← ', new.status,
                            ' | المدة ', new.check_in_date, ' → ', new.check_out_date)
        ));
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_audit_booking on public.bookings;
create trigger trg_audit_booking
after insert or update on public.bookings
for each row execute function public.trg_fn_audit_booking();

-- ---------------------------------------------------------------
-- 3) فحص توفر الوحدة قبل الحجز (نفس منطق قيد no_double_booking)
--    يُستخدم للتحقق المسبق في الواجهة ولإعطاء رسالة واضحة للمستخدم.
-- ---------------------------------------------------------------
create or replace function public.check_unit_availability(
  _unit_id uuid,
  _check_in date,
  _check_out date,
  _exclude_booking uuid default null
)
returns table (available boolean, conflicts jsonb)
language sql
stable
security invoker
set search_path = public
as $$
  with c as (
    select b.id, b.check_in_date, b.check_out_date, b.status
    from public.bookings b
    where b.unit_id = _unit_id
      and b.status in ('confirmed', 'checked_in')
      and (_exclude_booking is null or b.id <> _exclude_booking)
      and daterange(b.check_in_date, b.check_out_date, '[)')
          && daterange(_check_in, _check_out, '[)')
  )
  select (not exists (select 1 from c)),
         coalesce((select jsonb_agg(to_jsonb(c)) from c), '[]'::jsonb);
$$;

grant execute on function public.check_unit_availability(uuid, date, date, uuid) to authenticated;

-- ---------------------------------------------------------------
-- 4) فهرس لتسريع صفحة سجل النشاط
-- ---------------------------------------------------------------
create index if not exists idx_audit_logs_created_at on public.audit_logs (created_at desc);
create index if not exists idx_audit_logs_entity on public.audit_logs (entity, created_at desc);
