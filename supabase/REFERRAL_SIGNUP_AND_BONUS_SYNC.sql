-- ============================================================================
--  إصلاح نظام الإحالة (الترشيح) + مزامنة مكافأة 3 أشهر عند سداد الاشتراك
--  السبب الجذري: handle_new_user كان ينشئ المنشأة والملف الشخصي تلقائياً عند
--  التسجيل، فلا تظهر شاشة "تأسيس المنشأة" ولا تُستدعى referral_register_signup،
--  فتبقى جداول الترشيح فارغة ولا تظهر أي بيانات في لوحة الترشيح والتتبع.
-- ============================================================================

-- 1) أعمدة تتبع مكافأة المنشأة المُرشَّحة -----------------------------------
ALTER TABLE public.referrals
  ADD COLUMN IF NOT EXISTS bonus_months       integer     NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS bonus_applied      boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bonus_applied_at   timestamptz,
  ADD COLUMN IF NOT EXISTS bonus_new_ends_at  timestamptz;

-- 2) تسجيل الترشيح تلقائياً عند إنشاء الحساب --------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id   uuid;
  v_role         user_role := 'owner';
  v_full_name    text;
  v_username     text;
  v_company_name text;
  v_phone        text;
  v_id_or_cr     text;
  v_new_company  boolean := false;
  v_ref_code     text;
  v_c            public.referral_codes;
  v_co           public.companies;
BEGIN
  IF new.raw_user_meta_data->>'company_id' IS NOT NULL AND (new.raw_user_meta_data->>'company_id') != '' THEN
    BEGIN
      v_company_id := (new.raw_user_meta_data->>'company_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_company_id := NULL;
    END;
  END IF;

  IF new.raw_user_meta_data->>'role' IS NOT NULL AND (new.raw_user_meta_data->>'role') != '' THEN
    BEGIN
      v_role := (new.raw_user_meta_data->>'role')::user_role;
    EXCEPTION WHEN OTHERS THEN
      v_role := 'owner';
    END;
  END IF;

  v_full_name    := COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  v_username     := new.raw_user_meta_data->>'username';
  v_company_name := NULLIF(btrim(COALESCE(new.raw_user_meta_data->>'company_name', '')), '');
  v_phone        := NULLIF(btrim(COALESCE(new.raw_user_meta_data->>'phone', '')), '');
  v_id_or_cr     := NULLIF(btrim(COALESCE(new.raw_user_meta_data->>'id_or_cr', '')), '');

  IF v_company_id IS NULL THEN
    SELECT company_id INTO v_company_id
    FROM public.staff_permissions
    WHERE user_id = new.id OR staff_id = new.id
    LIMIT 1;

    IF v_company_id IS NULL THEN
      -- اسم المنشأة الفعلي المُدخل في نموذج التسجيل بدل "شركة <الاسم>"
      INSERT INTO public.companies (
        name, owner_phone, owner_id_or_cr, plan, trial_started_at, trial_ends_at
      )
      VALUES (
        COALESCE(v_company_name, 'شركة ' || v_full_name),
        v_phone, v_id_or_cr, 'trial', now(), now() + interval '7 days'
      )
      RETURNING id INTO v_company_id;
      v_new_company := true;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, full_name, role, company_id, username, phone)
  VALUES (new.id, v_full_name, v_role, v_company_id, v_username, v_phone)
  ON CONFLICT (id) DO UPDATE
  SET company_id = COALESCE(EXCLUDED.company_id, public.profiles.company_id),
      role       = COALESCE(EXCLUDED.role, public.profiles.role),
      full_name  = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
      username   = COALESCE(EXCLUDED.username, public.profiles.username),
      phone      = COALESCE(EXCLUDED.phone, public.profiles.phone);

  -- ربط المنشأة الجديدة بكود الترشيح القادم من رابط/كود الإحالة
  v_ref_code := upper(btrim(COALESCE(new.raw_user_meta_data->>'referral_code', '')));
  IF v_new_company AND v_ref_code <> '' THEN
    BEGIN
      SELECT * INTO v_c FROM public.referral_codes
       WHERE code = v_ref_code AND is_active LIMIT 1;

      IF v_c.id IS NOT NULL
         AND COALESCE(v_c.owner_company_id::text, '') <> v_company_id::text
         AND NOT EXISTS (SELECT 1 FROM public.referrals WHERE referred_company_id = v_company_id)
      THEN
        SELECT * INTO v_co FROM public.companies WHERE id = v_company_id;
        INSERT INTO public.referrals (
          code_id, code, referrer_profile_id, referrer_company_id, referrer_name,
          referred_company_id, referred_company_name, referred_owner_name,
          referred_email, referred_phone
        ) VALUES (
          v_c.id, v_c.code, v_c.owner_profile_id, v_c.owner_company_id, v_c.owner_name,
          v_company_id, v_co.name, v_full_name, new.email, v_phone
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- الترشيح لا يجوز أن يُفشل إنشاء الحساب
    END;
  END IF;

  RETURN new;
END;
$function$;

-- 3) شبكة أمان: تسجيل الترشيح بعد الدخول إن فات وقت الإنشاء -----------------
--    (referral_register_signup موجودة مسبقاً وتُستدعى من الواجهة)

