import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import SystemRepairLog from './SystemRepairLog'
import {
  SETTLEMENT_ACCOUNTS, computeSettlement, buildSettlementLines,
  reconcileSettlement, isBalanced, totalDebit, totalCredit, VAT_RATE,
} from '../lib/settlementLedger'

/**
 * SystemDiagnostics — مركز التشخيص وصحة النظام لحسابات super admin فقط.
 * يجمع كل الاختبارات الحرجة (قاعدة البيانات، RLS والصلاحيات، شجرة الحسابات،
 * القيود، محرك التصفية واختبارات الفروقات diff/tolerance) مع زر إصلاح مباشر
 * لكل مشكلة يستدعي edge function `system_repair` بصلاحية service role،
 * فيُطبَّق الإصلاح على مستوى النظام بالكامل (كل الشركات والمستخدمين الحاليين والجدد).
 * كل عملية إصلاح تُسجَّل في جدول system_repair_log.
 */
export default function SystemDiagnostics() {
  const { isSuperAdmin } = useAuth()
  const [running, setRunning] = useState(false)
  const [checks, setChecks] = useState([])
  const [busyFix, setBusyFix] = useState(null)
  const [logKey, setLogKey] = useState(0)

  // ===== حزمة CI: تشغيل تلقائي دوري + إصلاح تلقائي عند الفشل =====
  const [ciAuto, setCiAuto] = useState(() => localStorage.getItem('almazen_ci_auto') === '1')
  const [ciAutoFix, setCiAutoFix] = useState(() => localStorage.getItem('almazen_ci_autofix') !== '0')
  const [ciEvery, setCiEvery] = useState(() => Number(localStorage.getItem('almazen_ci_every') || 30))
  const [ciBusy, setCiBusy] = useState(false)
  const [ciRuns, setCiRuns] = useState([])
  const ciRef = useRef({ busy: false })




  const callRepair = async (checkId, dryRun = false) => {
    const { data: { session } } = await supabase.auth.getSession()
    const base = import.meta.env.VITE_SUPABASE_URL || 'https://drowmezlcrvowuhqmfef.supabase.co'
    const res = await fetch(`${base}/functions/v1/system_repair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token || ''}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
      },
      body: JSON.stringify({ check_id: checkId, dry_run: dryRun }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
    return json
  }

  const runAll = async () => {
    setRunning(true)
    const out = []

    /* ---------- 1) شجرة الحسابات على مستوى كل الشركات ---------- */
    try {
      const { data, error } = await supabase.from('chart_of_accounts').select('code, account_type, company_id')
      if (error) throw error
      const byCompany = new Map()
      ;(data || []).forEach(r => {
        const s = byCompany.get(r.company_id) || new Set()
        s.add(r.code); byCompany.set(r.company_id, s)
      })
      const required = Object.values(SETTLEMENT_ACCOUNTS).map(a => a.code)
      const bad = []
      for (const [cid, codes] of byCompany.entries()) {
        const missing = required.filter(c => !codes.has(c))
        if (missing.length) bad.push({ cid, missing })
      }
      out.push({
        id: 'missing_critical_accounts',
        title: 'الحسابات الحرجة لمحرك التصفية (كل الشركات)',
        status: bad.length === 0 ? 'pass' : 'fail',
        detail: bad.length === 0
          ? `${byCompany.size} شركة — كل الحسابات الحرجة موجودة`
          : `${bad.length} شركة تفتقد حسابات حرجة: ${bad.slice(0, 3).map(b => b.missing.join('/')).join(' · ')}`,
        fix_id: null,
        fix_hint: bad.length ? 'شغّل seed_default_chart_of_accounts للشركات الناقصة' : '',
      })
    } catch (e) {
      out.push({ id: 'chart_of_accounts_read', title: 'قراءة شجرة الحسابات', status: 'fail', detail: e.message })
    }

    /* ---------- 2) قيود يومية بدون أسطر ---------- */
    try {
      const { data: entries } = await supabase.from('journal_entries').select('id').limit(5000)
      const ids = (entries || []).map(e => e.id)
      let orphans = 0
      if (ids.length) {
        const { data: lines } = await supabase.from('journal_entry_lines').select('entry_id').in('entry_id', ids)
        const withLines = new Set((lines || []).map(l => l.entry_id))
        orphans = ids.filter(id => !withLines.has(id)).length
      }
      out.push({
        id: 'orphan_journal_entries',
        title: 'قيود يومية بدون أسطر (قيود يتيمة)',
        status: orphans === 0 ? 'pass' : 'fail',
        detail: orphans === 0 ? 'لا توجد قيود يتيمة' : `${orphans} قيد بدون أي أسطر مدين/دائن`,
        fix_id: orphans > 0 ? 'orphan_journal_entries' : null,
        fix_hint: 'حذف القيود التي لا تحوي أي أسطر — يُطبَّق على كل الشركات والحسابات',
      })
    } catch (e) {
      out.push({ id: 'orphan_journal_entries', title: 'قيود يتيمة', status: 'fail', detail: e.message })
    }

    /* ---------- 3) قيود بـ source_id بدون source_type ---------- */
    try {
      const { count } = await supabase.from('journal_entries')
        .select('*', { count: 'exact', head: true })
        .eq('source_type', 'manual').not('source_id', 'is', null)
      out.push({
        id: 'backfill_settlement_source_type',
        title: 'قيود لها مصدر بدون تصنيف مصدر (source_type)',
        status: (count || 0) === 0 ? 'pass' : 'warn',
        detail: (count || 0) === 0 ? 'كل القيود ذات المصدر مُصنَّفة' : `${count} قيد له source_id لكنه مُصنَّف manual`,
        fix_id: (count || 0) > 0 ? 'backfill_settlement_source_type' : null,
        fix_hint: 'ضبط source_type = "settlement" للقيود التي وصفها يحتوي كلمة "تصفية"',
      })
    } catch (e) {
      out.push({ id: 'backfill_settlement_source_type', title: 'تصنيف مصدر القيد', status: 'fail', detail: e.message })
    }

    /* ---------- 4) قيود بـ source_type بدون source_id (رابط معطوب) ---------- */
    try {
      const { count } = await supabase.from('journal_entries')
        .select('*', { count: 'exact', head: true })
        .neq('source_type', 'manual').is('source_id', null)
      out.push({
        id: 'dangling_source_type',
        title: 'ربط القيد بمصدره (source_id مفقود)',
        status: (count || 0) === 0 ? 'pass' : 'warn',
        detail: (count || 0) === 0 ? 'كل القيود مرتبطة بمصدرها بشكل صحيح' : `${count} قيد مع source_type بدون source_id`,
        fix_id: (count || 0) > 0 ? 'dangling_source_type' : null,
        fix_hint: 'إعادة تصنيف القيود التي فقدت مصدرها إلى manual — يزيل التناقض على مستوى كل الحسابات',
      })
    } catch (e) {
      out.push({ id: 'dangling_source_type', title: 'ربط القيد بمصدره', status: 'fail', detail: e.message })
    }

    /* ---------- 5) توازن القيود على مستوى النظام ---------- */
    try {
      const { data: entries } = await supabase.from('journal_entries').select('id, entry_number').limit(5000)
      const ids = (entries || []).map(e => e.id)
      let unb = 0
      if (ids.length) {
        const { data: lines } = await supabase.from('journal_entry_lines').select('entry_id, debit, credit').in('entry_id', ids)
        const agg = new Map()
        ;(lines || []).forEach(l => {
          const a = agg.get(l.entry_id) || { d: 0, c: 0 }
          a.d += Number(l.debit) || 0; a.c += Number(l.credit) || 0
          agg.set(l.entry_id, a)
        })
        unb = ids.filter(id => { const a = agg.get(id); return a && Math.abs(a.d - a.c) > 0.01 }).length
      }
      out.push({
        id: 'unbalanced_journal_entries',
        title: 'توازن القيود المُرحَّلة (كل الشركات)',
        status: unb === 0 ? 'pass' : 'fail',
        detail: unb === 0 ? 'كل القيود متوازنة ضمن حد التسامح 0.01' : `${unb} قيد غير متوازن`,
        fix_id: 'unbalanced_journal_entries',
        fix_hint: 'يُنتج تقرير أرقام القيود غير المتوازنة لمراجعتها أو إعادة ترحيلها (لا يحذف بيانات)',
      })
    } catch (e) {
      out.push({ id: 'unbalanced_journal_entries', title: 'توازن القيود', status: 'fail', detail: e.message })
    }

    /* ---------- 6) تدقيق RLS وصلاحيات Data API ---------- */
    try {
      const { data, error } = await supabase.rpc('system_rls_audit')
      if (error) throw error
      const problems = Array.isArray(data) ? data : []
      out.push({
        id: 'rls_grants',
        title: 'أمان قاعدة البيانات — RLS والصلاحيات لكل الجداول',
        status: problems.length === 0 ? 'pass' : 'fail',
        detail: problems.length === 0
          ? 'كل جداول public عليها RLS + سياسات + صلاحيات Data API صحيحة'
          : `${problems.length} جدول ينقصه RLS أو سياسات أو صلاحيات: ${problems.slice(0, 5).map(p => p.table_name).join(', ')}`,
        fix_id: problems.length > 0 ? 'rls_grants' : null,
        fix_hint: 'منح الصلاحيات الناقصة وتفعيل RLS للجداول التي لديها سياسات — يشمل كل المستخدمين الحاليين والجدد',
      })
    } catch (e) {
      out.push({ id: 'rls_grants', title: 'تدقيق RLS والصلاحيات', status: 'fail', detail: e.message, fix_id: 'rls_grants', fix_hint: 'محاولة إصلاح الصلاحيات عبر service role' })
    }

    /* ---------- 7) اختبارات محرك التصفية + حالات tolerance/diff ---------- */
    out.push(...ledgerLogicChecks())

    setChecks(out)
    setRunning(false)
    return out
  }

  const runFix = async (checkId) => {
    setBusyFix(checkId)
    try {
      const json = await callRepair(checkId, false)
      alert(`✅ تم تنفيذ «${checkId}»\nالحالة: ${json.status}\nعدد الصفوف المتأثرة: ${json.affected_rows}\n\n${JSON.stringify(json.details, null, 2)}`)
      setLogKey(k => k + 1)
      await runAll()
    } catch (e) {
      alert(`❌ فشل الإصلاح: ${e.message}`)
    } finally {
      setBusyFix(null)
    }
  }

  /* ============================================================
   * حزمة CI — تشغيل تلقائي لكل الفحوصات مع تقرير واضح للفشل والتحذيرات
   * وإعادة تطبيق الإصلاح تلقائياً عند ظهور أخطاء (يُطبَّق على كل الشركات
   * والمستخدمين الحاليين والجدد عبر service role).
   * ============================================================ */
  const runCiSuite = async ({ autoFix = ciAutoFix, trigger = 'manual' } = {}) => {
    if (ciRef.current.busy) return
    ciRef.current.busy = true
    setCiBusy(true)
    const started = new Date()
    const record = { at: started.toISOString(), trigger, fixes: [], error: '' }
    try {
      const before = await runAll()
      record.before = countBy(before)

      if (autoFix) {
        const fixIds = [...new Set(before.filter(c => c.status !== 'pass' && c.fix_id).map(c => c.fix_id))]
        for (const id of fixIds) {
          try {
            const json = await callRepair(id, false)
            record.fixes.push({ id, status: json.status, affected: json.affected_rows ?? 0 })
          } catch (e) {
            record.fixes.push({ id, status: 'failed', affected: 0, error: e.message })
          }
        }
        if (fixIds.length) {
          setLogKey(k => k + 1)
          const after = await runAll()
          record.after = countBy(after)
          record.remaining = after.filter(c => c.status !== 'pass').map(c => c.title)
        }
      }
      if (!record.after) {
        record.after = record.before
        record.remaining = before.filter(c => c.status !== 'pass').map(c => c.title)
      }
    } catch (e) {
      record.error = e.message
    } finally {
      record.durationMs = Date.now() - started.getTime()
      setCiRuns(prev => [record, ...prev].slice(0, 20))
      ciRef.current.busy = false
      setCiBusy(false)
    }
    return record
  }

  // مؤقّت التشغيل الدوري (CI) — يعمل طالما الصفحة مفتوحة والخيار مُفعَّل
  useEffect(() => {
    localStorage.setItem('almazen_ci_auto', ciAuto ? '1' : '0')
    localStorage.setItem('almazen_ci_autofix', ciAutoFix ? '1' : '0')
    localStorage.setItem('almazen_ci_every', String(ciEvery))
    if (!ciAuto) return
    runCiSuite({ trigger: 'auto' })
    const ms = Math.max(1, Number(ciEvery) || 30) * 60_000
    const timer = setInterval(() => runCiSuite({ trigger: 'auto' }), ms)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ciAuto, ciEvery, ciAutoFix])


  const summary = checks.length ? {
    pass: checks.filter(c => c.status === 'pass').length,
    fail: checks.filter(c => c.status === 'fail').length,
    warn: checks.filter(c => c.status === 'warn').length,
  } : null

  if (!isSuperAdmin) {
    return (
      <div className="panel" style={{ padding: 20 }}>
        <div style={{ color: 'var(--muted)' }}>هذه الصفحة متاحة لحسابات super admin فقط.</div>
      </div>
    )
  }



  return (
    <div className="panel" style={{ padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>🛠️ مركز التشخيص وصحة النظام — Super Admin</h2>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
          حزمة اختبارات كاملة: قاعدة البيانات · RLS والصلاحيات · شجرة الحسابات · القيود · محرك التصفية
          واختبارات الفروقات (diff/tolerance). كل إصلاح يُنفَّذ بصلاحية النظام ويُطبَّق على جميع الشركات
          والمستخدمين الحاليين والجدد، ويُسجَّل في سجل التدقيق أدناه.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-gold" onClick={runAll} disabled={running}>
          {running ? '⏳ جاري تشغيل الفحوصات...' : '🚀 تشغيل جميع الفحوصات'}
        </button>
        <button
          className="btn btn-blue"
          disabled={busyFix === 'full_repair'}
          onClick={() => { if (confirm('سيتم تنفيذ كل الإصلاحات الآمنة على مستوى النظام بالكامل. متابعة؟')) runFix('full_repair') }}
        >
          {busyFix === 'full_repair' ? '⏳ جاري الإصلاح الشامل...' : '🛠️ تنفيذ الإصلاح الشامل'}
        </button>
      </div>

      {/* ===== حزمة CI: تشغيل تلقائي + إصلاح تلقائي + تقرير ===== */}
      <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: '#F8FAFC' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>🤖 التشغيل التلقائي لحزمة الاختبارات (CI)</b>
          <button className="btn btn-gold btn-sm" disabled={ciBusy || running} onClick={() => runCiSuite({ trigger: 'manual' })}>
            {ciBusy ? '⏳ جاري تشغيل الحزمة...' : '▶️ تشغيل الحزمة الآن'}
          </button>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={ciAuto} onChange={e => setCiAuto(e.target.checked)} />
            تشغيل دوري تلقائي
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            كل
            <input
              type="number" min={1} max={1440} value={ciEvery}
              onChange={e => setCiEvery(Number(e.target.value) || 30)}
              style={{ width: 70 }}
            />
            دقيقة
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={ciAutoFix} onChange={e => setCiAutoFix(e.target.checked)} />
            إعادة تطبيق الإصلاح تلقائياً عند ظهور أخطاء
          </label>
        </div>

        {ciRuns.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
            لم تُشغَّل الحزمة بعد في هذه الجلسة.
          </div>
        ) : (
          <div style={{ marginTop: 10, maxHeight: 260, overflow: 'auto' }}>
            {ciRuns.map((r, i) => {
              const ok = !r.error && (r.after?.fail || 0) === 0
              return (
                <div key={i} style={{
                  border: '1px solid var(--border)', borderRadius: 10, padding: 10,
                  marginBottom: 8, background: '#fff',
                  borderRight: `4px solid ${ok ? '#15803D' : '#B91C1C'}`,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: ok ? '#15803D' : '#B91C1C' }}>
                    {ok ? '✅ الحزمة ناجحة' : '❌ الحزمة فيها إخفاقات'} · {new Date(r.at).toLocaleString('ar-SA')}
                    <span style={{ fontWeight: 400, color: 'var(--muted)' }}>
                      {' '}({r.trigger === 'auto' ? 'تلقائي' : 'يدوي'} · {Math.round((r.durationMs || 0) / 100) / 10}ث)
                    </span>
                  </div>
                  {r.error && <div style={{ color: '#B91C1C', fontSize: 12 }}>خطأ: {r.error}</div>}
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    قبل الإصلاح: ✅ {r.before?.pass ?? 0} · ❌ {r.before?.fail ?? 0} · ⚠️ {r.before?.warn ?? 0}
                    {r.fixes?.length ? ` — بعد الإصلاح: ✅ ${r.after?.pass ?? 0} · ❌ ${r.after?.fail ?? 0} · ⚠️ ${r.after?.warn ?? 0}` : ''}
                  </div>
                  {r.fixes?.length > 0 && (
                    <div style={{ fontSize: 12, marginTop: 4 }}>
                      الإصلاحات المُعادة: {r.fixes.map(f => `${f.id} (${f.status}، ${f.affected} صف)`).join(' · ')}
                    </div>
                  )}
                  {r.remaining?.length > 0 && (
                    <div style={{ fontSize: 12, marginTop: 4, color: '#B45309' }}>
                      لا تزال تحتاج تدخلاً: {r.remaining.join(' · ')}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>


      {summary && (
        <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span className="chip" style={{ background: '#DCFCE7', color: '#166534' }}>✓ نجح: {summary.pass}</span>
          <span className="chip" style={{ background: '#FEE2E2', color: '#991B1B' }}>✗ فشل: {summary.fail}</span>
          <span className="chip" style={{ background: '#FEF3C7', color: '#92400E' }}>⚠ تنبيه: {summary.warn}</span>
        </div>
      )}

      {checks.length > 0 && (
        <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {checks.map((c, i) => (
            <div key={c.id} style={{
              padding: '12px 14px',
              borderBottom: i < checks.length - 1 ? '1px solid var(--border)' : 'none',
              background: c.status === 'pass' ? '#F0FDF4' : c.status === 'fail' ? '#FEF2F2' : c.status === 'warn' ? '#FFFBEB' : '#F9FAFB',
              display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
              <span style={{ fontSize: 20 }}>
                {c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : c.status === 'warn' ? '⚠️' : 'ℹ️'}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{c.title}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{c.detail}</div>
                {c.fix_hint && <div style={{ fontSize: 12, color: '#0369A1', marginTop: 4 }}>💡 {c.fix_hint}</div>}
              </div>
              {c.fix_id && (
                <button className="btn btn-blue btn-sm" disabled={busyFix === c.fix_id} onClick={() => runFix(c.fix_id)}>
                  {busyFix === c.fix_id ? '⏳' : '🛠️ تنفيذ الإصلاح'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <SystemRepairLog embedded refreshKey={logKey} />
    </div>
  )
}

/* ============================================================
 * اختبارات منطق محرك التصفية والفروقات — تعمل في المتصفح بلا أي أثر على البيانات
 * تشمل: التوازن، حالات tolerance حول 0.01، وحالات التحذير المتطابقة (netDiff = 0)
 * ============================================================ */
function ledgerLogicChecks() {
  const out = []
  const push = (id, title, ok, detail, hint = '') => out.push({
    id, title, status: ok ? 'pass' : 'fail', detail,
    fix_id: null,
    fix_hint: ok ? '' : (hint || 'خلل في منطق محرك التصفية — يتطلب تصحيحاً برمجياً في settlementLedger'),
  })

  // (أ) توازن قيد تصفية نموذجي
  try {
    const c = computeSettlement({ daysCount: 10, dailyRate: 300, initialInsurance: 1000, paidSoFar: 1000 })
    const lines = buildSettlementLines({
      netDue: c.netDue, initialInsurance: c.initialInsurance,
      refundedInsurance: c.refundedInsurance, retainedInsurance: c.retainedInsurance, vatAmount: c.settlementVat,
    })
    push('logic_balanced', 'محرك التصفية — القيد المتوقع متوازن', isBalanced(lines),
      `مدين ${totalDebit(lines)} / دائن ${totalCredit(lines)}`)

    // (ب) تطابق تام ⇒ كل netDiff = 0 ولا يوجد تحذير
    const rec = reconcileSettlement(lines, lines.map(l => ({ ...l })))
    const allZero = rec.rows.every(r => r.netDiff === 0)
    push('diff_exact_zero', 'حالة التطابق التام: فرق كل حساب = صفر',
      allZero && rec.maxDiff === 0 && rec.mismatches.length === 0,
      `أكبر فرق = ${rec.maxDiff} · حسابات غير مطابقة = ${rec.mismatches.length}`)

    // (ج) رسالة التحذير لا تظهر فرقاً عندما netDiff = 0
    push('warning_zero_diff', 'حالة التحذير المتطابقة: لا تُعرض رسالة فرق عند netDiff = 0',
      rec.ok === true && rec.maxDiff === 0,
      rec.maxDiff === 0 ? 'المطابقة ok والفرق صفر — لا تحذير' : `⚠️ تحذير بفرق ${rec.maxDiff} رغم التطابق`,
      'راجع حساب maxDiff في reconcileSettlement — يجب ألا يُنتج تحذيراً عند الفرق صفر')

    // (د) فرق تحت حد التسامح (0.009) يُعدّ مطابقاً
    const under = lines.map((l, i) => i === 0 ? { ...l, debit: l.debit ? l.debit + 0.004 : l.debit, credit: l.credit ? l.credit + 0.004 : l.credit } : l)
    const recUnder = reconcileSettlement(lines, under)
    push('diff_under_tolerance', 'فرق أقل من حد التسامح (0.01) يُعتبر مطابقاً',
      recUnder.mismatches.length === 0,
      `أكبر فرق = ${recUnder.maxDiff} — المتوقع ≤ 0.01`)

    // (هـ) فرق فوق حد التسامح (0.02) يُكشف
    const over = lines.map((l, i) => i === 0 ? { ...l, debit: l.debit ? l.debit + 0.02 : l.debit, credit: l.credit ? l.credit + 0.02 : l.credit } : l)
    const recOver = reconcileSettlement(lines, over)
    push('diff_over_tolerance', 'فرق أكبر من حد التسامح (0.02) يُكشف كعدم تطابق',
      recOver.mismatches.length > 0,
      `أكبر فرق = ${recOver.maxDiff} — يجب أن يُرصد`)

    // (و) فرق مدين +100 ودائن +100 ليس صفراً
    const tampered = lines.map((l, i) => i === 0 ? { ...l, debit: (Number(l.debit) || 0) + 100, credit: (Number(l.credit) || 0) + 100 } : l)
    const recT = reconcileSettlement(lines, tampered)
    push('diff_no_netting', 'فروق المدين والدائن لا تُلغي بعضها (لا مقاصّة)',
      recT.maxDiff >= 100 && recT.mismatches.length > 0,
      `أكبر فرق = ${recT.maxDiff} — المتوقع 100 على الأقل`)
  } catch (e) {
    out.push({ id: 'ledger_logic', title: 'اختبارات منطق محرك التصفية', status: 'fail', detail: e.message })
  }

  // (ز) نسبة الضريبة
  push('vat_rate', 'نسبة ضريبة القيمة المضافة المعتمدة (15%)', VAT_RATE === 0.15, `الحالية = ${VAT_RATE}`,
    'يجب أن تكون 0.15 حسب اللوائح السعودية')

  return out
}

// عدّاد نتائج حزمة الاختبارات (يُستخدم في تقرير CI)
function countBy(list = []) {
  return {
    pass: list.filter(c => c.status === 'pass').length,
    fail: list.filter(c => c.status === 'fail').length,
    warn: list.filter(c => c.status === 'warn').length,
  }
}
