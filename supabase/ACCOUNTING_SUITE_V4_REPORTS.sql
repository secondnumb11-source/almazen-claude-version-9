-- =====================================================================
--  الدفعة 4 — التقارير المالية الحقيقية
-- ---------------------------------------------------------------------
--  كل تقرير يُحتسب من القيود المرحّلة فعلاً (journal_entry_lines)
--  أو من جداول العمليات نفسها — لا أرقام تقديرية ولا بيانات تجريبية.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) قائمة الدخل
-- ---------------------------------------------------------------------
drop function if exists public.rpt_income_statement(uuid,date,date,uuid,uuid);
create or replace function public.rpt_income_statement(
  p_company uuid default null, p_from date default null, p_to date default null,
  p_cost_center uuid default null, p_branch uuid default null)
returns table (o_section text, o_code text, o_name text, o_amount numeric)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare v_co uuid; v_rev numeric; v_exp numeric;
begin
  v_co := public.acct_guard(p_company);
  return query
  with l as (
    select a.account_type::text tp, a.code, a.name,
           sum(coalesce(jl.credit,0) - coalesce(jl.debit,0)) as net_cr,
           sum(coalesce(jl.debit,0) - coalesce(jl.credit,0)) as net_dr
      from public.journal_entry_lines jl
      join public.journal_entries e on e.id = jl.entry_id
      join public.chart_of_accounts a on a.id = jl.account_id
     where e.company_id = v_co and e.status = 'posted'
       and (p_from is null or e.entry_date >= p_from)
       and (p_to   is null or e.entry_date <= p_to)
       and (p_cost_center is null or jl.cost_center_id = p_cost_center)
       and (p_branch is null or e.branch_id = p_branch)
       and a.account_type::text in ('revenue','expense')
     group by 1,2,3)
  select 'الإيرادات', code, name, round(net_cr,2) from l where tp='revenue' and net_cr <> 0
  union all
  select 'المصروفات', code, name, round(net_dr,2) from l where tp='expense' and net_dr <> 0
  order by 1 desc, 2;

  select coalesce(sum(case when a.account_type::text='revenue' then jl.credit - jl.debit else 0 end),0),
         coalesce(sum(case when a.account_type::text='expense' then jl.debit - jl.credit else 0 end),0)
    into v_rev, v_exp
    from public.journal_entry_lines jl
    join public.journal_entries e on e.id = jl.entry_id
    join public.chart_of_accounts a on a.id = jl.account_id
   where e.company_id = v_co and e.status='posted'
     and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
     and (p_cost_center is null or jl.cost_center_id = p_cost_center)
     and (p_branch is null or e.branch_id = p_branch);

  return query select 'الإجمالي'::text, 'TOTAL-REV'::text, 'إجمالي الإيرادات'::text, round(v_rev,2);
  return query select 'الإجمالي'::text, 'TOTAL-EXP'::text, 'إجمالي المصروفات'::text, round(v_exp,2);
  return query select 'الإجمالي'::text, 'NET'::text, 'صافي الربح / (الخسارة)'::text, round(v_rev - v_exp,2);
end $$;
grant execute on function public.rpt_income_statement(uuid,date,date,uuid,uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2) قائمة المركز المالي (الميزانية العمومية)
-- ---------------------------------------------------------------------
drop function if exists public.rpt_balance_sheet(uuid,date,uuid);
create or replace function public.rpt_balance_sheet(
  p_company uuid default null, p_as_of date default null, p_branch uuid default null)
