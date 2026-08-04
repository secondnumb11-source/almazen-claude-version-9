-- =====================================================================
-- إصلاح فجوة الترحيل المحاسبي: الدفعات غير المرحّلة إلى دفتر اليومية
-- ---------------------------------------------------------------------
-- المشكلة: الدفعات المسجّلة قبل تفعيل المزامنة المحاسبية (أو التي فشلت
-- مزامنتها) لا يقابلها قيد يومية، فتظهر في سجل الدفعات ولا تظهر في
-- ميزان المراجعة أو قائمة الدخل => نقص حقيقي في اكتمال الحسابات.
--
-- الحل: دالة فحص + دالة إصلاح (SECURITY DEFINER مقيّدة بشركة المستخدم)
-- تُنشئ قيداً مزدوجاً متوازناً لكل دفعة غير مرحّلة بتاريخ الدفعة نفسها،
-- وهي idempotent (لا تُنشئ قيداً مكرراً عند إعادة التشغيل).
-- =====================================================================

-- شرط التغطية المحاسبية لدفعة واحدة
CREATE OR REPLACE FUNCTION public.acct_payment_is_posted(p_payment_id uuid, p_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.journal_entries je
     WHERE je.source_id = p_payment_id
        OR (p_booking_id IS NOT NULL AND je.source_id = p_booking_id)
  )
$$;

-- فحص: الدفعات غير المرحّلة لشركة المستخدم
CREATE OR REPLACE FUNCTION public.check_unposted_payments(p_company_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(id uuid, payment_date date, amount numeric, payment_type text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE cid uuid;
BEGIN
  cid := public.acct_assert_company_access(p_company_id);
  RETURN QUERY
    SELECT p.id, p.payment_date, p.amount, p.payment_type::text
      FROM public.payments p
     WHERE p.company_id = cid
       AND NOT public.acct_payment_is_posted(p.id, p.booking_id)
     ORDER BY p.payment_date;
END $$;

-- إصلاح: ترحيل الدفعات غير المرحّلة بقيود مزدوجة متوازنة
CREATE OR REPLACE FUNCTION public.accounting_repair_unposted_payments(
  p_company_id uuid DEFAULT NULL::uuid,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cid uuid; p record; n int := 0; total numeric := 0;
  dr_acc uuid; cr_acc uuid; je_id uuid; ent_no text;
BEGIN
  cid := public.acct_assert_company_access(p_company_id);
  IF NOT p_dry_run THEN PERFORM public.accounting_repair_chart(cid, false); END IF;

  FOR p IN
    SELECT pay.id, pay.booking_id, pay.amount, pay.payment_date,
           pay.payment_type::text AS ptype, pay.method::text AS pmethod, pay.branch_id
      FROM public.payments pay
     WHERE pay.company_id = cid
       AND pay.amount > 0
       AND NOT public.acct_payment_is_posted(pay.id, pay.booking_id)
     ORDER BY pay.payment_date
  LOOP
    n := n + 1; total := total + p.amount;
    CONTINUE WHEN p_dry_run;

    -- الطرف المدين: البنك للتحويلات/الشبكة، وإلا الصندوق
    SELECT a.id INTO dr_acc FROM public.chart_of_accounts a
     WHERE a.company_id = cid
       AND a.code = CASE WHEN p.pmethod IN ('bank_transfer','bank','card','pos','transfer') THEN '1102' ELSE '1101' END
     ORDER BY a.created_at LIMIT 1;

    -- الطرف الدائن: التزام تأمينات للتأمين، وإلا إيراد الإيجار
    SELECT a.id INTO cr_acc FROM public.chart_of_accounts a
     WHERE a.company_id = cid
       AND a.code = CASE WHEN p.ptype = 'insurance' THEN '2120' ELSE '4100' END
     ORDER BY a.created_at LIMIT 1;

    CONTINUE WHEN dr_acc IS NULL OR cr_acc IS NULL;

    ent_no := 'JV-BF-' || substr(replace(p.id::text, '-', ''), 1, 10);

    INSERT INTO public.journal_entries
      (company_id, entry_number, entry_date, description, source_type, source_id, branch_id)
    VALUES (cid, ent_no, p.payment_date,
            'ترحيل تصحيحي لدفعة غير مرحّلة (' || p.ptype || ')',
            'payment', p.id, p.branch_id)
    RETURNING id INTO je_id;

    INSERT INTO public.journal_entry_lines (entry_id, account_id, debit, credit, description, line_order)
    VALUES (je_id, dr_acc, p.amount, 0, 'تحصيل دفعة — ترحيل تصحيحي', 1),
           (je_id, cr_acc, 0, p.amount,
            CASE WHEN p.ptype = 'insurance' THEN 'التزام تأمين مستأجر' ELSE 'إيراد إيجار' END, 2);
  END LOOP;

  IF NOT p_dry_run AND n > 0 THEN
    PERFORM public.acct_log_repair(cid, 'unposted_payments', 'success', n,
      jsonb_build_object('payments', n, 'amount', total));
  END IF;

  RETURN jsonb_build_object(
    'status', CASE WHEN p_dry_run THEN 'dry_run' ELSE 'success' END,
    'affected_rows', n, 'amount', total);
END $$;

-- إدراج الخطوة داخل الإصلاح الشامل
CREATE OR REPLACE FUNCTION public.accounting_auto_repair(
  p_company_id uuid DEFAULT NULL::uuid,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE cid uuid; res jsonb; total int := 0; part jsonb;
BEGIN
  cid := public.acct_assert_company_access(p_company_id);
  res := '{}'::jsonb;
  part := public.accounting_repair_chart(cid, p_dry_run);              res := res || jsonb_build_object('chart', part);            total := total + (part->>'affected_rows')::int;
  part := public.accounting_repair_orphan_entries(cid, p_dry_run);     res := res || jsonb_build_object('orphans', part);          total := total + (part->>'affected_rows')::int;
  part := public.accounting_repair_dangling_source(cid, p_dry_run);    res := res || jsonb_build_object('dangling_source', part);  total := total + (part->>'affected_rows')::int;
  part := public.accounting_repair_unposted_payments(cid, p_dry_run);  res := res || jsonb_build_object('unposted_payments', part); total := total + (part->>'affected_rows')::int;
  part := public.accounting_repair_insurance(cid, p_dry_run);          res := res || jsonb_build_object('insurance', part);        total := total + (part->>'affected_rows')::int;
  part := public.accounting_repair_unbalanced(cid, p_dry_run);         res := res || jsonb_build_object('unbalanced', part);       total := total + (part->>'affected_rows')::int;
  IF NOT p_dry_run THEN
    PERFORM public.acct_log_repair(cid, 'accounting_auto_repair', 'success', total, res, 'auto');
  END IF;
  RETURN jsonb_build_object('status', CASE WHEN p_dry_run THEN 'dry_run' ELSE 'success' END, 'affected_rows', total, 'steps', res);
END $$;

REVOKE ALL ON FUNCTION public.acct_payment_is_posted(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_unposted_payments(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accounting_repair_unposted_payments(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acct_payment_is_posted(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_unposted_payments(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accounting_repair_unposted_payments(uuid, boolean) TO authenticated, service_role;
