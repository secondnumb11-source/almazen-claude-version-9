-- =====================================================================
--  بوابة اعتماد الترشيحات — لا أشهر مجانية بلا موافقة سوبر أدمن
-- ---------------------------------------------------------------------
--  العطل المُثبت حياً (F-6):
--    التريجر referral_apply_bonus_on_payment كان يمنح المنشأة المُرشَّحة
--    3 أشهر فوراً عند تحوّل خطتها إلى active — متجاوزاً منظومة
--    referral_rewards / super_admin_referral_decide بالكامل.
--
--  دليل الاختبار الحيّ (بيانات معزولة ثم تراجع):
--    T2: bonus_applied=true وتاريخ الانتهاء قفز 30 يوماً → 2026-12-03 بلا أي موافقة
--    T9: ثم اعتماد السوبر أدمن أضاف 3 أشهر أخرى → 2027-03-03
--    => منح مزدوج: 6 أشهر بدل 3، وخسارة اشتراك مضاعفة في كل إحالة.
--
--  العلاج (أقل تغيير ممكن):
--    يبقى التريجر مسؤولاً عن شيئين فقط:
--      1) تعليم الإحالة status='paid' ليستطيع المُحيل المطالبة.
--      2) إنشاء طلب مكافأة للمُحال (3 أشهر) بحالة pending_admin.
--    ويُحذف منه منح الأشهر وتعديل subscription_ends_at نهائياً.
--    الأشهر تُضاف حصراً عبر super_admin_referral_decide بعد مراجعة السداد.
--
--  ملاحظة: لا يمسّ هذا الترحيل أي صف قائم — استبدال دالة فقط.
--  اختيار المُحيل بين 3 أشهر أو 200 ريال يبقى كما هو في referral_claim.
-- =====================================================================

create or replace function public.referral_apply_bonus_on_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_r public.referrals;
begin
  if pg_trigger_depth() > 1 then return new; end if;                    -- منع التكرار الذاتي
  if new.plan is distinct from 'active' then return new; end if;
  if new.subscription_ends_at is null then return new; end if;

  select * into v_r from public.referrals
   where referred_company_id = new.id and status <> 'cancelled' limit 1;
  if v_r.id is null then return new; end if;

  -- (1) تعليم الإحالة كمسدَّدة — شرط لازم لمطالبة المُحيل
  if v_r.status <> 'paid' then
    update public.referrals set status = 'paid', paid_at = now() where id = v_r.id;
    begin
      perform public.referral_audit_write(null, v_r.id, null, 'referral', 'set_paid',
        v_r.status, 'paid', null, null, v_r.referrer_name, v_r.referred_company_name,
        'مزامنة تلقائية عند سداد الاشتراك');
    exception when others then null; end;
  end if;

  -- (2) إنشاء طلب مكافأة المُحال (3 أشهر) بانتظار اعتماد السوبر أدمن.
  --     يُنشأ تلقائياً حتى لا يُحرم المُحال لو لم يطالب مُحيله أبداً.
  --     ⚠️ إنشاء طلب فقط — لا يُضاف أي شهر هنا.
  if not exists (
        select 1 from public.referral_rewards w
         where w.referral_id = v_r.id
           and w.beneficiary = 'referred'
           and w.status <> 'rejected') then
    insert into public.referral_rewards (
      referral_id, code_id, beneficiary, beneficiary_company_id, beneficiary_name,
      kind, months, cash_amount, tier
    ) values (
      v_r.id, v_r.code_id, 'referred', v_r.referred_company_id, v_r.referred_company_name,
      'months', coalesce(v_r.bonus_months, 3), 0, 'single'
    );

    begin
      perform public.referral_audit_write(null, v_r.id, null, 'reward', 'auto_request',
        null, 'pending_admin', coalesce(v_r.bonus_months, 3), null,
        v_r.referred_company_name, v_r.referred_company_name,
        'طلب تلقائي بـ ' || coalesce(v_r.bonus_months, 3) || ' أشهر للمنشأة المُرشَّحة — بانتظار اعتماد السوبر أدمن');
    exception when others then null; end;
  end if;

  -- ❌ حُذف عمداً: منح bonus_applied وتمديد subscription_ends_at تلقائياً.
  --    أي إعادة لهذا المنطق هنا تُعيد المنح المزدوج وتُبطل بوابة الاعتماد.
  return new;
end;
$function$;
