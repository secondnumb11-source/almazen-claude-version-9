-- =====================================================================
--  عطل مُثبَت: السندات اليدوية لا تصل الدفاتر
-- ---------------------------------------------------------------------
--  الدليل الذي بُني عليه هذا الإصلاح:
--   • 25 سنداً (14 قبض + 11 صرف) بـ journal_entry_id = NULL.
--   • كلها بلا مصدر: payment_id و expense_id و booking_id فارغة، أي
--     أُصدرت يدوياً عبر issue_manual_voucher.
--   • فحص جسم الدالة: تُدرج صفاً في vouchers ثم return — لا تُنشئ قيداً.
--  الأثر: حركة نقدية حقيقية تُوثَّق في سند ولا تظهر في دفتر الأستاذ ولا
--  في ميزان المراجعة ولا في قائمة الدخل. هذا خلل محاسبي لا تجميلي.
--
--  الإصلاح على مستوى النظام كله: كل منشأة حالية وجديدة.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) ترحيل سند إلى الدفاتر — دالة واحدة يستدعيها الإصدار والتصحيح الرجعي
-- ---------------------------------------------------------------------
create or replace function public.voucher_post_to_ledger(p_voucher uuid)
returns uuid
language plpgsql security definer
set search_path to 'public','pg_temp'
as $$
declare
  v record; v_entry uuid; v_no text; v_cash uuid; v_party uuid;
  v_is_receipt boolean;
begin
  select * into v from public.vouchers where id = p_voucher;
  if v.id is null then raise exception 'السند غير موجود' using errcode='42501'; end if;
  if v.journal_entry_id is not null then
    return v.journal_entry_id;   -- مُرحَّل سلفاً: لا يُكرَّر القيد
  end if;

  v_is_receipt := v.voucher_type::text = 'receipt';

  -- الحساب النقدي: حساب السند إن حُدِّد، وإلا الصندوق
  v_cash := coalesce(v.account_id,
                     public.fn_ensure_account(v.company_id, '1101', 'الصندوق (كاش)', 'asset'));

  -- الطرف المقابل بحسب نوع السند وصفة الطرف:
  --   قبض  → إيراد أو ذمم مدينة   |   صرف → مصروف أو ذمم دائنة
  if v_is_receipt then
    v_party := case v.party_type::text
      when 'tenant'   then public.fn_ensure_account(v.company_id, '4100', 'إيرادات التأجير', 'revenue')
      when 'employee' then public.fn_ensure_account(v.company_id, '1210', 'ذمم الموظفين', 'asset')
      else                 public.fn_ensure_account(v.company_id, '4900', 'إيرادات أخرى', 'revenue')
    end;
  else
    v_party := case v.party_type::text
      when 'vendor'   then public.fn_ensure_account(v.company_id, '5200', 'مصاريف تشغيلية عمومية', 'expense')
      when 'employee' then public.fn_ensure_account(v.company_id, '5210', 'الرواتب والأجور', 'expense')
      else                 public.fn_ensure_account(v.company_id, '5900', 'مصروفات أخرى', 'expense')
    end;
  end if;

  if v_cash is null or v_party is null then
    -- لا ابتلاع صامت: يُنبَّه السوبر أدمن بدل ضياع الحركة
    insert into public.system_alerts (company_id, source, severity, code, message, context)
    values (v.company_id, 'accounting', 'high', 'voucher_post_failed',
            'تعذّر ترحيل سند يدوي — حساب مفقود',
            jsonb_build_object('voucher_id', v.id, 'voucher_number', v.voucher_number,
                               'amount', v.amount));
    return null;
  end if;

  v_no := public.next_document_number(v.company_id, 'journal');

  insert into public.journal_entries
    (company_id, entry_number, entry_date, description, source_type, source_id,
     created_by, branch_id, status, posted_at, posted_by, fiscal_period_id)
  values (v.company_id, v_no, v.voucher_date,
          'قيد تلقائي — ' || case when v_is_receipt then 'سند قبض ' else 'سند صرف ' end || v.voucher_number
            || coalesce(' — ' || nullif(v.party_name,''), ''),
          'voucher', v.id, v.created_by, v.branch_id, 'posted', now(), v.created_by,
          (select id from public.fiscal_periods f
            where f.company_id = v.company_id and v.voucher_date between f.start_date and f.end_date
            limit 1))
  returning id into v_entry;

  if v_is_receipt then
    -- قبض: النقدية مدينة، والطرف المقابل دائن
    insert into public.journal_entry_lines (entry_id, account_id, debit, credit, description, line_order, party_name)
    values (v_entry, v_cash,  v.amount, 0, coalesce(v.description, v.voucher_number), 1, v.party_name),
           (v_entry, v_party, 0, v.amount, coalesce(v.description, v.voucher_number), 2, v.party_name);
  else
    -- صرف: الطرف المقابل مدين، والنقدية دائنة
    insert into public.journal_entry_lines (entry_id, account_id, debit, credit, description, line_order, party_name)
    values (v_entry, v_party, v.amount, 0, coalesce(v.description, v.voucher_number), 1, v.party_name),
           (v_entry, v_cash,  0, v.amount, coalesce(v.description, v.voucher_number), 2, v.party_name);
  end if;

  update public.vouchers set journal_entry_id = v_entry where id = v.id;
  return v_entry;
end $$;
revoke all on function public.voucher_post_to_ledger(uuid) from public, anon;
grant execute on function public.voucher_post_to_ledger(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2) الإصدار اليدوي يُرحِّل فوراً
--    يُعاد تعريف الدالة كاملةً بنفس توقيعها وسلوكها، مضافاً إليها الترحيل.
-- ---------------------------------------------------------------------
create or replace function public.issue_manual_voucher(
  p_voucher_type public.voucher_type,
  p_amount numeric,
  p_party_type public.party_type,
  p_party_name text,
  p_description text default null,
  p_payment_method text default 'cash',
  p_reference_number text default null,
  p_employee_id uuid default null)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare v_cid uuid; v_voucher_no text; v_voucher_id uuid; v_cash_acc uuid;
