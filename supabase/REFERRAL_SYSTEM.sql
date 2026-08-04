-- ============================================================================
--  نظام الترشيح / الإحالة (Referral System) — منصة المازن
--  ملف مستقل تماماً: لا يعدّل أي جدول أو دالة قائمة، فقط يضيف جداول ودوال جديدة.
--  آمن للتنفيذ أكثر من مرة (idempotent).
-- ============================================================================

-- ---------------------------------------------------------------- 1) الجداول
create table if not exists public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  owner_profile_id uuid references public.profiles(id) on delete set null,
  owner_company_id uuid references public.companies(id) on delete cascade,
  owner_name text not null,
  owner_role text,
  owner_phone text,
  owner_email text,
  is_external boolean not null default false,   -- رابط أنشأه السوبر أدمن لشخص بلا حساب
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_referral_codes_company on public.referral_codes(owner_company_id);
create index if not exists idx_referral_codes_profile on public.referral_codes(owner_profile_id);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.referral_codes(id) on delete cascade,
  code text not null,
  referrer_profile_id uuid references public.profiles(id) on delete set null,
  referrer_company_id uuid references public.companies(id) on delete set null,
  referrer_name text,
  referred_company_id uuid references public.companies(id) on delete cascade,
  referred_company_name text,
  referred_owner_name text,
  referred_email text,
  referred_phone text,
  status text not null default 'registered',  -- registered | paid | cancelled
  paid_at timestamptz,
  milestone_consumed boolean not null default false,
  signed_up_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (referred_company_id)
);
create index if not exists idx_referrals_code on public.referrals(code_id);
create index if not exists idx_referrals_referrer_co on public.referrals(referrer_company_id);

create sequence if not exists public.referral_reward_no_seq;

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  request_no text not null default ('REF-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.referral_reward_no_seq')::text, 5, '0')),
  referral_id uuid references public.referrals(id) on delete set null,
  code_id uuid references public.referral_codes(id) on delete set null,
  beneficiary text not null,                  -- referrer | referred
  beneficiary_profile_id uuid references public.profiles(id) on delete set null,
  beneficiary_company_id uuid references public.companies(id) on delete set null,
  beneficiary_name text,
  contact_name text,
  contact_phone text,
  contact_email text,
  kind text not null,                         -- months | cash
  months integer default 0,
  cash_amount numeric default 0,
  tier text not null default 'single',        -- single (3 أشهر/200) | milestone (سنة/600)
  status text not null default 'pending_admin', -- pending_admin | approved | rejected | paid
  admin_note text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_referral_rewards_company on public.referral_rewards(beneficiary_company_id);
create index if not exists idx_referral_rewards_status on public.referral_rewards(status);

-- ------------------------------------------------------- 2) الصلاحيات و RLS
grant select on public.referral_codes, public.referrals, public.referral_rewards to authenticated;
grant all on public.referral_codes, public.referrals, public.referral_rewards to service_role;
grant usage, select on sequence public.referral_reward_no_seq to authenticated, service_role;

alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
alter table public.referral_rewards enable row level security;

-- شركة المستخدم الحالي (بدون تكرار RLS)
create or replace function public.referral_my_company()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select company_id from public.profiles where id = auth.uid()
$$;

drop policy if exists rc_select on public.referral_codes;
create policy rc_select on public.referral_codes for select to authenticated
  using (public.is_super_admin() or owner_company_id = public.referral_my_company());

drop policy if exists rf_select on public.referrals;
create policy rf_select on public.referrals for select to authenticated
  using (
    public.is_super_admin()
    or referrer_company_id = public.referral_my_company()
    or referred_company_id = public.referral_my_company()
  );

drop policy if exists rw_select on public.referral_rewards;
create policy rw_select on public.referral_rewards for select to authenticated
  using (public.is_super_admin() or beneficiary_company_id = public.referral_my_company());

-- كل الكتابة تتم عبر دوال SECURITY DEFINER فقط (لا سياسات insert/update للعملاء).

-- ------------------------------------------------------------ 3) دوال مساعدة
create or replace function public.referral_gen_code()
returns text language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v text;
begin
  loop
    v := 'MZ' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 6));
    exit when not exists (select 1 from public.referral_codes where code = v);
  end loop;
  return v;
end $$;

