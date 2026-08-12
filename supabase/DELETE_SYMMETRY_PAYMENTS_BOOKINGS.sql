-- ============================================================================
-- إصلاح: غياب نظير الحذف لمشغّلات الإدراج على payments و bookings
-- طُبّقت على المشروع drowmezlcrvowuhqmfef بتاريخ 2026-08-12
-- ============================================================================
--
-- كيف اكتُشف: باختبار كتابة حيّة كامل (عميل ← حجز ← دفعة ← حذف)، لا بفحص ساكن.
-- لم يكن أي تحليل للشيفرة ليكشفه، لأن الخلل في تماثل المشغّلات لا في الشيفرة.
--
-- السبب الجذري:
--   trg_payment_auto_post تعمل AFTER INSERT فقط.
--   trg_sync_unit_status تعمل BEFORE INSERT OR UPDATE OF status فقط.
--   لا نظير لأيٍّ منهما عند DELETE. لذلك:
--     (1) حذف دفعة يترك قيدها المحاسبي التلقائي حيّاً — إيراد مُثبَت في الدفاتر
--         بلا دفعة خلفه، أي تضخيم إيرادات.
--     (2) حذف حجز يترك الوحدة عالقة على 'reserved' بلا أي حجز نشط، فلا تُؤجَّر.
--
--   هذا يفسّر وجود unit_status_resync و voucher_backfill_ledger في المشروع:
--   عِلاجات دورية للعَرَض، لا منع للسبب.
--
-- الإصلاح: مشغّلا حذف متماثلان مع مشغّلي الإدراج القائمين — لا أكثر.
--   • حذف دفعة: يُحذف القيد التلقائي الخاص بها حصراً (source_type='payment'
--     و source_id = old.id). القيود اليدوية لا تُمسّ. الأسطر تُحذف بـ
--     ON DELETE CASCADE القائم على journal_entry_lines، وسند القبض بـ CASCADE
--     القائم على vouchers.payment_id.
--   • حذف حجز: تعود الوحدة 'available' فقط إذا لم يبقَ عليها أي حجز نشط —
--     نفس شرط unit_status_resync القائم، فلا يتغيّر منطق قائم.
--
-- التحقق المسبق (شرطا القاعدة 54):
--   • التطبيق لا يحذف حجوزات ولا دفعات في أي مسار واجهة (الإلغاء بتغيير الحالة).
--   • السلوك الحالي عند الحذف فاسد أصلاً، فلا سلوك سليم يعتمد عليه أحد.
--   • الأثر على الأداء معدوم: تنفيذ لكل صف عند الحذف فقط، وهو نادر.
--
-- التحقق بعد التنفيذ — دورة حيّة كاملة أُعيدت بعد الإصلاح:
--   القيود 81 ← 81 · قيود يتيمة 0 · سندات يتيمة 0 · وحدات متاحة 15 ← 15
--   وحدات عالقة 0 · قيود غير متوازنة 0 · سطور يتيمة 0 · إيرادات الشهر 1882 ثابتة
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_payment_delete_unpost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
begin
  -- القيد التلقائي لهذه الدفعة حصراً — الأسطر والسند يُنظَّفان بالـ CASCADE القائم.
  delete from public.journal_entries
   where source_type = 'payment'
     and source_id = old.id;
  return old;
end
$function$;

DROP TRIGGER IF EXISTS trg_payment_delete_unpost ON public.payments;
CREATE TRIGGER trg_payment_delete_unpost
  AFTER DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_payment_delete_unpost();

CREATE OR REPLACE FUNCTION public.fn_booking_delete_free_unit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
begin
  if old.unit_id is null then
    return old;
  end if;
  update public.units u
     set status = 'available'::unit_status
   where u.id = old.unit_id
     and u.status in ('reserved'::unit_status, 'reserved_online'::unit_status, 'occupied'::unit_status)
     and not exists (
       select 1 from public.bookings b
        where b.unit_id = u.id
          and b.id <> old.id
          and b.status in ('pending'::booking_status, 'confirmed'::booking_status, 'checked_in'::booking_status)
     );
  return old;
end
$function$;

DROP TRIGGER IF EXISTS trg_booking_delete_free_unit ON public.bookings;
CREATE TRIGGER trg_booking_delete_free_unit
  AFTER DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.fn_booking_delete_free_unit();
