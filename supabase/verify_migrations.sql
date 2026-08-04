-- ===============================================================
--  verify_migrations.sql — فحوصات تلقائية بعد كل ترحيل
--  يُشغَّل عبر: npm run db:verify
--  يفشل بخطأ واضح عند وجود أي نقص أو تعارض. للقراءة فقط تماماً.
-- ===============================================================
do $$
declare
  v_missing text[] := '{}';
  v_fn text;
  v_fns text[] := array[
    'portal_get_context','portal_record_payment','portal_create_service_request',
    'portal_confirm_handover','portal_add_companion','portal_submit_rating',
    'portal_validate_login','portal_regenerate_token',
    'get_my_role','current_role_of_user','branch_visible','fn_payment_auto_post','finalize_owner_setup','branch_delete_impact',
    'next_document_number'
  ];
  v_cnt int;
begin
  ---------------------------------------------------------------
  -- 1) الدوال الأساسية موجودة
  ---------------------------------------------------------------
  foreach v_fn in array v_fns loop
    select count(*) into v_cnt from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_fn;
    if v_cnt = 0 then v_missing := v_missing || ('MISSING_FUNCTION:' || v_fn); end if;
  end loop;

  ---------------------------------------------------------------
  -- 2) bootstrap_owner القديمة محذوفة نهائياً
  ---------------------------------------------------------------
  select count(*) into v_cnt from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'bootstrap_owner';
  if v_cnt <> 0 then v_missing := v_missing || ('LEGACY_bootstrap_owner_PRESENT:' || v_cnt); end if;

  ---------------------------------------------------------------
  -- 3) حماية الاشتراكات: التريجر موجود
  ---------------------------------------------------------------
  select count(*) into v_cnt from pg_trigger
    where tgname = 'trg_guard_company_subscription' and not tgisinternal;
  if v_cnt = 0 then v_missing := v_missing || 'MISSING_TRIGGER:trg_guard_company_subscription'; end if;

  select count(*) into v_cnt from pg_trigger
    where tgname = 'trg_protect_branch_delete' and not tgisinternal;
  if v_cnt = 0 then v_missing := v_missing || 'MISSING_TRIGGER:trg_protect_branch_delete'; end if;

  select count(*) into v_cnt from pg_trigger
    where tgname in ('trg_audit_referral_status','trg_audit_referral_reward_status') and not tgisinternal;
  if v_cnt <> 2 then v_missing := v_missing || ('MISSING_REFERRAL_AUDIT_TRIGGERS:' || v_cnt); end if;

  ---------------------------------------------------------------
  -- 4) الترشيحات: تفرّد الإحالة وعدم الازدواج
  ---------------------------------------------------------------
  select count(*) into v_cnt from pg_indexes
    where schemaname = 'public' and tablename = 'referrals'
      and indexdef ilike '%unique%' and indexdef ilike '%referred%';
  if v_cnt = 0 then v_missing := v_missing || 'MISSING_UNIQUE:referrals.referred'; end if;

  select count(*) into v_cnt from pg_constraint
    where conname = 'no_double_booking' and contype = 'x';
  if v_cnt = 0 then v_missing := v_missing || 'MISSING_EXCLUDE:no_double_booking'; end if;

  ---------------------------------------------------------------
  -- 5) RLS مفعّل على الجداول الحسّاسة
  ---------------------------------------------------------------
  select count(*) into v_cnt from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('bookings','payments','units','customers','branches','referrals','companies','user_roles')
      and c.relkind = 'r' and c.relrowsecurity = false;
  if v_cnt > 0 then v_missing := v_missing || ('RLS_DISABLED_TABLES:' || v_cnt); end if;

  ---------------------------------------------------------------
  -- 6) صلاحيات تنفيذ دوال البوابة متاحة لـ anon
  ---------------------------------------------------------------
  foreach v_fn in array array['portal_get_context','portal_record_payment'] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname = v_fn
        and has_function_privilege('anon', p.oid, 'EXECUTE')
    ) then v_missing := v_missing || ('NO_ANON_EXECUTE:' || v_fn); end if;
  end loop;

  ---------------------------------------------------------------
  -- 7) كل دوال SECURITY DEFINER لها search_path ثابت
  ---------------------------------------------------------------
  select count(*) into v_cnt from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (p.proconfig is null or not exists (
        select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'));
  if v_cnt > 0 then v_missing := v_missing || ('SECDEF_NO_SEARCH_PATH:' || v_cnt); end if;

  ---------------------------------------------------------------
  -- 8) لا مقارنات enum بقيم غير موجودة في fn_payment_auto_post
  ---------------------------------------------------------------
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='fn_payment_auto_post'
      and pg_get_functiondef(p.oid) like '%new.method in (%'
  ) then v_missing := v_missing || 'ENUM_UNSAFE_COMPARE:fn_payment_auto_post'; end if;

  if array_length(v_missing, 1) > 0 then
    raise exception 'VERIFY_FAILED: %', array_to_string(v_missing, ' | ');
  end if;

  raise notice 'VERIFY_OK: all post-migration checks passed';
end $$;

select 'VERIFY_OK' as result;
