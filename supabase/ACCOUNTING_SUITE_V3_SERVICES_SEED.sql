-- =====================================================================
--  الدفعة 3 — كتالوج الخدمات ببنود حقيقية + الحسابات المقابلة لها
-- ---------------------------------------------------------------------
--  البنود مأخوذة من دليل الحسابات المعتمد لدى المستخدم (الصورة 5):
--  مصاريف المشروعات، وبنود الإيرادات، وبنود المصروفات التشغيلية.
--  لكل بند حساب حقيقي في شجرة الحسابات — لا أسماء بلا أثر محاسبي.
-- =====================================================================

create or replace function public.acct_seed_services(p_company uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public','pg_temp'
as $$
declare
  rec record; v_acc uuid; v_tax uuid; n int := 0;
  -- (رمز الخدمة, الاسم, التصنيف, رقم الحساب, نوع الحساب, هل إيراد)
  items text[][] := array[
    -- الإيرادات
    ['SRV-R01','الفوائد المستلمة','الإيرادات','400101','revenue','1'],
    ['SRV-R02','المبيعات','الإيرادات','400102','revenue','1'],
    ['SRV-R03','إيرادات تأجير الوحدات','الإيرادات','400103','revenue','1'],
    ['SRV-R04','إيرادات الخدمات الفندقية','الإيرادات','400104','revenue','1'],
    -- مصاريف المشروعات
    ['SRV-P01','مصاريف المشروعات','مصاريف المشروعات','30080','expense','0'],
    ['SRV-P02','عدد وأدوات للمجموعات','مصاريف المشروعات','30082','expense','0'],
    ['SRV-P03','ملابس سفتي للعاملين','مصاريف المشروعات','30081','expense','0'],
    -- المصروفات التشغيلية
    ['SRV-E01','أجهزة الحاسب الآلي','المصروفات','500101','expense','0'],
    ['SRV-E02','الأتعاب المحاسبية','المصروفات','500102','expense','0'],
    ['SRV-E03','الإصلاحات والصيانة','المصروفات','500103','expense','0'],
    ['SRV-E04','الإعلانات والترويج','المصروفات','500104','expense','0'],
    ['SRV-E05','التأجير','المصروفات','500105','expense','0'],
    ['SRV-E06','التبرعات','المصروفات','500106','expense','0'],
    ['SRV-E07','الترفيه','المصروفات','500107','expense','0'],
    ['SRV-E08','الرسوم القانونية','المصروفات','500108','expense','0'],
    ['SRV-E09','الطباعة والقرطاسية','المصروفات','500109','expense','0'],
    ['SRV-E10','الكهرباء','المصروفات','500110','expense','0'],
    ['SRV-E11','المصاريف البنكية','المصروفات','500111','expense','0'],
    ['SRV-E12','المياه','المصروفات','500112','expense','0'],
    ['SRV-E13','الاتصالات والإنترنت','المصروفات','500113','expense','0'],
    ['SRV-E14','النظافة والتشغيل','المصروفات','500114','expense','0'],
    ['SRV-E15','الرواتب والأجور','المصروفات','500115','expense','0'],
    ['SRV-E16','التأمينات الاجتماعية','المصروفات','500116','expense','0'],
    ['SRV-E17','الوقود والمحروقات','المصروفات','500117','expense','0'],
    ['SRV-E18','الاشتراكات والتراخيص','المصروفات','500118','expense','0']
  ];
  it text[];
begin
  if p_company is null then return jsonb_build_object('error','no_company'); end if;

  select id into v_tax from public.tax_codes
   where company_id = p_company and code = 'VAT15-S' limit 1;

  foreach it slice 1 in array items loop
    -- الحساب المقابل — يُنشأ إن لم يوجد حتى يكون البند مرتبطاً بالدفاتر فعلاً
    select id into v_acc from public.chart_of_accounts
     where company_id = p_company and code = it[4] limit 1;
    if v_acc is null then
      insert into public.chart_of_accounts (company_id, code, name, account_type, is_group)
      values (p_company, it[4], it[2], it[5]::public.account_type, false)
      returning id into v_acc;
    end if;

    insert into public.services_catalog
      (company_id, code, name, category, uom, tax_code_id,
       income_account_id, expense_account_id)
    values (p_company, it[1], it[2], it[3], 'خدمة', v_tax,
            case when it[6] = '1' then v_acc else null end,
            case when it[6] = '1' then null else v_acc end)
    on conflict (company_id, code) do update
      set name = excluded.name,
          category = excluded.category,
          income_account_id  = coalesce(public.services_catalog.income_account_id,  excluded.income_account_id),
          expense_account_id = coalesce(public.services_catalog.expense_account_id, excluded.expense_account_id),
          updated_at = now();
    n := n + 1;
  end loop;

  return jsonb_build_object('company', p_company, 'services', n);
end $$;

revoke all on function public.acct_seed_services(uuid) from public, anon, authenticated;

-- تشغيلها لكل المنشآت القائمة
do $$ declare c record; begin
  for c in select id from public.companies loop
    perform public.acct_seed_services(c.id);
  end loop;
end $$;

-- وربطها بتهيئة المنشأة الجديدة
create or replace function public.fn_acct_bootstrap_on_company_insert()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $$
begin
  perform public.acct_bootstrap_company(new.id);
  perform public.acct_seed_services(new.id);
  return new;
end $$;
