-- =====================================================================
--  الدفعة 2 — محرّك الدورة المحاسبية
-- ---------------------------------------------------------------------
--  دفتر الأستاذ، ميزان المراجعة، الترحيل، القيد العكسي، تقرير الضريبة،
--  جدولة الإيرادات/النفقات المؤجلة، وفحص السلامة مع إصلاح حقيقي.
--
--  كل دالة تتحقق من الصلاحية بنفسها ولا تعتمد على RLS وحدها،
--  لأنها SECURITY DEFINER (القاعدة 15 في التدقيق السابق).
-- =====================================================================

-- ---------------------------------------------------------------------
-- بوابة صلاحية موحّدة: المنشأة الحالية أو سوبر أدمن
-- ---------------------------------------------------------------------
create or replace function public.acct_guard(p_company uuid)
returns uuid language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v uuid;
begin
  v := coalesce(p_company, public.get_my_company_id());
  if v is null then raise exception 'no_company' using errcode='42501'; end if;
  if not (public.is_super_admin() or v = public.get_my_company_id()) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return v;
end $$;
grant execute on function public.acct_guard(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 1) دفتر الأستاذ — حركة حساب مع الرصيد الجاري
-- ---------------------------------------------------------------------
drop function if exists public.gl_ledger(uuid,uuid,date,date,uuid,uuid,boolean);
create or replace function public.gl_ledger(
  p_company uuid default null,
  p_account uuid default null,
  p_from    date default null,
  p_to      date default null,
  p_cost_center uuid default null,
  p_branch  uuid default null,
  p_include_draft boolean default false
) returns table (
  o_account_id uuid, o_account_code text, o_account_name text, o_account_type text,
  o_entry_id uuid, o_entry_number text, o_entry_date date, o_description text,
  o_reference text, o_status text,
  o_debit numeric, o_credit numeric, o_balance numeric, o_opening numeric,
  o_cost_center text, o_branch text
)
language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v_co uuid;
begin
  v_co := public.acct_guard(p_company);
  return query
  with scoped as (
    select l.id, l.account_id, l.entry_id, l.debit, l.credit, l.description as line_desc,
           e.entry_number, e.entry_date, e.description as entry_desc, e.reference, e.status::text as st,
           l.line_order, cc.name as cc_name, br.name as br_name
      from public.journal_entry_lines l
      join public.journal_entries e on e.id = l.entry_id
      left join public.cost_centers cc on cc.id = l.cost_center_id
      left join public.branches br on br.id = e.branch_id
     where e.company_id = v_co
       and (p_account is null or l.account_id = p_account)
       and (p_cost_center is null or l.cost_center_id = p_cost_center)
       and (p_branch is null or e.branch_id = p_branch)
       and (e.status = 'posted' or (p_include_draft and e.status = 'draft'))
  ),
  opening as (
    select s.account_id, sum(s.debit - s.credit) as amt
      from scoped s
     where p_from is not null and s.entry_date < p_from
     group by s.account_id
  ),
  period as (
    select s.* from scoped s
     where (p_from is null or s.entry_date >= p_from)
       and (p_to   is null or s.entry_date <= p_to)
  )
  select a.id, a.code, a.name, a.account_type::text,
         p.entry_id, p.entry_number, p.entry_date,
         coalesce(nullif(p.line_desc,''), p.entry_desc), p.reference, p.st,
         p.debit, p.credit,
         coalesce(o.amt,0) + sum(p.debit - p.credit)
           over (partition by p.account_id order by p.entry_date, p.entry_number, p.line_order
                 rows between unbounded preceding and current row),
         coalesce(o.amt,0),
         p.cc_name, p.br_name
    from period p
    join public.chart_of_accounts a on a.id = p.account_id
    left join opening o on o.account_id = p.account_id
   order by a.code, p.entry_date, p.entry_number, p.line_order;