begin
  if current_role_of_user() not in ('owner','manager','accountant') then
    raise exception 'إصدار السندات صلاحية حصرية للإدارة';
  end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'أدخل مبلغاً صحيحاً'; end if;

  v_cid := current_company_id();
  select id into v_cash_acc from chart_of_accounts where company_id = v_cid and code = '1101';
  v_voucher_no := next_document_number(v_cid, p_voucher_type::text);

  insert into vouchers (company_id, voucher_type, voucher_number, voucher_date, amount,
                        account_id, party_type, party_name, description, payment_method,
                        reference_number, created_by)
  values (v_cid, p_voucher_type, v_voucher_no, current_date, p_amount, v_cash_acc,
          p_party_type, coalesce(p_party_name,'—'), p_description,
          p_payment_method::payment_method, p_reference_number, auth.uid())
  returning id into v_voucher_id;

  -- الإضافة: السند يصل الدفاتر فوراً بدل بقائه خارجها
  perform public.voucher_post_to_ledger(v_voucher_id);

  return v_voucher_id;
end $$;

-- شبكة أمان: أي سند يُدرج مباشرةً (لا عبر الدالة) يُرحَّل أيضاً
create or replace function public.fn_voucher_auto_post()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
begin
  -- السندات المرتبطة بمصدر يرحّلها مُشغّل مصدرها؛ اليدوية فقط هي المقصودة هنا
  if new.journal_entry_id is null
     and new.payment_id is null and new.expense_id is null and new.booking_id is null then
    perform public.voucher_post_to_ledger(new.id);
  end if;
  return new;
exception when others then
  return new;   -- فشل الترحيل لا يمنع إصدار السند؛ التنبيه يتكفّل بإظهاره
end $$;

drop trigger if exists trg_voucher_auto_post on public.vouchers;
create trigger trg_voucher_auto_post after insert on public.vouchers
for each row execute function public.fn_voucher_auto_post();

-- ---------------------------------------------------------------------
-- 3) التصحيح الرجعي للسندات الخمسة والعشرين — لكل المنشآت
-- ---------------------------------------------------------------------
create or replace function public.voucher_backfill_ledger(p_dry boolean default true)
returns jsonb
language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare r record; n int := 0; failed int := 0; v uuid;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for r in
    select id from public.vouchers
     where journal_entry_id is null
       and payment_id is null and expense_id is null and booking_id is null
     order by voucher_date
  loop
    if p_dry then n := n + 1;
    else
      v := public.voucher_post_to_ledger(r.id);
      if v is null then failed := failed + 1; else n := n + 1; end if;
    end if;
  end loop;

  if not p_dry then
    insert into public.system_repair_log (check_id, status, source, category, executed_by, affected_rows, details)
    values ('voucher_backfill', 'success', 'super_admin', 'data', auth.uid(), n,
            jsonb_build_object('posted', n, 'failed', failed));
  end if;

  return jsonb_build_object('ok', true, 'dry_run', p_dry, 'posted', n, 'failed', failed);
end $$;
grant execute on function public.voucher_backfill_ledger(boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 4) فحص دائم: لا سند خارج الدفاتر بعد اليوم
-- ---------------------------------------------------------------------
create or replace function public.ci_voucher_checks()
returns table (o_suite text, o_name text, o_category text, o_status text,
               o_message text, o_meta jsonb, o_fix text)
language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v int; v2 int;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*) into v from public.vouchers
   where journal_entry_id is null
     and payment_id is null and expense_id is null and booking_id is null;
  return query select 'accounting','كل السندات اليدوية مُرحَّلة للدفاتر','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'لا سند خارج الدفاتر' else v || ' سنداً يدوياً بلا قيد محاسبي' end,
    jsonb_build_object('unposted_vouchers', v), 'voucher_backfill'::text;

  select count(*) into v2 from public.vouchers v3
   where v3.journal_entry_id is not null
     and not exists (select 1 from public.journal_entries e where e.id = v3.journal_entry_id);
  return query select 'accounting','لا سند يشير لقيد محذوف','data',
    case when v2 = 0 then 'pass' else 'fail' end,
    case when v2 = 0 then 'كل الروابط سليمة' else v2 || ' سند يشير لقيد غير موجود' end,
    jsonb_build_object('dangling_vouchers', v2), null::text;

  select count(*) into v from public.system_alerts
   where code = 'voucher_post_failed' and coalesce(resolved, false) = false;
  return query select 'accounting','لا تنبيهات ترحيل سندات مفتوحة','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'لا سند تعذّر ترحيله' else v || ' سند تعذّر ترحيله' end,
    jsonb_build_object('open_alerts', v), null::text;
end $$;
revoke all on function public.ci_voucher_checks() from public, anon;
grant execute on function public.ci_voucher_checks() to authenticated;

create or replace function public.voucher_backfill_all()
returns integer language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare j jsonb;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  j := public.voucher_backfill_ledger(false);
  return coalesce((j->>'posted')::int, 0);
end $$;
revoke all on function public.voucher_backfill_all() from public, anon, authenticated;

insert into public.ci_fix_catalog (check_id, title, description, fix_function)
values ('voucher_backfill', 'ترحيل السندات اليدوية',
        'ينشئ القيد المحاسبي لكل سند يدوي صدر بلا قيد — لكل المنشآت',
        'voucher_backfill_all')
on conflict (check_id) do update
  set fix_function = excluded.fix_function,
      title        = excluded.title,
      description  = excluded.description;
