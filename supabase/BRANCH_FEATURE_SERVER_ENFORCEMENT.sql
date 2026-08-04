-- =====================================================================
-- BRANCH_FEATURE_SERVER_ENFORCEMENT.sql
-- ميزة الفروع تظهر لجميع المستخدمين، لكن لا يمكن استخدامها (كتابة) إلا بعد
-- تفعيل الصلاحية من السوبر أدمن. الواجهة تقفل الأزرار، وهذا الملف يضيف
-- الحماية على مستوى قاعدة البيانات (مصدر الحقيقة الأمني).
--
-- فحص الأثر قبل التطبيق:
--   * جميع مالكي/مديري الشركات التي لديها فروع حالياً مفعّلة لديهم الميزة،
--     لذلك لا يفقد أي مستخدم قائم صلاحياته.
--   * القراءة (SELECT) تبقى مفتوحة كما هي حتى لا تنكسر أي شاشة أو تقرير
--     أو استعلام يربط الفروع، والتقييد يقتصر على الإضافة/التعديل/الحذف.
-- =====================================================================

do $$
declare t text; c text;
begin
  foreach t in array array['branches', 'user_branches'] loop
    foreach c in array array['insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', t || '_feature_' || c, t);
      if c = 'insert' then
        execute format(
          'create policy %I on public.%I as restrictive for insert to authenticated
             with check (is_super_admin() or has_feature(''branches''))',
          t || '_feature_' || c, t);
      elsif c = 'update' then
        execute format(
          'create policy %I on public.%I as restrictive for update to authenticated
             using (is_super_admin() or has_feature(''branches''))
             with check (is_super_admin() or has_feature(''branches''))',
          t || '_feature_' || c, t);
      else
        execute format(
          'create policy %I on public.%I as restrictive for delete to authenticated
             using (is_super_admin() or has_feature(''branches''))',
          t || '_feature_' || c, t);
      end if;
    end loop;
  end loop;
end $$;
