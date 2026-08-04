-- =====================================================================
--  تثبيت التصميم الفاخر لمسطرة الحركة الطولية (الإصدار 3)
--  ينفَّذ مرة واحدة في: Supabase → SQL Editor
--
--  الهدف: ألا يعود المظهر الافتراضي القديم للمسطرة مرة أخرى — لا للمستخدمين
--  الجدد (عبر default العمود) ولا للمستخدمين الذين حُفظ لهم تصميم أقدم
--  (عبر تحديث الصفوف القائمة).
--
--  ملاحظة: التطبيق يرقّي الإعداد تلقائياً عند أول تحميل لكل مستخدم
--  (انظر RAIL_DESIGN_VERSION في src/hooks/useSidebarRailSettings.js)،
--  لكن تنفيذ هذا الملف يُنجز الترقية دفعة واحدة لكل الحسابات فوراً.
-- =====================================================================

-- 1) التصميم المعتمد لأي مستخدم جديد
alter table public.user_ui_settings
  alter column sidebar_rail set default jsonb_build_object(
    'accent',    '#E7C765',
    'accent2',   '#0B1E3F',
    'thickness', 3,
    'height',    68,
    'glow',      62,
    'radius',    999,
    'style',     'gem',
    'v',         3
  );

-- 2) ترقية كل صف محفوظ بإصدار أقدم من 3 إلى التصميم المعتمد
update public.user_ui_settings
set sidebar_rail = jsonb_build_object(
      'accent',    '#E7C765',
      'accent2',   '#0B1E3F',
      'thickness', 3,
      'height',    68,
      'glow',      62,
      'radius',    999,
      'style',     'gem',
      'v',         3
    )
where coalesce((sidebar_rail ->> 'v')::int, 0) < 3;

comment on column public.user_ui_settings.sidebar_rail is
  'تصميم مسطرة الحركة الطولية لكل مستخدم. الحقل v هو إصدار التصميم: أي قيمة أقل من الإصدار الحالي في التطبيق تُستبدل تلقائياً بالتصميم المعتمد.';
