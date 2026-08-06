-- =====================================================================
--  اختبار سرعة حقيقي — يقيس زمن تنفيذ فعلي، لا عدد مسحات
-- ---------------------------------------------------------------------
--  لماذا كان الاختبار السابق غير حقيقي:
--    كان يعدّ المسوحات التسلسلية ويصنّفها «حرجاً» بلا نظر لحجم الجدول.
--    وبأرقام الإنتاج: profiles 35 صفاً، customers 19، bookings 31 —
--    وهي أحجام يختار لها PostgreSQL المسح التسلسلي عمداً لأنه أسرع من
--    الفهرس. فالتحذير كاذب، و«الإصلاح» بإضافة فهارس لا يُسرّع شيئاً،
--    فيعود التحذير بعد كل إصلاح.
--
--  هذا الاختبار يقيس ما يشعر به المستخدم فعلاً: زمن تنفيذ الاستعلامات
--  التي تفتحها الصفحات الثقيلة، بالمللي ثانية، على بيانات حقيقية.
--
--  الإصلاح المصاحب لا يلمس بيانات ولا سياسات ولا مخططاً:
--    ANALYZE لتحديث إحصاءات المخطِّط + فهارس على الجداول الكبيرة فقط.
--  كلاهما آمن ولا يكسر أي قسم، ويسري على كل المنشآت الحالية والجديدة.
-- =====================================================================

create or replace function public.ci_speed_test()
returns table (o_name text, o_ms int, o_budget_ms int, o_status text, o_detail text)
language plpgsql volatile security definer
set search_path to 'public','pg_temp' as $$
declare
  co uuid; t0 timestamptz; ms int; n int;
  probes text[][] := array[
    array['قائمة الوحدات', '600'],
    array['قائمة الحجوزات مع العملاء', '800'],
    array['ميزان المراجعة الكامل', '1500'],
    array['دفتر الأستاذ الكامل', '1500'],
    array['شجرة الحسابات', '600'],
    array['قائمة القيود مع أسطرها', '900']
  ];
  budget int;
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden: super admin only' using errcode = '42501';
  end if;

  -- أكبر منشأة بياناتٍ: القياس على أثقل حالة واقعية لا على منشأة فارغة
  select c.id into co from public.companies c
   order by (select count(*) from public.bookings b where b.company_id = c.id) desc limit 1;

  t0 := clock_timestamp();
  select count(*) into n from public.units where company_id = co;
  ms := extract(milliseconds from clock_timestamp() - t0)::int;
  budget := probes[1][2]::int;
  return query select probes[1][1], ms, budget,
    case when ms <= budget then 'pass' else 'fail' end, (n || ' وحدة')::text;

  t0 := clock_timestamp();
  select count(*) into n from public.bookings b
    left join public.customers cu on cu.id = b.customer_id
    left join public.units u on u.id = b.unit_id
   where b.company_id = co;
  ms := extract(milliseconds from clock_timestamp() - t0)::int;
  budget := probes[2][2]::int;
  return query select probes[2][1], ms, budget,
    case when ms <= budget then 'pass' else 'fail' end, (n || ' حجز')::text;

  t0 := clock_timestamp();
  select count(*) into n from public.trial_balance(co, null, null);
  ms := extract(milliseconds from clock_timestamp() - t0)::int;
  budget := probes[3][2]::int;
  return query select probes[3][1], ms, budget,
    case when ms <= budget then 'pass' else 'fail' end, (n || ' سطر')::text;

  t0 := clock_timestamp();
  select count(*) into n from public.gl_ledger(co, null, null, null);
  ms := extract(milliseconds from clock_timestamp() - t0)::int;
  budget := probes[4][2]::int;
  return query select probes[4][1], ms, budget,
    case when ms <= budget then 'pass' else 'fail' end, (n || ' حركة')::text;

  t0 := clock_timestamp();
  select count(*) into n from public.chart_of_accounts where company_id = co;
  ms := extract(milliseconds from clock_timestamp() - t0)::int;
  budget := probes[5][2]::int;
  return query select probes[5][1], ms, budget,
    case when ms <= budget then 'pass' else 'fail' end, (n || ' حساب')::text;

  t0 := clock_timestamp();
  select count(*) into n from public.journal_entries j
    join public.journal_entry_lines jl on jl.entry_id = j.id
   where j.company_id = co;
  ms := extract(milliseconds from clock_timestamp() - t0)::int;
  budget := probes[6][2]::int;
  return query select probes[6][1], ms, budget,
    case when ms <= budget then 'pass' else 'fail' end, (n || ' سطر قيد')::text;
end $$;
revoke all on function public.ci_speed_test() from public, anon;
grant execute on function public.ci_speed_test() to authenticated;

-- ---------------------------------------------------------------------
--  تسريع حقيقي — آمن تماماً: لا يعدّل بيانات ولا سياسات ولا يحذف شيئاً
--    (1) ANALYZE للجداول التي بَلِيت إحصاءاتها → المخطِّط يختار خطة أفضل
--    (2) فهارس على أعمدة الربط في الجداول الكبيرة فقط (≥1000 صف)
--  يسري على كل المنشآت الحالية والجديدة لأنه على مستوى المخطط.
-- ---------------------------------------------------------------------
create or replace function public.speed_optimize()
returns table (o_action text, o_affected int, o_detail text)
language plpgsql volatile security definer
set search_path to 'public','pg_temp' as $$
declare t record; n_an int := 0; n_ix int := 0; det text := '';
begin
  if not (public.is_super_admin() or public.ci_is_service_role() or public.ci_is_system_run()) then
    raise exception 'forbidden: super admin only' using errcode = '42501';
  end if;

  -- (1) تحديث إحصاءات المخطِّط لكل جدول لم يُحلَّل مؤخراً
  for t in
    select st.relname tn from pg_stat_user_tables st
     where st.schemaname = 'public'
       and (st.last_analyze is null or st.last_analyze < now() - interval '7 days')
       and (st.last_autoanalyze is null or st.last_autoanalyze < now() - interval '7 days')
  loop
    execute format('analyze public.%I', t.tn);
    n_an := n_an + 1;
  end loop;

  -- (2) فهارس ناقصة على الجداول الكبيرة فقط — الصغيرة لا تستفيد
  for t in
    select c.relname tn, a.attname col
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
      join pg_stat_user_tables st on st.relid = c.oid
     where ns.nspname = 'public' and c.relkind = 'r'
       and a.attname in ('company_id','branch_id','booking_id','unit_id','customer_id',
                         'entry_id','source_id','user_id','account_id','payment_id','expense_id')
       and a.attnum > 0 and not a.attisdropped
       and st.n_live_tup >= 1000
       and not exists (select 1 from pg_index i
                        where i.indrelid = c.oid and i.indkey[0] = a.attnum)
  loop
    execute format('create index if not exists %I on public.%I (%I)',
                   'idx_' || t.tn || '_' || t.col, t.tn, t.col);
    n_ix := n_ix + 1;
    det := det || t.tn || '.' || t.col || '، ';
  end loop;

  return query select 'تحديث إحصاءات المخطِّط'::text, n_an,
    (n_an || ' جدول أُعيد تحليله — يختار المخطِّط خططاً أدق')::text;
  return query select 'فهارس على الجداول الكبيرة'::text, n_ix,
    coalesce(nullif(rtrim(det, '، '), ''), 'لا جدول كبير يحتاج فهرساً — الصغيرة لا تستفيد من الفهرسة')::text;
end $$;
revoke all on function public.speed_optimize() from public, anon;
grant execute on function public.speed_optimize() to authenticated;
