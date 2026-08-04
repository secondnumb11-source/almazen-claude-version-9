-- ============================================================================
-- نظام التحكم الكامل في الاشتراكات — Super Admin only
-- آمن للتشغيل المتكرر (idempotent) ولا يكسر أي دالة قائمة.
-- ============================================================================

-- 1) دالة موحّدة للتحكم في الاشتراك
CREATE OR REPLACE FUNCTION public.super_admin_set_subscription(
  p_company_id uuid,
  p_action     text,                       -- trial_extend | renew | set_date | unlimited | pause | resume | cancel
  p_months     integer     DEFAULT NULL,
  p_ends_at    timestamptz DEFAULT NULL,
  p_reason     text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c            public.companies%ROWTYPE;
  v_base       timestamptz;
  v_new_end    timestamptz;
  v_paused_at  timestamptz;
  v_pause_days numeric;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: super admin only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO c FROM public.companies WHERE id = p_company_id;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'company not found: %', p_company_id USING ERRCODE = 'P0002';
  END IF;

  IF p_action = 'trial_extend' THEN
    -- تمديد فترة التجربة فقط (تبقى الباقة "تجربة")
    v_base    := GREATEST(COALESCE(c.trial_ends_at, now()), now());
    v_new_end := v_base + make_interval(months => COALESCE(p_months, 1));
    UPDATE public.companies
       SET plan = 'trial', subscription_status = 'trial',
           trial_started_at = COALESCE(c.trial_started_at, c.created_at, now()),
           trial_ends_at = v_new_end,
           activated_by_admin = false,
           subscription_extension_requested = false,
           updated_at = now()
     WHERE id = p_company_id;

  ELSIF p_action IN ('renew', 'set_date', 'unlimited') THEN
    IF p_action = 'set_date' THEN
      IF p_ends_at IS NULL THEN
        RAISE EXCEPTION 'p_ends_at required for set_date' USING ERRCODE = '22004';
      END IF;
      v_new_end := p_ends_at;
    ELSIF p_action = 'unlimited' THEN
      v_new_end := now() + interval '100 years';
    ELSE
      -- التجديد يبدأ من نهاية الاشتراك الحالي إن كان ما زال سارياً، وإلا من اليوم
      v_base    := GREATEST(COALESCE(c.subscription_ends_at, now()), now());
      v_new_end := v_base + make_interval(months => COALESCE(p_months, 1));
    END IF;

    UPDATE public.companies
       SET plan = 'active',
           subscription_status = 'active',
           subscription_start = COALESCE(c.subscription_start, now()),
           subscription_ends_at = v_new_end,
           subscription_end = v_new_end,           -- عمود قديم يُبقى متزامناً
           trial_ends_at = NULL,                   -- لا عدّاد تجربة بعد التفعيل
           activated_by_admin = false,             -- الانتهاء الفعلي يحكم الوصول
           subscription_extension_requested = false,
           settings = COALESCE(c.settings, '{}'::jsonb) - '_pause',
           updated_at = now()
     WHERE id = p_company_id;

  ELSIF p_action = 'pause' THEN
    UPDATE public.companies
       SET plan = 'suspended',
           subscription_status = 'suspended',
           activated_by_admin = false,
           settings = COALESCE(c.settings, '{}'::jsonb) || jsonb_build_object(
             '_pause', jsonb_build_object(
               'paused_at', now(),
               'prev_plan', c.plan,
               'prev_ends_at', c.subscription_ends_at,
               'prev_trial_ends_at', c.trial_ends_at,
               'reason', p_reason)),
           updated_at = now()
     WHERE id = p_company_id;
    v_new_end := c.subscription_ends_at;

  ELSIF p_action = 'resume' THEN
    v_paused_at  := NULLIF(c.settings #>> '{_pause,paused_at}', '')::timestamptz;
    v_pause_days := CASE WHEN v_paused_at IS NULL THEN 0
                         ELSE EXTRACT(epoch FROM (now() - v_paused_at)) / 86400 END;
    -- تُعوَّض مدة الإيقاف حتى لا يخسر العميل أياماً من اشتراكه
    v_new_end := COALESCE(
      NULLIF(c.settings #>> '{_pause,prev_ends_at}', '')::timestamptz,
      c.subscription_ends_at
    );
    IF v_new_end IS NOT NULL THEN
      v_new_end := v_new_end + make_interval(days => CEIL(v_pause_days)::int);
    END IF;

    IF COALESCE(c.settings #>> '{_pause,prev_plan}', 'active') = 'trial' THEN
      UPDATE public.companies
         SET plan = 'trial', subscription_status = 'trial',
             trial_ends_at = COALESCE(
               NULLIF(c.settings #>> '{_pause,prev_trial_ends_at}', '')::timestamptz
                 + make_interval(days => CEIL(v_pause_days)::int),
               now() + interval '7 days'),
             settings = COALESCE(c.settings, '{}'::jsonb) - '_pause',
             updated_at = now()
       WHERE id = p_company_id;
    ELSE
      UPDATE public.companies
         SET plan = 'active', subscription_status = 'active',
             subscription_start = COALESCE(c.subscription_start, now()),
             subscription_ends_at = COALESCE(v_new_end, now() + interval '1 month'),
             subscription_end     = COALESCE(v_new_end, now() + interval '1 month'),
             trial_ends_at = NULL,
             settings = COALESCE(c.settings, '{}'::jsonb) - '_pause',
             updated_at = now()
       WHERE id = p_company_id;
    END IF;

  ELSIF p_action = 'cancel' THEN
    RETURN public.super_admin_cancel_subscription(p_company_id, p_reason);

  ELSE
    RAISE EXCEPTION 'unknown action: %', p_action USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.branches_audit_log(actor_id, actor_email, action, payload)
    VALUES (auth.uid(),
            (SELECT email::text FROM auth.users WHERE id = auth.uid()),
            'subscription:' || p_action,
            jsonb_build_object('company_id', p_company_id, 'company', c.name,
                               'months', p_months, 'ends_at', v_new_end, 'reason', p_reason));
  EXCEPTION WHEN OTHERS THEN NULL; -- سجل التدقيق لا يجب أن يُفشل العملية
  END;

  SELECT * INTO c FROM public.companies WHERE id = p_company_id;
  RETURN jsonb_build_object(
    'status', 'ok', 'action', p_action, 'company_id', p_company_id,
    'plan', c.plan, 'subscription_start', c.subscription_start,
    'subscription_ends_at', c.subscription_ends_at, 'trial_ends_at', c.trial_ends_at);
END;
$function$;

REVOKE ALL ON FUNCTION public.super_admin_set_subscription(uuid, text, integer, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_admin_set_subscription(uuid, text, integer, timestamptz, text) TO authenticated;

-- 2) توحيد الدالة القديمة معها حتى لا تترك حالة اشتراك متناقضة
CREATE OR REPLACE FUNCTION public.super_admin_update_company_status(
  p_company_id uuid, p_plan text, p_subscription_ends_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: super admin only' USING ERRCODE = '42501';
  END IF;

  UPDATE public.companies
     SET plan = COALESCE(p_plan, plan),
         subscription_status = COALESCE(p_plan, plan),
         subscription_ends_at = p_subscription_ends_at,
         subscription_end     = p_subscription_ends_at,
         subscription_start   = CASE WHEN p_plan = 'active'
                                     THEN COALESCE(subscription_start, now())
                                     ELSE subscription_start END,
         trial_ends_at        = CASE WHEN p_plan = 'active' THEN NULL ELSE trial_ends_at END,
         updated_at = now()
   WHERE id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'company not found: %', p_company_id USING ERRCODE = 'P0002';
  END IF;
END; $function$;

-- 3) إظهار تاريخ البداية أيضاً في حالة الوصول (يُستخدم في إعدادات الحساب)
DROP FUNCTION IF EXISTS public.company_access_state(uuid);
CREATE FUNCTION public.company_access_state(_company uuid)
RETURNS TABLE(plan text, active boolean, seconds_left bigint,
              ends_at timestamptz, starts_at timestamptz, trial_ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select
    c.plan,
    case
      when c.activated_by_admin then true
      when c.plan = 'active'
           and (c.subscription_ends_at is null or c.subscription_ends_at > now()) then true
      when c.plan = 'trial'  and c.trial_ends_at is not null and c.trial_ends_at > now() then true
      else false
    end as active,
    greatest(0, extract(epoch from
      coalesce(c.subscription_ends_at, c.trial_ends_at, now()) - now())::bigint) as seconds_left,
    coalesce(c.subscription_ends_at, c.trial_ends_at) as ends_at,
    coalesce(c.subscription_start, c.trial_started_at, c.created_at) as starts_at,
    c.trial_ends_at
  from public.companies c
  where c.id = _company;
$function$;

REVOKE ALL ON FUNCTION public.company_access_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_access_state(uuid) TO authenticated, anon;

-- 4) مزامنة الحالات القديمة المتناقضة (plan نشط بينما subscription_status منتهي)
UPDATE public.companies
   SET subscription_status = plan,
       subscription_end    = COALESCE(subscription_end, subscription_ends_at),
       subscription_start  = COALESCE(subscription_start, trial_started_at, created_at)
 WHERE subscription_status IS DISTINCT FROM plan;