-- كود المستخدم الحالي (يُنشأ تلقائياً عند أول طلب)
create or replace function public.referral_my_code()
returns public.referral_codes language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_p   public.profiles;
  v_row public.referral_codes;
  v_email text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  select * into v_p from public.profiles where id = v_uid;
  if v_p.id is null then raise exception 'PROFILE_NOT_FOUND' using errcode='42704'; end if;

  select * into v_row from public.referral_codes
   where owner_profile_id = v_uid and is_external = false limit 1;
  if v_row.id is not null then return v_row; end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.referral_codes (code, owner_profile_id, owner_company_id, owner_name, owner_role, owner_phone, owner_email, created_by)
  values (public.referral_gen_code(), v_uid, v_p.company_id, coalesce(v_p.full_name,'مستخدم'), v_p.role::text, v_p.phone, v_email, v_uid)
  returning * into v_row;
  return v_row;
end $$;

-- التحقق من كود ترشيح (متاح للزوار أثناء التسجيل)
create or replace function public.referral_lookup_code(p_code text)
returns table(valid boolean, code text, owner_name text, owner_role text, is_external boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select true, c.code, c.owner_name, c.owner_role, c.is_external
    from public.referral_codes c
   where upper(btrim(p_code)) = c.code and c.is_active
   limit 1
$$;

-- ربط منشأة جديدة بكود الترشيح (يستدعيه المالك الجديد بعد تأسيس منشأته)
create or replace function public.referral_register_signup(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_p public.profiles;
  v_c public.referral_codes;
  v_co public.companies;
  v_email text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  select * into v_p from public.profiles where id = v_uid;
  if v_p.id is null then return jsonb_build_object('ok', false, 'reason', 'no_profile'); end if;

  select * into v_c from public.referral_codes where code = upper(btrim(p_code)) and is_active limit 1;
  if v_c.id is null then return jsonb_build_object('ok', false, 'reason', 'invalid_code'); end if;
  if v_c.owner_company_id is not null and v_c.owner_company_id = v_p.company_id then
    return jsonb_build_object('ok', false, 'reason', 'self_referral');
  end if;
  if exists (select 1 from public.referrals where referred_company_id = v_p.company_id) then
    return jsonb_build_object('ok', false, 'reason', 'already_referred');
  end if;

  select * into v_co from public.companies where id = v_p.company_id;
  select email into v_email from auth.users where id = v_uid;

  insert into public.referrals (
    code_id, code, referrer_profile_id, referrer_company_id, referrer_name,
    referred_company_id, referred_company_name, referred_owner_name, referred_email, referred_phone
  ) values (
    v_c.id, v_c.code, v_c.owner_profile_id, v_c.owner_company_id, v_c.owner_name,
    v_p.company_id, v_co.name, v_p.full_name, v_email, coalesce(v_p.phone, v_co.owner_phone)
  );

  return jsonb_build_object('ok', true, 'referrer_name', v_c.owner_name, 'code', v_c.code);
end $$;

-- بيانات الترشيح الخاصة بمنشأتي (تظهر لكل موظفي المنشأة — معزولة عن باقي المنشآت)
create or replace function public.referral_my_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_p public.profiles;
  v_codes jsonb; v_refs jsonb; v_rewards jsonb; v_incoming jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  select * into v_p from public.profiles where id = v_uid;
  if v_p.id is null then return jsonb_build_object('ok', false); end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb) into v_codes
    from public.referral_codes c where c.owner_company_id = v_p.company_id;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) into v_refs
    from public.referrals r where r.referrer_company_id = v_p.company_id;

  select coalesce(jsonb_agg(to_jsonb(w) order by w.created_at desc), '[]'::jsonb) into v_rewards
    from public.referral_rewards w where w.beneficiary_company_id = v_p.company_id;

  select to_jsonb(r) into v_incoming
    from public.referrals r where r.referred_company_id = v_p.company_id limit 1;

  return jsonb_build_object(
    'ok', true,
    'my_role', v_p.role::text,
    'company_id', v_p.company_id,
    'codes', v_codes,
    'referrals', v_refs,
    'rewards', v_rewards,
    'incoming', coalesce(v_incoming, 'null'::jsonb),
    'paid_unclaimed', (
      select count(*) from public.referrals r
       where r.referrer_company_id = v_p.company_id and r.status = 'paid' and r.milestone_consumed = false
    )
  );
end $$;

