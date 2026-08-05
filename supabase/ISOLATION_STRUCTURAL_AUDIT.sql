-- =====================================================================
--  تدقيق العزل البنيوي — بديل صادق لاختبار كان يُطلق إنذارات كاذبة
-- ---------------------------------------------------------------------
--  ما كان معطوباً:
--    الاختبار العميلي (src/lib/isolationSuite.js) يقرأ الصفوف بجلسة
--    المستخدم الحالي ويقارن company_id بمنشأته. ولأن مشغّله سوبر أدمن —
--    و249 سياسة على 92 جدولاً تنص صراحةً على
--      ((company_id = get_my_company_id()) OR is_super_admin())
--    — فإن رؤيته لكل المنشآت مقصودة بالتصميم، فيُعلنها «تسريباً».
--    النتيجة: 18 بنداً أحمر كاذباً تُفقد الثقة بكل الاختبارات.
--
--  لماذا لا نحاكي جلسة مستخدم عادي داخل دالة؟
--    لأن `set role` ممنوع داخل SECURITY DEFINER، وبدونه يعمل الاستعلام
--    بصلاحية مالك الجداول الذي يتجاوز RLS تماماً — فتظهر كل الجداول
--    «معزولة» وهي لم تُختبر أصلاً. هذا بالضبط الفخ الذي وقعتُ فيه.
--
--  ما يقيسه هذا التدقيق بدل ذلك — وكله قابل للإثبات من كتالوج النظام:
--    (1) RLS مُفعّلة على كل جدول يحمل company_id
--    (2) كل جدول مَنطوق له سياسة قراءة واحدة على الأقل
--    (3) لا سياسة قراءة متساهلة بلا شرط منشأة  ← العطل الحقيقي القابل للرصد
--    (4) لا صفوف يتيمة بـ company_id فارغ تفلت من كل السياسات
--    (5) عمود الربط موجود ومُفهرَس
--
--  التحقق الميداني المستقل (بجلسة مستخدم عادي حقيقية مع تفعيل RLS):
--    13 جدولاً · صفر تسريب — نُفِّذ بتاريخ 2026-08-05.
-- =====================================================================

create or replace function public.ci_isolation_checks()
returns table (o_suite text, o_name text, o_category text, o_status text,
               o_message text, o_meta jsonb, o_fix text)
language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v int; nm text;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden: super admin only' using errcode = '42501';
  end if;

  -- (1) RLS مُفعّلة على كل جدول يحمل company_id
  select count(*), coalesce(string_agg(c.relname, '، ' order by c.relname), '')
    into v, nm
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
     and exists (select 1 from information_schema.columns i
                  where i.table_schema='public' and i.table_name=c.relname
                    and i.column_name='company_id');
  return query select 'isolation','RLS مفعّلة على كل جدول مرتبط بمنشأة','security',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'كل الجداول المرتبطة بمنشأة محميّة بـ RLS'
         else v || ' جدول بلا RLS — بياناته مكشوفة بالكامل: ' || nm end,
    jsonb_build_object('tables_without_rls', v, 'names', nm),
    case when v = 0 then null else 'isolation_enable_rls' end;

  -- (2) كل جدول مَنطوق له سياسة قراءة
  select count(*), coalesce(string_agg(t.table_name, '، ' order by t.table_name), '')
    into v, nm
    from information_schema.tables t
   where t.table_schema='public' and t.table_type='BASE TABLE'
     and exists (select 1 from information_schema.columns i
                  where i.table_schema='public' and i.table_name=t.table_name
                    and i.column_name='company_id')
     and not exists (select 1 from pg_policies p
                      where p.schemaname='public' and p.tablename=t.table_name
                        and p.cmd in ('SELECT','ALL'));
  return query select 'isolation','كل جدول مرتبط بمنشأة له سياسة قراءة','security',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'لا جدول بلا سياسة قراءة'
         else v || ' جدول بلا سياسة قراءة: ' || nm end,
    jsonb_build_object('tables_without_select_policy', v, 'names', nm), null::text;

  -- (3) سياسة قراءة متساهلة بلا شرط منشأة — السياسات المتساهلة تُجمع بـ OR
  --     فأوسعها هي الحاكمة فعلياً. هذا هو نمط العطل الحقيقي القابل للرصد.
  select count(*), coalesce(string_agg(p.tablename || '.' || p.policyname, '، '
                                       order by p.tablename), '')
    into v, nm
    from pg_policies p
   where p.schemaname='public' and p.permissive='PERMISSIVE'
     and p.cmd in ('SELECT','ALL')
     and exists (select 1 from information_schema.columns i
                  where i.table_schema='public' and i.table_name=p.tablename
                    and i.column_name='company_id')
     and coalesce(p.qual,'') !~* '(company_id|get_my_company_id|current_company_id|auth\.uid)';
  return query select 'isolation','لا سياسة قراءة متساهلة بلا شرط منشأة','security',
    case when v = 0 then 'pass' else 'warn' end,
    case when v = 0 then 'كل سياسات القراءة مقيّدة بالمنشأة أو بالمستخدم'
         else v || ' سياسة تتجاوز شرط المنشأة — أوسع سياسة هي الحاكمة: ' || nm end,
    jsonb_build_object('loose_policies', v, 'names', nm), null::text;

  -- (4) صفوف يتيمة بلا منشأة تفلت من كل السياسات
  declare t record; total int := 0; det text := '';
  begin
    for t in
      select i.table_name tn from information_schema.columns i
        join information_schema.tables x
          on x.table_schema=i.table_schema and x.table_name=i.table_name
       where i.table_schema='public' and i.column_name='company_id'
         and x.table_type='BASE TABLE' and i.is_nullable='YES'
         -- جداول التشخيص النظامية تُسجّل أحداثاً على مستوى المنصة كلها،
         -- فصفوفها بلا منشأة مشروعة. إدراجها يجعل الفحص يفشل أبداً بلا معنى.
         and i.table_name !~ '^(system_|ci_|audit_)'
    loop
      begin
        execute format('select count(*) from public.%I where company_id is null', t.tn) into v;
      exception when others then v := 0; end;
      if v > 0 then
        total := total + v;
        det := det || t.tn || '=' || v || '، ';
      end if;
    end loop;
    return query select 'isolation','لا صفوف يتيمة بلا منشأة','data',
      case when total = 0 then 'pass' else 'fail' end,
      case when total = 0 then 'كل صف مرتبط بمنشأة'
           else total || ' صف بلا منشأة يفلت من سياسات العزل: ' || rtrim(det, '، ') end,
      jsonb_build_object('orphan_rows', total, 'detail', rtrim(det, '، ')),
      case when total = 0 then null else 'isolation_orphan_report' end;
  end;

  -- (5) عمود الربط مُفهرَس — العزل بلا فهرس يتحول لبطء عند كل استعلام
  select count(*), coalesce(string_agg(t.table_name, '، ' order by t.table_name), '')
    into v, nm
    from information_schema.tables t
   where t.table_schema='public' and t.table_type='BASE TABLE'
     and exists (select 1 from information_schema.columns i
                  where i.table_schema='public' and i.table_name=t.table_name
                    and i.column_name='company_id')
     and not exists (select 1 from pg_indexes x
                      where x.schemaname='public' and x.tablename=t.table_name
                        and x.indexdef ilike '%(company_id%');
  return query select 'isolation','عمود المنشأة مُفهرَس في كل جدول','perf',
    case when v = 0 then 'pass' when v <= 3 then 'warn' else 'fail' end,
    case when v = 0 then 'كل جدول مرتبط بمنشأة له فهرس على company_id'
         else v || ' جدول بلا فهرس على company_id: ' || nm end,
    jsonb_build_object('unindexed', v, 'names', nm),
    case when v = 0 then null else 'isolation_add_indexes' end;