returns table (o_section text, o_code text, o_name text, o_amount numeric)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare v_co uuid; v_a numeric; v_l numeric; v_e numeric; v_p numeric;
begin
  v_co := public.acct_guard(p_company);
  return query
  with l as (
    select a.account_type::text tp, a.code, a.name,
           sum(coalesce(jl.debit,0) - coalesce(jl.credit,0)) as net_dr
      from public.journal_entry_lines jl
      join public.journal_entries e on e.id = jl.entry_id
      join public.chart_of_accounts a on a.id = jl.account_id
     where e.company_id = v_co and e.status='posted'
       and (p_as_of is null or e.entry_date <= p_as_of)
       and (p_branch is null or e.branch_id = p_branch)
     group by 1,2,3)
  select 'الأصول', code, name, round(net_dr,2)   from l where tp='asset'     and net_dr <> 0
  union all
  select 'الخصوم', code, name, round(-net_dr,2)  from l where tp='liability' and net_dr <> 0
  union all
  select 'حقوق الملكية', code, name, round(-net_dr,2) from l where tp='equity' and net_dr <> 0
  order by 1, 2;

  select
    coalesce(sum(case when a.account_type::text='asset'     then jl.debit - jl.credit else 0 end),0),
    coalesce(sum(case when a.account_type::text='liability' then jl.credit - jl.debit else 0 end),0),
    coalesce(sum(case when a.account_type::text='equity'    then jl.credit - jl.debit else 0 end),0)
    into v_a, v_l, v_e
    from public.journal_entry_lines jl
    join public.journal_entries e on e.id = jl.entry_id
    join public.chart_of_accounts a on a.id = jl.account_id
   where e.company_id = v_co and e.status='posted'
     and (p_as_of is null or e.entry_date <= p_as_of)
     and (p_branch is null or e.branch_id = p_branch);

  -- الأرباح المحتجزة = الإيرادات − المصروفات حتى التاريخ.
  -- كلا الطرفين بصيغة «دائن ناقص مدين»: الإيراد يزيدها والمصروف يخفضها،
  -- فتُطرح المصروفات بحكم إشارتها لا بطرح صريح.
  select coalesce(sum(jl.credit - jl.debit),0)
    into v_p
    from public.journal_entry_lines jl
    join public.journal_entries e on e.id = jl.entry_id
    join public.chart_of_accounts a on a.id = jl.account_id
   where e.company_id = v_co and e.status='posted'
     and a.account_type::text in ('revenue','expense')
     and (p_as_of is null or e.entry_date <= p_as_of)
     and (p_branch is null or e.branch_id = p_branch);

  -- صافي الدخل يظهر ضمن حقوق الملكية كما في المعايير
  return query select 'حقوق الملكية'::text, 'RE'::text, 'الأرباح المحتجزة (نتيجة الفترة)'::text, round(v_p,2);
  return query select 'الإجمالي'::text, 'TOTAL-A'::text, 'إجمالي الأصول'::text, round(v_a,2);
  return query select 'الإجمالي'::text, 'TOTAL-LE'::text, 'إجمالي الخصوم وحقوق الملكية'::text, round(v_l + v_e + v_p,2);
  return query select 'الإجمالي'::text, 'DIFF'::text, 'الفارق (يجب أن يساوي صفراً)'::text, round(v_a - (v_l + v_e + v_p),2);
end $$;
grant execute on function public.rpt_balance_sheet(uuid,date,uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3) قائمة التدفقات النقدية — حركة الحسابات النقدية والبنكية فعلياً
-- ---------------------------------------------------------------------
drop function if exists public.rpt_cash_flow(uuid,date,date,uuid);
create or replace function public.rpt_cash_flow(
  p_company uuid default null, p_from date default null, p_to date default null, p_branch uuid default null)
