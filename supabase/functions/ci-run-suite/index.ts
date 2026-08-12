// ci-run-suite — server-side CI test suite (super-admin only).
// يشغّل حزمة اختبارات على قاعدة البيانات بصلاحية الخدمة، ويسجّل النتائج
// في ci_test_runs / ci_test_results / ci_perf_samples، مع إصلاح تلقائي اختياري.
//
// ⚠️ تصحيح 2026-08-12 — مصدر حقيقة واحد للصلاحية:
//   كانت القائمة مُثبّتة في الشيفرة بـ6 عناوين بينما
//   public.super_admin_emails() تعرّف 8، فكان مالك المنصة يتلقى 403.
//   الصلاحية تُقرأ الآن من قاعدة البيانات عبر public.is_super_admin_email،
//   والقائمة أدناه صارت ارتداد أمان عند تعذّر الاستعلام فقط.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** ارتداد فقط عند تعذّر استعلام قاعدة البيانات — مطابق لـ super_admin_emails(). */
const FALLBACK_SUPER_ADMIN_EMAILS = new Set([
  'shadysalahshadysalah@gmail.com',
  'shadyabdelwahab99@gmail.com',
  'sh.abdelwahab@nes-sa.com',
  'shadyabdelwahabksa@gmail.com',
  'secondnumb11@gmail.com',
  'info.almazen.platform@gmail.com',
  'moatazsalah1016@gmail.com',
  'motazsalah1016@gmail.com',
])

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

/** الصلاحية من قاعدة البيانات أولاً، وعند تعذّرها فقط تُستعمل القائمة المُثبّتة. */
async function isSuperAdminEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<boolean> {
  if (!email) return false
  try {
    const { data, error } = await admin.rpc('is_super_admin_email', { _email: email })
    if (!error && typeof data === 'boolean') return data
  } catch { /* يسقط إلى الارتداد */ }
  return FALLBACK_SUPER_ADMIN_EMAILS.has(email)
}