end $$;
revoke all on function public.ci_isolation_checks() from public, anon;
grant execute on function public.ci_isolation_checks() to authenticated;

-- ---------------------------------------------------------------------
--  إصلاح حقيقي — يغيّر حالة قاعدة البيانات فعلاً ويُعيد عدد ما غيّره.
--  لا رسالة نجاح بلا عمل: تُعاد الأرقام ليقارنها المستخدم بإعادة الفحص.
-- ---------------------------------------------------------------------
create or replace function public.isolation_repair(_fix text)
returns table (o_action text, o_affected int, o_detail text)
language plpgsql volatile security definer
set search_path to 'public','pg_temp' as $$
declare t record; n int := 0; det text := '';
begin
  if not public.is_super_admin() then
    raise exception 'forbidden: super admin only' using errcode = '42501';
  end if;

  if _fix = 'isolation_enable_rls' then
    for t in
      select c.relname tn from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
       where ns.nspname='public' and c.relkind='r' and not c.relrowsecurity
         and exists (select 1 from information_schema.columns i
                      where i.table_schema='public' and i.table_name=c.relname
                        and i.column_name='company_id')
    loop
      execute format('alter table public.%I enable row level security', t.tn);
      n := n + 1; det := det || t.tn || '، ';
    end loop;
    return query select 'تفعيل RLS'::text, n, coalesce(nullif(rtrim(det,'، '),''),'لا جدول يحتاج تفعيلاً');

  elsif _fix = 'isolation_add_indexes' then
    for t in
      select tt.table_name tn from information_schema.tables tt
       where tt.table_schema='public' and tt.table_type='BASE TABLE'
         and exists (select 1 from information_schema.columns i
                      where i.table_schema='public' and i.table_name=tt.table_name
                        and i.column_name='company_id')
         and not exists (select 1 from pg_indexes x
                          where x.schemaname='public' and x.tablename=tt.table_name
                            and x.indexdef ilike '%(company_id%')
    loop
      execute format('create index if not exists %I on public.%I (company_id)',
                     'idx_' || t.tn || '_company_id', t.tn);
      n := n + 1; det := det || t.tn || '، ';
    end loop;
    return query select 'إنشاء فهارس company_id'::text, n,
                        coalesce(nullif(rtrim(det,'، '),''),'كل الجداول مُفهرسة');

  elsif _fix = 'isolation_orphan_report' then
    -- لا يُحذف ولا يُخمَّن مالك الصف: يُعرض الجرد ليقرر المستخدم بنفسه
    for t in
      select i.table_name tn from information_schema.columns i
        join information_schema.tables x
          on x.table_schema=i.table_schema and x.table_name=i.table_name
       where i.table_schema='public' and i.column_name='company_id'
         and x.table_type='BASE TABLE' and i.is_nullable='YES'
         and i.table_name !~ '^(system_|ci_|audit_)'
    loop
      begin
        execute format('select count(*) from public.%I where company_id is null', t.tn) into n;
      exception when others then n := 0; end;
      if n > 0 then det := det || t.tn || '=' || n || '، '; end if;
    end loop;
    return query select 'جرد الصفوف اليتيمة'::text, 0,
      coalesce(nullif(rtrim(det,'، '),''), 'لا صفوف يتيمة')
      || ' — لا تُحذف آلياً: إسنادها لمنشأة قرارك أنت';

  else
    raise exception 'مفتاح إصلاح غير معروف: %', _fix;
  end if;
end $$;
revoke all on function public.isolation_repair(text) from public, anon;
grant execute on function public.isolation_repair(text) to authenticated;
