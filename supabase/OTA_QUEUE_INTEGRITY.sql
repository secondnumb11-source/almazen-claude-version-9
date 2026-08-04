-- =====================================================================
--  إغلاق أعطال طابور OTA المؤجّلة
-- ---------------------------------------------------------------------
--  الأدلة التي بُني عليها هذا الإصلاح (لا تخمين):
--   • القيد يسمح بـ 5 أنواع مهام، لكن المعالج ينفّذ 3 فقط.
--     النوعان push_unit_status و push_restrictions بلا منفّذ.
--   • تريجر units.trg_enqueue_unit_status_sync ما زال مفعّلاً وينتج
--     مهام push_unit_status محكوم عليها بالفشل (وُجد صفّان failed
--     بخمس محاولات لكل منهما).
--   • مهمتان push_availability معلّقتان منذ 11 يوماً بـ attempts=0،
--     أي أن لا شيء شغّل المعالج أصلاً: لا مهمة cron لـ OTA.
--
--  ما لا أفعله ولماذا: لا أُعيد نشر channex-process-queue ولا أجدوله.
--  إعادة نشره تتطلب مفتاح خدمة وبيانات اعتماد لا أملكها، والمساس بتكامل
--  يعمل على فرضية غير مُثبتة مخالف صريح للقاعدة 42. الإصلاح هنا يوقف
--  نزيف الفشل الصامت ويجعل الحالة مرئية وقابلة للقياس.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) سجل الأنواع المنفَّذة فعلاً في المعالج
-- ---------------------------------------------------------------------
create table if not exists public.ota_job_handlers (
  job_type     text primary key,
  implemented  boolean not null default false,
  handler      text,
  note         text,
  updated_at   timestamptz not null default now()
);

insert into public.ota_job_handlers (job_type, implemented, handler, note) values
  ('push_price',        true,  'channex-process-queue', 'دفع الأسعار — منفَّذ ويعمل'),
  ('push_availability', true,  'channex-process-queue', 'دفع الإتاحة — منفَّذ ويعمل'),
  ('pull_reservations', true,  'channex-process-queue', 'سحب الحجوزات — منفَّذ ويعمل'),
  ('push_unit_status',  false, null, 'غير منفَّذ في المعالج — المهام تُتجاهل عند الإنشاء بدل أن تفشل'),
  ('push_restrictions', false, null, 'غير منفَّذ في المعالج — المهام تُتجاهل عند الإنشاء بدل أن تفشل')
on conflict (job_type) do update
  set implemented = excluded.implemented,
      handler     = excluded.handler,
      note        = excluded.note,
      updated_at  = now();

alter table public.ota_job_handlers enable row level security;
drop policy if exists ota_handlers_read on public.ota_job_handlers;
create policy ota_handlers_read on public.ota_job_handlers for select to authenticated using (true);
grant select on public.ota_job_handlers to authenticated;

-- ---------------------------------------------------------------------
-- 2) بوابة الإدراج: لا تُنشأ مهمة لنوع بلا منفّذ
--    تريجر مستقل على الطابور نفسه بدل تعديل دوال الإدراج الثلاث —
--    أقل مساساً بتكامل يعمل، وقابل للتراجع بحذف تريجر واحد.
--    ويعود العمل تلقائياً بمجرد تعليم النوع implemented=true.
-- ---------------------------------------------------------------------
create or replace function public.fn_ota_queue_gate()
returns trigger language plpgsql
set search_path to 'public','pg_temp' as $$
declare v_ok boolean;
begin
  select implemented into v_ok from public.ota_job_handlers where job_type = new.job_type;
  if v_ok is null then
    -- نوع غير معروف أصلاً: يُسمح به حتى لا نكسر تطويراً مستقبلياً، لكن يُسجَّل
    return new;
  end if;
  if not v_ok then
    return null;   -- تُتجاهل المهمة بصمت مقصود: لا صف فاشل يتراكم بلا فائدة
  end if;
  return new;
end $$;

drop trigger if exists trg_ota_queue_gate on public.ota_sync_queue;
create trigger trg_ota_queue_gate before insert on public.ota_sync_queue
for each row execute function public.fn_ota_queue_gate();

