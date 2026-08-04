import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { SAR } from '../lib/helpers'
import { runRepair, REPAIR_ACTIONS } from '../lib/accountingRepairs'
import { useBranches } from '../BranchContext'
import {
  computeSettlement, buildSettlementLines, reconcileSettlement,
  totalDebit, totalCredit, isBalanced, SETTLEMENT_ACCOUNTS, VAT_RATE,
} from '../lib/settlementLedger'


/* ====== التصحيح الشامل على جميع الحسابات (سوبر أدمن فقط) ====== */
export function GlobalFixBar() {
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])

  const runAll = async () => {
    if (!confirm('سيتم تنفيذ التصحيح على جميع الحسابات الحالية والجديدة. متابعة؟')) return
    setBusy(true); setLog([])
    const out = []

    // 1) الإصلاح المحاسبي الشامل لكل الشركات
    const acc = await runRepair('all_companies', {})
    out.push({ ok: acc.ok, text: acc.message })

    // 2) إعادة تفعيل RLS/عزل الحسابات على الجداول الحسّاسة
    const { data: fixed, error } = await supabase.rpc('isolation_auto_fix')
    if (error) out.push({ ok: false, text: `إصلاح العزل: ${error.message}` })
    else {
      const n = Array.isArray(fixed) ? fixed.length : 0
      out.push({ ok: true, text: n ? `إصلاح العزل: تم إصلاح ${n} جدول` : 'إصلاح العزل: لا توجد مشاكل' })
    }

    setLog(out); setBusy(false)
  }

  return (
    <div style={{
      marginBottom: 16, padding: '12px 14px', borderRadius: 10,
      border: '1px solid #FDE68A', background: '#FFFBEB', color: '#78350F', fontSize: 13,
    }}>
      <b>👑 اختبارات مقصورة على السوبر أدمن</b> — لا تظهر لأي حساب أو مستخدم آخر (حالي أو جديد).
      <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-sm btn-gold" onClick={runAll} disabled={busy}>
          {busy ? '⏳ جارٍ التصحيح الشامل...' : '🛠️ تصحيح على جميع المستخدمين'}
        </button>
        {log.map((l, i) => (
          <span key={i} style={{ fontSize: 12, fontWeight: 700, color: l.ok ? '#15803D' : '#B91C1C' }}>
            {l.ok ? '✅ ' : '❌ '}{l.text}
          </span>
        ))}
      </div>
    </div>
  )
}


