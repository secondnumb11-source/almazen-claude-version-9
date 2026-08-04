-- ============================================================================
--  مزامنة قائمة السوبر أدمن — منصة المازن
--  الهدف: ضمان أن الصلاحية العليا تُقرأ من مصدر واحد فقط:
--         الدالة public.super_admin_emails()
--  آمن للتنفيذ أكثر من مرة (idempotent) ولا يمسّ أي جدول أو سياسة قائمة.
-- ============================================================================

-- 1) القائمة المعتمدة (تحتوي motazsalah1016@gmail.com)
create or replace function public.super_admin_emails()
returns text[] language sql immutable set search_path = public, pg_temp as $$
  SELECT ARRAY[
    'shadysalahshadysalah@gmail.com',
    'info.almazen.platform@gmail.com',
    'sh.abdelwahab@nes-sa.com',
    'motazsalah1016@gmail.com',
    'moatazsalah1016@gmail.com',
    'secondnumb11@gmail.com',
    'shadyabdelwahabksa@gmail.com',
    'shadyabdelwahab99@gmail.com'
  ]::text[];
$$;

grant execute on function public.super_admin_emails() to authenticated, anon;

-- 2) ربط is_super_admin بالقائمة المركزية — فقط إذا لم تكن مرتبطة بها أصلاً.
--    هذا الشرط يمنع أي كسر لتعريف قائم يعمل بشكل صحيح.
do $$
declare v_def text;
begin
  begin
    v_def := pg_get_functiondef('public.is_super_admin()'::regprocedure);
  exception when others then
    v_def := null;
  end;

  if v_def is null or position('super_admin_emails' in v_def) = 0 then
    execute $fn$
      create or replace function public.is_super_admin()
      returns boolean language sql stable security definer
      set search_path = public, pg_temp as $body$
        select exists (
          select 1 from auth.users u
           where u.id = auth.uid()
             and lower(u.email) = any (
               select lower(e) from unnest(public.super_admin_emails()) e
             )
        )
      $body$;
    $fn$;
    execute 'grant execute on function public.is_super_admin() to authenticated, anon';
    raise notice 'is_super_admin() rebuilt from super_admin_emails()';
  else
    raise notice 'is_super_admin() already reads super_admin_emails() — no change';
  end if;
end $$;