-- 4) مزامنة تلقائية: عند سداد/تفعيل الاشتراك تُضاف 3 أشهر للمنشأة المُرشَّحة
CREATE OR REPLACE FUNCTION public.referral_apply_bonus_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_r      public.referrals;
  v_months integer;
  v_base   timestamptz;
  v_new    timestamptz;
BEGIN
  -- يعمل فقط عند الانتقال إلى اشتراك مدفوع فعّال
  IF NEW.plan IS DISTINCT FROM 'active' THEN RETURN NEW; END IF;
  IF NEW.subscription_ends_at IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_r FROM public.referrals
   WHERE referred_company_id = NEW.id
     AND status <> 'cancelled'
   LIMIT 1;
  IF v_r.id IS NULL THEN RETURN NEW; END IF;

  -- الخطوة 2 من المسار: المنشأة المُرشَّحة سدّدت اشتراكها
  IF v_r.status <> 'paid' THEN
    UPDATE public.referrals
       SET status = 'paid', paid_at = now()
     WHERE id = v_r.id;
    BEGIN
      PERFORM public.referral_audit_write(
        null, v_r.id, null, 'referral', 'set_paid', v_r.status, 'paid',
        null, null, v_r.referrer_name, v_r.referred_company_name,
        'مزامنة تلقائية عند سداد الاشتراك');
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- إضافة 3 أشهر مجانية مرة واحدة فقط على مدة اشتراك المنشأة المُرشَّحة
  IF NOT v_r.bonus_applied THEN
    v_months := COALESCE(v_r.bonus_months, 3);
    v_base   := GREATEST(NEW.subscription_ends_at, now());
    v_new    := v_base + make_interval(months => v_months);

    UPDATE public.companies
       SET subscription_ends_at = v_new,
           subscription_end     = v_new,
           updated_at           = now()
     WHERE id = NEW.id;

    UPDATE public.referrals
       SET bonus_applied     = true,
           bonus_applied_at  = now(),
           bonus_new_ends_at = v_new
     WHERE id = v_r.id;

    BEGIN
      PERFORM public.referral_audit_write(
        null, v_r.id, null, 'referral', 'bonus_applied', 'registered', 'paid',
        null, null, v_r.referrer_name, v_r.referred_company_name,
        'تمت إضافة ' || v_months || ' أشهر مجانية على اشتراك المنشأة المُرشَّحة');
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_referral_bonus_on_payment ON public.companies;
CREATE TRIGGER trg_referral_bonus_on_payment
AFTER UPDATE OF plan, subscription_ends_at ON public.companies
FOR EACH ROW
WHEN (NEW.plan = 'active' AND NEW.subscription_ends_at IS NOT NULL)
EXECUTE FUNCTION public.referral_apply_bonus_on_payment();

-- 5) عرض حالة المكافأة في إعدادات الحساب -------------------------------------
CREATE OR REPLACE FUNCTION public.referral_my_bonus_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_p   public.profiles;
  v_co  public.companies;
  v_r   public.referrals;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING errcode='28000'; END IF;
  SELECT * INTO v_p FROM public.profiles WHERE id = v_uid;
  IF v_p.id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT * INTO v_co FROM public.companies WHERE id = v_p.company_id;
  SELECT * INTO v_r  FROM public.referrals WHERE referred_company_id = v_p.company_id LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'has_referral', v_r.id IS NOT NULL,
    'referral', CASE WHEN v_r.id IS NULL THEN 'null'::jsonb ELSE to_jsonb(v_r) END,
    'plan', v_co.plan,
    'subscription_ends_at', v_co.subscription_ends_at,
    'trial_ends_at', v_co.trial_ends_at
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.referral_my_bonus_status() TO authenticated;