-- طلب مكافأة إحالة مفردة (3 أشهر أو 200 ريال) — يتطلب سداد المشترك الجديد
create or replace function public.referral_claim(
  p_referral_id uuid, p_kind text, p_contact_name text default null,
  p_contact_phone text default null, p_contact_email text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_p public.profiles;
  v_r public.referrals;
  v_new public.referral_rewards;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  if p_kind not in ('months','cash') then raise exception 'نوع المكافأة غير صحيح'; end if;
  select * into v_p from public.profiles where id = v_uid;
  select * into v_r from public.referrals where id = p_referral_id;
  if v_r.id is null or v_r.referrer_company_id is distinct from v_p.company_id then
    raise exception 'الإحالة غير موجودة أو لا تخص منشأتك' using errcode='42501';
  end if;
  if v_r.status <> 'paid' then
    raise exception 'لا يمكن المطالبة قبل سداد المشترك الجديد لاشتراكه' using errcode='22023';
  end if;
  if exists (select 1 from public.referral_rewards w
              where w.referral_id = v_r.id and w.beneficiary = 'referrer' and w.status <> 'rejected') then
    raise exception 'سبق تقديم طلب لهذه الإحالة' using errcode='23505';
  end if;

  insert into public.referral_rewards (
    referral_id, code_id, beneficiary, beneficiary_profile_id, beneficiary_company_id, beneficiary_name,
    contact_name, contact_phone, contact_email, kind, months, cash_amount, tier
  ) values (
    v_r.id, v_r.code_id, 'referrer', v_uid, v_p.company_id, v_p.full_name,
    coalesce(p_contact_name, v_p.full_name), coalesce(p_contact_phone, v_p.phone), p_contact_email,
    p_kind, case when p_kind='months' then 3 else 0 end,
    case when p_kind='cash' then 200 else 0 end, 'single'
  ) returning * into v_new;

  -- مكافأة المشترك الجديد (3 أشهر) تُنشأ تلقائياً كطلب بانتظار اعتماد السوبر أدمن
  if not exists (select 1 from public.referral_rewards w
                  where w.referral_id = v_r.id and w.beneficiary = 'referred' and w.status <> 'rejected') then
    insert into public.referral_rewards (
      referral_id, code_id, beneficiary, beneficiary_company_id, beneficiary_name, kind, months, tier
    ) values (
      v_r.id, v_r.code_id, 'referred', v_r.referred_company_id, v_r.referred_company_name, 'months', 3, 'single'
    );
  end if;

  return to_jsonb(v_new);
end $$;

-- طلب مكافأة إنجاز 3 اشتراكات (سنة كاملة أو 600 ريال)
create or replace function public.referral_claim_milestone(
  p_kind text, p_contact_name text default null,
  p_contact_phone text default null, p_contact_email text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_p public.profiles;
  v_ids uuid[];
  v_new public.referral_rewards;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  if p_kind not in ('months','cash') then raise exception 'نوع المكافأة غير صحيح'; end if;
  select * into v_p from public.profiles where id = v_uid;

  select array_agg(id) into v_ids from (
    select id from public.referrals
     where referrer_company_id = v_p.company_id and status = 'paid' and milestone_consumed = false
     order by paid_at nulls last, created_at limit 3
  ) t;

  if v_ids is null or array_length(v_ids,1) < 3 then
    raise exception 'تحتاج 3 اشتراكات مسددة غير مستخدمة لتفعيل هذه المكافأة' using errcode='22023';
  end if;

  update public.referrals set milestone_consumed = true where id = any(v_ids);

  insert into public.referral_rewards (
    code_id, beneficiary, beneficiary_profile_id, beneficiary_company_id, beneficiary_name,
    contact_name, contact_phone, contact_email, kind, months, cash_amount, tier
  ) values (
    (select code_id from public.referrals where id = v_ids[1]),
    'referrer', v_uid, v_p.company_id, v_p.full_name,
    coalesce(p_contact_name, v_p.full_name), coalesce(p_contact_phone, v_p.phone), p_contact_email,
    p_kind, case when p_kind='months' then 12 else 0 end,
    case when p_kind='cash' then 600 else 0 end, 'milestone'
  ) returning * into v_new;

  return to_jsonb(v_new);
end $$;

-- ------------------------------------------------------ 4) دوال السوبر أدمن
create or replace function public.super_admin_referrals_overview()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_codes jsonb; v_refs jsonb; v_rewards jsonb;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;

  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_codes from (
    select to_jsonb(c) || jsonb_build_object(
      'company_name', co.name,
      'signups', (select count(*) from public.referrals r where r.code_id = c.id),
      'paid_signups', (select count(*) from public.referrals r where r.code_id = c.id and r.status='paid')
    ) x
    from public.referral_codes c left join public.companies co on co.id = c.owner_company_id
  ) s;

  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_refs from (
    select to_jsonb(r) || jsonb_build_object(
      'referrer_company_name', rc.name,
      'referred_plan', nc.plan,
      'referred_subscription_ends_at', nc.subscription_ends_at,
      'referred_trial_ends_at', nc.trial_ends_at,
      'referred_created_at', nc.created_at
    ) x
    from public.referrals r
    left join public.companies rc on rc.id = r.referrer_company_id
    left join public.companies nc on nc.id = r.referred_company_id
  ) s;

  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_rewards from (
    select to_jsonb(w) || jsonb_build_object(
      'company_name', co.name,
      'referred_company_name', r.referred_company_name,
      'referral_code', r.code
    ) x
    from public.referral_rewards w
    left join public.companies co on co.id = w.beneficiary_company_id
    left join public.referrals r on r.id = w.referral_id
  ) s;

  return jsonb_build_object('ok', true, 'codes', v_codes, 'referrals', v_refs, 'rewards', v_rewards);
end $$;

-- توليد رابط ترشيح لشخص بلا حساب
create or replace function public.super_admin_create_external_code(
  p_owner_name text, p_phone text default null, p_email text default null, p_notes text default null
) returns public.referral_codes language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_row public.referral_codes;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if coalesce(btrim(p_owner_name),'') = '' then raise exception 'اسم صاحب الرابط مطلوب'; end if;
  insert into public.referral_codes (code, owner_name, owner_role, owner_phone, owner_email, is_external, notes, created_by)
  values (public.referral_gen_code(), btrim(p_owner_name), 'external', p_phone, p_email, true, p_notes, auth.uid())
  returning * into v_row;
  return v_row;
end $$;

-- تعليم اشتراك المشترك الجديد كمسدَّد (يفتح المطالبة بالمكافآت)
create or replace function public.super_admin_referral_set_paid(p_referral_id uuid, p_paid boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_r public.referrals;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  update public.referrals
     set status = case when p_paid then 'paid' else 'registered' end,
         paid_at = case when p_paid then now() else null end
   where id = p_referral_id returning * into v_r;
  return to_jsonb(v_r);
end $$;

-- اعتماد أو رفض طلب المكافأة — التمديد لا يحدث إلا بعد الاعتماد
create or replace function public.super_admin_referral_decide(
  p_reward_id uuid, p_action text, p_note text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_w public.referral_rewards; v_co public.companies; v_base timestamptz;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_action not in ('approve','reject','mark_paid') then raise exception 'إجراء غير معروف'; end if;
  select * into v_w from public.referral_rewards where id = p_reward_id;
  if v_w.id is null then raise exception 'الطلب غير موجود'; end if;

  if p_action = 'reject' then
    update public.referral_rewards set status='rejected', admin_note=p_note, decided_at=now(), decided_by=auth.uid()
     where id = p_reward_id returning * into v_w;
    return to_jsonb(v_w);
  end if;

  if p_action = 'mark_paid' then
    update public.referral_rewards set status='paid', admin_note=coalesce(p_note, admin_note), decided_at=now(), decided_by=auth.uid()
     where id = p_reward_id returning * into v_w;
    return to_jsonb(v_w);
  end if;

  -- approve
  if v_w.kind = 'months' and v_w.beneficiary_company_id is not null and coalesce(v_w.months,0) > 0 then
    select * into v_co from public.companies where id = v_w.beneficiary_company_id;
    v_base := greatest(coalesce(v_co.subscription_ends_at, v_co.trial_ends_at, now()), now());
    update public.companies
       set plan = 'active',
           subscription_start = coalesce(subscription_start, now()),
           subscription_ends_at = v_base + (v_w.months || ' months')::interval,
           subscription_end = v_base + (v_w.months || ' months')::interval,
           subscription_status = 'active'
     where id = v_w.beneficiary_company_id;
  end if;

  update public.referral_rewards
     set status = case when v_w.kind='cash' then 'approved' else 'approved' end,
         admin_note = p_note, decided_at = now(), decided_by = auth.uid()
   where id = p_reward_id returning * into v_w;

  return to_jsonb(v_w);
end $$;

-- ------------------------------------------------------------- 5) صلاحيات RPC
grant execute on function public.referral_my_code() to authenticated;
grant execute on function public.referral_lookup_code(text) to anon, authenticated;
grant execute on function public.referral_register_signup(text) to authenticated;
grant execute on function public.referral_my_dashboard() to authenticated;
grant execute on function public.referral_claim(uuid, text, text, text, text) to authenticated;
grant execute on function public.referral_claim_milestone(text, text, text, text) to authenticated;
grant execute on function public.super_admin_referrals_overview() to authenticated;
grant execute on function public.super_admin_create_external_code(text, text, text, text) to authenticated;
grant execute on function public.super_admin_referral_set_paid(uuid, boolean) to authenticated;
grant execute on function public.super_admin_referral_decide(uuid, text, text) to authenticated;
grant execute on function public.referral_my_company() to authenticated;
grant execute on function public.referral_gen_code() to authenticated;
