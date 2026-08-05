-- =====================================================================
--  عطل مُثبَت: أرشيف مستندات العميل يُرفع إلى التخزين ولا يُحفظ أبداً
-- ---------------------------------------------------------------------
--  الدليل:
--    • CustomerDocVault.jsx يحدّث customers.documents_json — والعمود غير موجود.
--    • المسار الاحتياطي يكتب داخل notes، ونتيجته صفر: لا عميل واحد يحمل
--      العلامة [DOCUMENTS: — أي أن الاحتياطي فشل بصمت هو الآخر.
--    • مسح شامل لـ 432 عموداً (نص/مصفوفة/JSON) مقابل 47 ملفاً في التخزين:
--        مرتبطة=32 | بلا مرجع=15 | روابط مكسورة=0
--      اثنا عشر من الخمسة عشر في حاوية documents رفعها مستخدمون حقيقيون
--      («المحاسب الجديد»، «test»، «علي علي») بين 24-07 و 02-08.
--    • كل مسارات الرفع الأخرى سليمة: profiles.id_photo_url و contract_url
--      و maintenance_requests.photos و invoice_url و companies.logo_url
--      و service_requests.photo_url — جميعها موجودة ومرتبطة.
--
--  الأثر: المستخدم يرفع مستنداً، يرى رسالة نجاح، ثم يفقده عند تحديث الصفحة.
--  الملفات الخمسة عشر باقية في التخزين لكن بياناتها الوصفية (العنوان،
--  النوع، التاريخ، العميل صاحبها) لم تُكتب قط — فلا سبيل لإعادة ربطها آلياً.
--
--  الإصلاح: إنشاء العمود المقصود أصلاً في التصميم.
-- =====================================================================

alter table public.customers
  add column if not exists documents_json text;

comment on column public.customers.documents_json is
  'أرشيف مستندات العميل: مصفوفة JSON [{id,title,type,url,date}] يكتبها CustomerDocVault';

-- ---------------------------------------------------------------------
-- فحص دائم يمنع تكرار الصنف: عمود هدف للرفع مفقود، أو ملف بلا مرجع
-- ---------------------------------------------------------------------
create or replace function public.ci_document_checks()
returns table (o_suite text, o_name text, o_category text, o_status text,
               o_message text, o_meta jsonb, o_fix text)
language plpgsql stable security definer
set search_path to 'public','storage','pg_temp' as $$
declare v int; nm text; miss text := '';
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- (1) كل عمود تكتب فيه واجهة الرفع موجود فعلاً
  select string_agg(t || '.' || c, '، ') into miss
    from (values ('customers','documents_json'), ('customers','id_document_url'),
                 ('profiles','id_photo_url'),    ('profiles','contract_url'),
                 ('maintenance_requests','photos'), ('maintenance_requests','invoice_url'),
                 ('companies','logo_url'),       ('service_requests','photo_url')) as x(t,c)
   where not exists (select 1 from information_schema.columns i
                      where i.table_schema='public' and i.table_name=t and i.column_name=c);
  return query select 'documents','أعمدة حفظ المرفوعات كلها موجودة','migration',
    case when miss is null then 'pass' else 'fail' end,
    case when miss is null then 'كل مسارات الرفع لها عمود حفظ'
         else 'أعمدة مفقودة تُفقد المرفوعات: ' || miss end,
    jsonb_build_object('missing', coalesce(miss,'')), null::text;

  -- (2) لا رابط في قاعدة البيانات يشير إلى ملف غير موجود
  select count(*) into v from public.unit_media m
   where coalesce(m.url,'') <> ''
     and not exists (select 1 from storage.objects o where m.url like '%' || o.name);
  return query select 'documents','لا روابط وسائط مكسورة','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'كل رابط وسائط له ملف فعلي' else v || ' رابط بلا ملف' end,
    jsonb_build_object('broken', v), null::text;

  -- (3) ملفات مرفوعة بلا أي مرجع — مؤشر على مسار حفظ معطوب
  --     المسح شامل: كل عمود (نص/مصفوفة/JSON) في المخطط العام بلا استثناء.
  --     نجمع أسماء الملفات المذكورة في كل عمود مرة واحدة بدل مقارنة كل ملف
  --     بكل عمود — فيصبح عدد الاستعلامات بعدد الأعمدة لا بحاصل ضربها.
  declare
    cc record; sq text; seen text[] := '{}'; got text[]; newest timestamptz;
  begin
    for cc in
      select table_name t, column_name col
        from information_schema.columns
       where table_schema = 'public'
         and data_type in ('text','character varying','jsonb','json','ARRAY')
         and table_name in (select table_name from information_schema.tables
                             where table_schema='public' and table_type='BASE TABLE')
    loop
      sq := format($q$
        select coalesce(array_agg(distinct o.name), '{}')
          from storage.objects o
         where exists (select 1 from public.%I x where x.%I::text like '%%' || o.name || '%%')$q$,
        cc.t, cc.col);
      begin execute sq into got; exception when others then got := '{}'; end;
      if got is not null and array_length(got,1) > 0 then
        seen := seen || got;
      end if;
    end loop;

    select count(*), max(o.created_at) into v, newest
      from storage.objects o where not (o.name = any(seen));

    return query select 'documents','لا ملفات مرفوعة بلا مرجع','data',
      case when v = 0 then 'pass'
           when newest < timestamptz '2026-08-05' then 'warn'
           else 'fail' end,
      case when v = 0 then 'كل ملف مرفوع مرتبط بسجل'
           when newest < timestamptz '2026-08-05'
             then v || ' ملف متروك قبل إصلاح أرشيف المستندات — غير قابل لإعادة الربط آلياً'
           else v || ' ملف بلا مرجع وأحدثها بعد الإصلاح: مسار حفظ معطوب من جديد' end,
      jsonb_build_object('orphans', v, 'newest', newest), null::text;
  end;
end $$;
revoke all on function public.ci_document_checks() from public, anon;
grant execute on function public.ci_document_checks() to authenticated;
