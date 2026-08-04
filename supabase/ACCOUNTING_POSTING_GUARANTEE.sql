-- =====================================================================
--  ضمان الترحيل المحاسبي — إصلاح على مستوى النظام بالكامل
--  لكل الشركات الحالية والجديدة، ولكل المستخدمين.
-- ---------------------------------------------------------------------
--  السبب الجذري المُثبت:
--    fn_expense_auto_post و fn_payment_auto_post تحتويان:
--        if v_exp_acc is null or v_cash_acc is null then return new; end if;
--    فإذا لم يكن الحساب المطلوب موجوداً *لحظة الإدراج* يخرج التريجر بصمت:
--    لا قيد، لا سند، لا خطأ، لا سجل — بينما تُبلغ الواجهة المستخدم بالنجاح.
--
--  الدليل: مصروف صيانة 99 ر.س أُدرج 2026-08-01 16:55:44 والحساب 5110
--  أُنشئ 16:55:46 (بعده بثانيتين) ولا يوجد حساب بديل 5100/5000 لتلك الشركة
--  => v_exp_acc = null => خروج صامت. ونفس النمط في مصروفات الكهرباء
--  (احتاجت 5120 غير الموجود، والبديل 5100 أُنشئ بعدها بعشر ساعات).
--
--  العلاج:
--    1) دالة fn_ensure_account: تُنشئ الحساب الناقص بدل الخروج الصامت.
--    2) إعادة كتابة التريجرين لاستخدامها + تسجيل أي فشل في system_alerts.
--    3) دالة إصلاح للمصروفات غير المرحّلة (لم تكن موجودة إطلاقاً).
--    4) ضمّها إلى accounting_auto_repair.
--    5) دالة إصلاح شاملة لكل الشركات دفعةً واحدة.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) get-or-create للحساب — تمنع الخروج الصامت من جذره
-- ---------------------------------------------------------------------
create or replace function public.fn_ensure_account(
  p_company_id uuid,
  p_code       text,
  p_name       text,
  p_type       public.account_type
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_company_id is null or p_code is null then return null; end if;

  select id into v_id from public.chart_of_accounts
   where company_id = p_company_id and code = p_code
   order by created_at limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.chart_of_accounts (company_id, code, name, account_type, is_group, is_active)
  values (p_company_id, p_code, coalesce(p_name, 'حساب ' || p_code), p_type, false, true)
  returning id into v_id;

  return v_id;
exception when unique_violation then
  -- سباق إدراج متزامن: أعد القراءة
  select id into v_id from public.chart_of_accounts
   where company_id = p_company_id and code = p_code
   order by created_at limit 1;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 2) تريجر المصروفات — بلا خروج صامت
-- ---------------------------------------------------------------------
create or replace function public.fn_expense_auto_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exp_acc uuid; v_cash_acc uuid; v_entry_id uuid; v_entry_no text; v_voucher_no text;
  v_code text; v_name text;
