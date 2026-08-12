// System repair edge function — super-admin only.
// يستقبل { check_id, dry_run } ويُنفّذ عملية إصلاح موحّدة على مستوى قاعدة البيانات كاملة.
// يُسجّل كل استدعاء في public.system_repair_log.
//
// ⚠️ تصحيح 2026-08-12 — مصدر حقيقة واحد للصلاحية:
//   كانت هذه الدالة تُثبّت قائمة سوبر أدمن من 6 عناوين في الشيفرة، بينما
//   public.super_admin_emails() في قاعدة البيانات تعرّف 8. فكان مالك المنصة
//   نفسه (shadysalahshadysalah@gmail.com) يتلقى 403 عند استدعاء أداة الإصلاح
//   رغم كونه super admin في قاعدة البيانات.
//   العلاج الجذري: تُقرأ الصلاحية الآن من قاعدة البيانات عبر
//   public.is_super_admin_email، فلا يتكرر الانحراف مهما تغيّرت القائمة.
//   القائمة المُثبّتة أدناه لم تعد مصدر حقيقة — هي ارتداد أمان يُستعمل فقط
//   إذا تعذّر استعلام قاعدة البيانات، حتى لا تنقطع الإتاحة عند عطل عابر.

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

/** الصلاحية من قاعدة البيانات أولاً، وعند تعذّرها فقط تُستعمل القائمة المُثبّتة. */
async function isSuperAdminEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc('is_super_admin_email', { _email: email })
    if (!error && typeof data === 'boolean') return data
  } catch { /* يسقط إلى الارتداد */ }
  return FALLBACK_SUPER_ADMIN_EMAILS.has(email)
}

type RepairResult = {
  status: 'success' | 'partial' | 'failed' | 'dry_run'
  affected_rows: number
  details: Record<string, unknown>
  error?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const jsonResp = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResp({ error: 'Unauthorized' }, 401)
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // (1) تحقق من هوية المستدعي
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const token = authHeader.replace('Bearer ', '')
    const { data: userData, error: userErr } = await authClient.auth.getUser(token)
    if (userErr || !userData?.user) return jsonResp({ error: 'Unauthorized' }, 401)

    const email = (userData.user.email || '').toLowerCase()

    // (2) صلاحية الخدمة — تُستعمل للتحقق من الصلاحية ثم لتنفيذ الإصلاح
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })

    if (!(await isSuperAdminEmail(admin, email))) {
      return jsonResp({ error: 'Forbidden: super_admin only' }, 403)
    }
    const userId = userData.user.id

    // (3) اقرأ payload
    const body = await req.json().catch(() => ({}))
    const check_id: string = String(body.check_id || '').trim()
    const dry_run: boolean = Boolean(body.dry_run)
    if (!check_id) return jsonResp({ error: 'check_id is required' }, 400)

    // (4) نفّذ الإصلاح المُحدَّد عبر service role (يتجاوز RLS بأمان)
    const result = await runRepair(admin, check_id, dry_run)

    // (5) سجّل العملية
    await admin.from('system_repair_log').insert({
      check_id,
      executed_by: userId,
      executed_by_email: email,
      status: result.status,
      affected_rows: result.affected_rows,
      details: result.details,
      error: result.error ?? null,
    })

    return jsonResp({ ok: result.status !== 'failed', ...result })
  } catch (e) {
    return jsonResp({ error: (e as Error).message }, 500)
  }
})

