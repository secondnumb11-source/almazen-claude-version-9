/**
 * ciSuite.js — client bridge to the server-side CI suite.
 * The actual checks run in the `ci-run-suite` edge function with service-role
 * privileges (super-admin gated). This module only triggers runs, reports
 * client-side performance samples, and exposes the auto-fix helpers.
 */
import { supabase } from './supabase'

const PERF_WARN_MS = 2000
const PERF_FAIL_MS = 4000

/** Collect browser navigation/paint timings for the current page. */
export function collectClientPerf() {
  const samples = []
  try {
    const nav = performance.getEntriesByType?.('navigation')?.[0]
    if (nav) {
      samples.push({
        scope: 'page_load',
        name: location?.pathname || '/',
        duration_ms: Math.round(nav.loadEventEnd || nav.duration || 0),
      })
      samples.push({
        scope: 'navigation',
        name: `ttfb:${location?.pathname || '/'}`,
        duration_ms: Math.round(nav.responseStart || 0),
      })
    }
    const paint = performance.getEntriesByType?.('paint') || []
    for (const p of paint) {
      samples.push({ scope: 'navigation', name: p.name, duration_ms: Math.round(p.startTime) })
    }
  } catch { /* noop */ }
  return samples.filter(s => s.duration_ms >= 0)
}

/** Persist client-side perf samples (best effort — never throws). */
export async function reportClientPerf(runId = null) {
  const samples = collectClientPerf()
  if (!samples.length) return 0
  const { data: sess } = await supabase.auth.getSession()
  const userId = sess?.session?.user?.id || null
  const { error } = await supabase.from('ci_perf_samples').insert(
    samples.map(s => ({ ...s, run_id: runId, user_id: userId, meta: { ua: navigator.userAgent } })),
  )
  if (error) console.warn('perf sample insert failed', error.message)
  return samples.length
}

/**
 * Trigger the server-side suite.
 * @returns {{ run_id: string, status: string, perf: object, results: any[], fixes: any[] }}
 */
export async function runCiSuite({ triggerKind = 'manual', suites, autoFix = true } = {}) {
  const { data: sess } = await supabase.auth.getSession()
  if (!sess?.session) throw new Error('يجب تسجيل الدخول كـ super admin أولاً')

  const { data, error } = await supabase.functions.invoke('ci-run-suite', {
    body: { trigger_kind: triggerKind, suites, auto_fix: autoFix },
  })
  if (error) {
    let details = error.message
    try { details = await error.context?.text?.() || details } catch { /* noop */ }
    throw new Error(details)
  }
  if (data?.error) throw new Error(data.error)

  await reportClientPerf(data?.run_id || null)
  return data
}

/** Apply a well-known fix across every user (SECURITY DEFINER RPC). */
export async function applyFixToAllUsers(checkId) {
  const { data, error } = await supabase.rpc('ci_apply_fix_to_all_users', { _check_id: checkId })
  if (error) throw error
  return data
}

/** Apply every catalogued auto-fix in one shot. */
export async function applyAllFixes() {
  const { data, error } = await supabase.rpc('ci_apply_all_fixes')
  if (error) throw error
  return data
}

/** The catalogue of available repairs (super admin only). */
export async function loadFixCatalog() {
  const { data, error } = await supabase.from('ci_fix_catalog').select('*').order('check_id')
  if (error) throw error
  return data || []
}

/** Aggregated performance report over the last N days. */
export async function loadPerfReport({ days = 7 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const { data, error } = await supabase
    .from('ci_perf_samples')
    .select('scope, name, duration_ms, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000)
  if (error) throw error

  const byName = new Map()
  for (const s of data || []) {
    const key = `${s.scope}::${s.name}`
    const e = byName.get(key) || { scope: s.scope, name: s.name, count: 0, total: 0, max: 0 }
    e.count += 1
    e.total += s.duration_ms
    e.max = Math.max(e.max, s.duration_ms)
    byName.set(key, e)
  }
  return [...byName.values()]
    .map(e => ({
      ...e,
      avg: Math.round(e.total / e.count),
      status: e.total / e.count >= PERF_FAIL_MS ? 'fail'
        : e.total / e.count >= PERF_WARN_MS ? 'warn' : 'pass',
    }))
    .sort((a, b) => b.avg - a.avg)
}

export const PERF_THRESHOLDS = { warn: PERF_WARN_MS, fail: PERF_FAIL_MS }
