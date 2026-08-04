-- =====================================================================
--  منع ازدواج المطالبة بمكافآت الترشيح
-- ---------------------------------------------------------------------
--  العطل:
--    referral_claim_milestone كان يختار الإحالات بشرط
--      status='paid' AND milestone_consumed=false
--    دون استثناء ما سبقت المطالبة به فردياً. فيستطيع المُحيل أخذ
--      3 × (3 أشهر أو 200 ريال)   ثم إضافةً   (12 شهراً أو 600 ريال)
--    عن نفس الإحالات الثلاث => التزام يصل إلى 1,200 ريال أو 21 شهراً
--    مقابل 3 اشتراكات فقط.
--
--    وبالاتجاه المعاكس: referral_claim لم يكن يمنع المطالبة الفردية
--    بإحالة سبق حجزها ضمن مكافأة إنجاز (milestone_consumed=true).
--
--  القاعدة المعتمدة:
--    كل إحالة تُحتسب مرة واحدة فقط — إما فردياً (3 أشهر أو 200 ريال)
--    وإما ضمن ثلاثية الإنجاز (12 شهراً أو 600 ريال). لا جمع بينهما.
--
--  كلا المكافأتين تبقيان خاضعتين لموافقة السوبر أدمن
--  (status يبدأ pending_admin ولا تُطبَّق إلا عبر super_admin_referral_decide).
--
--  ملاحظة: المكافآت ترويجية من مطوّر المنصة ولا تُرحَّل إلى دفاتر
--  حسابات المنشآت عمداً — لا قيود محاسبية لها.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) الإنجاز: لا يحتسب إحالة سبقت المطالبة بها فردياً
-- ---------------------------------------------------------------------
create or replace function public.referral_claim_milestone(
  p_kind text,
  p_contact_name text default null,
  p_contact_phone text default null,
  p_contact_email text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
    select r.id from public.referrals r
     where r.referrer_company_id = v_p.company_id
       and r.status = 'paid'
       and r.milestone_consumed = false
       -- ✅ استثناء ما سبقت المطالبة به فردياً (منع الازدواج)
       and not exists (
             select 1 from public.referral_rewards w
              where w.referral_id = r.id
                and w.beneficiary = 'referrer'
                and w.status <> 'rejected')
     order by r.paid_at nulls last, r.created_at
     limit 3
  ) t;

  if v_ids is null or array_length(v_ids,1) < 3 then
    raise exception 'تحتاج 3 اشتراكات مسددة غير مستخدمة في أي مكافأة سابقة لتفعيل هذه المكافأة'
      using errcode='22023';
  end if;

  insert into public.referral_rewards (
    code_id, beneficiary, beneficiary_profile_id, beneficiary_company_id, beneficiary_name,
    contact_name, contact_phone, contact_email, kind, months, cash_amount, tier
  ) values (
    (select code_id from public.referrals where id = v_ids[1]),
    'referrer', v_uid, v_p.company_id, v_p.full_name,
    coalesce(p_contact_name, v_p.full_name), coalesce(p_contact_phone, v_p.phone), p_contact_email,
    p_kind,
    case when p_kind='months' then 12 else 0 end,
    case when p_kind='cash'   then 600 else 0 end,
    'milestone'
  ) returning * into v_new;

  -- تُحجز الثلاثية باسم الطلب نفسه لتتحرر تلقائياً عند الرفض
  update public.referrals
     set milestone_consumed = true, consumed_by_reward_id = v_new.id
   where id = any(v_ids);

  return to_jsonb(v_new);
end $function$;

-- ---------------------------------------------------------------------
-- 2) الفردي: لا يقبل إحالة محجوزة ضمن مكافأة إنجاز
-- ---------------------------------------------------------------------
create or replace function public.referral_claim(
  p_referral_id uuid,
  p_kind text,
  p_contact_name text default null,
  p_contact_phone text default null,
  p_contact_email text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  -- ✅ منع الازدواج بالاتجاه المعاكس
  if v_r.milestone_consumed then
    raise exception 'هذه الإحالة محجوزة ضمن مكافأة إنجاز 3 اشتراكات — لا يمكن المطالبة بها مرتين'
      using errcode='23505';
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
    p_kind,
    case when p_kind='months' then 3 else 0 end,
    case when p_kind='cash'   then 200 else 0 end,
    'single'
  ) returning * into v_new;

  -- طلب مكافأة المنشأة المُرشَّحة (3 أشهر) — إنشاء فقط، لا تفعيل قبل الاعتماد
  if not exists (select 1 from public.referral_rewards w
                  where w.referral_id = v_r.id and w.beneficiary = 'referred' and w.status <> 'rejected') then
    insert into public.referral_rewards (
      referral_id, code_id, beneficiary, beneficiary_company_id, beneficiary_name, kind, months, tier
    ) values (
      v_r.id, v_r.code_id, 'referred', v_r.referred_company_id, v_r.referred_company_name, 'months', 3, 'single'
    );
  end if;

  return to_jsonb(v_new);
end $function$;
