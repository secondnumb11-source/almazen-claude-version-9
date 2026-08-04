-- إصلاحات انحراف المخطط المكتشفة خلال الفحص الحي
-- 1) عمود إعدادات المستخدم (تنسيق لوحة التحكم وتفضيلات الواجهة)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- تحديث ذاكرة مخطط الـ Data API
NOTIFY pgrst, 'reload schema';

-- ملاحظات (تم إصلاحها في الكود لا في المخطط):
--   * جدول payments يستخدم العمود "method" وليس "payment_method"
--     (تم تصحيح الاستعلامات في AccountantTools.jsx و AdvancedAnalytics.jsx).
--   * جدول customers لا يحتوي عمود "name" — الاسم هو "full_name"
--     (تم تصحيح مسبار اختبار العزل في src/lib/isolationSuite.js).
