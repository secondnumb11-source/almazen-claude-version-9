-- ============================================================================
-- إصلاح: مفاتيح أجنبية ناقصة في discount_requests
-- طُبّقت على المشروع drowmezlcrvowuhqmfef بتاريخ 2026-08-12
-- ============================================================================
--
-- الخلل:
--   جدول discount_requests كان يملك مفتاحاً أجنبياً واحداً فقط
--   (discount_requests_customer_id_fkey)، بينما booking_id و requested_by
--   بلا مفاتيح. ولمّا كانت PostgREST تشتقّ علاقات التضمين من المفاتيح
--   الأجنبية حصراً، كان استعلام واجهة الموافقة على الخصومات
--   (src/components/DiscountApprovals.jsx) يفشل كاملاً بخطأ:
--     PGRST200 — Could not find a relationship between
--     'discount_requests' and 'bookings' in the schema cache
--   فلا تظهر أي طلبات خصم في الواجهة إطلاقاً.
--
-- التحقق قبل التنفيذ (شرطا القاعدة 54):
--   • صفر صفوف يتيمة في booking_id و unit_id و requested_by و reviewed_by
--     و company_id — فالقيد يُثبَّت دون رفض أي صف قائم.
--   • التطبيق لا يحذف حجوزات ولا ملفات شخصية إطلاقاً (الإلغاء يتم بتغيير
--     الحالة)، فسلوك ON DELETE لا يغيّر أي مسار قائم.
--   • requested_by يُكتب دائماً بقيمة profile.id في مواضع الكتابة الثلاثة
--     (AccountSettings.jsx · EmployeeOps.jsx · Units.jsx).
--
-- سلوك الحذف مطابق لعُرف المخطط القائم:
--   • التابع للحجز → CASCADE (كما payments و payment_schedules و
--     service_requests).
--   • عمود الفاعل → بلا ON DELETE (كما invoices_issued_by_fkey و
--     payments_received_by_fkey و journal_entries_created_by_fkey).
--
-- التحقق بعد التنفيذ: استعلام DiscountApprovals نفسه صار HTTP 200.
-- ============================================================================

ALTER TABLE public.discount_requests
  ADD CONSTRAINT discount_requests_booking_id_fkey
  FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;

ALTER TABLE public.discount_requests
  ADD CONSTRAINT discount_requests_requested_by_fkey
  FOREIGN KEY (requested_by) REFERENCES public.profiles(id);

-- فهرس على عمود الربط كي لا يُبطئ المفتاح الجديد عمليات الحذف على الأب.
CREATE INDEX IF NOT EXISTS idx_discount_requests_booking_id
  ON public.discount_requests (booking_id);