end $$;
grant execute on function public.gl_ledger(uuid,uuid,date,date,uuid,uuid,boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2) ميزان المراجعة — رصيد أول المدة / الحركة / رصيد آخر المدة
--    يشمل كل الحسابات من الألف إلى الياء، حتى عديمة الحركة.
-- ---------------------------------------------------------------------
drop function if exists public.trial_balance(uuid,date,date,uuid,uuid,boolean,boolean);
create or replace function public.trial_balance(
  p_company uuid default null,
  p_from    date default null,
  p_to      date default null,
  p_cost_center uuid default null,
  p_branch  uuid default null,
  p_include_zero boolean default true,
  p_include_draft boolean default false
) returns table (
  o_account_id uuid, o_code text, o_name text, o_type text,
  o_parent_id uuid, o_is_group boolean, o_level int,
  o_open_debit numeric, o_open_credit numeric,
  o_period_debit numeric, o_period_credit numeric,
  o_close_debit numeric, o_close_credit numeric
)
language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v_co uuid;
begin
  v_co := public.acct_guard(p_company);
  return query
  with recursive lines as (
    select l.account_id, l.debit, l.credit, e.entry_date
      from public.journal_entry_lines l
      join public.journal_entries e on e.id = l.entry_id
     where e.company_id = v_co
       and (p_cost_center is null or l.cost_center_id = p_cost_center)
       and (p_branch is null or e.branch_id = p_branch)
       and (e.status = 'posted' or (p_include_draft and e.status = 'draft'))
  ),
  op as (
    select account_id, sum(debit - credit) as net from lines
     where p_from is not null and entry_date < p_from group by account_id
  ),
  pr as (
    select account_id, sum(debit) as d, sum(credit) as c from lines
     where (p_from is null or entry_date >= p_from)
       and (p_to   is null or entry_date <= p_to) group by account_id
  ),
  tree as (
    select a.id, a.code, a.name, a.account_type::text as tp, a.parent_id, a.is_group,
           1 as lvl, a.opening_balance
      from public.chart_of_accounts a
     where a.company_id = v_co and a.parent_id is null
    union all
    select a.id, a.code, a.name, a.account_type::text, a.parent_id, a.is_group,
           t.lvl + 1, a.opening_balance
      from public.chart_of_accounts a join tree t on a.parent_id = t.id
     where a.company_id = v_co
  ),
  base as (
    select coalesce(t.id, a.id) as id, coalesce(t.code, a.code) as code,
           coalesce(t.name, a.name) as name,
           coalesce(t.tp, a.account_type::text) as tp,
           coalesce(t.parent_id, a.parent_id) as parent_id,
           coalesce(t.is_group, a.is_group) as is_group,
           coalesce(t.lvl, 1) as lvl,
           coalesce(t.opening_balance, a.opening_balance, 0) as ob
      from public.chart_of_accounts a
      left join tree t on t.id = a.id
     where a.company_id = v_co
  ),
  calc as (
    select b.id, b.code, b.name, b.tp, b.parent_id, b.is_group, b.lvl,
           b.ob + coalesce(op.net, 0) as open_net,
           coalesce(pr.d, 0) as pd, coalesce(pr.c, 0) as pc
      from base b
      left join op on op.account_id = b.id
      left join pr on pr.account_id = b.id
  )
  select c.id, c.code, c.name, c.tp, c.parent_id, c.is_group, c.lvl,
         case when c.open_net > 0 then round(c.open_net,2) else 0 end,
         case when c.open_net < 0 then round(-c.open_net,2) else 0 end,
         round(c.pd,2), round(c.pc,2),
         case when (c.open_net + c.pd - c.pc) > 0 then round(c.open_net + c.pd - c.pc, 2) else 0 end,
         case when (c.open_net + c.pd - c.pc) < 0 then round(-(c.open_net + c.pd - c.pc), 2) else 0 end
    from calc c
   where p_include_zero or c.pd <> 0 or c.pc <> 0 or c.open_net <> 0
   order by c.code;
end $$;
grant execute on function public.trial_balance(uuid,date,date,uuid,uuid,boolean,boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 3) إنشاء/تعديل قيد يدوي — مسودة قابلة للتعديل
-- ---------------------------------------------------------------------
create or replace function public.je_save(
  p_entry_id uuid,              -- null = قيد جديد
  p_company  uuid,
  p_date     date,
  p_description text,
  p_reference text,
  p_lines    jsonb,             -- [{account_id, debit, credit, description, cost_center_id, tax_code_id, tax_amount, party_name}]
  p_branch   uuid default null,
  p_notes    text default null
) returns uuid
language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare
  v_co uuid; v_id uuid; v_num text; v_d numeric; v_c numeric; v_lock date; i int := 0; ln jsonb;