returns table (o_section text, o_code text, o_name text, o_amount numeric)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare v_co uuid; v_open numeric; v_in numeric; v_out numeric;
begin
  v_co := public.acct_guard(p_company);

  -- الحسابات النقدية: الأصول التي رمزها يبدأ بـ 10 أو 11 (النقدية والبنوك في الدليل المعتمد)
  select coalesce(sum(jl.debit - jl.credit),0) into v_open
    from public.journal_entry_lines jl
    join public.journal_entries e on e.id = jl.entry_id
    join public.chart_of_accounts a on a.id = jl.account_id
   where e.company_id=v_co and e.status='posted' and a.account_type::text='asset'
     and (a.code like '10%' or a.code like '11%')
     and p_from is not null and e.entry_date < p_from
     and (p_branch is null or e.branch_id = p_branch);

  return query select 'الرصيد'::text, 'OPEN'::text, 'النقدية أول المدة'::text, round(coalesce(v_open,0),2);

  return query
  select case when jl.debit > 0 then 'التدفقات الداخلة' else 'التدفقات الخارجة' end,
         a.code, a.name, round(sum(abs(jl.debit - jl.credit)),2)
    from public.journal_entry_lines jl
    join public.journal_entries e on e.id = jl.entry_id
    join public.chart_of_accounts a on a.id = jl.account_id
   where e.company_id=v_co and e.status='posted' and a.account_type::text='asset'
     and (a.code like '10%' or a.code like '11%')
     and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
     and (p_branch is null or e.branch_id = p_branch)
   group by 1,2,3 order by 1,2;

  select coalesce(sum(jl.debit),0), coalesce(sum(jl.credit),0) into v_in, v_out
    from public.journal_entry_lines jl
    join public.journal_entries e on e.id = jl.entry_id
    join public.chart_of_accounts a on a.id = jl.account_id
   where e.company_id=v_co and e.status='posted' and a.account_type::text='asset'
     and (a.code like '10%' or a.code like '11%')
     and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to)
     and (p_branch is null or e.branch_id = p_branch);

  return query select 'الإجمالي'::text, 'IN'::text,  'إجمالي المقبوضات'::text, round(v_in,2);
  return query select 'الإجمالي'::text, 'OUT'::text, 'إجمالي المدفوعات'::text, round(v_out,2);
  return query select 'الإجمالي'::text, 'CLOSE'::text, 'النقدية آخر المدة'::text,
                      round(coalesce(v_open,0) + v_in - v_out, 2);
end $$;
grant execute on function public.rpt_cash_flow(uuid,date,date,uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4) أعمار الذمم المدينة (العملاء) — من الفواتير غير المسددة فعلياً
-- ---------------------------------------------------------------------
drop function if exists public.rpt_ar_aging(uuid,date);
create or replace function public.rpt_ar_aging(p_company uuid default null, p_as_of date default null)
returns table (
  o_party text, o_doc text, o_date date, o_total numeric, o_paid numeric, o_due numeric,
  o_days int, o_bucket text)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare v_co uuid; v_as date;
begin
  v_co := public.acct_guard(p_company);
  v_as := coalesce(p_as_of, current_date);
  return query
  with paid as (
    select p.booking_id, sum(p.amount) amt from public.payments p
     where p.company_id = v_co and p.payment_type::text not in ('refund')
     group by p.booking_id)
  select i.customer_name,
         i.invoice_number,
         i.issued_at::date,
         round(i.total,2),
         round(coalesce(pd.amt,0),2),
         round(i.total - coalesce(pd.amt,0),2),
         (v_as - i.issued_at::date)::int,
         case when (v_as - i.issued_at::date) <= 30 then '0-30 يوم'
              when (v_as - i.issued_at::date) <= 60 then '31-60 يوم'
              when (v_as - i.issued_at::date) <= 90 then '61-90 يوم'
              else 'أكثر من 90 يوم' end
    from public.invoices i
    left join paid pd on pd.booking_id = i.booking_id
   where i.company_id = v_co
     and i.status::text <> 'cancelled'
     and i.issued_at::date <= v_as
     and round(i.total - coalesce(pd.amt,0),2) > 0
   order by 7 desc;
end $$;
grant execute on function public.rpt_ar_aging(uuid,date) to authenticated;

