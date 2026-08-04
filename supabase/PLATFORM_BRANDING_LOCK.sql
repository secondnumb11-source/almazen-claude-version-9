-- ============================================================================
--  تثبيت هوية وشعار منصة المازن — مصدر واحد دائم في قاعدة البيانات
--  الهدف: منع ظهور شعار أي منصة أخرى (مثل شعار Lovable) في المتصفح أو عند
--         النشر على Vercel، وتثبيت مسارات الأيقونة بشكل دائم.
--  آمن للتنفيذ أكثر من مرة (idempotent) ولا يمسّ أي جدول أو سياسة قائمة.
-- ============================================================================

create table if not exists public.platform_branding (
  id boolean primary key default true check (id),
  app_name text not null default 'المازن — إدارة الوحدات السكنية والشاليهات',
  short_name text not null default 'المازن',
  favicon_ico text not null default '/favicon.ico',
  favicon_png text not null default '/favicon.png',
  favicon_192 text not null default '/favicon-192.png',
  favicon_512 text not null default '/favicon-512.png',
  logo_path text not null default '/almazen-logo.png',
  locked boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.platform_branding (id) values (true) on conflict (id) do nothing;

-- تحديث القيم المعتمدة (بدون كسر أي قيمة إضافية موجودة)
update public.platform_branding
   set app_name    = 'المازن — إدارة الوحدات السكنية والشاليهات',
       short_name  = 'المازن',
       favicon_ico = '/favicon.ico',
       favicon_png = '/favicon.png',
       favicon_192 = '/favicon-192.png',
       favicon_512 = '/favicon-512.png',
       logo_path   = '/almazen-logo.png',
       locked      = true,
       updated_at  = now()
 where id;

grant select on public.platform_branding to authenticated, anon;
grant all on public.platform_branding to service_role;
alter table public.platform_branding enable row level security;

drop policy if exists pb_select on public.platform_branding;
create policy pb_select on public.platform_branding for select to authenticated, anon using (true);

-- التعديل مقصور على السوبر أدمن فقط
drop policy if exists pb_update on public.platform_branding;
create policy pb_update on public.platform_branding for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- حارس دائم: يمنع تفريغ مسارات الأيقونة أو استبدالها بشعار جهة أخرى
create or replace function public.platform_branding_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.locked is not true then
    raise exception 'BRANDING_LOCKED: شعار منصة المازن مثبَّت ولا يمكن إلغاء التثبيت';
  end if;
  if coalesce(btrim(new.favicon_ico),'') = '' or coalesce(btrim(new.favicon_png),'') = ''
     or coalesce(btrim(new.favicon_192),'') = '' or coalesce(btrim(new.logo_path),'') = '' then
    raise exception 'BRANDING_LOCKED: مسارات شعار المنصة مطلوبة';
  end if;
  if lower(new.favicon_ico || new.favicon_png || new.favicon_192 || new.favicon_512 || new.logo_path)
     ~ '(lovable|gpteng|placeholder)' then
    raise exception 'BRANDING_LOCKED: لا يجوز استخدام شعار جهة أخرى بدل شعار المازن';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_platform_branding_guard on public.platform_branding;
create trigger trg_platform_branding_guard
  before insert or update on public.platform_branding
  for each row execute function public.platform_branding_guard();

-- منع الحذف نهائياً
drop policy if exists pb_no_delete on public.platform_branding;
create policy pb_no_delete on public.platform_branding for delete to authenticated using (false);

-- قراءة الهوية من التطبيق
create or replace function public.platform_branding_get()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(b) from public.platform_branding b where b.id
$$;
grant execute on function public.platform_branding_get() to authenticated, anon;
