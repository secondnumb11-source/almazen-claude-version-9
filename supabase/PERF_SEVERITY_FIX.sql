-- =====================================================================
--  إصلاح تصنيف خطورة الأداء — كان يُطلق «حرج» على جداول لا مشكلة فيها
-- ---------------------------------------------------------------------
--  الدليل من إحصاءات الإنتاج (pg_stat_user_tables):
--    profiles   35 صفاً · 112 كيلوبايت · 1,344,352 مسح تسلسلي → صُنّف «حرج»
--    customers  19 صفاً · 216 كيلوبايت                        → «حرج»
--    bookings   31 صفاً · 280 كيلوبايت                        → «حرج»
--    units      31 صفاً · 232 كيلوبايت                        → «حرج»
--
--  لماذا هذا خطأ: PostgreSQL يختار المسح التسلسلي لجدول يسع صفحة أو
--  صفحتين لأنه أسرع من قراءة الفهرس ثم الجدول. المسح التسلسلي على 35 صفاً
--  ليس بطئاً — بل هو الخطة المثلى التي يختارها المخطِّط عمداً.
--
--  أثر العطل على المستخدم: «إصلاح» يضيف فهارس لا تُستعمل، فتظهر رسالة
--  نجاح ثم يعود التحذير نفسه عند إعادة الفحص — وهو بالضبط ما اشتكى منه
--  المستخدم: «يظهر رسالة وهمية أنه تم الإصلاح ولكن عند إعادة الفحص يظهر
--  نفس الخطأ».
--
--  الإصلاح: التصنيف بتكلفة المسح الحقيقية (حجم الجدول × عدد المسحات)
--  بدل عدد المسحات وحده، مع حدّ أدنى لحجم الجدول تحته لا معنى للفهرسة.
--  الدالة للقراءة فقط — لا تُعدّل بيانات ولا سياسات، فلا خطر على النظام.
-- =====================================================================

create or replace function public.ci_perf_scan()
returns table (o_kind text, o_target text, o_metric text, o_detail text, o_severity text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden: super admin only' using errcode = '42501';
  end if;

  -- (أ) فهارس ناقصة على أعمدة الربط — تُصنَّف بحجم الجدول لا بوجودها فقط
  return query
  select 'missing_index'::text,
         (c.relname || '.' || a.attname)::text,
         coalesce(s.n_live_tup, 0)::text || ' صف',
         ('مسح تسلسلي: ' || coalesce(s.seq_scan, 0)::text)::text,
         (case when coalesce(s.n_live_tup,0) > 5000 then 'high'
               when coalesce(s.n_live_tup,0) > 1000 then 'medium'
               else 'low' end)::text
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid
  left join pg_stat_user_tables s on s.relid = c.oid
  where ns.nspname = 'public' and c.relkind = 'r'
    and a.attname in ('company_id','branch_id','booking_id','unit_id','customer_id',
                      'entry_id','source_id','user_id','account_id','payment_id','expense_id')
    and a.attnum > 0 and not a.attisdropped
    and not exists (select 1 from pg_index i
                     where i.indrelid = c.oid and i.indkey[0] = a.attnum);

  -- (ب) مسح تسلسلي مُكلف فعلاً — لا مجرد متكرر
  --     الشرط: الجدول أكبر من 8 صفحات (64 كيلوبايت) وفيه 1000 صف فأكثر،
  --     فتحته يفضّل المخطِّط المسح التسلسلي عمداً وإضافة فهرس لا تنفع.
  return query
  select 'seq_scan'::text, st.relname::text,
         st.seq_scan::text || ' مسح',
         ('فهرسي: ' || coalesce(st.idx_scan,0)::text
          || ' — صفوف: ' || st.n_live_tup::text
          || ' — حجم: ' || pg_size_pretty(pg_total_relation_size(st.relid)))::text,
         (case when st.seq_scan::bigint * st.n_live_tup > 50000000 then 'high'
               when st.seq_scan::bigint * st.n_live_tup > 5000000  then 'medium'
               else 'low' end)::text
  from pg_stat_user_tables st
  where st.schemaname = 'public'
    and st.seq_scan > 200
    and st.n_live_tup >= 1000
    and pg_total_relation_size(st.relid) > 65536;
end $$;
revoke all on function public.ci_perf_scan() from public, anon;
grant execute on function public.ci_perf_scan() to authenticated;

comment on function public.ci_perf_scan() is
  'فحص أداء يصنّف بالتكلفة الحقيقية (حجم × مسحات) لا بعدد المسحات وحده — يمنع إنذارات «حرج» على جداول صغيرة يختار لها المخطِّط المسح التسلسلي عمداً.';