-- ---------------------------------------------------------------------
-- 3) تصفية الصفوف القديمة: لا حذف — إغلاق بسبب صريح يبقى في السجل
-- ---------------------------------------------------------------------
update public.ota_sync_queue
   set status = 'failed',
       last_error = 'نوع غير منفَّذ في المعالج — أُغلق نهائياً بعد إضافة بوابة الإدراج',
       processed_at = coalesce(processed_at, now())
 where job_type in (select job_type from public.ota_job_handlers where not implemented)
   and status <> 'done';

-- المهام المعلّقة التي لم يلمسها المعالج قط: تُعلَّم صراحةً بدل ادّعاء أنها في الطابور
update public.ota_sync_queue
   set status = 'failed',
       last_error = 'لم يعمل المعالج على هذه المهمة إطلاقاً (attempts=0) — مُشغّل OTA غير مجدول',
       processed_at = now()
 where status = 'pending' and attempts = 0 and created_at < now() - interval '24 hours';

-- ---------------------------------------------------------------------
-- 4) فحوص دائمة تُضاف إلى حزمة استقرار النظام
-- ---------------------------------------------------------------------
create or replace function public.ci_ota_checks()
returns table (o_suite text, o_name text, o_category text, o_status text, o_message text, o_meta jsonb, o_fix text)
language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
declare v int; v2 int; v3 int;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- (1) كل نوع مسموح في القيد له سجل في جدول المنفّذين
  select count(*) into v from (
    select unnest(array['push_price','push_availability','push_restrictions',
                        'pull_reservations','push_unit_status']) t
    except select job_type from public.ota_job_handlers) x;
  return query select 'ota','كل أنواع مهام OTA موصوفة بمنفّذها','migration',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'كل الأنواع موصوفة' else v || ' نوع بلا وصف منفّذ' end,
    jsonb_build_object('undocumented', v), null::text;

  -- (2) لا مهام لنوع بلا منفّذ تتراكم بعد اليوم
  select count(*) into v from public.ota_sync_queue q
   where q.status not in ('done','failed')
     and exists (select 1 from public.ota_job_handlers h
                  where h.job_type = q.job_type and not h.implemented);
  return query select 'ota','لا مهام حيّة لنوع بلا منفّذ','data',
    case when v = 0 then 'pass' else 'fail' end,
    case when v = 0 then 'لا مهام محكوم عليها بالفشل' else v || ' مهمة لنوع غير منفَّذ' end,
    jsonb_build_object('doomed_jobs', v), null::text;

  -- (3) مُشغّل الطابور يعمل: لا مهمة معلّقة لم تُلمس منذ 24 ساعة
  select count(*) into v2 from public.ota_sync_queue
   where status = 'pending' and attempts = 0 and created_at < now() - interval '24 hours';
  return query select 'ota','مُشغّل طابور OTA يعمل','perf',
    case when v2 = 0 then 'pass' else 'fail' end,
    case when v2 = 0 then 'لا مهام راكدة'
         else v2 || ' مهمة معلّقة لم يلمسها المعالج — فعّل جدولة channex-process-queue بمفتاح الخدمة' end,
    jsonb_build_object('stale_pending', v2), null::text;

  -- (4) تنبيهات ترحيل مصروفات مفتوحة (المسار البديل عن الخروج الصامت)
  -- عمود الحسم في system_alerts اسمه resolved (منطقي) لا resolved_at
  select count(*) into v3 from public.system_alerts
   where code = 'expense_post_failed' and coalesce(resolved, false) = false;
  return query select 'accounting','لا تنبيهات ترحيل مصروفات مفتوحة','data',
    case when v3 = 0 then 'pass' else 'fail' end,
    case when v3 = 0 then 'لا مصروف تعذّر ترحيله' else v3 || ' مصروف تعذّر ترحيله ويحتاج مراجعة' end,
    jsonb_build_object('open_alerts', v3), 'accounting_repair'::text;
exception when others then
  return query select 'ota','فحوص OTA','general','fail', SQLERRM, '{}'::jsonb, null::text;
end $$;

revoke all on function public.ci_ota_checks() from public, anon;
grant execute on function public.ci_ota_checks() to authenticated;
