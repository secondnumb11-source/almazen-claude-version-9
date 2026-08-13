-- ============================================================================
-- شموس: اعتماد مستقل لكل فرع — «كل مدير يربط منشأته وفروعه بشكل منفصل»
-- طُبِّق على المشروع drowmezlcrvowuhqmfef بتاريخ 2026-08-13
-- ============================================================================
-- الحالة المقيسة قبل التعديل:
--   shomoos_settings مفتاحها PRIMARY KEY (company_id) وحده، بلا عمود فرع.
--   وشموس تسجّل كل «منشأة سياحية» برقم منشأة ورخصة سياحة مستقلَّين، فالمنشأة
--   ذات فرعين = منشأتان لدى الوزارة — والمخطط لم يكن يستطيع تمثيلهما إطلاقاً.
--
-- ملاحظة على مسار التنفيذ (شفافية):
--   المحاولة الأولى أضافت branch_id وفهرساً فريداً على
--   (company_id, coalesce(branch_id,…)) وتركت المفتاح الأولي على company_id،
--   فبقي العزل بلا أثر عملي. كُشف ذلك بتجربة إدراج أعادت صفاً واحداً بدل
--   ثلاثة — لا بقراءة المخطط. هذا الملف يحمل الشكل الصحيح النهائي.
--
-- الأمان: صفر مفتاح أجنبي وارد إلى الجدول، وصفر صف فيه وقت التعديل.
-- PostgreSQL 17: UNIQUE NULLS NOT DISTINCT يعامل NULL كقيمة واحدة، فيمنع
-- تكرار اعتماد المنشأة الافتراضي دون حيلة COALESCE، ويبقى قيداً حقيقياً
-- يستطيع PostgREST استهدافه في upsert بعمودَيه.
--
-- تحقّق بعد التنفيذ (كله داخل معاملات أُلغيت، صفر بقايا):
--   • منشأة لها فرعان: 3 صفوف بثلاثة أرقام منشآت مستقلة
--     (اعتمادا فرعين + اعتماد المنشأة الافتراضي).
--   • تكرار اعتماد فرع → رُفض. تكرار اعتماد المنشأة (NULL) → رُفض.
--   • الواجهة حيّاً: الصفحة تُحمَّل، 23 صف جاهزية، محدّد الفرع يعرض
--     «اعتماد المنشأة (افتراضي)» + الفرعين، صفر طلب فاشل وصفر خطأ.
-- ============================================================================

ALTER TABLE public.shomoos_settings
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE;

ALTER TABLE public.shomoos_queue
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

-- المفتاح الأولي كان company_id وحده فيمنع أكثر من اعتماد للمنشأة الواحدة.
ALTER TABLE public.shomoos_settings DROP CONSTRAINT IF EXISTS shomoos_settings_pkey;

ALTER TABLE public.shomoos_settings
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.shomoos_settings ADD PRIMARY KEY (id);

ALTER TABLE public.shomoos_settings
  ADD CONSTRAINT shomoos_settings_company_branch_uk
  UNIQUE NULLS NOT DISTINCT (company_id, branch_id);

CREATE INDEX IF NOT EXISTS ix_shomoos_settings_company ON public.shomoos_settings (company_id);
CREATE INDEX IF NOT EXISTS ix_shomoos_settings_branch  ON public.shomoos_settings (branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_shomoos_queue_branch     ON public.shomoos_queue (branch_id)    WHERE branch_id IS NOT NULL;

COMMENT ON COLUMN public.shomoos_settings.branch_id IS
  'الفرع الذي يخصّه هذا الاعتماد. NULL = اعتماد المنشأة الافتراضي. لكل فرع رقم منشأة ورخصة سياحة مستقلَّان لدى شموس.';
