-- =====================================================================
--  تفضيلات واجهة المستخدم — مقاس مربعات الوحدات
--  ينفَّذ مرة واحدة على قاعدة البيانات (SQL Editor في Supabase).
--
--  الجدول public.user_ui_settings منشأ مسبقاً في
--  supabase/ISOLATION_MONITOR_AND_SIDEBAR_RAIL.sql — هنا نضيف عموداً
--  واحداً يحفظ مقاس مربعات الوحدات لكل مستخدم على حدة، حتى لا يعيد
--  المستخدم ضبط المقاس عند كل تسجيل دخول أو من جهاز آخر.
--
--  ملاحظة: التطبيق يعمل بدون هذا العمود (يرجع للتخزين المحلي في
--  المتصفح)، لكن بدونه لا ينتقل الإعداد بين الأجهزة.
-- =====================================================================

-- الجدول موجود مسبقاً؛ هذا احتياط إن نُفّذ هذا الملف أولاً.
create table if not exists public.user_ui_settings (
  user_id    uuid primary key default auth.uid(),
  updated_at timestamptz not null default now()
);

-- ⚠️ يجب أن تطابق هذه القيم DEFAULT_UNIT_GRID في src/hooks/useUnitCardSize.js.
-- أي اختلاف يعني أن المستخدم الجديد يبدأ بمقاس مخالف للمقاس المقصود في الواجهة.
alter table public.user_ui_settings
  add column if not exists units_grid jsonb not null default jsonb_build_object(
    'preset', 'sm',
    'width',  190,
    'scale',  0.91
  );

-- مواءمة العمود إن كان قد أُنشئ سابقاً بالقيم القديمة (md/220)
alter table public.user_ui_settings
  alter column units_grid set default jsonb_build_object(
    'preset', 'sm',
    'width',  190,
    'scale',  0.91
  );

-- الصفوف التي حملت الافتراضي القديم تلقائياً (لا اختيار حقيقي من المستخدم)
update public.user_ui_settings
set units_grid = jsonb_build_object('preset', 'sm', 'width', 190, 'scale', 0.91)
where units_grid->>'preset' = 'md' and (units_grid->>'width')::int = 220;

comment on column public.user_ui_settings.units_grid is
  'مقاس مربعات الوحدات لكل مستخدم: preset (المقاس الجاهز) و width (عرض العمود بالبكسل) و scale (مقياس المحتوى).';

-- الصلاحيات وسياسة العزل مطبَّقة على مستوى الجدول في الملف الأصلي،
-- ونؤكدها هنا حتى يكون هذا الملف صالحاً للتنفيذ منفرداً.
grant select, insert, update on public.user_ui_settings to authenticated;
grant all on public.user_ui_settings to service_role;

alter table public.user_ui_settings enable row level security;

drop policy if exists "ui settings own" on public.user_ui_settings;
create policy "ui settings own"
  on public.user_ui_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
