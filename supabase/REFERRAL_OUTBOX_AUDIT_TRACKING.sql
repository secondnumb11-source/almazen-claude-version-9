-- ============================================================================
--  ترقية نظام الترشيح — منصة المازن
--  1) تحديث قائمة السوبر أدمن (إضافة motazsalah1016@gmail.com)
--  2) صندوق صادر للإشعارات (Outbox) بإعادة محاولة تلقائية عند فشل الإرسال
--  3) سجل تدقيق كامل لتغييرات حالة طلبات الترشيح (اعتماد/رفض/صرف/تمديد/سداد)
--  4) دوال تتبّع حالة الطلب خطوة بخطوة للمرشَّح ولصاحب الكود
--  آمن للتنفيذ أكثر من مرة (idempotent) ولا يعدّل أي جدول قائم.
-- ============================================================================

-- ------------------------------------------------- 1) قائمة السوبر أدمن
create or replace function public.super_admin_emails()
returns text[] language sql immutable set search_path = public, pg_temp as $$
  SELECT ARRAY[
    'shadysalahshadysalah@gmail.com',
    'info.almazen.platform@gmail.com',
    'sh.abdelwahab@nes-sa.com',
    'motazsalah1016@gmail.com',
    'moatazsalah1016@gmail.com',
    'secondnumb11@gmail.com',
    'shadyabdelwahabksa@gmail.com',
    'shadyabdelwahab99@gmail.com'
  ]::text[];
$$;

-- ------------------------------------------- 2) صندوق صادر الإشعارات (Outbox)
create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'email',
  event_type text not null,                       -- new_signup | referral_reward_request | referral_status_update
  recipients text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',         -- pending | sent | failed | dead
  attempts integer not null default 0,
  max_attempts integer not null default 6,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_by uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists idx_outbox_due on public.notification_outbox(status, next_attempt_at);
create index if not exists idx_outbox_event on public.notification_outbox(event_type, created_at desc);

grant select on public.notification_outbox to authenticated;
grant all on public.notification_outbox to service_role;
alter table public.notification_outbox enable row level security;

drop policy if exists nob_select on public.notification_outbox;
create policy nob_select on public.notification_outbox for select to authenticated
  using (public.is_super_admin() or created_by = auth.uid());