// ========== عمليات الإصلاح المدعومة ==========
async function runRepair(
  admin: ReturnType<typeof createClient>,
  checkId: string,
  dryRun: boolean,
): Promise<RepairResult> {
  try {
    switch (checkId) {
      case 'orphan_journal_entries': {
        // قيود بدون أسطر إطلاقًا
        const { data: entries } = await admin
          .from('journal_entries')
          .select('id')
          .limit(1000)
        const ids = (entries || []).map((e) => e.id)
        if (!ids.length) return { status: 'success', affected_rows: 0, details: { note: 'no entries' } }
        const { data: lines } = await admin
          .from('journal_entry_lines')
          .select('entry_id')
          .in('entry_id', ids)
        const withLines = new Set((lines || []).map((l) => l.entry_id))
        const orphans = ids.filter((id) => !withLines.has(id))
        if (dryRun) return { status: 'dry_run', affected_rows: orphans.length, details: { orphans } }
        if (!orphans.length) return { status: 'success', affected_rows: 0, details: {} }
        const { error, count } = await admin
          .from('journal_entries')
          .delete({ count: 'exact' })
          .in('id', orphans)
        if (error) return { status: 'failed', affected_rows: 0, details: {}, error: error.message }
        return { status: 'success', affected_rows: count || 0, details: { deleted: orphans } }
      }

      case 'backfill_settlement_source_type': {
        // قيود ذات source_id لكن بدون source_type — نضبطها إلى 'settlement' إذا الوصف يحتوي "تصفية"
        const { data, error } = await admin
          .from('journal_entries')
          .select('id, description, source_id, source_type')
          .eq('source_type', 'manual')
          .not('source_id', 'is', null)
        if (error) return { status: 'failed', affected_rows: 0, details: {}, error: error.message }
        const targets = (data || []).filter((r) => /تصفية|settle/i.test(r.description || ''))
        if (dryRun) return { status: 'dry_run', affected_rows: targets.length, details: { targets: targets.map((t) => t.id) } }
        if (!targets.length) return { status: 'success', affected_rows: 0, details: {} }
        const { error: uerr, count } = await admin
          .from('journal_entries')
          .update({ source_type: 'settlement' }, { count: 'exact' })
          .in('id', targets.map((t) => t.id))
        if (uerr) return { status: 'failed', affected_rows: 0, details: {}, error: uerr.message }
        return { status: 'success', affected_rows: count || 0, details: {} }
      }

      case 'dangling_source_type': {
        // قيود لها source_type لكن بدون source_id — رابط مصدر معطوب.
        // الإصلاح: إعادة source_type إلى 'manual' (العمود NOT NULL) حتى تتطابق حالة القيد مع بياناته.
        const { data, error } = await admin
          .from('journal_entries')
          .select('id, entry_number, source_type')
          .neq('source_type', 'manual')
          .is('source_id', null)
        if (error) return { status: 'failed', affected_rows: 0, details: {}, error: error.message }
        const targets = data || []
        if (dryRun) return { status: 'dry_run', affected_rows: targets.length, details: { targets: targets.map((t) => t.entry_number) } }
        if (!targets.length) return { status: 'success', affected_rows: 0, details: { note: 'nothing to repair' } }
        const { error: uerr, count } = await admin
          .from('journal_entries')
          .update({ source_type: 'manual' }, { count: 'exact' })
          .in('id', targets.map((t) => t.id))
        if (uerr) return { status: 'failed', affected_rows: 0, details: {}, error: uerr.message }
        return { status: 'success', affected_rows: count || 0, details: { entries: targets.map((t) => t.entry_number) } }
      }

      case 'unbalanced_journal_entries': {
        // قيود غير متوازنة (فرق مدين/دائن > 0.01) — تقرير فقط، لا حذف تلقائي
        const { data: entries, error } = await admin
          .from('journal_entries')
          .select('id, entry_number, company_id')
          .limit(5000)
        if (error) return { status: 'failed', affected_rows: 0, details: {}, error: error.message }
        const ids = (entries || []).map((e) => e.id)
        if (!ids.length) return { status: 'success', affected_rows: 0, details: { unbalanced: [] } }
        const { data: lines } = await admin
          .from('journal_entry_lines')
          .select('entry_id, debit, credit')
          .in('entry_id', ids)
        const agg = new Map<string, { d: number; c: number }>()
        for (const l of lines || []) {
          const a = agg.get(l.entry_id as string) || { d: 0, c: 0 }
          a.d += Number(l.debit) || 0
          a.c += Number(l.credit) || 0
          agg.set(l.entry_id as string, a)
        }
        const bad = (entries || []).filter((e) => {
          const a = agg.get(e.id as string)
          return a && Math.abs(a.d - a.c) > 0.01
        })
        return {
          status: 'success',
          affected_rows: bad.length,
          details: {
            unbalanced: bad.slice(0, 50).map((e) => e.entry_number),
            note: 'تقرير فقط — القيود غير المتوازنة تحتاج مراجعة يدوية أو إعادة ترحيل',
          },
        }
      }

      case 'rls_grants': {
        // إصلاح RLS وصلاحيات Data API على مستوى كل الجداول (كل المستخدمين)
        if (dryRun) {
          const { data, error } = await admin.rpc('system_rls_audit')
          if (error) return { status: 'failed', affected_rows: 0, details: {}, error: error.message }
          return { status: 'dry_run', affected_rows: (data as unknown[])?.length || 0, details: { pending: data } }
        }
        const { data, error } = await admin.rpc('system_repair_rls_grants')
        if (error) return { status: 'failed', affected_rows: 0, details: {}, error: error.message }
        const fixed = (data as { fixed?: unknown[] })?.fixed || []
        return { status: 'success', affected_rows: fixed.length, details: data as Record<string, unknown> }
      }

      case 'full_repair': {
        // تشغيل كل الإصلاحات الآمنة دفعة واحدة على مستوى النظام بالكامل
        const steps = ['orphan_journal_entries', 'backfill_settlement_source_type', 'dangling_source_type', 'rls_grants']
        const details: Record<string, unknown> = {}
        let total = 0
        let anyFailed = false
        for (const step of steps) {
          const r = await runRepair(admin, step, dryRun)
          details[step] = r
          total += r.affected_rows
          if (r.status === 'failed') anyFailed = true
        }
        return { status: anyFailed ? 'partial' : dryRun ? 'dry_run' : 'success', affected_rows: total, details }
      }

      case 'health_check': {
        // فحص خفيف يعيد إحصاءات
        const [{ count: coa }, { count: je }, { count: jel }] = await Promise.all([
          admin.from('chart_of_accounts').select('*', { count: 'exact', head: true }),
          admin.from('journal_entries').select('*', { count: 'exact', head: true }),
          admin.from('journal_entry_lines').select('*', { count: 'exact', head: true }),
        ])
        return {
          status: 'success',
          affected_rows: 0,
          details: {
            chart_of_accounts: coa,
            journal_entries: je,
            journal_entry_lines: jel,
          },
        }
      }

      default:
        return { status: 'failed', affected_rows: 0, details: {}, error: `Unknown check_id: ${checkId}` }
    }

  } catch (e) {
    return { status: 'failed', affected_rows: 0, details: {}, error: (e as Error).message }
  }
}