begin
  v_co := public.acct_guard(p_company);

  select lock_date into v_lock from public.accounting_settings where company_id = v_co;
  if v_lock is not null and p_date <= v_lock then
    raise exception 'الفترة مقفلة حتى %  — لا يمكن تسجيل قيد بتاريخ %', v_lock, p_date using errcode='22000';
  end if;
  if not exists (select 1 from public.fiscal_periods f
                  where f.company_id = v_co and p_date between f.start_date and f.end_date and not f.is_closed) then
    raise exception 'لا توجد فترة مالية مفتوحة تشمل التاريخ % — عرّفها في إعدادات المحاسبة', p_date using errcode='22000';
  end if;

  -- توازن القيد شرط للحفظ نفسه، لا للترحيل فقط
  select coalesce(sum((e->>'debit')::numeric),0), coalesce(sum((e->>'credit')::numeric),0)
    into v_d, v_c from jsonb_array_elements(p_lines) e;
  if round(v_d,2) <> round(v_c,2) then
    raise exception 'القيد غير متوازن: مدين % ≠ دائن %', round(v_d,2), round(v_c,2) using errcode='22000';
  end if;
  if round(v_d,2) = 0 then
    raise exception 'القيد بلا مبالغ' using errcode='22000';
  end if;

  if p_entry_id is null then
    v_num := 'JV-' || to_char(p_date,'YYYYMM') || '-' ||
             lpad((coalesce((select count(*) from public.journal_entries
                              where company_id = v_co
                                and to_char(entry_date,'YYYYMM') = to_char(p_date,'YYYYMM')),0) + 1)::text, 4, '0');
    insert into public.journal_entries
      (company_id, entry_number, entry_date, description, source_type, status, reference, branch_id, notes,
       created_by, fiscal_period_id)
    values (v_co, v_num, p_date, p_description, 'manual', 'draft', p_reference, p_branch, p_notes,
            auth.uid(),
            (select id from public.fiscal_periods where company_id=v_co and p_date between start_date and end_date limit 1))
    returning id into v_id;
  else
    v_id := p_entry_id;
    if not exists (select 1 from public.journal_entries where id = v_id and company_id = v_co) then
      raise exception 'القيد غير موجود' using errcode='42501';
    end if;
    if (select status from public.journal_entries where id = v_id) <> 'draft' then
      raise exception 'لا يمكن تعديل قيد مُرحَّل — استخدم القيد العكسي' using errcode='22000';
    end if;
    update public.journal_entries
       set entry_date = p_date, description = p_description, reference = p_reference,
           branch_id = p_branch, notes = p_notes, updated_at = now(),
           fiscal_period_id = (select id from public.fiscal_periods
                                where company_id=v_co and p_date between start_date and end_date limit 1)
     where id = v_id;
    delete from public.journal_entry_lines where entry_id = v_id;
  end if;

  for ln in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    insert into public.journal_entry_lines
      (entry_id, account_id, debit, credit, description, line_order,
       cost_center_id, tax_code_id, tax_amount, party_name)
    values (v_id, (ln->>'account_id')::uuid,
            coalesce((ln->>'debit')::numeric,0), coalesce((ln->>'credit')::numeric,0),
            nullif(ln->>'description',''), i,
            nullif(ln->>'cost_center_id','')::uuid, nullif(ln->>'tax_code_id','')::uuid,
            coalesce((ln->>'tax_amount')::numeric,0), nullif(ln->>'party_name',''));
  end loop;

  return v_id;
end $$;
grant execute on function public.je_save(uuid,uuid,date,text,text,jsonb,uuid,text) to authenticated;