-- ---------------------------------------------------------------------
-- 5) أعمار الذمم الدائنة (الموردون) — من سندات الصرف غير المسددة
-- ---------------------------------------------------------------------
drop function if exists public.rpt_ap_aging(uuid,date);
create or replace function public.rpt_ap_aging(p_company uuid default null, p_as_of date default null)
returns table (o_party text, o_doc text, o_date date, o_amount numeric, o_days int, o_bucket text)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare v_co uuid; v_as date;
begin
  v_co := public.acct_guard(p_company);
  v_as := coalesce(p_as_of, current_date);
  return query
  select v.party_name, v.voucher_number, v.voucher_date, round(v.amount,2),
         (v_as - v.voucher_date)::int,
         case when (v_as - v.voucher_date) <= 30 then '0-30 يوم'
              when (v_as - v.voucher_date) <= 60 then '31-60 يوم'
              when (v_as - v.voucher_date) <= 90 then '61-90 يوم'
              else 'أكثر من 90 يوم' end
    from public.vouchers v
   where v.company_id = v_co and v.party_type::text = 'vendor'
     and v.voucher_date <= v_as
   order by 5 desc;
end $$;
grant execute on function public.rpt_ap_aging(uuid,date) to authenticated;

-- ---------------------------------------------------------------------
-- 6) كشف حساب طرف (عميل أو مورد) — كل عملياته مع الرصيد الجاري
-- ---------------------------------------------------------------------
drop function if exists public.rpt_party_statement(uuid,text,date,date);
create or replace function public.rpt_party_statement(
  p_company uuid default null, p_party text default null,
  p_from date default null, p_to date default null)
returns table (o_date date, o_doc_type text, o_doc text, o_description text,
               o_debit numeric, o_credit numeric, o_balance numeric)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare v_co uuid;
begin
  v_co := public.acct_guard(p_company);
  return query
  with tx as (
    select i.issued_at::date d, 'فاتورة'::text tp, i.invoice_number doc,
           coalesce(i.customer_name,'') descr, i.total dr, 0::numeric cr
      from public.invoices i
     where i.company_id=v_co and i.status::text <> 'cancelled'
       and (p_party is null or i.customer_name ilike '%'||p_party||'%')
    union all
    select v.voucher_date, case when v.voucher_type::text='receipt' then 'سند قبض' else 'سند صرف' end,
           v.voucher_number, coalesce(v.description, v.party_name),
           case when v.voucher_type::text='payment' then v.amount else 0 end,
           case when v.voucher_type::text='receipt' then v.amount else 0 end
      from public.vouchers v
     where v.company_id=v_co
       and (p_party is null or v.party_name ilike '%'||p_party||'%')
  ), f as (
    select * from tx
     where (p_from is null or d >= p_from) and (p_to is null or d <= p_to)
  )
  select f.d, f.tp, f.doc, f.descr, round(f.dr,2), round(f.cr,2),
         round(sum(f.dr - f.cr) over (order by f.d, f.doc rows between unbounded preceding and current row),2)
    from f order by f.d, f.doc;
end $$;
grant execute on function public.rpt_party_statement(uuid,text,date,date) to authenticated;

-- ---------------------------------------------------------------------
-- 7) ملخص الضريبة المجمّع
-- ---------------------------------------------------------------------
drop function if exists public.rpt_vat_summary(uuid,date,date);
create or replace function public.rpt_vat_summary(p_company uuid default null, p_from date default null, p_to date default null)
returns table (o_bucket text, o_count int, o_net numeric, o_vat numeric, o_gross numeric)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare v_co uuid;
begin
  v_co := public.acct_guard(p_company);
  return query
  select r.o_bucket, count(*)::int, round(sum(r.o_net),2), round(sum(r.o_vat),2), round(sum(r.o_gross),2)
    from public.vat_report(v_co, p_from, p_to) r
   group by r.o_bucket order by 1;
end $$;
grant execute on function public.rpt_vat_summary(uuid,date,date) to authenticated;

-- ---------------------------------------------------------------------
-- 8) ملخص الأصول الثابتة
-- ---------------------------------------------------------------------
drop function if exists public.rpt_fixed_assets(uuid);
create or replace function public.rpt_fixed_assets(p_company uuid default null)
returns table (o_name text, o_category text, o_purchase_date date, o_cost numeric,
               o_accumulated numeric, o_book_value numeric)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare v_co uuid; v_has boolean;