/* ================= مكوّنات مساعدة موحّدة ================= */
export function ScopeNotice({ isSuperAdmin, companyName, companyId }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const runGlobal = async () => {
    if (!confirm('سيتم تشغيل الإصلاح المحاسبي على جميع شركات النظام. متابعة؟')) return
    setBusy(true); setMsg(null)
    const res = await runRepair('all_companies', {})
    setMsg(res); setBusy(false)
  }
  return (
    <div style={{
      marginBottom: 16, padding: '10px 14px', borderRadius: 10,
      border: '1px solid #BFDBFE', background: '#EFF6FF', color: '#1E3A8A', fontSize: 13,
    }}>
      <b>🔒 نطاق الإصلاح:</b> أي إصلاح تلقائي تُشغّله من هذه الصفحة يُطبَّق حصراً على بيانات
      حسابك <b>{companyName || 'شركتك'}</b> ولا يمسّ أي حساب آخر في النظام
      {companyId ? <span style={{ color: '#64748B' }}> (معرّف الشركة: {String(companyId).slice(0, 8)}…)</span> : null}.
      {isSuperAdmin && (
        <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#7C2D12' }}>👑 بصفتك Super Admin يمكنك — وحدك — تشغيل الإصلاح على كل حسابات النظام:</span>
          <button className="btn btn-sm btn-gold" onClick={runGlobal} disabled={busy}>
            {busy ? '⏳ جارٍ الإصلاح الشامل...' : '🌐 إصلاح كل حسابات النظام'}
          </button>
          {msg && (
            <span style={{ fontSize: 12, fontWeight: 700, color: msg.ok ? '#15803D' : '#B91C1C' }}>
              {msg.ok ? '✅ ' : '❌ '}{msg.message}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function RepairButton({ action, companyId, onDone }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const def = REPAIR_ACTIONS[action]
  if (!def) return null
  const go = async () => {
    setBusy(true); setMsg(null)
    const res = await runRepair(action, { companyId })
    setMsg(res)
    setBusy(false)
    if (res.ok && typeof onDone === 'function') await onDone()
  }
  return (
    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <button className="btn btn-sm btn-gold" onClick={go} disabled={busy} title={def.label}>
        {busy ? '⏳ جاري الإصلاح...' : '🛠️ إصلاح تلقائي الآن'}
      </button>
      {msg && (
        <span style={{ fontSize: 12, fontWeight: 700, color: msg.ok ? '#15803D' : '#B91C1C' }}>
          {msg.ok ? '✅ ' : '❌ '}{msg.message}
        </span>
      )}
    </div>
  )
}

function ResultsList({ results, companyId, onRepaired }) {
  if (!results?.length) return null
  return (
    <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      {results.map((r, i) => {
        // المقترحات تُعرض فقط عندما يفشل الاختبار أو يُصدر تحذيراً — لا معنى
        // لعرض «مقترح إصلاح» بجانب اختبار ناجح (كان يسبّب لبساً في التقارير).
        const needsAction = r.status === 'fail' || r.status === 'warn'
        return (
        <div key={i} style={{
          padding: '10px 14px', borderBottom: i < results.length - 1 ? '1px solid var(--border)' : 'none',
          background: r.status === 'pass' ? '#F0FDF4' : r.status === 'fail' ? '#FEF2F2' : r.status === 'warn' ? '#FFFBEB' : '#F9FAFB',
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>
            {r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : r.status === 'warn' ? '⚠️' : 'ℹ️'}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: r.status === 'pass' ? '#15803D' : r.status === 'fail' ? '#B91C1C' : r.status === 'warn' ? '#B45309' : 'var(--text)' }}>
              {r.name}
            </div>
            {r.detail && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{r.detail}</div>}
            {needsAction && r.fix && <div style={{ fontSize: 12, color: '#0369A1', marginTop: 4, fontStyle: 'italic' }}>💡 مقترح الإصلاح: {r.fix}</div>}
            {needsAction && r.repair && <RepairButton action={r.repair} companyId={companyId} onDone={onRepaired} />}
          </div>
        </div>
        )
      })}
    </div>
  )
}

function TestRunnerCard({ title, description, running, onRun, results, summary, companyId, repairAllAction }) {
  const [fixingAll, setFixingAll] = useState(false)
  const [allMsg, setAllMsg] = useState(null)
  const hasIssues = (summary?.fail || 0) + (summary?.warn || 0) > 0
  const fixAll = async () => {
    setFixingAll(true); setAllMsg(null)
    const res = await runRepair(repairAllAction, { companyId })
    setAllMsg(res); setFixingAll(false)
    if (res.ok) await onRun()
  }
  return (
    <div className="tool-card" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      <h4 style={{ margin: '0 0 6px' }}>{title}</h4>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>{description}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-blue btn-sm" onClick={onRun} disabled={running || fixingAll}>
          {running ? '⏳ جاري التنفيذ...' : '▶️ تشغيل الاختبارات'}
        </button>
        {repairAllAction && hasIssues && (
          <button className="btn btn-sm btn-gold" onClick={fixAll} disabled={running || fixingAll}>
            {fixingAll ? '⏳ جاري الإصلاح الشامل...' : '🛠️ إصلاح كل المشاكل تلقائياً'}
          </button>
        )}
        {allMsg && (
          <span style={{ fontSize: 12, fontWeight: 700, color: allMsg.ok ? '#15803D' : '#B91C1C' }}>
            {allMsg.ok ? '✅ ' : '❌ '}{allMsg.message}
          </span>
        )}
      </div>
      {summary && (
        <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span className="chip" style={{ background: '#DCFCE7', color: '#166534' }}>✓ نجح: {summary.pass}</span>
          <span className="chip" style={{ background: '#FEE2E2', color: '#991B1B' }}>✗ فشل: {summary.fail}</span>
          {summary.warn > 0 && <span className="chip" style={{ background: '#FEF3C7', color: '#92400E' }}>⚠ تنبيه: {summary.warn}</span>}
        </div>
      )}
      <ResultsList results={results} companyId={companyId} onRepaired={onRun} />
    </div>
  )
}

const summarize = (results) => ({
  pass: results.filter(r => r.status === 'pass').length,
  fail: results.filter(r => r.status === 'fail').length,
  warn: results.filter(r => r.status === 'warn').length,
})

/* ================= 5) اختبارات محرك التصفية ================= */
export function LedgerRegressionTests() {
  const { profile } = useAuth()
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState([])

  const run = () => {
    setRunning(true)
    const out = []
    // repair='all' يعيد مواءمة بيانات المحاسبة (الشجرة/القيود) بعد أي فشل في المحرك
    const check = (name, cond, detail = '', fix = '') =>
      out.push({ status: cond ? 'pass' : 'fail', name, detail, fix, repair: cond ? undefined : 'all' })

    // 1) تصفية عادية متوازنة
    try {
      const c = computeSettlement({ daysCount: 10, dailyRate: 300, initialInsurance: 1000, paidSoFar: 1000 })
      const lines = buildSettlementLines({ netDue: c.netDue, initialInsurance: c.initialInsurance, refundedInsurance: c.refundedInsurance, retainedInsurance: c.retainedInsurance, vatAmount: c.settlementVat })
      check('التصفية الأساسية: 10 أيام × 300', c.calculatedRent === 3000, `المحسوب: ${c.calculatedRent}`, 'راجع computeSettlement — الضرب غير صحيح')
      check('التوازن المحاسبي للتصفية الأساسية', isBalanced(lines), `مدين ${totalDebit(lines)} / دائن ${totalCredit(lines)}`, 'راجع buildSettlementLines — سطر الموازنة مفقود')
    } catch (e) { out.push({ status: 'fail', name: 'حساب التصفية العادية', detail: e.message, repair: 'all' }) }

    // 2) دفعات زائدة → استرداد
    try {
      const c = computeSettlement({ daysCount: 5, dailyRate: 200, paidSoFar: 1500 })
      check('دفعات زائدة تُنتج netDue سالب', c.netDue < 0, `netDue = ${c.netDue}`)
    } catch (e) { out.push({ status: 'fail', name: 'اختبار الدفعات الزائدة', detail: e.message, repair: 'all' }) }

    // 3) إلغاء (صفر أيام)
    try {
      const c = computeSettlement({ daysCount: 0, dailyRate: 250, initialInsurance: 800 })
      check('إلغاء (صفر أيام): finalTenantBill = 0', c.finalTenantBill === 0)
      check('إرجاع كامل التأمين عند الإلغاء', c.refundedInsurance === 800)
    } catch (e) { out.push({ status: 'fail', name: 'اختبار الإلغاء', detail: e.message, repair: 'all' }) }

    // 4) استقطاع جزء من التأمين
    try {
      const c = computeSettlement({ daysCount: 6, dailyRate: 300, initialInsurance: 1000, insuranceAction: 'deduct_part', deductedInsurance: 400 })
      check('استقطاع 400 من تأمين 1000', c.retainedInsurance === 400 && c.refundedInsurance === 600, `retained=${c.retainedInsurance} refunded=${c.refundedInsurance}`)
    } catch (e) { out.push({ status: 'fail', name: 'اختبار الاستقطاع', detail: e.message, repair: 'all' }) }

    // 5) VAT ثابتة 15%
    check('نسبة ضريبة القيمة المضافة المعتمدة', VAT_RATE === 0.15, `الحالية = ${VAT_RATE}`, 'يجب أن تكون 0.15 حسب اللوائح السعودية')

    // 6) الدفع البنكي vs النقدي
    try {
      const linesCash = buildSettlementLines({ netDue: 500, method: 'cash' })
      const linesBank = buildSettlementLines({ netDue: 500, method: 'bank_transfer' })
      check('الدفع النقدي يستخدم حساب 1101', linesCash.find(l => l.tag === 'cash_in')?.code === '1101')
      check('الدفع البنكي يستخدم حساب 1102', linesBank.find(l => l.tag === 'cash_in')?.code === '1102')
    } catch (e) { out.push({ status: 'fail', name: 'اختبار طرق الدفع', detail: e.message, repair: 'chart' }) }

    // 7) لوحة المطابقة
    try {
      const c = computeSettlement({ daysCount: 10, dailyRate: 300, initialInsurance: 1000, paidSoFar: 1000 })
      const lines = buildSettlementLines({ netDue: c.netDue, initialInsurance: c.initialInsurance, refundedInsurance: c.refundedInsurance, retainedInsurance: c.retainedInsurance, vatAmount: c.settlementVat })
      const rec = reconcileSettlement(lines, lines.map(l => ({ ...l })))
      check('لوحة المطابقة: تطابق تام', rec.ok && rec.mismatches.length === 0)
      const tampered = lines.map((l, i) => i === 0 ? { ...l, debit: l.debit + 100 } : l)
      const rec2 = reconcileSettlement(lines, tampered)
      check('لوحة المطابقة: تكشف الفروقات', !rec2.ok && rec2.mismatches.length > 0)
    } catch (e) { out.push({ status: 'fail', name: 'اختبار لوحة المطابقة', detail: e.message, repair: 'all' }) }

    setResults(out); setRunning(false)
  }

  return (
    <TestRunnerCard
      title="⚖️ اختبارات الانحدار على محرك التصفية"
      description="يشغّل حالات الاختبار الحرجة على settlementLedger لضمان صحة الحسابات وتوازن القيود المتوقعة في كل السيناريوهات"
      running={running} onRun={run} results={results} summary={results.length ? summarize(results) : null}
      companyId={profile?.company_id} repairAllAction="all"
    />
  )
}

/* ================= 6) شجرة الحسابات ================= */
export function ChartOfAccountsTests() {
  const { profile } = useAuth()
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState([])

  const run = async () => {
    setRunning(true)
    const out = []
    const companyId = profile?.company_id
    try {
      // ملاحظة: العمود الفعلي في قاعدة البيانات اسمه `account_type` وليس `type`،
      // والعلاقة الأبوية عبر `parent_id` وليس `parent_code`. الاستعلام السابق كان يفشل بـ
      // "column chart_of_accounts.type does not exist".
      const { data, error } = await supabase.from('chart_of_accounts').select('code, name, account_type, parent_id').eq('company_id', companyId)
      if (error) throw error
      const rows = (data || []).map(r => ({ ...r, type: r.account_type })) // aliasing لتوافق الكود القديم
      out.push({ status: rows.length > 0 ? 'pass' : 'fail', name: 'وجود شجرة حسابات للشركة', detail: `عدد الحسابات: ${rows.length}`, fix: rows.length === 0 ? 'شغّل seed_default_chart_of_accounts للشركة' : '', repair: 'chart' })

      // الحسابات الأساسية المطلوبة لمحرك التصفية
      const required = Object.values(SETTLEMENT_ACCOUNTS)
      const codes = new Set(rows.map(r => r.code))
      const missing = required.filter(a => !codes.has(a.code))
      out.push({
        status: missing.length === 0 ? 'pass' : 'fail',
        name: 'الحسابات المطلوبة لمحرك التصفية',
        detail: missing.length === 0 ? `الحسابات الـ${required.length} المطلوبة موجودة` : `مفقود: ${missing.map(m => `${m.code} ${m.name}`).join(' · ')}`,
        fix: missing.length ? 'أضف الحسابات المفقودة في شجرة الحسابات — أو أعد تشغيل seed_default_chart_of_accounts' : '',
        repair: 'chart',
      })

      // التحقق من نوع كل حساب
      required.forEach(req => {
        const found = rows.find(r => r.code === req.code)
        if (found && found.account_type !== req.type) {
          out.push({ status: 'fail', name: `نوع الحساب ${req.code}`, detail: `المتوقع: ${req.type}, الفعلي: ${found.account_type}`, fix: `صحّح نوع الحساب ${req.code} إلى ${req.type}`, repair: 'chart' })
        } else if (found) {
          out.push({ status: 'pass', name: `الحساب ${req.code} ${found.name}`, detail: `النوع صحيح (${found.account_type})` })
        }
      })


      // فحص التكرار
      const dupCodes = rows.map(r => r.code).filter((c, i, a) => a.indexOf(c) !== i)
      out.push({ status: dupCodes.length === 0 ? 'pass' : 'fail', name: 'عدم تكرار رموز الحسابات', detail: dupCodes.length ? `مكرّر: ${dupCodes.join(', ')}` : 'لا يوجد تكرار', fix: dupCodes.length ? 'احذف الحسابات المكرّرة (غير المستخدمة في أي قيد) تلقائياً' : '', repair: 'chart' })
    } catch (e) {
      out.push({ status: 'fail', name: 'فحص شجرة الحسابات', detail: e.message, repair: 'chart' })
    }
    setResults(out); setRunning(false)
  }

  return (
    <TestRunnerCard
      title="🌳 اختبارات صحة شجرة الحسابات"
      description="يتحقّق من وجود الحسابات الحرجة (1101, 1102, 2120, 2300, 4100, 4200, 4300)، صحة أنواعها، وعدم تكرار الرموز"
      running={running} onRun={run} results={results} summary={results.length ? summarize(results) : null}
      companyId={profile?.company_id} repairAllAction="chart"
    />
  )
}

/* ================= 7) القيود المُرحَّلة ================= */
export function JournalEntriesTests() {
  const { profile } = useAuth()
  // نطاق الفرع: يُطبَّق فقط عند تفعيل الميزة واختيار فرع محدد — وRLS يبقى مصدر الحقيقة
  const { enabled: branchesOn, activeBranch, activeBranchName } = useBranches()
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState([])

  const run = async () => {
    setRunning(true)
    const out = []
    const companyId = profile?.company_id
    try {
      let entriesQ = supabase.from('journal_entries')
        .select('id, entry_number, entry_date, source_type, source_id, branch_id')
        .eq('company_id', companyId)
      if (branchesOn && activeBranch) entriesQ = entriesQ.eq('branch_id', activeBranch)
      const { data: entries, error } = await entriesQ.order('entry_date', { ascending: false }).limit(200)
      if (error) throw error
      out.push({
        status: 'pass', name: 'قراءة يومية القيود',
        detail: `تم فحص ${entries.length} قيد (آخر 200)${branchesOn && activeBranch ? ` — نطاق الفرع: ${activeBranchName}` : ''}`,
      })

      if (entries.length === 0) { setResults(out); setRunning(false); return }

      const ids = entries.map(e => e.id)
      const { data: lines } = await supabase.from('journal_entry_lines').select('entry_id, debit, credit, chart_of_accounts(code)').in('entry_id', ids)

      const byEntry = new Map()
      ;(lines || []).forEach(l => {
        const a = byEntry.get(l.entry_id) || { debit: 0, credit: 0, codes: [] }
        a.debit += Number(l.debit) || 0
        a.credit += Number(l.credit) || 0
        a.codes.push(l.chart_of_accounts?.code)
        byEntry.set(l.entry_id, a)
      })

      let unbalanced = 0, missingLines = 0, missingSource = 0, orphanAccount = 0
      const unbalancedSamples = [], danglingSamples = []
      entries.forEach(e => {
        const a = byEntry.get(e.id)
        if (!a) missingLines++
        else if (Math.abs(a.debit - a.credit) > 0.01) {
          unbalanced++
          if (unbalancedSamples.length < 3) unbalancedSamples.push(`${e.entry_number} (فرق ${(a.debit - a.credit).toFixed(2)})`)
        }
        // القيود اليدوية (source_type = 'manual') ليس لها مصدر خارجي بالتصميم،
        // لذا لا تُعدّ قيوداً «يتيمة». يُحتسب الخلل فقط عندما يدّعي القيد أن له
        // مصدراً خارجياً (حجز/فاتورة/دفعة/تصفية) بينما source_id مفقود.
        if (e.source_type && e.source_type !== 'manual' && !e.source_id) {
          missingSource++
          if (danglingSamples.length < 3) danglingSamples.push(`${e.entry_number} (${e.source_type})`)
        }
        if (a && a.codes.some(c => !c)) orphanAccount++
      })

      const manualCount = entries.filter(e => !e.source_type || e.source_type === 'manual').length

      out.push({ status: unbalanced === 0 ? 'pass' : 'fail', name: 'توازن جميع القيود', detail: unbalanced === 0 ? 'كل القيود متوازنة' : `${unbalanced} قيد غير متوازن — أمثلة: ${unbalancedSamples.join(' · ')}`, fix: unbalanced > 0 ? 'إضافة سطر موازنة تلقائي على حساب التسوية المؤقت (3999) لكل قيد غير متوازن' : '', repair: 'unbalanced' })
      out.push({ status: missingLines === 0 ? 'pass' : 'fail', name: 'كل قيد له أسطر', detail: `${missingLines} قيد بدون أسطر`, fix: missingLines > 0 ? 'حذف القيود اليتيمة (بدون أي أسطر) تلقائياً' : '', repair: 'orphans' })
      out.push({
        status: missingSource === 0 ? 'pass' : 'warn',
        name: 'ربط القيد بمصدره',
        detail: missingSource === 0
          ? `كل القيود المرتبطة بمصادر خارجية لها source_id (${manualCount} قيد يدوي بدون مصدر — وهذا سلوك صحيح بالتصميم)`
          : `${missingSource} قيد يدّعي مصدراً خارجياً بدون source_id — أمثلة: ${danglingSamples.join(' · ')}`,
        fix: missingSource > 0 ? 'إعادة تصنيف القيود التي لا مصدر لها إلى قيود يدوية (manual) لإزالة الروابط المعلّقة' : '',
        repair: 'dangling_source',
      })
      out.push({ status: orphanAccount === 0 ? 'pass' : 'fail', name: 'ربط الأسطر بشجرة الحسابات', detail: `${orphanAccount} قيد يحوي أسطر بحساب يتيم`, fix: orphanAccount > 0 ? 'إعادة بناء الحسابات الحرجة المفقودة في الشجرة ثم إعادة الترحيل' : '', repair: 'chart' })

      // فحص خاص لقيود التصفية
      const settle = entries.filter(e => e.source_type === 'settlement')
      out.push({ status: 'info', name: 'قيود التصفية المُرحَّلة', detail: `عدد ${settle.length} قيد تصفية من أصل ${entries.length}` })
    } catch (e) {
      out.push({ status: 'fail', name: 'فحص القيود', detail: e.message, repair: 'all' })
    }
    setResults(out); setRunning(false)
  }
  return (
    <TestRunnerCard
      title="📖 اختبارات القيود المُرحَّلة"
      description="يفحص توازن كل قيد، وجود الأسطر، ربطها بشجرة الحسابات، وربط قيد التصفية بمصدره (الحجز)"
      running={running} onRun={run} results={results} summary={results.length ? summarize(results) : null}
      companyId={profile?.company_id} repairAllAction="all"
    />
  )
}

/* ================= 8) اختبار الانحدار الشامل ================= */
export function FullRegressionSuite() {
  const { profile } = useAuth()
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState([])

  const run = async () => {
    setRunning(true)
    const out = []
    const companyId = profile?.company_id

    // A) صلاحيات المستخدم
    out.push({ status: profile?.role ? 'pass' : 'warn', name: 'دور المستخدم محدّد', detail: `الدور: ${profile?.role || 'غير محدد'}` })

    // B) DB أساسي
    for (const t of ['chart_of_accounts', 'journal_entries', 'bookings', 'customers']) {
      try {
        const { error } = await supabase.from(t).select('id', { head: true, count: 'exact' }).eq('company_id', companyId).limit(1)
        out.push({ status: error ? 'fail' : 'pass', name: `وصول ${t}`, detail: error?.message || 'متاح', repair: error ? 'all' : undefined })
      } catch (e) { out.push({ status: 'fail', name: `وصول ${t}`, detail: e.message, repair: 'all' }) }
    }

    // C) محرك التصفية
    try {
      const c = computeSettlement({ daysCount: 7, dailyRate: 250, initialInsurance: 500, paidSoFar: 800 })
      const lines = buildSettlementLines({ netDue: c.netDue, initialInsurance: c.initialInsurance, refundedInsurance: c.refundedInsurance, retainedInsurance: c.retainedInsurance, vatAmount: c.settlementVat })
      out.push({ status: isBalanced(lines) ? 'pass' : 'fail', name: 'محرك التصفية — قيد متوازن', detail: `debit ${totalDebit(lines)} / credit ${totalCredit(lines)}`, repair: isBalanced(lines) ? undefined : 'unbalanced' })
    } catch (e) { out.push({ status: 'fail', name: 'محرك التصفية', detail: e.message, repair: 'all' }) }

    // D) شجرة الحسابات — الحسابات الحرجة
    try {
      const { data } = await supabase.from('chart_of_accounts').select('code').eq('company_id', companyId)
      const codes = new Set((data || []).map(r => r.code))
      const missing = Object.values(SETTLEMENT_ACCOUNTS).filter(a => !codes.has(a.code))
      out.push({ status: missing.length === 0 ? 'pass' : 'fail', name: 'الحسابات الحرجة للتصفية', detail: missing.length ? `مفقود: ${missing.map(m => m.code).join(', ')}` : 'كلها موجودة', repair: 'chart' })
    } catch (e) { out.push({ status: 'fail', name: 'فحص الحسابات الحرجة', detail: e.message, repair: 'chart' }) }

    // E) الفواتير والدفعات
    try {
      const { count: invCount } = await supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('company_id', companyId)
      const { count: payCount } = await supabase.from('payments').select('*', { count: 'exact', head: true }).eq('company_id', companyId)
      out.push({ status: 'info', name: 'حجم البيانات المحاسبية', detail: `${invCount ?? 0} فاتورة · ${payCount ?? 0} دفعة` })
    } catch (e) { out.push({ status: 'warn', name: 'إحصائيات الفواتير/الدفعات', detail: e.message }) }

    // F) توازن آخر 20 قيد
    try {
      const { data: entries } = await supabase.from('journal_entries').select('id, entry_number').eq('company_id', companyId).order('entry_date', { ascending: false }).limit(20)
      const ids = (entries || []).map(e => e.id)
      if (ids.length) {
        const { data: lines } = await supabase.from('journal_entry_lines').select('entry_id, debit, credit').in('entry_id', ids)
        const bal = new Map()
        ;(lines || []).forEach(l => {
          const a = bal.get(l.entry_id) || { d: 0, c: 0 }
          a.d += Number(l.debit) || 0; a.c += Number(l.credit) || 0
          bal.set(l.entry_id, a)
        })
        const unb = entries.filter(e => { const a = bal.get(e.id); return a && Math.abs(a.d - a.c) > 0.01 }).length
        out.push({ status: unb === 0 ? 'pass' : 'fail', name: 'توازن آخر 20 قيد', detail: unb === 0 ? 'كلها متوازنة' : `${unb} قيد غير متوازن`, repair: 'unbalanced' })
      } else {
        out.push({ status: 'info', name: 'توازن القيود الأخيرة', detail: 'لا توجد قيود بعد' })
      }
    } catch (e) { out.push({ status: 'fail', name: 'توازن القيود الأخيرة', detail: e.message, repair: 'unbalanced' }) }

    setResults(out); setRunning(false)
  }

  return (
    <TestRunnerCard
      title="🚀 اختبار الانحدار الشامل"
      description="يشغّل جميع الاختبارات (صلاحيات · DB · محرك التصفية · شجرة الحسابات · القيود) دفعة واحدة ويعطي تقريراً موحّداً"
      running={running} onRun={run} results={results} summary={results.length ? summarize(results) : null}
      companyId={profile?.company_id} repairAllAction="all"
    />
  )
}