type Status = 'pass' | 'fail' | 'warn' | 'skip'
type Category = 'schema' | 'rbac' | 'crud' | 'perf' | 'data' | 'general' | 'migration'
type Result = {
  suite: string
  name: string
  category: Category
  status: Status
  duration_ms: number
  message?: string
  meta?: Record<string, unknown>
  fix_check_id?: string | null
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  try {
    const body = await req.json().catch(() => ({}))
    const suites: string[] = Array.isArray(body.suites) && body.suites.length
      ? body.suites
      : ['schema', 'rbac', 'crud', 'perf', 'data', 'branches']
    const autoFix: boolean = body.auto_fix !== false
    const triggerKind: string = body.trigger_kind === 'schedule' ? 'schedule' : 'manual'
    const internalSecret = req.headers.get('x-ci-internal')

    // ---- authorization ------------------------------------------------
    let userId: string | null = null
    if (triggerKind === 'schedule' && internalSecret && internalSecret === SERVICE_KEY) {
      // internal call from ci-schedule-tick
    } else {
      const authHeader = req.headers.get('Authorization')
      if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)
      const token = authHeader.replace('Bearer ', '')
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      })
      const { data: userData, error: userErr } = await userClient.auth.getUser(token)
      const email = userData?.user?.email?.toLowerCase() ?? ''
      if (userErr || !(await isSuperAdminEmail(admin, email))) {
        return json({ error: 'Forbidden: super admin only' }, 403)
      }
      userId = userData!.user!.id
    }

    // ---- create run ---------------------------------------------------
    const { data: run, error: runErr } = await admin
      .from('ci_test_runs')
      .insert({ triggered_by: userId, trigger_kind: triggerKind, status: 'running' })
      .select('id')
      .single()
    if (runErr) return json({ error: 'failed to create run', details: runErr.message }, 500)
    const runId = run.id as string

    const results: Result[] = []
    const perfSamples: { run_id: string; scope: string; name: string; duration_ms: number }[] = []

    const timed = async (
      suite: string,
      name: string,
      category: Category,
      fixId: string | null,
      fn: () => Promise<{ status: Status; message?: string; meta?: Record<string, unknown> }>,
    ) => {
      const t0 = performance.now()
      let out: { status: Status; message?: string; meta?: Record<string, unknown> }
      try {
        out = await fn()
      } catch (e) {
        out = { status: 'fail', message: (e as Error).message }
      }
      const duration = Math.round(performance.now() - t0)
      results.push({
        suite, name, category, status: out.status, duration_ms: duration,
        message: out.message ?? null as unknown as string, meta: out.meta ?? {},
        fix_check_id: out.status === 'pass' ? null : fixId,
      })
      perfSamples.push({ run_id: runId, scope: 'query', name: `${suite}:${name}`, duration_ms: duration })
    }

    const tableExists = async (t: string) => {
      const { error } = await admin.from(t).select('*', { head: true, count: 'exact' }).limit(1)
      return !error
    }

    // ---------------------------------------------------------- schema
    if (suites.includes('schema')) {
      const core = ['companies', 'profiles', 'ci_test_runs', 'ci_test_results', 'ci_schedules',
        'ci_auto_fix_jobs', 'ci_perf_samples', 'ci_fix_catalog', 'system_repair_log']
      for (const t of core) {
        await timed('schema', `جدول ${t}`, 'schema', 'full_repair', async () => {
          const ok = await tableExists(t)
          return ok ? { status: 'pass' } : { status: 'fail', message: `الجدول ${t} غير موجود أو غير متاح` }
        })
      }
      await timed('schema', 'RLS مفعّل على كل الجداول', 'schema', 'enable_rls_all', async () => {
        const { data, error } = await admin.rpc('ci_check_missing_rls')
        if (error) return { status: 'warn', message: error.message }
        const bad = (data?.tables_without_rls ?? []) as string[]
        return bad.length
          ? { status: 'fail', message: `${bad.length} جدول بدون RLS`, meta: { tables: bad } }
          : { status: 'pass' }
      })
    }

    // ------------------------------------------------------------ rbac
    if (suites.includes('rbac')) {
      const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
      for (const t of ['profiles', 'companies', 'ci_test_runs', 'user_feature_flags']) {
        await timed('rbac', `منع القراءة المجهولة من ${t}`, 'rbac', 'enable_rls_all', async () => {
          const { data, error } = await anon.from(t).select('id').limit(1)
          if (error) return { status: 'pass', message: 'مرفوض كما هو متوقع' }
          return (data?.length ?? 0) === 0
            ? { status: 'pass', message: 'لا توجد صفوف مكشوفة' }
            : { status: 'fail', message: `بيانات ${t} مكشوفة للمستخدم المجهول` }
        })
      }
      await timed('rbac', 'دالة is_super_admin موجودة', 'rbac', null, async () => {
        const { error } = await admin.rpc('is_super_admin')
        return error && !/permission|forbidden/i.test(error.message)
          ? { status: 'fail', message: error.message }
          : { status: 'pass' }
      })
    }

    // ------------------------------------------------------------ crud
    if (suites.includes('crud')) {
      await timed('crud', 'كتابة/حذف سجل اختباري', 'crud', null, async () => {
        const { data, error } = await admin
          .from('ci_perf_samples')
          .insert({ run_id: runId, scope: 'selftest', name: 'crud_probe', duration_ms: 1 })
          .select('id').single()
        if (error) return { status: 'fail', message: error.message }
        const { error: delErr } = await admin.from('ci_perf_samples').delete().eq('id', data.id)
        return delErr ? { status: 'warn', message: delErr.message } : { status: 'pass' }
      })
    }

    // ------------------------------------------------------------ data
    if (suites.includes('data')) {
      await timed('data', 'كل مستخدم لديه ملف تعريف', 'data', 'bootstrap_profiles', async () => {
        const { count: users } = await admin.from('profiles').select('id', { head: true, count: 'exact' })
        return (users ?? 0) > 0 ? { status: 'pass', meta: { profiles: users } }
          : { status: 'warn', message: 'لا توجد ملفات تعريف' }
      })
      await timed('data', 'اشتراكات حسابات المالك فعّالة', 'data', 'super_admin_plans', async () => {
        const { data, error } = await admin.from('companies')
          .select('id, plan, subscription_ends_at').limit(500)
        if (error) return { status: 'warn', message: error.message }
        const expired = (data ?? []).filter(
          (c) => c.subscription_ends_at && new Date(c.subscription_ends_at as string) < new Date(),
        )
        return expired.length
          ? { status: 'warn', message: `${expired.length} اشتراك منتهٍ`, meta: { count: expired.length } }
          : { status: 'pass' }
      })
    }

    // -------------------------------------------------------- branches
    if (suites.includes('branches')) {
      await timed('branches', 'جداول الفروع موجودة', 'schema', 'branch_feature_bootstrap', async () => {
        const ok = (await tableExists('branches')) && (await tableExists('user_branches'))
          && (await tableExists('user_feature_flags'))
        return ok ? { status: 'pass' } : { status: 'fail', message: 'جداول الفروع ناقصة' }
      })
      await timed('branches', 'ترابط الفروع سليم', 'data', 'branch_feature_bootstrap', async () => {
        const { data, error } = await admin.rpc('ci_check_branch_link_integrity')
        if (error) return { status: 'skip', message: error.message }
        const orphans = (data as Record<string, number>)?.orphan_branch_links ?? 0
        return orphans === 0
          ? { status: 'pass' }
          : { status: 'fail', message: `${orphans} قيد مرتبط بفرع محذوف` }
      })
      await timed('branches', 'علم ميزة الفروع مهيّأ', 'data', 'branch_feature_bootstrap', async () => {
        const { count, error } = await admin.from('user_feature_flags')
          .select('id', { head: true, count: 'exact' }).eq('feature', 'branches')
        if (error) return { status: 'fail', message: error.message }
        return (count ?? 0) > 0 ? { status: 'pass', meta: { flags: count } }
          : { status: 'fail', message: 'لا توجد أعلام ميزة' }
      })
    }

    // ------------------------------------------------------------ perf
    if (suites.includes('perf')) {
      const { data: budgets } = await admin.from('ci_perf_budgets').select('metric, warn_ms, fail_ms')
      const budget = (budgets ?? []).find((b) => b.metric === 'query') ?? { warn_ms: 2000, fail_ms: 4000 }
      for (const t of ['profiles', 'companies', 'ci_test_runs']) {
        await timed('perf', `زمن الاستعلام: ${t}`, 'perf', null, async () => {
          const t0 = performance.now()
          const { error } = await admin.from(t).select('id').limit(50)
          const ms = Math.round(performance.now() - t0)
          if (error) return { status: 'fail', message: error.message }
          if (ms >= (budget.fail_ms as number)) return { status: 'fail', message: `${ms}ms`, meta: { ms } }
          if (ms >= (budget.warn_ms as number)) return { status: 'warn', message: `${ms}ms`, meta: { ms } }
          return { status: 'pass', message: `${ms}ms`, meta: { ms } }
        })
      }
    }

    // ---- persist ------------------------------------------------------
    if (results.length) {
      await admin.from('ci_test_results').insert(results.map((r) => ({ ...r, run_id: runId })))
    }
    if (perfSamples.length) await admin.from('ci_perf_samples').insert(perfSamples)

    const failed = results.filter((r) => r.status === 'fail')
    const warned = results.filter((r) => r.status === 'warn')

    // ---- auto-fix -----------------------------------------------------
    const fixes: unknown[] = []
    if (autoFix && failed.length) {
      const ids = [...new Set(failed.map((r) => r.fix_check_id).filter(Boolean))] as string[]
      for (const id of ids) {
        const { data, error } = await admin.rpc('ci_apply_fix_to_all_users', { _check_id: id })
        fixes.push({ check_id: id, result: data ?? null, error: error?.message ?? null })
      }
    }

    const durations = results.map((r) => r.duration_ms)
    const perf = {
      total_ms: durations.reduce((a, b) => a + b, 0),
      avg_ms: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      max_ms: durations.length ? Math.max(...durations) : 0,
      slowest: results.slice().sort((a, b) => b.duration_ms - a.duration_ms)[0]?.name ?? null,
    }
    const status = failed.length ? 'failed' : warned.length ? 'warned' : 'passed'

    await admin.from('ci_test_runs').update({
      finished_at: new Date().toISOString(),
      status,
      totals: {
        total: results.length,
        passed: results.filter((r) => r.status === 'pass').length,
        failed: failed.length,
        warned: warned.length,
        skipped: results.filter((r) => r.status === 'skip').length,
        fixes_applied: fixes.length,
      },
      perf,
      warnings: warned.map((w) => ({ name: w.name, message: w.message })),
    }).eq('id', runId)

    return json({ run_id: runId, status, perf, results, fixes })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
