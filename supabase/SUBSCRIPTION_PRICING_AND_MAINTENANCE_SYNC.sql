-- ============================================================================
-- 1) تصحيح تاريخ نهاية الاشتراك للمنشآت الجديدة فقط
--    السبب الجذري: العمود القديم subscription_end افتراضيه now() + 1 year
--    لا يُعدَّل أي صف قائم — التغيير يسري على الإنشاء الجديد فقط.
-- 2) جدول تسعير الاشتراك (3000 ر.س سنوياً)
-- 3) مزامنة الصيانة: دالة فورية + مهمة مجدولة + منع التكرار نهائياً
-- آمن للتشغيل المتكرر (idempotent).
-- ============================================================================

-- 1) إزالة الافتراضي القديم -------------------------------------------------
ALTER TABLE public.companies ALTER COLUMN subscription_end DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.ensure_company_trial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
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
  -- لا اشتراك مدفوع أثناء التجربة: تُصفّر أعمدة الاشتراك للمنشأة الجديدة فقط
  NEW.subscription_end    := NULL;
  NEW.subscription_ends_at := NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_company_trial ON public.companies;
CREATE TRIGGER trg_ensure_company_trial
BEFORE INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.ensure_company_trial();

-- 2) جدول تسعير الاشتراك ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  code            text PRIMARY KEY,
  name            text NOT NULL,
  price           numeric(12,2) NOT NULL CHECK (price >= 0),
  currency        text NOT NULL DEFAULT 'SAR',
  period_months   integer NOT NULL DEFAULT 12 CHECK (period_months > 0),
  is_active       boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.subscription_plans TO anon, authenticated;
GRANT ALL    ON public.subscription_plans TO service_role;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans readable by everyone" ON public.subscription_plans;
CREATE POLICY "plans readable by everyone" ON public.subscription_plans
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "plans writable by super admin" ON public.subscription_plans;
CREATE POLICY "plans writable by super admin" ON public.subscription_plans
  FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

INSERT INTO public.subscription_plans (code, name, price, currency, period_months)
VALUES ('annual', 'الاشتراك السنوي الكامل', 3000, 'SAR', 12)
ON CONFLICT (code) DO UPDATE
  SET price = EXCLUDED.price, currency = EXCLUDED.currency,
      period_months = EXCLUDED.period_months, name = EXCLUDED.name,
      updated_at = now();

-- 3) الصيانة: تنظيف + منع التكرار -------------------------------------------
-- (أ) توحيد التذاكر المكرّرة المفتوحة لنفس الوحدة (يُبقي الأحدث فقط)
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY unit_id ORDER BY opened_at DESC NULLS LAST, id) AS rn
    FROM public.maintenance_requests
   WHERE status IN ('open'::maintenance_status, 'in_progress'::maintenance_status)
     AND unit_id IS NOT NULL
)
UPDATE public.maintenance_requests m
   SET status = 'done'::maintenance_status,
       closed_at = COALESCE(m.closed_at, now())
  FROM ranked r
 WHERE m.id = r.id AND r.rn > 1;

-- (ب) إغلاق التذاكر المعلّقة لوحدات حالتها متاحة
UPDATE public.maintenance_requests m
   SET status = 'done'::maintenance_status,
       closed_at = COALESCE(m.closed_at, now())
  FROM public.units u
 WHERE u.id = m.unit_id
   AND u.status = 'available'::unit_status
   AND m.status IN ('open'::maintenance_status, 'in_progress'::maintenance_status);

-- (ج) فهرس فريد جزئي: تذكرة مفتوحة واحدة فقط لكل وحدة
CREATE UNIQUE INDEX IF NOT EXISTS uq_maintenance_open_per_unit
  ON public.maintenance_requests (unit_id)
  WHERE status IN ('open'::maintenance_status, 'in_progress'::maintenance_status)
    AND unit_id IS NOT NULL;

-- (د) حارس idempotent: لا تذكرة مفتوحة لوحدة متاحة
CREATE OR REPLACE FUNCTION public.guard_maintenance_ticket_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_status unit_status;
BEGIN
  IF NEW.unit_id IS NULL
     OR NEW.status NOT IN ('open'::maintenance_status, 'in_progress'::maintenance_status) THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_status FROM public.units WHERE id = NEW.unit_id;
  IF v_status = 'available'::unit_status THEN
    -- الوحدة متاحة: التذكرة تُسجَّل مغلقة بدل إبقاء حالة معلّقة خاطئة
    NEW.status := 'done'::maintenance_status;
    NEW.closed_at := COALESCE(NEW.closed_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_maintenance_ticket_state ON public.maintenance_requests;
CREATE TRIGGER trg_guard_maintenance_ticket_state
BEFORE INSERT OR UPDATE OF status, unit_id ON public.maintenance_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_maintenance_ticket_state();

-- (هـ) دالة إعادة المزامنة الشاملة (تُستدعى من الكرون ومن زر السوبر أدمن)
CREATE OR REPLACE FUNCTION public.maintenance_resync_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_stale int := 0; v_dupes int := 0;
BEGIN
  WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY unit_id ORDER BY opened_at DESC NULLS LAST, id) AS rn
      FROM public.maintenance_requests
     WHERE status IN ('open'::maintenance_status, 'in_progress'::maintenance_status)
       AND unit_id IS NOT NULL
  ), upd AS (
    UPDATE public.maintenance_requests m
       SET status = 'done'::maintenance_status, closed_at = COALESCE(m.closed_at, now())
      FROM ranked r WHERE m.id = r.id AND r.rn > 1
      RETURNING 1
  ) SELECT count(*) INTO v_dupes FROM upd;

  WITH upd2 AS (
    UPDATE public.maintenance_requests m
       SET status = 'done'::maintenance_status, closed_at = COALESCE(m.closed_at, now())
      FROM public.units u
     WHERE u.id = m.unit_id
       AND u.status = 'available'::unit_status
       AND m.status IN ('open'::maintenance_status, 'in_progress'::maintenance_status)
      RETURNING 1
  ) SELECT count(*) INTO v_stale FROM upd2;

  RETURN jsonb_build_object('ok', true, 'duplicates_closed', v_dupes,
                            'stale_closed', v_stale, 'at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.maintenance_resync_all() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.maintenance_resync_all() TO service_role;

-- (و) زر المزامنة الفورية — سوبر أدمن فقط
CREATE OR REPLACE FUNCTION public.super_admin_global_sync()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: super admin only' USING ERRCODE = '42501';
  END IF;

  v := public.maintenance_resync_all();

  BEGIN
    INSERT INTO public.branches_audit_log(actor_id, actor_email, action, payload)
    VALUES (auth.uid(), (SELECT email::text FROM auth.users WHERE id = auth.uid()),
            'global_sync', v);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.super_admin_global_sync() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_admin_global_sync() TO authenticated;

-- (ز) مهمة مجدولة كل ساعة
SELECT cron.unschedule('maintenance_resync_hourly')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'maintenance_resync_hourly');

SELECT cron.schedule('maintenance_resync_hourly', '0 * * * *',
                     $$SELECT public.maintenance_resync_all();$$);
