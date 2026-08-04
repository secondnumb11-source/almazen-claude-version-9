-- =====================================================================
--  البحث الشامل في بيانات النظام
-- ---------------------------------------------------------------------
--  يبحث برقم الفاتورة أو العقد أو القيد أو السند أو الوحدة أو الهوية
--  أو الاسم أو الهاتف — عبر كل الجداول دفعةً واحدة، ويُرجع لكل نتيجة
--  الصفحة التي تفتحها ومعرّف السجل، فيصل المستخدم للسجل مباشرة.
--
--  الأمن: كل استعلام مقيّد بمنشأة المستخدم عبر acct_guard، فلا يكشف
--  البحث سجلات منشأة أخرى مهما كان النص المُدخل.
-- =====================================================================

drop function if exists public.global_search(text, uuid, int);
create or replace function public.global_search(
  p_query text,
  p_company uuid default null,
  p_limit int default 40
) returns table (
  o_kind      text,   -- نوع السجل (فاتورة، قيد، عقد…)
  o_page      text,   -- مفتاح الصفحة التي تُفتح
  o_id        uuid,   -- معرّف السجل
  o_title     text,   -- العنوان المعروض
  o_subtitle  text,   -- سطر التفاصيل
  o_badge     text,   -- شارة (حالة أو مبلغ)
  o_date      date,
  o_rank      int     -- ترتيب: 1 = تطابق تام على رقم
)
language plpgsql stable security definer
set search_path to 'public','pg_temp'
as $$
declare v_co uuid; q text; qx text; lim int;
begin
  v_co := public.acct_guard(p_company);
  q := trim(coalesce(p_query, ''));
  if length(q) < 2 then return; end if;
  qx  := '%' || q || '%';
  lim := greatest(1, least(coalesce(p_limit, 40), 100));

  return query
  with hits as (
    -- ============ الفواتير ============
    select 'فاتورة'::text kind, 'reports-hub'::text page, i.id,
           ('فاتورة ' || i.invoice_number)::text ttl,
           coalesce(i.customer_name, '') || ' — ' || round(i.total,2)::text || ' ر.س' sub,
           i.status::text badge, i.issued_at::date dt,
           case when i.invoice_number ilike q then 1 else 3 end rnk
      from public.invoices i
     where i.company_id = v_co
       and (i.invoice_number ilike qx or i.customer_name ilike qx
            or i.customer_vat ilike qx or i.customer_cr ilike qx)

    -- ============ القيود المحاسبية ============
    union all
    select 'قيد محاسبي', 'je-list', e.id,
           ('قيد ' || e.entry_number),
           coalesce(e.description, '') || coalesce(' — مرجع ' || e.reference, ''),
           e.status::text, e.entry_date,
           case when e.entry_number ilike q then 1 else 3 end
      from public.journal_entries e
     where e.company_id = v_co
       and (e.entry_number ilike qx or e.description ilike qx or e.reference ilike qx)

    -- ============ السندات ============
    union all
    select case when v.voucher_type::text = 'receipt' then 'سند قبض' else 'سند صرف' end,
           'je-list', v.id,
           ('سند ' || v.voucher_number),
           coalesce(v.party_name, '') || ' — ' || round(v.amount,2)::text || ' ر.س',
           v.payment_method::text, v.voucher_date,
           case when v.voucher_number ilike q then 1 else 3 end
      from public.vouchers v
     where v.company_id = v_co
       and (v.voucher_number ilike qx or v.party_name ilike qx
            or v.reference_number ilike qx or v.description ilike qx)

    -- ============ العقود / الحجوزات ============
    union all
    select 'عقد / حجز', 'dash', b.id,
           ('عقد ' || coalesce(b.contract_number, left(b.id::text, 8))),
           coalesce(c.full_name, '') || coalesce(' — وحدة ' || u.unit_number, ''),
           b.status::text, b.check_in_date,
           case when b.contract_number ilike q then 1 else 3 end
      from public.bookings b
      left join public.customers c on c.id = b.customer_id
      left join public.units u on u.id = b.unit_id
     where b.company_id = v_co
       and (b.contract_number ilike qx or c.full_name ilike qx
            or c.id_number ilike qx or c.phone ilike qx or u.unit_number ilike qx)

    -- ============ العملاء ============
    union all
    select 'عميل', 'customers', c.id,
           c.full_name,
           coalesce(c.phone, '') || coalesce(' — هوية ' || c.id_number, ''),
           coalesce(c.customer_type::text, 'فرد'), c.created_at::date,
           case when c.id_number ilike q or c.phone ilike q then 1 else 2 end
      from public.customers c
     where c.company_id = v_co
       and (c.full_name ilike qx or c.id_number ilike qx or c.phone ilike qx
            or c.email ilike qx or c.passport_number ilike qx
            or c.company_name ilike qx or c.cr_number ilike qx or c.vat_number ilike qx)

    -- ============ الوحدات ============
    union all
    select 'وحدة', 'dash', u.id,
           ('وحدة ' || u.unit_number),
           coalesce(u.category::text, '') || coalesce(' — ' || u.description, ''),
           u.status::text, u.created_at::date,
           case when u.unit_number ilike q then 1 else 3 end
      from public.units u
     where u.company_id = v_co
       and (u.unit_number ilike qx or u.description ilike qx)

    -- ============ المصروفات ============
    union all
    select 'مصروف', 'reports', x.id,
           ('مصروف ' || round(x.amount,2)::text || ' ر.س'),
           coalesce(x.category::text, '') || coalesce(' — ' || x.description, ''),
           coalesce(x.vendor_name, ''), x.expense_date,
           3
      from public.expenses x
     where x.company_id = v_co
       and (x.description ilike qx or x.vendor_name ilike qx)

    -- ============ الدفعات ============
    union all
    select 'دفعة', 'reports', p.id,
           ('دفعة ' || round(p.amount,2)::text || ' ر.س'),
           coalesce(p.payment_type::text, '') || coalesce(' — ' || p.reference_number, ''),
           coalesce(p.method::text, ''), p.payment_date,
           3
      from public.payments p
     where p.company_id = v_co
       and (p.reference_number ilike qx or p.notes ilike qx)

    -- ============ الحسابات في الشجرة ============
    union all
    select 'حساب', 'coa', a.id,
           (a.code || ' — ' || a.name),
           a.account_type::text, case when a.is_active then 'نشط' else 'معطّل' end,
           a.created_at::date,
           case when a.code ilike q then 1 else 3 end
      from public.chart_of_accounts a
     where a.company_id = v_co and (a.code ilike qx or a.name ilike qx)

    -- ============ الخدمات ============
    union all
    select 'خدمة', 'services', s.id,
           (s.code || ' — ' || s.name),
           coalesce(s.category, '') || ' — ' || round(s.unit_price,2)::text || ' ر.س',
           case when s.is_active then 'نشط' else 'معطّل' end, s.created_at::date,
           case when s.code ilike q then 1 else 3 end
      from public.services_catalog s
     where s.company_id = v_co and (s.code ilike qx or s.name ilike qx or s.category ilike qx)

    -- ============ مراكز التكلفة ============
    union all
    select 'مركز تكلفة', 'cost-centers', cc.id,
           (cc.code || ' — ' || cc.name),
           cc.kind::text, case when cc.is_active then 'نشط' else 'معطّل' end,
           cc.created_at::date,
           case when cc.code ilike q then 1 else 3 end
      from public.cost_centers cc
     where cc.company_id = v_co and (cc.code ilike qx or cc.name ilike qx)

    -- ============ طلبات الصيانة ============
    union all
    select 'طلب صيانة', 'maintenance', m.id,
           ('صيانة — ' || coalesce(m.request_type::text, '')),
           coalesce(m.description, ''), m.status::text, m.opened_at::date,
           3
      from public.maintenance_requests m
     where m.company_id = v_co and (m.description ilike qx or m.request_type::text ilike qx)

    -- ============ المستندات الرقمية ============
    union all
    select 'مستند رقمي', 'digital-docs', d.id,
           (d.serial || coalesce(' — ' || d.doc_title, '')),
           coalesce('رمز التحقق ' || d.verify_code, ''), d.doc_kind,
           coalesce(d.doc_date, d.issued_at::date),
           case when d.serial ilike q or d.verify_code ilike upper(q) then 1 else 3 end
      from public.document_registry d
     where d.company_id = v_co
       and (d.serial ilike qx or d.doc_title ilike qx or d.verify_code ilike upper(qx))
  )
  select h.kind, h.page, h.id, h.ttl, h.sub, h.badge, h.dt, h.rnk
    from hits h
   order by h.rnk, h.dt desc nulls last, h.ttl
   limit lim;
end $$;

grant execute on function public.global_search(text, uuid, int) to authenticated;
