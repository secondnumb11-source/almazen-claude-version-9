-- ============================================================================
-- الإغلاق النهائي لبنود الفروع والتدقيق — آمن للتنفيذ المتكرر
-- 1) إزالة bootstrap_owner القديمة وغير المستخدمة بعد انتقال إنشاء المالك إلى trigger التسجيل.
-- 2) منع حذف فرع ما دام مرتبطاً ببيانات تشغيلية أو مستخدمين.
-- 3) ضمان تسجيل كل تغيّر في حالة الإحالات والمكافآت، حتى لو تم خارج RPC الإدارة.
-- 4) فهارس مساعدة لفلاتر الفرع والزمن الحقيقي.
-- ============================================================================

create extension if not exists btree_gist;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.bookings'::regclass
       and conname = 'no_double_booking'
       and contype = 'x'
  ) then
    alter table public.bookings
      add constraint no_double_booking
      exclude using gist (
        unit_id with =,
        daterange(check_in_date, check_out_date, '[)') with &&
      ) where (status in ('confirmed','checked_in'));
  end if;
end $$;

-- الاسم الجديد يزيل الدالة القديمة دون كسر مسار استكمال الحسابات التاريخية
-- التي أُنشئت قبل تفعيل trigger handle_new_user.
create or replace function public.finalize_owner_setup(
  p_company_name text,
  p_full_name text,
  p_vat_number text default null,
  p_phone text default null,
  p_id_or_cr text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_co uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  if coalesce(btrim(p_company_name),'') = '' or coalesce(btrim(p_full_name),'') = '' then
    raise exception 'اسم المنشأة والاسم الكامل مطلوبان' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'PROFILE_EXISTS' using errcode = '23505';
  end if;

  insert into public.companies (
    name, vat_number, owner_phone, owner_id_or_cr, plan, trial_started_at, trial_ends_at
  ) values (
    btrim(p_company_name), nullif(btrim(p_vat_number),''), nullif(btrim(p_phone),''),
    nullif(btrim(p_id_or_cr),''), 'trial', now(), now() + interval '7 days'
  ) returning id into v_co;

  insert into public.profiles (id, company_id, role, full_name)
    values (v_uid, v_co, 'owner', btrim(p_full_name));
  return v_co;
end;
$$;

revoke all on function public.finalize_owner_setup(text,text,text,text,text) from public;
grant execute on function public.finalize_owner_setup(text,text,text,text,text) to authenticated;
grant all on function public.finalize_owner_setup(text,text,text,text,text) to service_role;
drop function if exists public.bootstrap_owner(text, text, text, text, text);

create or replace function public.branch_delete_impact(p_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table text;
  v_count bigint;
  v_total bigint := 0;
  v_details jsonb := '{}'::jsonb;
  v_company uuid;
begin
  select company_id into v_company from public.branches where id = p_branch_id;
  if v_company is null then raise exception 'BRANCH_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_super_admin() or (public.can_manage_branches() and v_company = public.current_company_id())) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  foreach v_table in array array[
    'user_branches','units','bookings','customers','payments','expenses','maintenance_requests',
    'journal_entries','invoices','contracts','vouchers','tenants','properties','branches_audit_log'
  ] loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = v_table and column_name = 'branch_id'
    ) then
      execute format('select count(*) from public.%I where branch_id = $1', v_table)
        into v_count using p_branch_id;
      v_total := v_total + v_count;
      if v_count > 0 then v_details := v_details || jsonb_build_object(v_table, v_count); end if;
    end if;
  end loop;
  return jsonb_build_object('total', v_total, 'details', v_details);
end;
$$;

grant execute on function public.branch_delete_impact(uuid) to authenticated;
grant all on function public.branch_delete_impact(uuid) to service_role;

create or replace function public.protect_branch_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table text;
  v_count bigint;
begin
  if not (public.is_super_admin() or public.can_manage_branches()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if exists (select 1 from public.user_branches where branch_id = old.id) then
    raise exception 'BRANCH_HAS_USERS: ألغِ إسناد المستخدمين قبل حذف الفرع' using errcode = '23503';
  end if;

  foreach v_table in array array[
    'units','bookings','customers','payments','expenses','maintenance_requests',
    'journal_entries','invoices','contracts','vouchers','tenants','properties','branches_audit_log'
  ] loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = v_table and column_name = 'branch_id'
    ) then
      execute format('select count(*) from public.%I where branch_id = $1', v_table)
        into v_count using old.id;
      if v_count > 0 then
        raise exception 'BRANCH_HAS_DATA: الفرع مرتبط ببيانات تشغيلية في % ولا يمكن حذفه؛ أوقفه بدلاً من ذلك', v_table
          using errcode = '23503';
      end if;
    end if;
  end loop;
  return old;
end;
$$;

drop trigger if exists trg_protect_branch_delete on public.branches;
create trigger trg_protect_branch_delete
before delete on public.branches
for each row execute function public.protect_branch_delete();

