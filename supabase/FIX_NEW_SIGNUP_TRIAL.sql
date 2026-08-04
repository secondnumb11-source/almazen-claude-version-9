-- ============================================================================
-- إصلاح: المستخدم الجديد يُحوَّل خطأً لصفحة "انتهت فترة التجربة"
-- السبب: المنشأة تُنشأ أحياناً بدون trial_ends_at (أو بخطة غير 'trial')
--        فتُرجِع company_access_state القيمة active = false.
-- الحل:  1) ضمان تجربة 7 أيام تلقائياً عند إنشاء أي منشأة (trigger)
--        2) تصحيح كل المنشآت الحالية المتأثرة (backfill)
--        3) جعل company_access_state متسامحة: منشأة تجريبية بلا تاريخ انتهاء
--           تُحتسب لها 7 أيام من تاريخ الإنشاء بدل اعتبارها منتهية.
-- آمن للتشغيل المتكرر (idempotent) ولا يغيّر أي اشتراك مدفوع قائم.
-- ملاحظة: مكافأة الترشيح (3 أشهر) تبقى كما هي — تُضاف بعد السداد فقط،
--         ولا تمسّ فترة التجربة إطلاقاً.
-- ============================================================================

-- 1) ضمان بدء التجربة عند إنشاء المنشأة -------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_company_trial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- لا نلمس المنشآت المفعّلة أو الموقوفة إدارياً
  IF COALESCE(NEW.plan, '') IN ('active', 'suspended', 'cancelled') THEN
    RETURN NEW;
  END IF;

  IF NEW.subscription_ends_at IS NOT NULL AND NEW.subscription_ends_at > now() THEN
    RETURN NEW;
  END IF;

  NEW.plan := 'trial';
  BEGIN
    NEW.subscription_status := 'trial';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  NEW.trial_started_at := COALESCE(NEW.trial_started_at, NEW.created_at, now());
  IF NEW.trial_ends_at IS NULL THEN
    NEW.trial_ends_at := COALESCE(NEW.trial_started_at, now()) + interval '7 days';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_company_trial ON public.companies;
CREATE TRIGGER trg_ensure_company_trial
BEFORE INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.ensure_company_trial();

-- 2) تصحيح المنشآت الحالية المتأثرة -----------------------------------------
-- (أ) منشآت بلا أي تاريخ انتهاء إطلاقاً → تجربة 7 أيام تبدأ الآن
UPDATE public.companies
   SET plan = 'trial',
       subscription_status = 'trial',
       trial_started_at = COALESCE(trial_started_at, created_at, now()),
       trial_ends_at = now() + interval '7 days',
       updated_at = now()
 WHERE COALESCE(plan, '') NOT IN ('active', 'suspended', 'cancelled')
   AND trial_ends_at IS NULL
   AND (subscription_ends_at IS NULL OR subscription_ends_at <= now());

-- (ب) منشآت خطتها فارغة/غير معروفة لكن لديها تجربة سارية → توحيد الخطة فقط
UPDATE public.companies
   SET plan = 'trial',
       subscription_status = 'trial',
       updated_at = now()
 WHERE COALESCE(plan, '') NOT IN ('active', 'trial', 'suspended', 'cancelled')
   AND trial_ends_at IS NOT NULL
   AND trial_ends_at > now();

-- 3) حالة الوصول متسامحة مع غياب trial_ends_at -------------------------------
DROP FUNCTION IF EXISTS public.company_access_state(uuid);
CREATE FUNCTION public.company_access_state(_company uuid)
RETURNS TABLE(plan text, active boolean, seconds_left bigint,
              ends_at timestamptz, starts_at timestamptz, trial_ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  with c as (
    select
      co.*,
      -- تاريخ انتهاء تجربة فعّال: المخزَّن، وإلا 7 أيام من بداية التجربة/الإنشاء
      coalesce(
        co.trial_ends_at,
        coalesce(co.trial_started_at, co.created_at, now()) + interval '7 days'
      ) as eff_trial_ends_at
    from public.companies co
    where co.id = _company
  )
  select
    c.plan,
    case
      when c.activated_by_admin then true
      when c.plan = 'active'
           and (c.subscription_ends_at is null or c.subscription_ends_at > now()) then true
      when coalesce(c.plan, 'trial') not in ('active', 'suspended', 'cancelled')
           and c.eff_trial_ends_at > now() then true
      else false
    end as active,
    greatest(0, extract(epoch from
      coalesce(
        case when c.plan = 'active' then c.subscription_ends_at else null end,
        c.subscription_ends_at,
        c.eff_trial_ends_at
      ) - now())::bigint) as seconds_left,
    coalesce(c.subscription_ends_at, c.eff_trial_ends_at) as ends_at,
    coalesce(c.subscription_start, c.trial_started_at, c.created_at) as starts_at,
    c.eff_trial_ends_at as trial_ends_at
  from c;
$function$;

REVOKE ALL ON FUNCTION public.company_access_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_access_state(uuid) TO authenticated, anon;

-- Remove legacy 3-arg overload (ambiguity risk); the 5-arg signature is canonical
DROP FUNCTION IF EXISTS public.bootstrap_owner(text,text,text);