begin
  -- خريطة الفئة إلى كود الحساب واسمه
  select c, n into v_code, v_name from (
    select case new.category::text
             when 'electricity' then '5120' when 'water' then '5120'
             when 'maintenance' then '5110' when 'cleaning' then '5110'
             when 'salaries'    then '5210' when 'internet' then '5130'
             else '5200' end as c,
           case new.category::text
             when 'electricity' then 'مصاريف كهرباء ومياه' when 'water' then 'مصاريف كهرباء ومياه'
             when 'maintenance' then 'مصاريف الصيانة والنظافة' when 'cleaning' then 'مصاريف الصيانة والنظافة'
             when 'salaries'    then 'الرواتب والأجور' when 'internet' then 'مصاريف اتصالات وإنترنت'
             else 'مصاريف تشغيلية عمومية' end as n
  ) m;

  -- ✅ بدل الخروج الصامت: أنشئ الحساب إن لم يوجد
  v_exp_acc  := public.fn_ensure_account(new.company_id, v_code, v_name, 'expense');
  v_cash_acc := coalesce(
                  new.paid_from_account_id,
                  public.fn_ensure_account(new.company_id, '1101', 'الصندوق (كاش)', 'asset'));

  if v_exp_acc is null or v_cash_acc is null then
    -- تعذّر رغم المحاولة: نبّه بدل الابتلاع الصامت
    insert into public.system_alerts (company_id, source, severity, code, message, context)
    values (new.company_id, 'accounting', 'high', 'expense_post_failed',
            'تعذّر ترحيل مصروف تلقائياً — حساب مفقود',
            jsonb_build_object('expense_id', new.id, 'amount', new.amount,
                               'category', new.category::text, 'needed_code', v_code));
    return new;
  end if;

  v_entry_no := next_document_number(new.company_id, 'journal');

  insert into journal_entries (company_id, entry_number, entry_date, description, source_type, source_id, created_by, branch_id)
    values (new.company_id, v_entry_no, new.expense_date, 'قيد تلقائي — مصروف', 'expense', new.id, new.created_by, new.branch_id)
    returning id into v_entry_id;

  insert into journal_entry_lines (entry_id, account_id, debit, credit, description, line_order) values
    (v_entry_id, v_exp_acc,  new.amount, 0, coalesce(new.description, 'مصروف'), 1),
    (v_entry_id, v_cash_acc, 0, new.amount, coalesce(new.description, 'مصروف'), 2);

  v_voucher_no := next_document_number(new.company_id, 'payment');
  insert into vouchers (
    company_id, voucher_type, voucher_number, voucher_date, amount, account_id,
    party_type, party_name, description, payment_method, attachment_url,
    expense_id, journal_entry_id, created_by, branch_id
  ) values (
    new.company_id, 'payment', v_voucher_no, new.expense_date, new.amount, v_cash_acc,
    'vendor', coalesce(new.vendor_name, 'مورد غير محدد'), coalesce(new.description, 'سند صرف تلقائي'),
    -- ⚠️ vouchers.payment_method من نوع enum: لا تُحوّله إلى text وإلا فشل الإدراج كلياً
    coalesce(new.payment_method, 'cash'::public.payment_method), new.invoice_url,
    new.id, v_entry_id, new.created_by, new.branch_id
  );

  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3) تريجر الدفعات — بلا خروج صامت (التسوية/الاسترداد تبقى مستثناة عمداً:
--    تُرحَّل عبر كود التطبيق مرتبطةً بالحجز لا بالدفعة)
-- ---------------------------------------------------------------------
create or replace function public.fn_payment_auto_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cash_acc uuid; v_rev_acc uuid; v_entry_id uuid; v_entry_no text; v_voucher_no text;
  v_customer_name text; v_cash_code text; v_rev_code text; v_rev_name text; v_rev_type public.account_type;
begin
  if new.payment_type::text in ('settlement','refund') then
    return new;
  end if;

  v_cash_code := case when new.method::text in ('bank_transfer','card','pos') then '1102' else '1101' end;
  v_cash_acc  := public.fn_ensure_account(new.company_id, v_cash_code,
                   case when v_cash_code = '1102' then 'البنك' else 'الصندوق (كاش)' end, 'asset');

  -- التأمين التزام على المنشأة لا إيراد
  select c, n, t into v_rev_code, v_rev_name, v_rev_type from (
    select case when new.payment_type::text = 'insurance' then '2120'
                when new.payment_type::text = 'rent'      then '4100'
                else '4300' end as c,
           case when new.payment_type::text = 'insurance' then 'تأمينات مستأجرين'
                when new.payment_type::text = 'rent'      then 'إيرادات الإيجار'
                else 'إيرادات أخرى' end as n,
           (case when new.payment_type::text = 'insurance' then 'liability'
                 else 'revenue' end)::public.account_type as t
  ) m;

  v_rev_acc := public.fn_ensure_account(new.company_id, v_rev_code, v_rev_name, v_rev_type);

  if v_cash_acc is null or v_rev_acc is null then
    insert into public.system_alerts (company_id, source, severity, code, message, context)
    values (new.company_id, 'accounting', 'high', 'payment_post_failed',
            'تعذّر ترحيل دفعة تلقائياً — حساب مفقود',
            jsonb_build_object('payment_id', new.id, 'amount', new.amount,
                               'payment_type', new.payment_type::text));
    return new;
  end if;

  v_entry_no := next_document_number(new.company_id, 'journal');
  insert into journal_entries (company_id, entry_number, entry_date, description, source_type, source_id, created_by, branch_id)
    values (new.company_id, v_entry_no, new.payment_date, 'قيد تلقائي — دفعة مستلمة', 'payment', new.id, new.received_by, new.branch_id)
    returning id into v_entry_id;

  insert into journal_entry_lines (entry_id, account_id, debit, credit, description, line_order) values
    (v_entry_id, v_cash_acc, new.amount, 0, 'استلام دفعة', 1),
    (v_entry_id, v_rev_acc, 0, new.amount, 'استلام دفعة', 2);

  select c.full_name into v_customer_name
    from bookings b join customers c on c.id = b.customer_id where b.id = new.booking_id;

  v_voucher_no := next_document_number(new.company_id, 'receipt');
  insert into vouchers (company_id, voucher_type, voucher_number, voucher_date, amount, account_id,
    party_type, party_name, description, payment_method, attachment_url, payment_id, journal_entry_id, created_by, branch_id)
  values (new.company_id, 'receipt', v_voucher_no, new.payment_date, new.amount, v_cash_acc,
    'tenant', coalesce(v_customer_name,'مستأجر'), 'سند قبض تلقائي لدفعة ' || coalesce(new.notes,''),
    new.method, new.document_url, new.id, v_entry_id, new.received_by, new.branch_id);

  return new;
