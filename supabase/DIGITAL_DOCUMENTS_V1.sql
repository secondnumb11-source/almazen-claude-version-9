-- =====================================================================
--  رقمنة النظام بالكامل — البند 20
-- ---------------------------------------------------------------------
--  كل مستند يخرج من النظام (فاتورة، سند، قيد، تقرير، كشف حساب، عقد)
--  يحمل: رقماً تسلسلياً فريداً، بصمة تحقق مشتقة من محتواه، ورمز تحقق
--  يمكن لأي طرف التحقق منه دون الدخول للنظام.
--
--  لماذا بصمة المحتوى؟ الرقم التسلسلي وحده يثبت أن المستند صدر منّا،
--  لكنه لا يكشف تحريفه بعد الطباعة. البصمة تكشف ذلك.
-- =====================================================================

alter table public.document_registry
  add column if not exists content_hash text,
  add column if not exists verify_code  text,
  add column if not exists doc_title    text,
  add column if not exists doc_total    numeric(14,2),
  add column if not exists doc_date     date,
  add column if not exists revoked_at   timestamptz,
  add column if not exists revoked_by   uuid;

create unique index if not exists uq_docreg_verify on public.document_registry(verify_code)
  where verify_code is not null;
create index if not exists idx_docreg_company on public.document_registry(company_id, issued_at desc);
create index if not exists idx_docreg_kind on public.document_registry(company_id, doc_kind);

-- ---------------------------------------------------------------------
-- 1) ختم مستند: يصدر الرقم والبصمة ورمز التحقق دفعةً واحدة
-- ---------------------------------------------------------------------
create or replace function public.doc_stamp(
  p_kind    text,
  p_title   text default null,
  p_payload text default null,          -- المحتوى الذي تُشتق منه البصمة
  p_table   text default null,
  p_id      uuid default null,
  p_total   numeric default null,
  p_date    date default null,
  p_meta    jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer
-- pgcrypto مثبَّت في مخطط extensions لا public: بدونه في المسار تفشل
-- digest() فلا يُختم أي مستند — وهو ما أثبته الاختبار السلوكي (0 من 10).
set search_path to 'public','extensions','pg_temp'
as $$
declare
  v_co uuid; v_serial text; v_hash text; v_code text; v_row public.document_registry;
begin
  v_co := public.acct_guard(null);

  -- مستند سبق ختمه لنفس الكيان: يُعاد ختمه نفسه لا ختم جديد،
  -- وإلا تعدّدت الأرقام لنفس الفاتورة عند كل طباعة.
  if p_id is not null then
    select * into v_row from public.document_registry
     where company_id = v_co and doc_kind = p_kind and entity_id = p_id and revoked_at is null
     order by issued_at desc limit 1;
    if v_row.id is not null and (p_payload is null
        or v_row.content_hash = encode(digest(coalesce(p_payload,''), 'sha256'), 'hex')) then
      return jsonb_build_object(
        'serial', v_row.serial, 'hash', v_row.content_hash, 'code', v_row.verify_code,
        'issued_at', v_row.issued_at, 'reused', true);
    end if;
  end if;

  v_serial := public.issue_document_serial(p_kind, p_table, p_id, coalesce(p_meta,'{}'::jsonb));
  v_hash := encode(digest(coalesce(p_payload, v_serial), 'sha256'), 'hex');
  -- رمز تحقق قصير قابل للقراءة والنطق — 10 خانات من البصمة والرقم
  v_code := upper(substr(encode(digest(v_serial || v_hash, 'sha256'), 'hex'), 1, 10));

  update public.document_registry
     set content_hash = v_hash, verify_code = v_code, doc_title = p_title,
         doc_total = p_total, doc_date = coalesce(p_date, current_date)
   where company_id = v_co and serial = v_serial;

  return jsonb_build_object('serial', v_serial, 'hash', v_hash, 'code', v_code,
                            'issued_at', now(), 'reused', false);
end $$;
grant execute on function public.doc_stamp(text,text,text,text,uuid,numeric,date,jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 2) التحقق من مستند برمزه — متاح للعموم عمداً
--    الغرض أن يتحقق طرف خارجي (عميل، مورد، مدقق) من صحة ورقة بيده.
--    لا يُرجع محتوى المستند، فقط إثبات صدوره وسلامته.
-- ---------------------------------------------------------------------
create or replace function public.doc_verify(p_code text, p_hash text default null)
returns jsonb
language plpgsql security definer stable
set search_path to 'public','extensions','pg_temp'
as $$
declare r record; c record;
begin
  if p_code is null or length(trim(p_code)) < 6 then
    return jsonb_build_object('valid', false, 'reason', 'رمز غير صالح');
  end if;

  select * into r from public.document_registry where verify_code = upper(trim(p_code));
  if r.id is null then
    return jsonb_build_object('valid', false, 'reason', 'لا يوجد مستند بهذا الرمز');
  end if;
  if r.revoked_at is not null then
    return jsonb_build_object('valid', false, 'reason', 'المستند ملغى', 'revoked_at', r.revoked_at);
  end if;
  if p_hash is not null and r.content_hash is not null and r.content_hash <> lower(trim(p_hash)) then
    return jsonb_build_object('valid', false, 'reason', 'محتوى المستند لا يطابق البصمة المسجّلة — يُشتبه في تحريفه');
  end if;

  select name into c from public.companies where id = r.company_id;
  return jsonb_build_object(
    'valid', true,
    'serial', r.serial, 'kind', r.doc_kind, 'title', r.doc_title,
    'issued_at', r.issued_at, 'doc_date', r.doc_date, 'total', r.doc_total,
    'issuer', coalesce(c.name, 'منشأة مسجّلة'));
end $$;
grant execute on function public.doc_verify(text,text) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 3) سجل المستندات الرقمية للمنشأة
-- ---------------------------------------------------------------------
drop function if exists public.doc_registry_list(uuid,text,date,date,text,int);
create or replace function public.doc_registry_list(
  p_company uuid default null, p_kind text default null,
  p_from date default null, p_to date default null,
  p_search text default null, p_limit int default 300)
