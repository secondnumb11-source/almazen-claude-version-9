-- =====================================================================
--  ضمان أن كل خدمة قابلة للترحيل — فحص دائم وإصلاح حقيقي
-- ---------------------------------------------------------------------
--  الثغرة المُثبَتة: عمودا income_account_id و expense_account_id في
--  services_catalog يقبلان الفراغ، ولا شيء كان يمنع حفظ خدمة بلا حساب.
--  خدمة بلا حساب — حين تُستخدم في فاتورة أو قيد — لا تجد أين تُرحَّل،
--  فتنكسر سلسلة الترحيل بصمت.
--
--  الحالة وقت الإصلاح: 26 خدمة في منشأة المستخدم، كلها مرتبطة — فلا ضرر
--  واقع، لكن الباب كان مفتوحاً.
--
--  لماذا لا نفرض NOT NULL على العمود: صفوف قائمة في منشآت أخرى قد تكون
--  فارغة، ومسارات الحفظ على مرحلتين ستنكسر. المنع في الواجهة + فحص دائم
--  + إصلاح آلي يغطي الحالات دون كسر أي مسار قائم.
--
--  الإصلاح يعمل على مستوى المنصة: كل المنشآت الحالية والجديدة.
-- =====================================================================

create or replace function public.ci_services_checks()
returns table (o_suite text, o_name text, o_category text, o_status text,
               o_message text, o_meta jsonb, o_fix text)
language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v int; nm text;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden: super admin only' using errcode = '42501';
  end if;

  -- (1) لا خدمة بلا حساب مرتبط — على مستوى المنصة كلها
  select count(*), coalesce(string_agg(distinct c.name, '، '), '') into v, nm
    from public.services_catalog s join public.companies c on c.id = s.company_id
   where s.income_account_id is null and s.expense_account_id is null;
  return query select 'services','كل خدمة مرتبطة بحساب قابل للترحيل','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'كل الخدمات في كل المنشآت لها حساب ترحيل'
         else v || ' خدمة بلا حساب لن تجد أين تُرحَّل — المنشآت: ' || nm end,
    jsonb_build_object('unlinked', v, 'companies', nm),
    case when v = 0 then null else 'services_link_accounts' end;

  -- (2) الحساب المرتبط موجود فعلاً وفي نفس المنشأة
  select count(*) into v
    from public.services_catalog s
   where coalesce(s.income_account_id, s.expense_account_id) is not null
     and not exists (select 1 from public.chart_of_accounts a
                      where a.id = coalesce(s.income_account_id, s.expense_account_id)
                        and a.company_id = s.company_id);
  return query select 'services','حساب الخدمة يخص منشأتها ويوجد في الشجرة','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'كل ارتباط سليم ويشير لحساب داخل شجرة نفس المنشأة'
         else v || ' خدمة تشير لحساب مفقود أو من منشأة أخرى' end,
    jsonb_build_object('broken_links', v), null::text;

  -- (3) كل منشأة لديها حسابات افتراضية تُمكّن الإصلاح الآلي
  select count(*) into v from public.companies c
   where not exists (select 1 from public.accounting_settings a
                      where a.company_id = c.id
                        and a.product_income_account_id is not null
                        and a.product_expense_account_id is not null);
  return query select 'services','كل منشأة لها حسابات خدمات افتراضية','migration',
    case when v = 0 then 'pass' else 'warn' end,
    case when v = 0 then 'كل المنشآت مهيّأة — الإصلاح الآلي متاح لها'
         else v || ' منشأة بلا حسابات افتراضية للخدمات' end,
    jsonb_build_object('companies_without_defaults', v),
    case when v = 0 then null else 'acct_complete_defaults' end;
end $$;
revoke all on function public.ci_services_checks() from public, anon;
grant execute on function public.ci_services_checks() to authenticated;

-- ---------------------------------------------------------------------
--  إصلاح حقيقي: يربط كل خدمة بلا حساب بالحساب الافتراضي لمنشأتها.
--  يعمل على كل المنشآت — الحالية والتي ستُنشأ لاحقاً — ويُعيد عدد ما
--  غيّره فعلاً. لا يلمس خدمة مرتبطة أصلاً، ولا يُنشئ حسابات جديدة.
-- ---------------------------------------------------------------------
create or replace function public.services_link_accounts()
returns table (o_action text, o_affected int, o_detail text)
language plpgsql volatile security definer
set search_path to 'public','pg_temp' as $$
declare n_inc int := 0; n_exp int := 0; n_left int := 0;
begin
  if not public.is_super_admin() then
    raise exception 'forbidden: super admin only' using errcode = '42501';
  end if;

  -- الخدمات المصنّفة إيراداً → حساب الإيراد الافتراضي
  with upd as (
    update public.services_catalog s
       set income_account_id = a.product_income_account_id,
           updated_at = now()
      from public.accounting_settings a
     where a.company_id = s.company_id
       and s.income_account_id is null and s.expense_account_id is null
       and a.product_income_account_id is not null
       and coalesce(s.category,'') in ('الإيرادات','إيرادات','revenue','income')
    returning 1)
  select count(*) into n_inc from upd;

  -- ما تبقّى (مصروفات وغير مصنّف) → حساب المصروف الافتراضي
  with upd2 as (
    update public.services_catalog s
       set expense_account_id = a.product_expense_account_id,
           updated_at = now()
      from public.accounting_settings a
     where a.company_id = s.company_id
       and s.income_account_id is null and s.expense_account_id is null
       and a.product_expense_account_id is not null
    returning 1)
  select count(*) into n_exp from upd2;

  select count(*) into n_left from public.services_catalog
   where income_account_id is null and expense_account_id is null;

  return query select 'ربط الخدمات بحساباتها'::text, (n_inc + n_exp),
    ('إيراد=' || n_inc || ' | مصروف=' || n_exp
     || ' | متبقٍ بلا حساب=' || n_left
     || case when n_left > 0
             then ' (منشآتها بلا حسابات افتراضية — شغّل «إكمال الحسابات الافتراضية» أولاً)'
             else '' end)::text;
end $$;
revoke all on function public.services_link_accounts() from public, anon;
grant execute on function public.services_link_accounts() to authenticated;