-- إدراج إشعار في الصندوق (يُستدعى قبل محاولة الإرسال مباشرة)
create or replace function public.outbox_enqueue(
  p_event_type text, p_recipients text[], p_payload jsonb
) returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  insert into public.notification_outbox (event_type, recipients, payload, created_by)
  values (coalesce(nullif(btrim(p_event_type),''),'generic'),
          coalesce(p_recipients, '{}'::text[]), coalesce(p_payload,'{}'::jsonb), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- تسجيل نتيجة محاولة الإرسال (نجاح أو فشل مع جدولة إعادة المحاولة تصاعدياً)
create or replace function public.outbox_mark(
  p_id uuid, p_ok boolean, p_error text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_row public.notification_outbox;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  select * into v_row from public.notification_outbox where id = p_id;
  if v_row.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  if p_ok then
    update public.notification_outbox
       set status='sent', sent_at=now(), attempts=attempts+1, last_error=null
     where id = p_id returning * into v_row;
  else
    update public.notification_outbox
       set attempts = attempts + 1,
           last_error = left(coalesce(p_error,'unknown'), 2000),
           status = case when attempts + 1 >= max_attempts then 'dead' else 'failed' end,
           next_attempt_at = now() + (least(power(2, attempts + 1), 60) || ' minutes')::interval
     where id = p_id returning * into v_row;
  end if;
  return to_jsonb(v_row);
end $$;

-- الإشعارات المستحقة لإعادة المحاولة
create or replace function public.outbox_due(p_limit integer default 10)
returns setof public.notification_outbox language sql stable security definer
set search_path = public, pg_temp as $$
  select * from public.notification_outbox
   where status in ('pending','failed')
     and next_attempt_at <= now()
     and (public.is_super_admin() or created_by = auth.uid())
   order by next_attempt_at
   limit greatest(1, least(coalesce(p_limit,10), 50))
$$;

-- ------------------------------------------------- 3) سجل تدقيق الترشيحات
create table if not exists public.referral_audit_log (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid,
  referral_id uuid,
  request_no text,
  entity text not null default 'reward',   -- reward | referral
  action text not null,                    -- approve | reject | mark_paid | extend | set_paid | set_unpaid
  old_status text,
  new_status text,
  months_applied integer,
  cash_amount numeric,
  beneficiary_name text,
  referred_company_name text,
  actor_id uuid,
  actor_name text,
  actor_email text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_ref_audit_reward on public.referral_audit_log(reward_id, created_at desc);
create index if not exists idx_ref_audit_created on public.referral_audit_log(created_at desc);

grant select on public.referral_audit_log to authenticated;
grant all on public.referral_audit_log to service_role;
alter table public.referral_audit_log enable row level security;

drop policy if exists ral_select on public.referral_audit_log;
create policy ral_select on public.referral_audit_log for select to authenticated
  using (
    public.is_super_admin()
    or reward_id in (select id from public.referral_rewards where beneficiary_company_id = public.referral_my_company())
    or referral_id in (
      select id from public.referrals
       where referrer_company_id = public.referral_my_company()
          or referred_company_id = public.referral_my_company()
    )
  );

create or replace function public.referral_audit_write(
  p_reward_id uuid, p_referral_id uuid, p_request_no text, p_entity text, p_action text,
  p_old text, p_new text, p_months integer, p_cash numeric,
  p_beneficiary text, p_referred text, p_note text
) returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_name text; v_email text;
begin
  select coalesce(p.full_name, u.email) , u.email into v_name, v_email
    from auth.users u left join public.profiles p on p.id = u.id
   where u.id = auth.uid();
  insert into public.referral_audit_log (
    reward_id, referral_id, request_no, entity, action, old_status, new_status,
    months_applied, cash_amount, beneficiary_name, referred_company_name,
    actor_id, actor_name, actor_email, note
  ) values (
    p_reward_id, p_referral_id, p_request_no, coalesce(p_entity,'reward'), p_action, p_old, p_new,
    p_months, p_cash, p_beneficiary, p_referred, auth.uid(), coalesce(v_name,'—'), v_email, p_note
  );
end $$;

-- ------------------------ 4) إعادة تعريف دوال السوبر أدمن مع كتابة التدقيق
create or replace function public.super_admin_referral_set_paid(p_referral_id uuid, p_paid boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_r public.referrals; v_old text;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select status into v_old from public.referrals where id = p_referral_id;
  update public.referrals
     set status = case when p_paid then 'paid' else 'registered' end,
         paid_at = case when p_paid then now() else null end
   where id = p_referral_id returning * into v_r;

  perform public.referral_audit_write(
    null, v_r.id, null, 'referral',
    case when p_paid then 'set_paid' else 'set_unpaid' end,
    v_old, v_r.status, null, null, v_r.referrer_name, v_r.referred_company_name, null
  );
  return to_jsonb(v_r);
end $$;

create or replace function public.super_admin_referral_decide(
  p_reward_id uuid, p_action text, p_note text default null
) returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_w public.referral_rewards; v_co public.companies; v_base timestamptz;
  v_old text; v_ref_name text; v_applied integer := null;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_action not in ('approve','reject','mark_paid') then raise exception 'إجراء غير معروف'; end if;
  select * into v_w from public.referral_rewards where id = p_reward_id;
  if v_w.id is null then raise exception 'الطلب غير موجود'; end if;
  v_old := v_w.status;
  select referred_company_name into v_ref_name from public.referrals where id = v_w.referral_id;

  if p_action = 'reject' then
    update public.referral_rewards set status='rejected', admin_note=p_note, decided_at=now(), decided_by=auth.uid()
     where id = p_reward_id returning * into v_w;
  elsif p_action = 'mark_paid' then
    update public.referral_rewards set status='paid', admin_note=coalesce(p_note, admin_note), decided_at=now(), decided_by=auth.uid()
     where id = p_reward_id returning * into v_w;
  else
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
      v_applied := v_w.months;
    end if;

    update public.referral_rewards
       set status='approved', admin_note = p_note, decided_at = now(), decided_by = auth.uid()
     where id = p_reward_id returning * into v_w;
  end if;

  perform public.referral_audit_write(
    v_w.id, v_w.referral_id, v_w.request_no, 'reward',
    case when p_action = 'approve' and v_applied is not null then 'extend' else p_action end,
    v_old, v_w.status, v_applied, v_w.cash_amount, v_w.beneficiary_name, v_ref_name, p_note
  );
  return to_jsonb(v_w);
end $$;

-- --------------------------------------- 5) دوال العرض (تدقيق + تتبّع الحالة)
create or replace function public.super_admin_referral_audit(p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) into v
    from (select * from public.referral_audit_log order by created_at desc
           limit greatest(1, least(coalesce(p_limit,500), 5000))) a;
  return jsonb_build_object('ok', true, 'entries', v);
end $$;

-- تتبّع خطوة بخطوة: يعمل لصاحب الكود وللمنشأة المُرشَّحة على حد سواء
create or replace function public.referral_track_my()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_p public.profiles;
  v_out jsonb; v_in jsonb; v_rw jsonb; v_audit jsonb; v_co public.companies;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='28000'; end if;
  select * into v_p from public.profiles where id = v_uid;
  if v_p.id is null then return jsonb_build_object('ok', false); end if;
  select * into v_co from public.companies where id = v_p.company_id;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) into v_out
    from public.referrals r where r.referrer_company_id = v_p.company_id;

  select to_jsonb(r) into v_in
    from public.referrals r where r.referred_company_id = v_p.company_id limit 1;

  select coalesce(jsonb_agg(to_jsonb(w) || jsonb_build_object(
            'referred_company_name', r.referred_company_name,
            'referral_code', r.code)
          order by w.created_at desc), '[]'::jsonb) into v_rw
    from public.referral_rewards w
    left join public.referrals r on r.id = w.referral_id
   where w.beneficiary_company_id = v_p.company_id;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) into v_audit
    from public.referral_audit_log a
   where a.reward_id in (select id from public.referral_rewards where beneficiary_company_id = v_p.company_id)
      or a.referral_id in (select id from public.referrals
                            where referrer_company_id = v_p.company_id
                               or referred_company_id = v_p.company_id);

  return jsonb_build_object(
    'ok', true,
    'company_name', v_co.name,
    'subscription_ends_at', v_co.subscription_ends_at,
    'outgoing', v_out,
    'incoming', coalesce(v_in, 'null'::jsonb),
    'rewards', v_rw,
    'timeline', v_audit
  );
end $$;

-- ------------------------------------------------------------- 6) الصلاحيات
grant execute on function public.outbox_enqueue(text, text[], jsonb) to authenticated;
grant execute on function public.outbox_mark(uuid, boolean, text) to authenticated;
grant execute on function public.outbox_due(integer) to authenticated;
grant execute on function public.referral_audit_write(uuid, uuid, text, text, text, text, text, integer, numeric, text, text, text) to authenticated;
grant execute on function public.super_admin_referral_audit(integer) to authenticated;
grant execute on function public.referral_track_my() to authenticated;
grant execute on function public.super_admin_referral_set_paid(uuid, boolean) to authenticated;
grant execute on function public.super_admin_referral_decide(uuid, text, text) to authenticated;
grant execute on function public.super_admin_emails() to authenticated, anon;