returns table (
  o_id uuid, o_serial text, o_kind text, o_title text, o_code text,
  o_date date, o_total numeric, o_issued_at timestamptz,
  o_issued_by text, o_entity text, o_revoked boolean)
language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v_co uuid;
begin
  v_co := public.acct_guard(p_company);
  return query
  select r.id, r.serial, r.doc_kind, r.doc_title, r.verify_code,
         r.doc_date, r.doc_total, r.issued_at,
         coalesce(p.full_name, '—'), coalesce(r.entity_table, '—'),
         r.revoked_at is not null
    from public.document_registry r
    left join public.profiles p on p.id = r.issued_by
   where r.company_id = v_co
     and (p_kind is null or r.doc_kind = p_kind)
     and (p_from is null or coalesce(r.doc_date, r.issued_at::date) >= p_from)
     and (p_to   is null or coalesce(r.doc_date, r.issued_at::date) <= p_to)
     and (p_search is null or r.serial ilike '%'||p_search||'%'
          or coalesce(r.doc_title,'') ilike '%'||p_search||'%'
          or coalesce(r.verify_code,'') ilike '%'||p_search||'%')
   order by r.issued_at desc
   limit greatest(1, least(p_limit, 2000));
end $$;
grant execute on function public.doc_registry_list(uuid,text,date,date,text,int) to authenticated;

-- ---------------------------------------------------------------------
-- 4) إلغاء مستند — لا يُحذف أبداً؛ الحذف يُفقد أثر التدقيق
-- ---------------------------------------------------------------------
create or replace function public.doc_revoke(p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_co uuid;
begin
  select company_id into v_co from public.document_registry where id = p_id;
  if v_co is null then raise exception 'المستند غير موجود' using errcode='42501'; end if;
  perform public.acct_guard(v_co);
  update public.document_registry
     set revoked_at = now(), revoked_by = auth.uid(),
         meta = coalesce(meta,'{}'::jsonb) || jsonb_build_object('revoke_reason', p_reason)
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.doc_revoke(uuid,text) to authenticated;

-- ---------------------------------------------------------------------
-- 5) إحصاءات الرقمنة — كم من مستندات النظام صار موثّقاً رقمياً
-- ---------------------------------------------------------------------
drop function if exists public.doc_coverage(uuid);
create or replace function public.doc_coverage(p_company uuid default null)
returns table (o_kind text, o_total int, o_stamped int, o_pct numeric)
language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v_co uuid;
begin
  v_co := public.acct_guard(p_company);
  return query
  with src as (
    select 'invoice'::text k, count(*)::int n from public.invoices where company_id=v_co
    union all select 'voucher', count(*)::int from public.vouchers where company_id=v_co
    union all select 'journal', count(*)::int from public.journal_entries where company_id=v_co
    union all select 'contract', count(*)::int from public.contracts where company_id=v_co
    union all select 'handover', count(*)::int from public.handovers where company_id=v_co
  ), stamped as (
    select doc_kind k, count(*)::int n from public.document_registry
     where company_id=v_co and revoked_at is null group by 1
  )
  select src.k,
         src.n,
         coalesce(stamped.n, 0),
         case when src.n = 0 then 100
              else round(100.0 * least(coalesce(stamped.n,0), src.n) / src.n, 1) end
    from src left join stamped on stamped.k = src.k
   order by 1;
exception when others then return;
end $$;
grant execute on function public.doc_coverage(uuid) to authenticated;
