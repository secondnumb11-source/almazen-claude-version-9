-- ============================================================================
-- BRANCH_SCOPE_AND_SUBSCRIPTION_GUARD.sql
-- تصحيحان أمنيان مكتشفان أثناء الفحص الشامل:
--  1) قائمة الفروع كانت مرئية لكل مستخدمي المنشأة حتى لو كان الموظف مُسنداً
--     لفرع واحد فقط — الآن تُقيَّد القراءة بـ branch_visible().
--  2) كان بإمكان مالك المنشأة تعديل حقول الاشتراك مباشرة (plan /
--     subscription_ends_at / trial_ends_at) وتفعيل اشتراكه بنفسه —
--     الآن تُحرس هذه الحقول ولا تُقبل إلا من super admin أو من الدوال
--     الإدارية / المشغّل الخلفي.
-- التنفيذ آمن ومتكرر (idempotent) ولا يغيّر أي سلوك مشروع قائم.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) نطاق الفروع في القراءة
-- ---------------------------------------------------------------------------
drop policy if exists branches_branch_scope on public.branches;
create policy branches_branch_scope on public.branches
  as restrictive for select to authenticated
  using (
    public.is_super_admin()
    or public.can_manage_branches()   -- المالك/المدير يحتاج القائمة الكاملة للإسناد
    or public.branch_visible(id)      -- الموظف يرى فروعه المُسندة فقط
  );

-- ---------------------------------------------------------------------------
-- 2) حراسة حقول الاشتراك على جدول companies
-- ---------------------------------------------------------------------------
create or replace function public.guard_company_subscription_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- يُسمح بالتغيير في الحالات التالية فقط:
  --  * المشغّل الخلفي / service_role (لا يوجد auth.uid)
  --  * super admin
  --  * تغيير قادم من مشغّل آخر مثل referral_apply_bonus_on_payment
  if auth.uid() is null
     or public.is_super_admin()
     or pg_trigger_depth() > 1
  then
    return new;
  end if;

  -- خلاف ذلك: تُعاد حقول الاشتراك لقيمها السابقة بصمت،
  -- حتى لا تنكسر تحديثات البيانات العادية (الاسم، الشعار، البريد...).
  new.plan                 := old.plan;
  new.trial_ends_at        := old.trial_ends_at;
  new.subscription_ends_at := old.subscription_ends_at;
  new.subscription_end     := old.subscription_end;
  return new;
end;
$$;

drop trigger if exists trg_guard_company_subscription on public.companies;
create trigger trg_guard_company_subscription
  before update on public.companies
  for each row execute function public.guard_company_subscription_fields();