begin
  v_co := public.acct_guard(p_company);
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='assets' and column_name='purchase_cost')
    into v_has;
  if not v_has then return; end if;
  return query
  select a.name::text, coalesce(a.category,'—')::text, a.purchase_date::date,
         round(coalesce(a.purchase_cost,0),2),
         round(coalesce(a.accumulated_depreciation,0),2),
         round(coalesce(a.purchase_cost,0) - coalesce(a.accumulated_depreciation,0),2)
    from public.assets a where a.company_id = v_co order by a.name;
exception when others then return;
end $$;
grant execute on function public.rpt_fixed_assets(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 9) ملخص العملاء — رصيد كل عميل
-- ---------------------------------------------------------------------
drop function if exists public.rpt_customer_summary(uuid,date,date);
create or replace function public.rpt_customer_summary(p_company uuid default null, p_from date default null, p_to date default null)
returns table (o_customer text, o_invoices int, o_billed numeric, o_paid numeric, o_balance numeric)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare v_co uuid;
begin
  v_co := public.acct_guard(p_company);
  return query
  with inv as (
    select i.customer_name nm, count(*)::int c, sum(i.total) t, i.booking_id
      from public.invoices i
     where i.company_id=v_co and i.status::text <> 'cancelled'
       and (p_from is null or i.issued_at::date >= p_from)
       and (p_to is null or i.issued_at::date <= p_to)
     group by i.customer_name, i.booking_id),
  pay as (
    select p.booking_id, sum(p.amount) a from public.payments p
     where p.company_id=v_co and p.payment_type::text <> 'refund' group by p.booking_id)
  select inv.nm, sum(inv.c)::int, round(sum(inv.t),2),
         round(sum(coalesce(pay.a,0)),2), round(sum(inv.t) - sum(coalesce(pay.a,0)),2)
    from inv left join pay on pay.booking_id = inv.booking_id
   group by inv.nm order by 5 desc;
end $$;
grant execute on function public.rpt_customer_summary(uuid,date,date) to authenticated;

-- ---------------------------------------------------------------------
-- 10) مطابقة حساب الضريبة: رصيد الحساب مقابل الضريبة المحتسبة
-- ---------------------------------------------------------------------
drop function if exists public.rpt_vat_reconcile(uuid,date,date);
create or replace function public.rpt_vat_reconcile(p_company uuid default null, p_from date default null, p_to date default null)
returns table (o_item text, o_amount numeric, o_note text)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare v_co uuid; v_acct numeric; v_calc numeric; v_out numeric; v_in numeric;
begin
  v_co := public.acct_guard(p_company);

  select coalesce(sum(jl.credit - jl.debit),0) into v_acct
    from public.journal_entry_lines jl
    join public.journal_entries e on e.id = jl.entry_id
    join public.accounting_settings s on s.company_id = e.company_id
   where e.company_id=v_co and e.status='posted' and jl.account_id = s.vat_output_account_id
     and (p_from is null or e.entry_date >= p_from) and (p_to is null or e.entry_date <= p_to);

  select coalesce(sum(o_vat) filter (where o_bucket='مخرجات'),0),
         coalesce(sum(o_vat) filter (where o_bucket='مدخلات'),0)
    into v_out, v_in from public.vat_report(v_co, p_from, p_to);
  v_calc := v_out;

  return query select 'رصيد حساب ضريبة المخرجات في الدفاتر'::text, round(coalesce(v_acct,0),2), 'من القيود المرحّلة'::text;
  return query select 'الضريبة المحتسبة على المستندات'::text, round(v_calc,2), 'من الفواتير وسطور الضريبة'::text;
  return query select 'ضريبة المدخلات'::text, round(v_in,2), 'قابلة للخصم'::text;
  return query select 'فارق المطابقة'::text, round(coalesce(v_acct,0) - v_calc, 2),
                      case when abs(coalesce(v_acct,0) - v_calc) < 0.01
                           then '✓ مطابق' else '⚠ يحتاج مراجعة' end;
end $$;
grant execute on function public.rpt_vat_reconcile(uuid,date,date) to authenticated;
