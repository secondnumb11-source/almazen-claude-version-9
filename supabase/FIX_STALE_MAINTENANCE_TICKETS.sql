-- =====================================================================
--  تصحيح: ظهور رمز "صيانة" على وحدات حالتها (متاحة)
--  السبب: بقاء طلبات صيانة بحالة open/in_progress لوحدات عادت متاحة.
--  الملف Idempotent — آمن لإعادة التنفيذ على جميع الحسابات.
--  ملاحظة: التريجر public.close_maintenance_on_available يغلق الطلبات
--  تلقائياً عند تحويل الوحدة إلى available مستقبلاً (الحسابات الجديدة).
-- =====================================================================

UPDATE public.maintenance_requests mr
   SET status = 'done'::maintenance_status
  FROM public.units u
 WHERE u.id = mr.unit_id
   AND u.status = 'available'::unit_status
   AND mr.status IN ('open'::maintenance_status, 'in_progress'::maintenance_status);