create or replace function public.audit_referral_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  v_action := case when tg_op = 'INSERT' then 'create' else 'status_change' end;
  insert into public.referral_audit_log (
    reward_id, referral_id, request_no, entity, action, old_status, new_status,
    months_applied, cash_amount, beneficiary_name, referred_company_name,
    actor_id, actor_name, actor_email, note
  ) values (
    null, new.id, null, 'referral', v_action,
    case when tg_op = 'UPDATE' then old.status else null end,
    new.status, null, null, new.referrer_name, new.referred_company_name,
    auth.uid(), coalesce(auth.jwt()->>'name', auth.jwt()->>'email', 'النظام'), auth.jwt()->>'email',
    'تسجيل موحّد تلقائي لتغيير حالة الإحالة'
  );
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_audit_referral_status on public.referrals;
create trigger trg_audit_referral_status
after insert or update of status on public.referrals
for each row execute function public.audit_referral_status_change();

create or replace function public.audit_referral_reward_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  insert into public.referral_audit_log (
    reward_id, referral_id, request_no, entity, action, old_status, new_status,
    months_applied, cash_amount, beneficiary_name, actor_id, actor_name, actor_email, note
  ) values (
    new.id, new.referral_id, new.request_no, 'reward',
    case when tg_op = 'INSERT' then 'create' else 'status_change' end,
    case when tg_op = 'UPDATE' then old.status else null end,
    new.status, new.months, new.cash_amount, new.beneficiary_name,
    auth.uid(), coalesce(auth.jwt()->>'name', auth.jwt()->>'email', 'النظام'), auth.jwt()->>'email',
    'تسجيل موحّد تلقائي لتغيير حالة مكافأة الإحالة'
  );
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_audit_referral_reward_status on public.referral_rewards;
create trigger trg_audit_referral_reward_status
after insert or update of status on public.referral_rewards
for each row execute function public.audit_referral_reward_status_change();

-- الدوال الإدارية الحالية تستدعي referral_audit_write بعد التحديث. عند وجود
-- السجل التلقائي في نفس المعاملة نُثريه باسم الإجراء بدل إضافة صف مكرر.
create or replace function public.referral_audit_write(
  p_reward_id uuid, p_referral_id uuid, p_request_no text, p_entity text, p_action text,
  p_old text, p_new text, p_months integer, p_cash numeric,
  p_beneficiary text, p_referred text, p_note text
) returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_name text; v_email text; v_updated integer;
begin
  select coalesce(p.full_name, u.email), u.email into v_name, v_email
    from auth.users u left join public.profiles p on p.id = u.id where u.id = auth.uid();

  update public.referral_audit_log
     set action = p_action, request_no = coalesce(p_request_no, request_no),
         months_applied = coalesce(p_months, months_applied), cash_amount = coalesce(p_cash, cash_amount),
         beneficiary_name = coalesce(p_beneficiary, beneficiary_name),
         referred_company_name = coalesce(p_referred, referred_company_name), note = coalesce(p_note, note),
         actor_id = auth.uid(), actor_name = coalesce(v_name, actor_name, '—'), actor_email = coalesce(v_email, actor_email)
   where id = (
     select id from public.referral_audit_log
      where entity = coalesce(p_entity,'reward')
        and reward_id is not distinct from p_reward_id
        and referral_id is not distinct from p_referral_id
        and old_status is not distinct from p_old
        and new_status is not distinct from p_new
        and action in ('create','status_change')
      order by created_at desc limit 1
   );
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    insert into public.referral_audit_log (
      reward_id, referral_id, request_no, entity, action, old_status, new_status,
      months_applied, cash_amount, beneficiary_name, referred_company_name,
      actor_id, actor_name, actor_email, note
    ) values (
      p_reward_id, p_referral_id, p_request_no, coalesce(p_entity,'reward'), p_action, p_old, p_new,
      p_months, p_cash, p_beneficiary, p_referred, auth.uid(), coalesce(v_name,'—'), v_email, p_note
    );
  end if;
end $$;

create index if not exists idx_units_company_branch on public.units(company_id, branch_id);
create index if not exists idx_bookings_company_branch on public.bookings(company_id, branch_id);
create index if not exists idx_customers_company_branch on public.customers(company_id, branch_id);
create index if not exists idx_payments_company_branch on public.payments(company_id, branch_id);
create index if not exists idx_expenses_company_branch on public.expenses(company_id, branch_id);
create index if not exists idx_maintenance_company_branch on public.maintenance_requests(company_id, branch_id);

grant execute on function public.protect_branch_delete() to authenticated;
grant all on function public.protect_branch_delete() to service_role;
grant all on function public.referral_audit_write(uuid,uuid,text,text,text,text,text,integer,numeric,text,text,text) to service_role;
grant all on function public.audit_referral_status_change() to service_role;
grant all on function public.audit_referral_reward_status_change() to service_role;