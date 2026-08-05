-- =====================================================================
--  إغلاق عطلين مفتوحين — بعد قياسهما بالأرقام
-- ---------------------------------------------------------------------
--  (1) تسعة حسابات افتراضية غير محدَّدة في كل المنشآت الست عشرة:
--      الحساب البنكي المعلّق، التحويل الداخلي، أرباح وخسائر خصم الدفع
--      المبكر، ضريبة الاستقطاع، دخل ونفقات المنتج، وخصومات بند الفاتورة
--      للعملاء والموردين. غير المحدَّد يعني أن الترحيل التلقائي قد يتخطى
--      تلك الحالات بصمت.
--  (2) ستة مصروفات لها قيود محاسبية سليمة لكن بلا سند صرف. الدفاتر
--      صحيحة والأرصدة سليمة؛ الناقص هو المستند نفسه. لا يُترك لأن السند
--      هو ما يُطبع ويُقدَّم للمراجع.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) إكمال الحسابات الافتراضية لكل منشأة — الحالية والجديدة
-- ---------------------------------------------------------------------
create or replace function public.acct_complete_defaults(p_company uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public','pg_temp'
as $$
declare
  s record; n int := 0;
  -- (رقم الحساب, الاسم, النوع, عمود الإعداد)
  defs text[][] := array[
    ['1102','الحساب البنكي المعلّق',                'asset',    'suspense_bank_account_id'],
    ['1103','الأموال قيد التحويل الداخلي',          'asset',    'internal_transfer_account_id'],
    ['4910','أرباح خصم الدفع المبكر',               'revenue',  'early_discount_gain_account_id'],
    ['5910','خسائر خصم الدفع المبكر',               'expense',  'early_discount_loss_account_id'],
    ['2310','ضريبة الاستقطاع المستحقة',             'liability','withholding_tax_account_id'],
    ['4200','إيرادات المنتجات والخدمات',            'revenue',  'product_income_account_id'],
    ['5300','تكلفة المنتجات والخدمات',              'expense',  'product_expense_account_id'],
    ['4310','خصومات ممنوحة على فواتير العملاء',     'expense',  'invoice_discount_customer_account_id'],
    ['5310','خصومات مكتسبة من فواتير الموردين',     'revenue',  'invoice_discount_vendor_account_id']
  ];
  d text[]; v_acc uuid; v_cur uuid;
begin
  if p_company is null then return jsonb_build_object('error','no_company'); end if;

  insert into public.accounting_settings (company_id) values (p_company)
  on conflict (company_id) do nothing;

  foreach d slice 1 in array defs loop
    -- لا يُلمس ما حدّده المستخدم بنفسه
    execute format('select %I from public.accounting_settings where company_id = $1', d[4])
      into v_cur using p_company;
    if v_cur is not null then continue; end if;

    v_acc := public.fn_ensure_account(p_company, d[1], d[2], d[3]::public.account_type);
    if v_acc is null then continue; end if;

    execute format('update public.accounting_settings set %I = $1 where company_id = $2', d[4])
      using v_acc, p_company;
    n := n + 1;
  end loop;

  return jsonb_build_object('company', p_company, 'filled', n);
end $$;
revoke all on function public.acct_complete_defaults(uuid) from public, anon, authenticated;

do $$ declare c record; begin
  for c in select id from public.companies loop
    perform public.acct_complete_defaults(c.id);
  end loop;
end $$;

-- تُستدعى تلقائياً لكل منشأة جديدة
create or replace function public.fn_acct_bootstrap_on_company_insert()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
begin
  perform public.acct_bootstrap_company(new.id);
  perform public.acct_seed_services(new.id);
  perform public.acct_complete_defaults(new.id);
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2) إنشاء سندات الصرف الناقصة للمصروفات
-- ---------------------------------------------------------------------
create or replace function public.expense_backfill_vouchers(p_dry boolean default true)
returns jsonb
language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare r record; n int := 0; v_no text; v_je uuid;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for r in
    select e.* from public.expenses e
     where not exists (select 1 from public.vouchers v where v.expense_id = e.id)
     order by e.expense_date
  loop
    if p_dry then n := n + 1; continue; end if;

    select id into v_je from public.journal_entries where source_id = r.id limit 1;
    v_no := public.next_document_number(r.company_id, 'payment');

    insert into public.vouchers (
      company_id, voucher_type, voucher_number, voucher_date, amount, account_id,
      party_type, party_name, description, payment_method, attachment_url,
      expense_id, journal_entry_id, created_by, branch_id)
    values (
      r.company_id, 'payment', v_no, r.expense_date, r.amount,
      coalesce(r.paid_from_account_id,
               public.fn_ensure_account(r.company_id, '1101', 'الصندوق (كاش)', 'asset')),
      'vendor', coalesce(r.vendor_name, 'مورد غير محدد'),
      coalesce(r.description, 'سند صرف — تصحيح رجعي لمصروف مُرحَّل'),
      coalesce(r.payment_method, 'cash'::public.payment_method), r.invoice_url,
      r.id, v_je, r.created_by, r.branch_id);
    n := n + 1;
  end loop;

  if not p_dry then
    insert into public.system_repair_log (check_id, status, source, category, executed_by, affected_rows, details)
    values ('expense_voucher_backfill', 'success', 'super_admin', 'data', auth.uid(), n,
            jsonb_build_object('vouchers_created', n));
  end if;

  return jsonb_build_object('ok', true, 'dry_run', p_dry, 'created', n);
