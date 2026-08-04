-- إصلاحات نظام الإحالة: منع فقدان الترشيحات عند الرفض + حماية حالة الصرف
alter table public.referrals
  add column if not exists consumed_by_reward_id uuid references public.referral_rewards(id) on delete set null;

create or replace function public.referral_claim_milestone(p_kind text, p_contact_name text default null, p_contact_phone text default null, p_contact_email text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
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

  -- تُحجز الترشيحات باسم الطلب نفسه ليتم تحريرها تلقائياً عند الرفض
  update public.referrals
     set milestone_consumed = true, consumed_by_reward_id = v_new.id
   where id = any(v_ids);

  return to_jsonb(v_new);
end $function$;

create or replace function public.super_admin_referral_decide(p_reward_id uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
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
    -- تحرير الترشيحات المحجوزة حتى لا تضيع على صاحبها
    update public.referrals
       set milestone_consumed = false, consumed_by_reward_id = null
     where consumed_by_reward_id = p_reward_id;
  elsif p_action = 'mark_paid' then
    if v_w.status <> 'approved' then
      raise exception 'لا يمكن تعليم المكافأة كمصروفة قبل اعتمادها' using errcode='22023';
    end if;
    update public.referral_rewards set status='paid', admin_note=coalesce(p_note, admin_note), decided_at=now(), decided_by=auth.uid()
     where id = p_reward_id returning * into v_w;
  else
    if v_w.status not in ('pending_admin','approved') then
      raise exception 'لا يمكن اعتماد طلب بحالته الحالية' using errcode='22023';
    end if;
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
end $function$;
