-- ============================================================================
-- ZATCA — أساس المرحلة الثانية (الفوترة الإلكترونية: التكامل والتخليص)
-- طُبّقت على المشروع drowmezlcrvowuhqmfef بتاريخ 2026-08-12
-- ============================================================================
-- الحالة قبل هذه المهاجرة — مُقاسة لا مُفترضة:
--   • لا دالة Edge واحدة للربط بـ Fatoora من بين 16 دالة منشورة.
--   • صفر عمود من أعمدة السلسلة والتوقيع في invoices.
--   • بيانات اعتماد ZATCA مخزَّنة على مستوى المنشأة فقط (company_secrets)
--     بلا أي عزل على مستوى الفرع.
--   • 13 منشأة من 17 بلا رقم ضريبي.
--
-- ما تضيفه: البنية اللازمة للمرحلة الثانية فقط. لا تدّعي الاعتماد لدى الهيئة —
-- التوقيع الفعلي يتطلب شهادة CSID حقيقية من بوابة Fatoora لكل منشأة/فرع،
-- وهي لا تُولَّد من داخل النظام.
--
-- كل الأعمدة NULLABLE وبلا قيود إلزامية: الفواتير القائمة (25 فاتورة) تبقى
-- صالحة كما هي ولا يتغيّر أي سلوك قائم — شرطا القاعدة 54.
-- ============================================================================

-- (1) أعمدة السلسلة والتوقيع على الفاتورة
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS zatca_uuid uuid,                    -- UUID الفريد للفاتورة (حقل إلزامي في UBL)
  ADD COLUMN IF NOT EXISTS icv bigint,                         -- Invoice Counter Value — عدّاد تسلسلي لا يتكرر
  ADD COLUMN IF NOT EXISTS invoice_hash text,                  -- تجزئة الفاتورة (SHA-256، Base64)
  ADD COLUMN IF NOT EXISTS previous_hash text,                 -- تجزئة الفاتورة السابقة — سلسلة غير قابلة للكسر
  ADD COLUMN IF NOT EXISTS signed_xml text,                    -- مستند UBL 2.1 الموقّع
  ADD COLUMN IF NOT EXISTS zatca_status text,                  -- pending | reported | cleared | rejected | failed
  ADD COLUMN IF NOT EXISTS zatca_response jsonb,               -- ردّ الهيئة كاملاً للتدقيق
  ADD COLUMN IF NOT EXISTS zatca_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS zatca_cleared_at timestamptz,
  ADD COLUMN IF NOT EXISTS branch_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_zatca_status_chk') THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_zatca_status_chk
      CHECK (zatca_status IS NULL OR zatca_status IN ('pending','reported','cleared','rejected','failed'));
  END IF;
END $$;

-- ICV يجب ألّا يتكرر داخل المنشأة الواحدة — شرط أصيل في مواصفة ZATCA.
CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_company_icv
  ON public.invoices (company_id, icv) WHERE icv IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_invoices_zatca_status
  ON public.invoices (company_id, zatca_status) WHERE zatca_status IS NOT NULL;

-- (2) عزل بيانات الاعتماد لكل فرع — كل مدير على منشأته وفروعه بشكل منفصل،
--     لأن لكل جهة مستنداتها. صف branch_id = NULL يمثّل اعتماد المنشأة الافتراضي.
CREATE TABLE IF NOT EXISTS public.zatca_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  environment text NOT NULL DEFAULT 'sandbox'
    CHECK (environment IN ('sandbox','simulation','production')),
  vat_number text,
  csr text,
  csid text,
  csid_secret text,
  production_csid text,
  production_csid_secret text,
  onboarding_status text NOT NULL DEFAULT 'not_started'
    CHECK (onboarding_status IN ('not_started','csr_generated','compliance_passed','production_ready','failed')),
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_zatca_credentials_company_branch
  ON public.zatca_credentials (company_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE public.zatca_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS zatca_credentials_rw ON public.zatca_credentials;
CREATE POLICY zatca_credentials_rw ON public.zatca_credentials
  FOR ALL
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.current_profile_role() IN ('owner','manager'))
  )
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.current_profile_role() IN ('owner','manager'))
  );

REVOKE ALL ON public.zatca_credentials FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zatca_credentials TO authenticated;

DROP TRIGGER IF EXISTS trg_zatca_credentials_updated ON public.zatca_credentials;
CREATE TRIGGER trg_zatca_credentials_updated
  BEFORE UPDATE ON public.zatca_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- (3) عدّاد ICV ذرّي لكل منشأة — يمنع التكرار حتى مع الإصدار المتزامن.
CREATE OR REPLACE FUNCTION public.zatca_next_icv(p_company uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
declare v_next bigint;
begin
  perform public.acct_guard(p_company);
  perform pg_advisory_xact_lock(hashtext('zatca_icv:' || p_company::text));
  select coalesce(max(icv), 0) + 1 into v_next
    from public.invoices where company_id = p_company;
  return v_next;
end
$function$;

REVOKE ALL ON FUNCTION public.zatca_next_icv(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.zatca_next_icv(uuid) TO authenticated;
