-- =====================================================================
--  الفروع: توريث branch_id تلقائياً + أداة تعبئة رجعية اختيارية
-- ---------------------------------------------------------------------
--  العطل المُثبت (F-8):
--    بُنيت ميزة الفروع كاملة (14 عمود branch_id + سياسات RLS + واجهة +
--    BranchContext)، لكن مسار الكتابة نُفِّذ للوحدات والعملاء فقط:
--      Units.jsx:514            → branch_id: activeBranch
--      CustomersManagement:653  → branch_id: activeBranch
--    ولم يُكتب إطلاقاً في: الحجوزات، الدفعات، الفواتير، القيود،
--    المصروفات، السندات، طلبات الصيانة.
--
--  ولأن scopeQuery يفلتر بمساواة صارمة (query.eq('branch_id', active))
--  فإن الصفوف بـ branch_id = NULL لا تُطابق أي فرع => اختيار فرع
--  يُخفي كل البيانات المالية والتشغيلية.
--
--  الدليل من الإنتاج («شركة عقارات»، فرعان، الميزة مفعّلة):
--    وحدات 3/3 موسومة | حجوزات 0/3 | دفعات 0/1
--
--  العلاج:
--    1) تريجر BEFORE INSERT يورّث branch_id من الأصل عند غيابه،
--       فلا يعتمد على تذكّر أي مسار في الواجهة.
--       ⚠️ BEFORE وليس AFTER: تريجرات المحاسبة (AFTER INSERT) تقرأ
--       NEW.branch_id لتضعه في القيد، فيجب أن يكون جاهزاً قبلها.
--    2) دالة تعبئة رجعية اختيارية — لا تعمل تلقائياً، يشغّلها المستخدم.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) توريث branch_id من الأصل
-- ---------------------------------------------------------------------
create or replace function public.fn_inherit_branch_id()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_branch uuid;
begin
  if new.branch_id is not null then return new; end if;

  case tg_table_name
    when 'bookings' then
      select u.branch_id into v_branch from public.units u where u.id = new.unit_id;

    when 'payments' then
      select b.branch_id into v_branch from public.bookings b where b.id = new.booking_id;
      if v_branch is null then
        select u.branch_id into v_branch
          from public.bookings b join public.units u on u.id = b.unit_id
         where b.id = new.booking_id;
      end if;

    when 'invoices' then
      select b.branch_id into v_branch from public.bookings b where b.id = new.booking_id;
      if v_branch is null then
        select u.branch_id into v_branch
          from public.bookings b join public.units u on u.id = b.unit_id
         where b.id = new.booking_id;
      end if;

    when 'expenses', 'maintenance_requests' then
      select u.branch_id into v_branch from public.units u where u.id = new.unit_id;

    when 'vouchers' then
      select p.branch_id into v_branch from public.payments p where p.id = new.payment_id;
      if v_branch is null then
        select e.branch_id into v_branch from public.expenses e where e.id = new.expense_id;
      end if;
      if v_branch is null then
        select b.branch_id into v_branch from public.bookings b where b.id = new.booking_id;
      end if;

    when 'journal_entries' then
      select p.branch_id into v_branch from public.payments  p where p.id = new.source_id;
      if v_branch is null then
        select e.branch_id into v_branch from public.expenses e where e.id = new.source_id;
      end if;
      if v_branch is null then
        select b.branch_id into v_branch from public.bookings b where b.id = new.source_id;
      end if;

    else
      v_branch := null;
  end case;

  new.branch_id := v_branch;
  return new;
exception when others then
  -- التوريث لا يجوز أن يُفشل العملية الأصلية
  return new;
end $function$;

do $$
declare t text;
begin
  foreach t in array array['bookings','payments','invoices','expenses',
                           'maintenance_requests','vouchers','journal_entries']
  loop
    execute format('drop trigger if exists trg_inherit_branch_id on public.%I', t);
    execute format(
      'create trigger trg_inherit_branch_id before insert on public.%I
       for each row execute function public.fn_inherit_branch_id()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2) تعبئة رجعية اختيارية — لا تعمل تلقائياً
