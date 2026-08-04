-- ============================================================================
-- BRANCH_RBAC_HARDENING.sql
-- تحصين الصلاحيات وعزل الحسابات (Multi-tenant isolation) — نظام المازن
-- ----------------------------------------------------------------------------
-- سبب الملف: اختبار حقيقي بجلسة مستخدم فعلية أثبت أن أي مستخدم مسجّل يستطيع:
--   1) تعديل profiles.role الخاص به إلى "owner"  → تصعيد صلاحيات داخل المنشأة
--   2) تعديل profiles.company_id إلى منشأة أخرى → اختراق عزل الحسابات بالكامل
-- الإصلاح أدناه يمنع الحالتين على مستوى قاعدة البيانات (لا يمكن الالتفاف عليه
-- من الواجهة أو من أي عميل خارجي يستخدم المفتاح العام).
-- شغّل هذا الملف في SQL Editor داخل مشروع Supabase.
-- ============================================================================

-- 1) دالة أدوار آمنة (SECURITY DEFINER) لتجنّب التكرار اللانهائي في السياسات
create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role::text from public.profiles where id = auth.uid()
$$;

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid()
$$;

create or replace function public.can_manage_branches()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() in ('owner','manager'), false)
$$;

grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_company_id() to authenticated;
grant execute on function public.can_manage_branches() to authenticated;

-- 2) تجميد الحقول الحسّاسة في profiles (الدور + المنشأة + حالة التفعيل)
--    لا يمكن لأي مستخدم ترقية نفسه أو الانتقال لمنشأة أخرى.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  actor_company uuid;
begin
  -- service_role وعمليات النظام تمر بدون قيود
  if auth.uid() is null then
    return new;
  end if;

  select role::text, company_id into actor_role, actor_company
    from public.profiles where id = auth.uid();

  -- منع تغيير المنشأة نهائياً من واجهة المستخدم
  if new.company_id is distinct from old.company_id then
    raise exception 'تغيير المنشأة غير مسموح (عزل الحسابات).' using errcode = '42501';
  end if;

  -- الدور وحالة التفعيل: يعدّلهما المالك/المدير داخل نفس المنشأة فقط، ولا يعدّل أحد دوره بنفسه
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    if auth.uid() = old.id then
      raise exception 'لا يمكن تعديل دورك أو حالتك بنفسك.' using errcode = '42501';
    end if;
    if actor_role not in ('owner','manager') or actor_company is distinct from old.company_id then
      raise exception 'تعديل الأدوار متاح لمالك المنشأة أو المدير داخل نفس المنشأة فقط.' using errcode = '42501';
    end if;
    -- لا يجوز منح دور owner إلا من مالك
    if new.role::text = 'owner' and actor_role <> 'owner' then
      raise exception 'منح دور المالك متاح للمالك فقط.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_profile_privileges on public.profiles;
create trigger trg_protect_profile_privileges
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

-- 3) منع إدراج ملف تعريف بمنشأة لا تخص المُنشئ
create or replace function public.protect_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  actor_company uuid;
begin
  if auth.uid() is null or auth.uid() = new.id then
    return new; -- التسجيل الذاتي / trigger النظام
  end if;
  select role::text, company_id into actor_role, actor_company
    from public.profiles where id = auth.uid();
  if actor_role not in ('owner','manager') then
    raise exception 'إنشاء الحسابات متاح لمالك المنشأة أو المدير فقط.' using errcode = '42501';
  end if;
  if new.company_id is distinct from actor_company then
    raise exception 'إنشاء حساب خارج منشأتك غير مسموح.' using errcode = '42501';
  end if;
  if new.role::text = 'owner' and actor_role <> 'owner' then
    raise exception 'منح دور المالك متاح للمالك فقط.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_insert on public.profiles;
create trigger trg_protect_profile_insert
  before insert on public.profiles
  for each row execute function public.protect_profile_insert();

-- 4) سياسات الفروع: القراءة لكل أعضاء المنشأة، الكتابة للمالك/المدير فقط
alter table public.branches enable row level security;

drop policy if exists "branches_select_company" on public.branches;
create policy "branches_select_company" on public.branches
  for select to authenticated
  using (company_id = public.current_company_id());

drop policy if exists "branches_insert_managers" on public.branches;
create policy "branches_insert_managers" on public.branches
  for insert to authenticated
  with check (company_id = public.current_company_id() and public.can_manage_branches());

drop policy if exists "branches_update_managers" on public.branches;
create policy "branches_update_managers" on public.branches
  for update to authenticated
  using (company_id = public.current_company_id() and public.can_manage_branches())
  with check (company_id = public.current_company_id() and public.can_manage_branches());

drop policy if exists "branches_delete_managers" on public.branches;
create policy "branches_delete_managers" on public.branches
  for delete to authenticated
  using (company_id = public.current_company_id() and public.can_manage_branches());

-- 5) سياسات الإسناد user_branches: الكتابة للمالك/المدير وداخل فروع منشأته فقط
alter table public.user_branches enable row level security;

drop policy if exists "user_branches_select" on public.user_branches;
create policy "user_branches_select" on public.user_branches
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.branches b
      where b.id = user_branches.branch_id
        and b.company_id = public.current_company_id()
    )
  );

drop policy if exists "user_branches_write_managers" on public.user_branches;
create policy "user_branches_write_managers" on public.user_branches
  for all to authenticated
  using (
    public.can_manage_branches() and exists (
      select 1 from public.branches b
      where b.id = user_branches.branch_id and b.company_id = public.current_company_id()
    )
  )
  with check (
    public.can_manage_branches()
    and exists (
      select 1 from public.branches b
      where b.id = user_branches.branch_id and b.company_id = public.current_company_id()
    )
    and exists (
      select 1 from public.profiles p
      where p.id = user_branches.user_id and p.company_id = public.current_company_id()
    )
  );

-- 6) صلاحيات Data API (بدون anon — لا شيء من هذه الجداول عام)
grant select, insert, update, delete on public.branches to authenticated;
grant select, insert, update, delete on public.user_branches to authenticated;
grant all on public.branches to service_role;
grant all on public.user_branches to service_role;

-- ============================================================================
-- تحقق سريع بعد التشغيل (يجب أن تفشل كل المحاولات التالية لمستخدم عادي):
--   update profiles set role='owner' where id = auth.uid();
--   update profiles set company_id='<منشأة أخرى>' where id = auth.uid();
--   insert into branches(name, company_id) values ('x', '<منشأة أخرى>');
-- ============================================================================
