-- ===============================================================
--  PORTAL_PAYMENT_AND_MIGRATION_CHECKS.sql
--  1) portal_record_payment — سداد آمن من بوابة المستأجر (بدون تسجيل دخول)
--     البوابة عامة تماماً، فلا يجوز الإدراج المباشر في جدول payments.
--     الدالة SECURITY DEFINER وتتحقق من التوكن وتحسب المتبقي بنفسها،
--     فلا يمكن للعميل تمرير مبلغ أكبر من المستحق ولا الدفع لحجز غيره.
--  2) لا تغيّر أي سلوك قائم — إضافة فقط.
-- ===============================================================

CREATE OR REPLACE FUNCTION public.portal_record_payment(
  p_token     text,
  p_method    text DEFAULT 'card',
  p_amount    numeric DEFAULT NULL,
  p_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_acct      tenant_portal_accounts%rowtype;
  v_booking   bookings%rowtype;
  v_paid      numeric;
  v_remaining numeric;
  v_amount    numeric;
  v_method    payment_method;
  v_id        uuid;
begin
  select * into v_acct from tenant_portal_accounts
   where access_token = p_token and is_active = true;
  if not found then raise exception 'INVALID_TOKEN'; end if;

  select b.* into v_booking from bookings b
   where b.customer_id = v_acct.customer_id
     and b.company_id  = v_acct.company_id
     and b.status in ('confirmed'::booking_status, 'checked_in'::booking_status)
   order by b.check_in_date desc
   limit 1;
  if not found then raise exception 'NO_ACTIVE_BOOKING'; end if;

  select coalesce(sum(p.amount), 0) into v_paid from payments p where p.booking_id = v_booking.id;
  v_remaining := coalesce(v_booking.total_amount, 0) - v_paid;
  if v_remaining <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'nothing_due', 'remaining', 0);
  end if;

  -- المبلغ المسموح: المتبقي كحد أقصى، ولا يقبل قيمة صفرية أو سالبة
  v_amount := least(coalesce(nullif(p_amount, 0), v_remaining), v_remaining);
  if v_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  begin
    v_method := p_method::payment_method;
  exception when others then
    v_method := 'card'::payment_method;
  end;

  insert into payments (company_id, booking_id, payment_type, amount, payment_date, method, reference_number, notes, branch_id)
  values (v_acct.company_id, v_booking.id, 'rent'::payment_type, v_amount, current_date, v_method,
          p_reference, 'دفع إلكتروني عبر بوابة المستأجر', v_booking.branch_id)
  returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'payment_id', v_id, 'amount', v_amount,
    'remaining', v_remaining - v_amount, 'booking_id', v_booking.id
  );
end $function$;

REVOKE ALL ON FUNCTION public.portal_record_payment(text, text, numeric, text) FROM public;
GRANT EXECUTE ON FUNCTION public.portal_record_payment(text, text, numeric, text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------
-- إصلاح حرج: fn_payment_auto_post كانت تقارن enum payment_method
-- بالقيمة 'pos' غير الموجودة في النوع، مما يجعل *أي* إدراج دفعة
-- يفشل بخطأ: invalid input value for enum payment_method: "pos".
-- الحل: المقارنة نصياً (::text) مع الإبقاء على نفس المنطق تماماً.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_payment_auto_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cash_acc uuid; v_rev_acc uuid; v_entry_id uuid; v_entry_no text; v_voucher_no text;
  v_customer_name text;
begin
  if new.payment_type in ('settlement','refund') then
    return new;
  end if;

  select id into v_cash_acc from chart_of_accounts
    where company_id = new.company_id
      and code = case when new.method::text in ('bank_transfer','card','pos') then '1102' else '1101' end;
  if v_cash_acc is null then
    select id into v_cash_acc from chart_of_accounts
      where company_id = new.company_id and code in ('1102','1101','1100','1000') limit 1;
  end if;

  select id into v_rev_acc from chart_of_accounts
    where company_id = new.company_id
      and code = case when new.payment_type::text = 'insurance' then '2120'
                      when new.payment_type::text = 'rent' then '4100'
                      else '4300' end;
  if v_rev_acc is null then
    select id into v_rev_acc from chart_of_accounts
      where company_id = new.company_id and code in ('4100','4000') limit 1;
  end if;

  if v_cash_acc is null or v_rev_acc is null then return new; end if;

  v_entry_no := next_document_number(new.company_id, 'journal');
  insert into journal_entries (company_id, entry_number, entry_date, description, source_type, source_id, created_by)
    values (new.company_id, v_entry_no, new.payment_date, 'قيد تلقائي — دفعة مستلمة', 'payment', new.id, new.received_by)
    returning id into v_entry_id;

  insert into journal_entry_lines (entry_id, account_id, debit, credit, description, line_order) values
    (v_entry_id, v_cash_acc, new.amount, 0, 'استلام دفعة', 1),
    (v_entry_id, v_rev_acc, 0, new.amount, 'استلام دفعة', 2);

  select c.full_name into v_customer_name
    from bookings b join customers c on c.id = b.customer_id where b.id = new.booking_id;

  v_voucher_no := next_document_number(new.company_id, 'receipt');
  insert into vouchers (company_id, voucher_type, voucher_number, voucher_date, amount, account_id,
    party_type, party_name, description, payment_method, attachment_url, payment_id, journal_entry_id, created_by)
  values (new.company_id, 'receipt', v_voucher_no, new.payment_date, new.amount, v_cash_acc,
    'tenant', coalesce(v_customer_name,'مستأجر'), 'سند قبض تلقائي لدفعة ' || coalesce(new.notes,''),
    new.method, new.document_url, new.id, v_entry_id, new.received_by);

  return new;
end $function$;

-- تثبيت search_path لدالة SECURITY DEFINER كانت بدون تثبيت (تصلّب أمني)
ALTER FUNCTION public.create_tenant_portal_on_checkin() SET search_path TO 'public';