--    p_dry_run = true (الافتراضي) يحصي فقط دون أي كتابة.
-- ---------------------------------------------------------------------
create or replace function public.branch_backfill_unassigned(
  p_company_id uuid default null,
  p_dry_run    boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  cid uuid; res jsonb := '{}'::jsonb; n int; total int := 0;
begin
  cid := public.acct_assert_company_access(p_company_id);

  -- الحجوزات ← فرع الوحدة
  select count(*) into n from public.bookings b join public.units u on u.id = b.unit_id
   where b.company_id = cid and b.branch_id is null and u.branch_id is not null;
  if not p_dry_run and n > 0 then
    update public.bookings b set branch_id = u.branch_id
      from public.units u
     where u.id = b.unit_id and b.company_id = cid
       and b.branch_id is null and u.branch_id is not null;
  end if;
  res := res || jsonb_build_object('bookings', n); total := total + n;

  -- المصروفات وطلبات الصيانة ← فرع الوحدة
  select count(*) into n from public.expenses e join public.units u on u.id = e.unit_id
   where e.company_id = cid and e.branch_id is null and u.branch_id is not null;
  if not p_dry_run and n > 0 then
    update public.expenses e set branch_id = u.branch_id
      from public.units u
     where u.id = e.unit_id and e.company_id = cid
       and e.branch_id is null and u.branch_id is not null;
  end if;
  res := res || jsonb_build_object('expenses', n); total := total + n;

  select count(*) into n from public.maintenance_requests m join public.units u on u.id = m.unit_id
   where m.company_id = cid and m.branch_id is null and u.branch_id is not null;
  if not p_dry_run and n > 0 then
    update public.maintenance_requests m set branch_id = u.branch_id
      from public.units u
     where u.id = m.unit_id and m.company_id = cid
       and m.branch_id is null and u.branch_id is not null;
  end if;
  res := res || jsonb_build_object('maintenance_requests', n); total := total + n;

  -- الدفعات والفواتير ← فرع الحجز (بعد تعبئة الحجوزات)
  select count(*) into n from public.payments p join public.bookings b on b.id = p.booking_id
   where p.company_id = cid and p.branch_id is null and b.branch_id is not null;
  if not p_dry_run and n > 0 then
    update public.payments p set branch_id = b.branch_id
      from public.bookings b
     where b.id = p.booking_id and p.company_id = cid
       and p.branch_id is null and b.branch_id is not null;
  end if;
  res := res || jsonb_build_object('payments', n); total := total + n;

  select count(*) into n from public.invoices i join public.bookings b on b.id = i.booking_id
   where i.company_id = cid and i.branch_id is null and b.branch_id is not null;
  if not p_dry_run and n > 0 then
    update public.invoices i set branch_id = b.branch_id
      from public.bookings b
     where b.id = i.booking_id and i.company_id = cid
       and i.branch_id is null and b.branch_id is not null;
  end if;
  res := res || jsonb_build_object('invoices', n); total := total + n;

  -- القيود ← فرع المصدر
  select count(*) into n from public.journal_entries je
   where je.company_id = cid and je.branch_id is null
     and coalesce(
           (select p.branch_id from public.payments  p where p.id = je.source_id),
           (select e.branch_id from public.expenses  e where e.id = je.source_id),
           (select b.branch_id from public.bookings  b where b.id = je.source_id)) is not null;
  if not p_dry_run and n > 0 then
    update public.journal_entries je
       set branch_id = coalesce(
             (select p.branch_id from public.payments  p where p.id = je.source_id),
             (select e.branch_id from public.expenses  e where e.id = je.source_id),
             (select b.branch_id from public.bookings  b where b.id = je.source_id))
     where je.company_id = cid and je.branch_id is null;
  end if;
  res := res || jsonb_build_object('journal_entries', n); total := total + n;

  -- السندات ← فرع الدفعة/المصروف
  select count(*) into n from public.vouchers v
   where v.company_id = cid and v.branch_id is null
     and coalesce(
           (select p.branch_id from public.payments p where p.id = v.payment_id),
           (select e.branch_id from public.expenses e where e.id = v.expense_id)) is not null;
  if not p_dry_run and n > 0 then
    update public.vouchers v
       set branch_id = coalesce(
             (select p.branch_id from public.payments p where p.id = v.payment_id),
             (select e.branch_id from public.expenses e where e.id = v.expense_id))
     where v.company_id = cid and v.branch_id is null;
  end if;
  res := res || jsonb_build_object('vouchers', n); total := total + n;

  if not p_dry_run and total > 0 then
    begin
      perform public.acct_log_repair(cid, 'branch_backfill', 'success', total, res, 'manual');
    exception when others then null; end;
  end if;

  return jsonb_build_object(
    'status', case when p_dry_run then 'dry_run' else 'success' end,
    'affected_rows', total, 'details', res);
end $function$;

revoke all on function public.branch_backfill_unassigned(uuid, boolean) from public, anon;
grant execute on function public.branch_backfill_unassigned(uuid, boolean) to authenticated, service_role;
