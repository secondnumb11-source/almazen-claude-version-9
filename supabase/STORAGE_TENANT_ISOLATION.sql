-- =====================================================================
--  عزل التخزين بين المنشآت — إغلاق خرق بيانات مؤكد
-- ---------------------------------------------------------------------
--  العطل المُثبت (F-9):
--    سياسات storage.objects كانت كلها بشرط `true`:
--      storage_select_policy  SELECT authenticated USING true
--      storage_upload_policy  INSERT authenticated WITH CHECK true
--      storage_update_policy  UPDATE authenticated USING true
--      storage_delete_policy  DELETE authenticated USING true
--    وسياسة storage_public_select كانت تمنح anon قراءة حاوية `documents`
--    رغم أنها معلَّمة public=false.
--
--  الأثر المقيس على الإنتاج (اختبار حيّ بجلستَي anon و authenticated):
--    إجمالي الملفات 47
--    زائر غير مسجَّل يرى 45 — منها كل الـ21 ملفاً في حاوية documents
--    مستخدم عادي يرى 47، جميعها تخص منشآت أخرى
--    ومفتاح anon مضمَّن في كود الواجهة ويراه أي زائر
--    => عقود ووثائق هوية 6 منشآت مكشوفة عملياً، وأي مستخدم يستطيع حذفها.
--
--  العلاج: تقييد بالمسار. اصطلاح المسار المعتمد في الكود:
--      uploadFile()          → {company_id}/{timestamp}_{name}
--      TrialExpired          → {company_id}/...
--      TenantPortal          → {token}/...   (بوابة المستأجر، ليست منشأة)
--
--  حاويات الأصول العامة تبقى مقروءة للجميع (صور الوحدات والشعارات
--  والتواقيع تُعرض في صفحات عامة)، والحاويات الخاصة تُقيَّد بالمنشأة.
-- =====================================================================

-- الحاويات التي يجوز قراءتها علناً (أصول تُعرض في صفحات عامة)
create or replace function public.storage_public_buckets()
returns text[] language sql immutable
as $$ select array['unit-media','almazen-unit-media','almazen-logos',
                   'handover-signatures','portal-uploads'] $$;

-- منشأة المستخدم الحالي
create or replace function public.auth_company_id()
returns uuid language sql stable security definer set search_path = public
as $$ select company_id from public.profiles where id = auth.uid() $$;

revoke all on function public.auth_company_id() from public, anon;
grant execute on function public.auth_company_id() to authenticated, service_role;
grant execute on function public.storage_public_buckets() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- استبدال السياسات المفتوحة
-- ---------------------------------------------------------------------
drop policy if exists storage_select_policy       on storage.objects;
drop policy if exists storage_upload_policy       on storage.objects;
drop policy if exists storage_update_policy       on storage.objects;
drop policy if exists storage_delete_policy       on storage.objects;
drop policy if exists storage_public_select       on storage.objects;
drop policy if exists buckets_list_authenticated  on storage.objects;

-- قراءة عامة: الأصول العامة فقط — ولم تعد تشمل documents
create policy storage_public_read on storage.objects
  for select to anon, authenticated
  using ( bucket_id = any (public.storage_public_buckets()) );

-- قراءة المسجَّلين: ملفات منشأتهم فقط (أو سوبر أدمن)
create policy storage_read_own_company on storage.objects
  for select to authenticated
  using (
    public.is_super_admin()
    or split_part(name, '/', 1) = public.auth_company_id()::text
  );

-- الرفع: داخل مجلد منشأة المستخدم، أو بوابة المستأجر (مسارها بالرمز لا بالمنشأة)
create policy storage_insert_own_company on storage.objects
  for insert to authenticated
  with check (
    public.is_super_admin()
    or bucket_id = 'portal-uploads'
    or split_part(name, '/', 1) = public.auth_company_id()::text
  );

-- رفع الزائر مقتصر على بوابة المستأجر (يرفع صور الأعطال قبل تسجيل الدخول)
create policy storage_insert_portal_anon on storage.objects
  for insert to anon
  with check ( bucket_id = 'portal-uploads' );

-- التعديل والحذف: ملفات المنشأة فقط
create policy storage_update_own_company on storage.objects
  for update to authenticated
  using (
    public.is_super_admin()
    or split_part(name, '/', 1) = public.auth_company_id()::text
  )
  with check (
    public.is_super_admin()
    or split_part(name, '/', 1) = public.auth_company_id()::text
  );

create policy storage_delete_own_company on storage.objects
  for delete to authenticated
  using (
    public.is_super_admin()
    or split_part(name, '/', 1) = public.auth_company_id()::text
  );

-- ---------------------------------------------------------------------
-- الحاوية documents خاصة فعلاً — تأكيد العلامة
-- ---------------------------------------------------------------------
update storage.buckets set public = false
 where id in ('documents','almazen-id-documents','almazen-receipts','subscription-receipts');
