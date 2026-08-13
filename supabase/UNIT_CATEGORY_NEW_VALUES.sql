-- ============================================================================
-- تصنيفات وحدات جديدة + إصلاح تصنيف كانت الواجهة تعرضه والقاعدة ترفضه
-- طُبِّق على المشروع drowmezlcrvowuhqmfef بتاريخ 2026-08-13
-- ============================================================================
-- units.category نوع ENUM اسمه unit_category، لا نص حر ولا CHECK. كان يحوي
-- أربع قيم فقط: apartment · chalet · furnished_unit · hotel_room
-- بينما CATS في الواجهة يعرض خمسة، منها furnished_room («غرفة مفروشة»)
-- غير موجود في النوع إطلاقاً.
--
-- أُثبت العطل بتجربة غير مدمّرة قبل أي تعديل:
--   select 'furnished_room'::unit_category
--   → ERROR 22P02: invalid input value for enum unit_category
-- أي أن كل من اختار «غرفة مفروشة» من القائمة كان حفظه يفشل.
--
-- الإضافة محضة (ADD VALUE IF NOT EXISTS): لا صف قائم يتغيّر، ولا استعلام
-- ولا سياسة RLS ولا فهرس يتأثر — شرطا القاعدة 54 متحققان.
--
-- تحقّق بعد التنفيذ:
--   • القيم الأربع تُقبل بالتحويل الصريح.
--   • 31 وحدة قائمة بلا تغيير قبل وبعد.
--   • إدراج فعلي للتصنيفات الأربعة داخل معاملة ثم rollback: نجح الإدراج،
--     وصفر بقايا بعده (leftover_probes = 0، الإجمالي 31 كما كان).
-- ============================================================================

ALTER TYPE public.unit_category ADD VALUE IF NOT EXISTS 'furnished_room';
ALTER TYPE public.unit_category ADD VALUE IF NOT EXISTS 'furnished_villa';
ALTER TYPE public.unit_category ADD VALUE IF NOT EXISTS 'residential_villa';
ALTER TYPE public.unit_category ADD VALUE IF NOT EXISTS 'rest_house';