end $$;
grant execute on function public.expense_backfill_vouchers(boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 3) فحوص دائمة تمنع عودة العطلين
-- ---------------------------------------------------------------------
create or replace function public.ci_defaults_checks()
returns table (o_suite text, o_name text, o_category text, o_status text,
               o_message text, o_meta jsonb, o_fix text)
language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v int;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*) into v from public.accounting_settings
   where suspense_bank_account_id is null or internal_transfer_account_id is null
      or early_discount_gain_account_id is null or early_discount_loss_account_id is null
      or withholding_tax_account_id is null or product_income_account_id is null
      or product_expense_account_id is null or invoice_discount_customer_account_id is null
      or invoice_discount_vendor_account_id is null or vat_output_account_id is null
      or vat_input_account_id is null or deferred_revenue_account_id is null
      or deferred_expense_account_id is null;
  return query select 'accounting','كل الحسابات الافتراضية محدَّدة','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'كل المنشآت مكتملة الإعداد'
         else v || ' منشأة ينقصها حساب افتراضي أو أكثر' end,
    jsonb_build_object('incomplete_companies', v), 'acct_defaults'::text;

  select count(*) into v from public.expenses e
   where not exists (select 1 from public.vouchers v2 where v2.expense_id = e.id);
  return query select 'accounting','كل مصروف له سند صرف','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'لا مصروف بلا سند' else v || ' مصروفاً بلا سند صرف' end,
    jsonb_build_object('expenses_without_voucher', v), 'expense_vouchers'::text;
end $$;
revoke all on function public.ci_defaults_checks() from public, anon;
grant execute on function public.ci_defaults_checks() to authenticated;

-- دوال الإصلاح المرتبطة بالكتالوج
create or replace function public.acct_defaults_all()
returns integer language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare c record; n int := 0; j jsonb;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  for c in select id from public.companies loop
    j := public.acct_complete_defaults(c.id);
    n := n + coalesce((j->>'filled')::int, 0);
  end loop;
  return n;
end $$;
revoke all on function public.acct_defaults_all() from public, anon, authenticated;

create or replace function public.expense_vouchers_all()
returns integer language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare j jsonb;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  j := public.expense_backfill_vouchers(false);
  return coalesce((j->>'created')::int, 0);
end $$;
revoke all on function public.expense_vouchers_all() from public, anon, authenticated;

insert into public.ci_fix_catalog (check_id, title, description, fix_function) values
  ('acct_defaults', 'إكمال الحسابات الافتراضية',
   'ينشئ الحسابات الناقصة ويربطها بإعدادات كل منشأة دون المساس بما حدّده المستخدم',
   'acct_defaults_all'),
  ('expense_vouchers', 'إنشاء سندات الصرف الناقصة',
   'ينشئ سند صرف لكل مصروف مُرحَّل بلا سند، مربوطاً بقيده القائم',
   'expense_vouchers_all')
on conflict (check_id) do update
  set fix_function = excluded.fix_function,
      title        = excluded.title,
      description  = excluded.description;