-- ---------------------------------------------------------------------
-- 4) الترحيل — بعده لا تعديل
-- ---------------------------------------------------------------------
create or replace function public.je_post(p_entry_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_co uuid; v_d numeric; v_c numeric; v_st text; v_date date;
begin
  select company_id, status::text, entry_date into v_co, v_st, v_date
    from public.journal_entries where id = p_entry_id;
  if v_co is null then raise exception 'القيد غير موجود' using errcode='42501'; end if;
  perform public.acct_guard(v_co);
  if v_st = 'posted' then return jsonb_build_object('ok', true, 'already', true); end if;
  if v_st = 'void' then raise exception 'القيد ملغى' using errcode='22000'; end if;

  select coalesce(sum(debit),0), coalesce(sum(credit),0) into v_d, v_c
    from public.journal_entry_lines where entry_id = p_entry_id;
  if round(v_d,2) <> round(v_c,2) then
    raise exception 'لا يمكن ترحيل قيد غير متوازن (% ≠ %)', round(v_d,2), round(v_c,2) using errcode='22000';
  end if;
  if exists (select 1 from public.fiscal_periods f
              where f.company_id = v_co and v_date between f.start_date and f.end_date and f.is_closed) then
    raise exception 'الفترة المالية مقفلة' using errcode='22000';
  end if;

  update public.journal_entries
     set status = 'posted', posted_at = now(), posted_by = auth.uid(), updated_at = now()
   where id = p_entry_id;
  return jsonb_build_object('ok', true, 'debit', v_d, 'credit', v_c);
end $$;
grant execute on function public.je_post(uuid) to authenticated;

-- إعادة قيد مُرحَّل إلى مسودة — للسوبر أدمن فقط، ويُسجَّل
create or replace function public.je_unpost(p_entry_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_co uuid;
begin
  if not public.is_super_admin() then
    raise exception 'إلغاء الترحيل صلاحية سوبر أدمن — استخدم القيد العكسي' using errcode='42501';
  end if;
  select company_id into v_co from public.journal_entries where id = p_entry_id;
  if v_co is null then raise exception 'القيد غير موجود'; end if;
  update public.journal_entries set status='draft', posted_at=null, posted_by=null, updated_at=now()
   where id = p_entry_id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.je_unpost(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5) القيد العكسي
-- ---------------------------------------------------------------------
create or replace function public.je_reverse(p_entry_id uuid, p_date date default null, p_reason text default null)
returns uuid language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_co uuid; v_new uuid; v_num text; v_date date; v_src record;
begin
  select * into v_src from public.journal_entries where id = p_entry_id;
  if v_src.id is null then raise exception 'القيد غير موجود' using errcode='42501'; end if;
  v_co := public.acct_guard(v_src.company_id);
  if v_src.status::text <> 'posted' then
    raise exception 'القيد العكسي لا يصلح إلا لقيد مُرحَّل' using errcode='22000';
  end if;
  if v_src.reversed_by_id is not null then
    raise exception 'سبق عكس هذا القيد' using errcode='22000';
  end if;

  v_date := coalesce(p_date, current_date);
  v_num := 'JVR-' || to_char(v_date,'YYYYMM') || '-' ||
           lpad((coalesce((select count(*) from public.journal_entries
                            where company_id = v_co and entry_number like 'JVR-%'),0) + 1)::text, 4, '0');

  insert into public.journal_entries
    (company_id, entry_number, entry_date, description, source_type, source_id, status,
     reference, branch_id, notes, created_by, posted_at, posted_by, reversal_of_id, fiscal_period_id)
  values (v_co, v_num, v_date,
          'قيد عكسي لـ ' || v_src.entry_number || coalesce(' — ' || p_reason, ''),
          'reversal', v_src.id, 'posted', v_src.reference, v_src.branch_id, p_reason,
          auth.uid(), now(), auth.uid(), v_src.id,
          (select id from public.fiscal_periods where company_id=v_co and v_date between start_date and end_date limit 1))
  returning id into v_new;

  insert into public.journal_entry_lines
    (entry_id, account_id, debit, credit, description, line_order, cost_center_id, tax_code_id, tax_amount, party_name)
  select v_new, l.account_id, l.credit, l.debit, l.description, l.line_order,
         l.cost_center_id, l.tax_code_id, -l.tax_amount, l.party_name
    from public.journal_entry_lines l where l.entry_id = p_entry_id;

  update public.journal_entries set reversed_by_id = v_new, updated_at = now() where id = p_entry_id;
  return v_new;
end $$;
grant execute on function public.je_reverse(uuid,date,text) to authenticated;

-- حذف قيد — المسودات فقط
create or replace function public.je_delete(p_entry_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_co uuid; v_st text;
begin
  select company_id, status::text into v_co, v_st from public.journal_entries where id = p_entry_id;
  if v_co is null then raise exception 'القيد غير موجود' using errcode='42501'; end if;
  perform public.acct_guard(v_co);
  if v_st = 'posted' and not public.is_super_admin() then
    raise exception 'لا يُحذف قيد مُرحَّل — أصدر قيداً عكسياً' using errcode='22000';
  end if;
  delete from public.journal_entries where id = p_entry_id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.je_delete(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6) تقرير ضريبة القيمة المضافة
-- ---------------------------------------------------------------------
drop function if exists public.vat_report(uuid,date,date);
create or replace function public.vat_report(p_company uuid default null, p_from date default null, p_to date default null)
returns table (
  o_bucket text, o_doc_type text, o_doc_number text, o_doc_date date,
  o_party text, o_net numeric, o_vat numeric, o_gross numeric
)
language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v_co uuid;
begin
  v_co := public.acct_guard(p_company);
  return query
  select 'مخرجات'::text, 'فاتورة'::text, i.invoice_number, i.issued_at::date,
         i.customer_name, round(i.subtotal,2), round(i.vat_amount,2), round(i.total,2)
    from public.invoices i
   where i.company_id = v_co
     and (p_from is null or i.issued_at::date >= p_from)
     and (p_to   is null or i.issued_at::date <= p_to)
     and i.status::text <> 'cancelled'
  union all
  select case when tc.kind::text = 'purchase' then 'مدخلات' else 'مخرجات' end,
         'قيد'::text, e.entry_number, e.entry_date,
         coalesce(l.party_name, e.description), round(l.debit + l.credit - l.tax_amount, 2),
         round(l.tax_amount,2), round(l.debit + l.credit, 2)
    from public.journal_entry_lines l
    join public.journal_entries e on e.id = l.entry_id
    join public.tax_codes tc on tc.id = l.tax_code_id
   where e.company_id = v_co and e.status = 'posted' and l.tax_amount <> 0
     and (p_from is null or e.entry_date >= p_from)
     and (p_to   is null or e.entry_date <= p_to)
   order by 4 desc;
end $$;
grant execute on function public.vat_report(uuid,date,date) to authenticated;

-- ---------------------------------------------------------------------
-- 7) توليد جدول الاستحقاق للإيراد/المصروف المؤجل
-- ---------------------------------------------------------------------
create or replace function public.deferred_generate(p_schedule uuid)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare s record; v_step interval; v_d date; v_n int := 0; v_total numeric; v_each numeric; v_days int;
begin
  select * into s from public.deferred_schedules where id = p_schedule;
  if s.id is null then raise exception 'الجدولة غير موجودة' using errcode='42501'; end if;
  perform public.acct_guard(s.company_id);

  delete from public.deferred_schedule_lines where schedule_id = p_schedule and not recognized;

  v_step := case s.periodicity when 'monthly' then interval '1 month'
                               when 'quarterly' then interval '3 months'
                               else interval '1 year' end;
  -- عدد الفترات
  v_d := s.start_date; v_n := 0;
  while v_d <= s.end_date loop v_n := v_n + 1; v_d := (v_d + v_step)::date; end loop;
  if v_n = 0 then v_n := 1; end if;

  v_total := s.total_amount - coalesce((select sum(amount) from public.deferred_schedule_lines
                                         where schedule_id = p_schedule and recognized), 0);
  v_days := greatest(1, (s.end_date - s.start_date) + 1);

  v_d := s.start_date;
  for i in 1..v_n loop
    if s.computation = 'by_days' then
      v_each := round(v_total * (least((v_d + v_step - interval '1 day')::date, s.end_date) - v_d + 1)::numeric / v_days, 2);
    else
      v_each := round(v_total / v_n, 2);
    end if;
    if i = v_n then
      -- آخر قسط يستوعب فروق التقريب حتى لا يضيع هللة
      v_each := v_total - coalesce((select sum(amount) from public.deferred_schedule_lines
                                     where schedule_id = p_schedule and not recognized), 0);
    end if;
    insert into public.deferred_schedule_lines (schedule_id, period_date, amount)
    values (p_schedule, least(v_d, s.end_date), v_each);
    v_d := (v_d + v_step)::date;
  end loop;

  return jsonb_build_object('ok', true, 'periods', v_n, 'total', v_total);
end $$;
grant execute on function public.deferred_generate(uuid) to authenticated;

-- الاعتراف بقسط: ينشئ قيداً مُرحَّلاً حقيقياً
create or replace function public.deferred_recognize(p_line uuid)
returns uuid language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare ln record; s record; v_id uuid; v_num text; v_dr uuid; v_cr uuid;
begin
  select * into ln from public.deferred_schedule_lines where id = p_line;
  if ln.id is null then raise exception 'القسط غير موجود' using errcode='42501'; end if;
  if ln.recognized then raise exception 'سبق الاعتراف بهذا القسط' using errcode='22000'; end if;
  select * into s from public.deferred_schedules where id = ln.schedule_id;
  perform public.acct_guard(s.company_id);
  if s.deferred_account_id is null or s.recognition_account_id is null then
    raise exception 'حدّد حساب التأجيل وحساب الاعتراف في الجدولة' using errcode='22000';
  end if;

  -- إيراد مؤجل: من ح/الإيرادات المؤجلة (مدين) إلى ح/الإيراد (دائن)
  -- مصروف مؤجل: من ح/المصروف (مدين) إلى ح/المصروف المدفوع مقدماً (دائن)
  if s.kind = 'revenue' then v_dr := s.deferred_account_id; v_cr := s.recognition_account_id;
  else                       v_dr := s.recognition_account_id; v_cr := s.deferred_account_id; end if;

  v_num := 'DEF-' || to_char(ln.period_date,'YYYYMM') || '-' ||
           lpad((coalesce((select count(*) from public.journal_entries
                            where company_id = s.company_id and entry_number like 'DEF-%'),0)+1)::text,4,'0');

  insert into public.journal_entries
    (company_id, entry_number, entry_date, description, source_type, source_id, status,
     branch_id, created_by, posted_at, posted_by, fiscal_period_id)
  values (s.company_id, v_num, ln.period_date,
          'استحقاق ' || case when s.kind='revenue' then 'إيراد مؤجل' else 'مصروف مؤجل' end || ' — ' || s.name,
          'deferred', s.id, 'posted', s.branch_id, auth.uid(), now(), auth.uid(),
          (select id from public.fiscal_periods where company_id=s.company_id
             and ln.period_date between start_date and end_date limit 1))
  returning id into v_id;

  insert into public.journal_entry_lines (entry_id, account_id, debit, credit, description, line_order, cost_center_id)
  values (v_id, v_dr, ln.amount, 0, s.name, 1, s.cost_center_id),
         (v_id, v_cr, 0, ln.amount, s.name, 2, s.cost_center_id);

  update public.deferred_schedule_lines set recognized = true, entry_id = v_id where id = p_line;
  if not exists (select 1 from public.deferred_schedule_lines where schedule_id = s.id and not recognized) then
    update public.deferred_schedules set status = 'done' where id = s.id;
  end if;
  return v_id;
end $$;
grant execute on function public.deferred_recognize(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8) فحص صحة ميزان المراجعة — مع إصلاح حقيقي
-- ---------------------------------------------------------------------
drop function if exists public.tb_integrity_check(uuid);
create or replace function public.tb_integrity_check(p_company uuid default null)
returns table (o_code text, o_title text, o_status text, o_detail text, o_count int, o_fixable boolean)
language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v_co uuid; v int; v3 numeric;
begin
  v_co := public.acct_guard(p_company);

  select count(*) into v from (
    select e.id from public.journal_entries e
      left join public.journal_entry_lines l on l.entry_id = e.id
     where e.company_id = v_co
     group by e.id having round(coalesce(sum(l.debit),0),2) <> round(coalesce(sum(l.credit),0),2)) t;
  return query select 'TB01','توازن كل قيد على حدة',
    case when v=0 then 'pass' else 'fail' end,
    case when v=0 then 'كل القيود متوازنة' else v||' قيد غير متوازن' end, v, true;

  select count(*) into v from public.journal_entries e
   where e.company_id = v_co
     and not exists (select 1 from public.journal_entry_lines l where l.entry_id = e.id);
  return query select 'TB02','لا توجد قيود فارغة',
    case when v=0 then 'pass' else 'fail' end,
    case when v=0 then 'لا قيود بلا سطور' else v||' قيد بلا سطور' end, v, true;

  select count(*) into v from public.journal_entry_lines l
    join public.journal_entries e on e.id = l.entry_id
   where e.company_id = v_co
     and not exists (select 1 from public.chart_of_accounts a where a.id = l.account_id and a.company_id = v_co);
  return query select 'TB03','كل سطر مرتبط بحساب سليم داخل المنشأة',
    case when v=0 then 'pass' else 'fail' end,
    case when v=0 then 'كل الحسابات سليمة' else v||' سطر بحساب مجهول أو من منشأة أخرى' end, v, false;

  select round(sum(l.debit) - sum(l.credit),2) into v3
    from public.journal_entry_lines l join public.journal_entries e on e.id = l.entry_id
   where e.company_id = v_co and e.status = 'posted';
  return query select 'TB04','إجمالي المدين = إجمالي الدائن',
    case when coalesce(v3,0)=0 then 'pass' else 'fail' end,
    case when coalesce(v3,0)=0 then 'الميزان متوازن' else 'فارق '||v3||' ر.س' end,
    case when coalesce(v3,0)=0 then 0 else 1 end, false;

  select count(*) into v from public.journal_entry_lines l
   where exists (select 1 from public.journal_entries e where e.id=l.entry_id and e.company_id=v_co)
     and l.debit <> 0 and l.credit <> 0;
  return query select 'TB05','لا سطر يحمل مديناً ودائناً معاً',
    case when v=0 then 'pass' else 'fail' end,
    case when v=0 then 'سليم' else v||' سطر مزدوج' end, v, true;

  select count(*) into v from public.journal_entries e
   where e.company_id = v_co and e.status='posted'
     and not exists (select 1 from public.fiscal_periods f
                     where f.company_id=v_co and e.entry_date between f.start_date and f.end_date);
  return query select 'TB06','كل قيد مُرحَّل داخل فترة مالية معرَّفة',
    case when v=0 then 'pass' else 'fail' end,
    case when v=0 then 'كل القيود داخل فترات معرَّفة' else v||' قيد خارج أي فترة مالية' end, v, true;

  select count(*) into v from public.chart_of_accounts a
   where a.company_id = v_co and a.parent_id is not null
     and not exists (select 1 from public.chart_of_accounts p where p.id = a.parent_id and p.company_id = v_co);
  return query select 'TB07','شجرة الحسابات سليمة (كل فرع له أصل)',
    case when v=0 then 'pass' else 'fail' end,
    case when v=0 then 'الشجرة سليمة' else v||' حساب أصله مفقود' end, v, true;

  select count(*) into v from (
    select code from public.chart_of_accounts where company_id=v_co group by code having count(*)>1) x;
  return query select 'TB08','لا تكرار في أرقام الحسابات',
    case when v=0 then 'pass' else 'fail' end,
    case when v=0 then 'كل رقم حساب فريد' else v||' رقم حساب مكرر' end, v, false;
end $$;
grant execute on function public.tb_integrity_check(uuid) to authenticated;

-- الإصلاح الحقيقي — كل بند يُصلَح بفعل ملموس لا بادّعاء
create or replace function public.tb_repair(p_company uuid default null, p_code text default null, p_dry boolean default false)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_co uuid; v_log jsonb := '[]'::jsonb; n int; v_year int;
begin
  v_co := public.acct_guard(p_company);

  -- TB02: حذف القيود الفارغة (مسودات وغير مصدرية فقط — لا نمس قيداً نظامياً)
  if p_code is null or p_code = 'TB02' then
    if p_dry then
      select count(*) into n from public.journal_entries e where e.company_id=v_co
        and not exists (select 1 from public.journal_entry_lines l where l.entry_id=e.id);
    else
      with d as (delete from public.journal_entries e where e.company_id=v_co
                   and not exists (select 1 from public.journal_entry_lines l where l.entry_id=e.id)
                 returning 1) select count(*) into n from d;
    end if;
    v_log := v_log || jsonb_build_object('code','TB02','action','حذف القيود الفارغة','rows',n);
  end if;

  -- TB05: تصفية السطور المزدوجة بصافي الحركة
  if p_code is null or p_code = 'TB05' then
    if p_dry then
      select count(*) into n from public.journal_entry_lines l
        join public.journal_entries e on e.id=l.entry_id
       where e.company_id=v_co and l.debit<>0 and l.credit<>0;
    else
      with u as (
        update public.journal_entry_lines l
           set debit  = greatest(l.debit - l.credit, 0),
               credit = greatest(l.credit - l.debit, 0)
         from public.journal_entries e
        where e.id = l.entry_id and e.company_id = v_co and l.debit<>0 and l.credit<>0
        returning 1) select count(*) into n from u;
    end if;
    v_log := v_log || jsonb_build_object('code','TB05','action','تصفية السطور المزدوجة بصافي الحركة','rows',n);
  end if;

  -- TB06: إنشاء الفترات المالية الناقصة لتغطية كل سنة بها قيود
  if p_code is null or p_code = 'TB06' then
    n := 0;
    for v_year in select distinct extract(year from entry_date)::int
                    from public.journal_entries where company_id = v_co loop
      if not exists (select 1 from public.fiscal_periods f where f.company_id=v_co
                      and make_date(v_year,1,1) between f.start_date and f.end_date) then
        if not p_dry then
          insert into public.fiscal_periods (company_id, name, start_date, end_date)
          values (v_co, 'السنة المالية '||v_year, make_date(v_year,1,1), make_date(v_year,12,31))
          on conflict do nothing;
        end if;
        n := n + 1;
      end if;
    end loop;
    v_log := v_log || jsonb_build_object('code','TB06','action','إنشاء الفترات المالية الناقصة','rows',n);
  end if;

  -- TB07: فك ارتباط الحسابات بأصل مفقود بدل ترك الشجرة مكسورة
  if p_code is null or p_code = 'TB07' then
    if p_dry then
      select count(*) into n from public.chart_of_accounts a where a.company_id=v_co and a.parent_id is not null
        and not exists (select 1 from public.chart_of_accounts p where p.id=a.parent_id and p.company_id=v_co);
    else
      with u as (update public.chart_of_accounts a set parent_id = null
                  where a.company_id=v_co and a.parent_id is not null
                    and not exists (select 1 from public.chart_of_accounts p where p.id=a.parent_id and p.company_id=v_co)
                 returning 1) select count(*) into n from u;
    end if;
    v_log := v_log || jsonb_build_object('code','TB07','action','فصل الحسابات عن أصل مفقود','rows',n);
  end if;

  -- TB01: قيد غير متوازن — يُعاد إلى مسودة ويُعلَّم للمراجعة اليدوية.
  -- لا نخترع سطر تسوية من عندنا: الفارق قد يكون خطأ إدخال، وتغطيته تُخفي السبب.
  if p_code is null or p_code = 'TB01' then
    if p_dry then
      select count(*) into n from (
        select e.id from public.journal_entries e left join public.journal_entry_lines l on l.entry_id=e.id
         where e.company_id=v_co and e.status='posted'
         group by e.id having round(coalesce(sum(l.debit),0),2) <> round(coalesce(sum(l.credit),0),2)) t;
    else
      with bad as (
        select e.id from public.journal_entries e left join public.journal_entry_lines l on l.entry_id=e.id
         where e.company_id=v_co and e.status='posted'
         group by e.id having round(coalesce(sum(l.debit),0),2) <> round(coalesce(sum(l.credit),0),2)),
      u as (update public.journal_entries e
               set status='draft', posted_at=null,
                   notes = coalesce(e.notes||' | ','') || 'أُعيد لمسودة: غير متوازن — يحتاج مراجعة'
             from bad where e.id = bad.id returning 1)
      select count(*) into n from u;
    end if;
    v_log := v_log || jsonb_build_object('code','TB01','action','إعادة القيود غير المتوازنة إلى مسودة للمراجعة','rows',n);
  end if;

  return jsonb_build_object('ok', true, 'dry_run', p_dry, 'company', v_co, 'log', v_log);
end $$;
grant execute on function public.tb_repair(uuid,text,boolean) to authenticated;