end $$;

-- ---------------------------------------------------------------------
-- 4) إصلاح المصروفات غير المرحّلة — لم تكن هناك دالة لهذا إطلاقاً
-- ---------------------------------------------------------------------
create or replace function public.accounting_repair_unposted_expenses(
  p_company_id uuid default null,
  p_dry_run    boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid; e record; n int := 0; total numeric := 0;
  dr_acc uuid; cr_acc uuid; je_id uuid; ent_no text; v_code text; v_name text;
begin
  cid := public.acct_assert_company_access(p_company_id);

  for e in
    select ex.* from public.expenses ex
     where ex.company_id = cid and ex.amount > 0
       and not exists (select 1 from public.journal_entries je where je.source_id = ex.id)
     order by ex.expense_date
  loop
    n := n + 1; total := total + e.amount;
    continue when p_dry_run;

    v_code := case e.category::text
                when 'electricity' then '5120' when 'water' then '5120'
                when 'maintenance' then '5110' when 'cleaning' then '5110'
                when 'salaries' then '5210' when 'internet' then '5130'
                else '5200' end;
    v_name := case e.category::text
                when 'electricity' then 'مصاريف كهرباء ومياه' when 'water' then 'مصاريف كهرباء ومياه'
                when 'maintenance' then 'مصاريف الصيانة والنظافة' when 'cleaning' then 'مصاريف الصيانة والنظافة'
                when 'salaries' then 'الرواتب والأجور' when 'internet' then 'مصاريف اتصالات وإنترنت'
                else 'مصاريف تشغيلية عمومية' end;

    dr_acc := public.fn_ensure_account(cid, v_code, v_name, 'expense');
    cr_acc := coalesce(e.paid_from_account_id,
                       public.fn_ensure_account(cid, '1101', 'الصندوق (كاش)', 'asset'));
    continue when dr_acc is null or cr_acc is null;

    ent_no := 'JV-BF-' || substr(replace(e.id::text, '-', ''), 1, 10);

    insert into public.journal_entries
      (company_id, entry_number, entry_date, description, source_type, source_id, branch_id)
    values (cid, ent_no, e.expense_date,
            'ترحيل تصحيحي لمصروف غير مرحّل (' || e.category::text || ')',
            'expense', e.id, e.branch_id)
    returning id into je_id;

    insert into public.journal_entry_lines (entry_id, account_id, debit, credit, description, line_order)
    values (je_id, dr_acc, e.amount, 0, coalesce(e.description,'مصروف') || ' — ترحيل تصحيحي', 1),
           (je_id, cr_acc, 0, e.amount, 'سداد نقدي — ترحيل تصحيحي', 2);
  end loop;

  if not p_dry_run and n > 0 then
    perform public.acct_log_repair(cid, 'unposted_expenses', 'success', n,
      jsonb_build_object('expenses', n, 'amount', total), 'auto');
  end if;

  return jsonb_build_object(
    'status', case when p_dry_run then 'dry_run' else 'success' end,
    'affected_rows', n, 'amount', total);
end $$;

-- ---------------------------------------------------------------------
-- 5) ضمّ خطوة المصروفات إلى الإصلاح الشامل
-- ---------------------------------------------------------------------
create or replace function public.accounting_auto_repair(
  p_company_id uuid default null,
  p_dry_run    boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare cid uuid; res jsonb; total int := 0; part jsonb;
begin
  cid := public.acct_assert_company_access(p_company_id);
  res := '{}'::jsonb;
  part := public.accounting_repair_chart(cid, p_dry_run);              res := res || jsonb_build_object('chart', part);             total := total + (part->>'affected_rows')::int;
  part := public.accounting_repair_orphan_entries(cid, p_dry_run);     res := res || jsonb_build_object('orphans', part);           total := total + (part->>'affected_rows')::int;
  part := public.accounting_repair_dangling_source(cid, p_dry_run);    res := res || jsonb_build_object('dangling_source', part);   total := total + (part->>'affected_rows')::int;
  part := public.accounting_repair_unposted_payments(cid, p_dry_run);  res := res || jsonb_build_object('unposted_payments', part); total := total + (part->>'affected_rows')::int;
  part := public.accounting_repair_unposted_expenses(cid, p_dry_run);  res := res || jsonb_build_object('unposted_expenses', part); total := total + (part->>'affected_rows')::int;
  part := public.accounting_repair_insurance(cid, p_dry_run);          res := res || jsonb_build_object('insurance', part);         total := total + (part->>'affected_rows')::int;
  part := public.accounting_repair_unbalanced(cid, p_dry_run);         res := res || jsonb_build_object('unbalanced', part);        total := total + (part->>'affected_rows')::int;
  if not p_dry_run then
    perform public.acct_log_repair(cid, 'accounting_auto_repair', 'success', total, res, 'auto');
  end if;
  return jsonb_build_object('status', case when p_dry_run then 'dry_run' else 'success' end,
                            'affected_rows', total, 'steps', res);
end $$;

-- ---------------------------------------------------------------------
-- 6) إصلاح شامل لكل الشركات — service_role فقط (لا يُستدعى من الواجهة)
-- ---------------------------------------------------------------------
create or replace function public.accounting_repair_all_companies(
  p_dry_run boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare c record; out_rows jsonb := '[]'::jsonb; part jsonb; grand int := 0;
begin
  for c in select id, name from public.companies order by created_at loop
    begin
      part := public.accounting_repair_unposted_expenses(c.id, p_dry_run);
      grand := grand + coalesce((part->>'affected_rows')::int, 0);
      out_rows := out_rows || jsonb_build_object('company', c.name, 'expenses', part);

      part := public.accounting_repair_unposted_payments(c.id, p_dry_run);
      grand := grand + coalesce((part->>'affected_rows')::int, 0);
      out_rows := out_rows || jsonb_build_object('company', c.name, 'payments', part);
    exception when others then
      out_rows := out_rows || jsonb_build_object('company', c.name, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('status', case when p_dry_run then 'dry_run' else 'success' end,
                            'affected_rows', grand, 'details', out_rows);
end $$;

-- ---------------------------------------------------------------------
-- الصلاحيات
-- ---------------------------------------------------------------------
revoke all on function public.fn_ensure_account(uuid, text, text, public.account_type) from public, anon;
revoke all on function public.accounting_repair_unposted_expenses(uuid, boolean) from public, anon;
revoke all on function public.accounting_repair_all_companies(boolean) from public, anon, authenticated;

grant execute on function public.fn_ensure_account(uuid, text, text, public.account_type) to authenticated, service_role;
grant execute on function public.accounting_repair_unposted_expenses(uuid, boolean) to authenticated, service_role;
grant execute on function public.accounting_repair_all_companies(boolean) to service_role;
