import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../AuthContext'
import {
  trialBalance, tbIntegrityCheck, tbRepair, fetchCostCenters, money, ACCOUNT_TYPES,
} from '../../lib/accountingApi'
import { supabase } from '../../lib/supabase'
import {
  AcctPage, AcctFilters, Field, ExcelButton, PrintButton, RefreshButton, Notice, EmptyState,
} from '../../components/accounting/AcctKit'
import { ShieldCheck, Wrench, ScrollText, Settings2, ExternalLink } from 'lucide-react'
import { fetchAccountingSettings } from '../../lib/accountingApi'

/* تبويبات الحسابات الافتراضية (الصورة 1) — تُعرض داخل ميزان المراجعة نفسه
   لأن هذه الحسابات هي التي تتكوّن منها أرصدة الميزان، فرؤيتها هنا تشرح
   من أين جاء كل رصيد بدل البحث عنها في صفحة أخرى. */
const DEFAULT_ACCT_TABS = [
  { title: 'المعاملات البنكية والمدفوعات', items: [
    ['suspense_bank_account_id', 'الحساب البنكي المعلّق'],
    ['internal_transfer_account_id', 'الأموال قيد التحويل الداخلي'],
  ] },
  { title: 'قيود الإيرادات المؤجلة', items: [
    ['deferred_revenue_account_id', 'الإيرادات المؤجلة'],
  ] },
  { title: 'قيود النفقات المؤجلة', items: [
    ['deferred_expense_account_id', 'النفقة المؤجلة (مدفوعة مقدماً)'],
  ] },
  { title: 'خصومات الدفع المبكر', items: [
    ['early_discount_gain_account_id', 'أرباح خصم الدفع المبكر'],
    ['early_discount_loss_account_id', 'خسائر خصم الدفع المبكر'],
  ] },
  { title: 'خصومات بند الفاتورة', items: [
    ['invoice_discount_customer_account_id', 'فواتير العملاء'],
    ['invoice_discount_vendor_account_id', 'فاتورة المورد'],
  ] },
  { title: 'ضريبة الاستقطاع (Withholding)', items: [
    ['withholding_tax_account_id', 'أساس ضريبة الاستقطاع'],
  ] },
  { title: 'حسابات المنتج', items: [
    ['product_income_account_id', 'حساب الدخل'],
    ['product_expense_account_id', 'حساب النفقات'],
  ] },
  { title: 'ضريبة القيمة المضافة', items: [
    ['vat_output_account_id', 'الضريبة المستحقة (مخرجات)'],
    ['vat_input_account_id', 'الضريبة القابلة للخصم (مدخلات)'],
  ] },
]

const yearStart = () => `${new Date().getFullYear()}-01-01`
const today = () => new Date().toISOString().slice(0, 10)

/**
 * ميزان المراجعة الكامل: رصيد أول المدة، الحركة، رصيد آخر المدة.
 * يشمل كل الحسابات من الألف إلى الياء — بما فيها عديمة الحركة —
 * لأن المحاسب يحتاج إثبات أن الحساب موجود ورصيده صفر، لا أن يختفي.
 */
export default function TrialBalancePage({ mode = 'full' }) {
  const { profile, company } = useAuth()
  const cid = profile?.company_id
  // 'full'  = الميزان الكامل ومعه لوحة الفحص.
  // 'check' = صفحة الفحص والإصلاح وحدها — كانت الصفحتان متطابقتين وهذا خطأ.
  const checkOnly = mode === 'check'

  const [from, setFrom] = useState(yearStart)
  const [to, setTo] = useState(today)
  const [costCenter, setCostCenter] = useState('')
  const [branch, setBranch] = useState('')
  const [includeZero, setIncludeZero] = useState(true)
  const [includeDraft, setIncludeDraft] = useState(false)
  const [typeFilter, setTypeFilter] = useState('all')

  const [rows, setRows] = useState([])
  const [centers, setCenters] = useState([])
  const [branches, setBranches] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [checks, setChecks] = useState(null)
  const [checking, setChecking] = useState(false)
  const [repairLog, setRepairLog] = useState(null)
  const [defAccounts, setDefAccounts] = useState(null)
  const [showDefaults, setShowDefaults] = useState(false)

  const load = useCallback(async () => {
    if (!cid || checkOnly) return
    setBusy(true); setErr('')
    try {
      const data = await trialBalance({
        company_id: cid, from, to,
        cost_center_id: costCenter || null, branch_id: branch || null,
        include_zero: includeZero, include_draft: includeDraft,
      })
      setRows(data || [])
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [cid, from, to, costCenter, branch, includeZero, includeDraft, checkOnly])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!cid) return
    // الحسابات الافتراضية تُقرأ مع الميزان: هي مصدر أرصدته التلقائية
    fetchAccountingSettings(cid)
      .then(st => setDefAccounts(st || {}))
      .catch(() => setDefAccounts({}))
    fetchCostCenters(cid).then(setCenters).catch(() => {})
    supabase.from('branches').select('id, name').eq('company_id', cid)
      .then(({ data }) => setBranches(data || []))
  }, [cid])

  const shown = useMemo(
    () => rows.filter(r => typeFilter === 'all' || r.o_type === typeFilter),
    [rows, typeFilter],
  )

  const totals = useMemo(() => shown.reduce((t, r) => ({
    od: t.od + Number(r.o_open_debit), oc: t.oc + Number(r.o_open_credit),
    pd: t.pd + Number(r.o_period_debit), pc: t.pc + Number(r.o_period_credit),
    cd: t.cd + Number(r.o_close_debit), cc: t.cc + Number(r.o_close_credit),
  }), { od: 0, oc: 0, pd: 0, pc: 0, cd: 0, cc: 0 }), [shown])

  const balanced = Math.abs(totals.pd - totals.pc) < 0.01 && Math.abs(totals.cd - totals.cc) < 0.01

  const excelRows = useMemo(() => shown.map(r => ({
    'رقم الحساب': r.o_code, 'اسم الحساب': r.o_name, 'النوع': ACCOUNT_TYPES[r.o_type] || r.o_type,
    'رصيد أول المدة مدين': Number(r.o_open_debit), 'رصيد أول المدة دائن': Number(r.o_open_credit),
    'الحركة مدين': Number(r.o_period_debit), 'الحركة دائن': Number(r.o_period_credit),
    'رصيد آخر المدة مدين': Number(r.o_close_debit), 'رصيد آخر المدة دائن': Number(r.o_close_credit),
  })), [shown])

  const runChecks = useCallback(async () => {
    setChecking(true); setRepairLog(null)
    try { setChecks(await tbIntegrityCheck(cid)) }
    catch (e) { setErr(e.message) } finally { setChecking(false) }
  }, [cid])

  // صفحة الفحص المستقلة تبدأ فحصها فور فتحها بدل انتظار ضغطة زر
  useEffect(() => { if (checkOnly && cid) runChecks() }, [checkOnly, cid, runChecks])

  const runRepair = async (code) => {
    setChecking(true)
    try {
      const res = await tbRepair(cid, code || null, false)
      setRepairLog(res?.log || [])
      setChecks(await tbIntegrityCheck(cid))
      await load()
    } catch (e) { setErr(e.message) } finally { setChecking(false) }
  }

  const failCount = (checks || []).filter(c => c.o_status === 'fail').length

  return (
    <AcctPage
      title={checkOnly ? 'فحص صحة ميزان المراجعة والإصلاح' : 'ميزان المراجعة الكامل'}
      icon={checkOnly ? <ShieldCheck size={20} /> : <ScrollText size={20} />}
      subtitle={checkOnly
        ? 'ثمانية فحوص على سلامة القيود والشجرة والفترات — وكل خطأ قابل للإصلاح بزر ينفّذ تصحيحاً حقيقياً'
        : 'كل الحسابات من الألف إلى الياء — رصيد أول المدة، الحركة، ورصيد آخر المدة'}
      tools={checkOnly ? (
        <>
          <button className="btn btn-gold btn-sm" onClick={runChecks} disabled={checking}>
            {checking ? 'جارٍ الفحص…' : 'إعادة الفحص'}
          </button>
          {checks && failCount > 0 && (
            <button className="btn btn-danger btn-sm" onClick={() => runRepair(null)} disabled={checking}>
              <Wrench size={13} /> إصلاح الكل ({failCount})
            </button>
          )}
          <PrintButton docKind="report" targetId="tb-check-print" title={`فحص صحة ميزان المراجعة — ${company?.name || ''}`} />
        </>
      ) : (
        <>
          <RefreshButton onClick={load} busy={busy} />
          <ExcelButton
            filename={`ميزان-المراجعة-${from}_${to}.xlsx`} sheet="ميزان المراجعة" rows={excelRows}
            numericCols={['رصيد أول المدة مدين', 'رصيد أول المدة دائن', 'الحركة مدين', 'الحركة دائن', 'رصيد آخر المدة مدين', 'رصيد آخر المدة دائن']}
            onError={setErr}
          />
          <PrintButton docKind="statement" targetId="tb-print" title={`ميزان المراجعة — ${company?.name || ''} — من ${from} إلى ${to}`} />
        </>
      )}
    >
      <Notice kind="error" onClose={() => setErr('')}>{err}</Notice>

      {!checkOnly && (
      <AcctFilters>
        <Field label="من تاريخ"><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="إلى تاريخ"><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
        <Field label="نوع الحساب">
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="all">كل الأنواع</option>
            {Object.entries(ACCOUNT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="مركز التكلفة">
          <select value={costCenter} onChange={e => setCostCenter(e.target.value)}>
            <option value="">كل المراكز</option>
            {centers.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
        </Field>
        <Field label="الفرع">
          <select value={branch} onChange={e => setBranch(e.target.value)}>
            <option value="">كل الفروع</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <label className="acct-chk">
          <input type="checkbox" checked={includeZero} onChange={e => setIncludeZero(e.target.checked)} />
          إظهار الحسابات عديمة الحركة
        </label>
        <label className="acct-chk">
          <input type="checkbox" checked={includeDraft} onChange={e => setIncludeDraft(e.target.checked)} />
          تضمين المسودات غير المرحّلة
        </label>
      </AcctFilters>
      )}

      {/* ------- اختبار صحة الميزان مع إصلاح حقيقي ------- */}
      <div className="acct-integrity" id="tb-check-print">
        {!checkOnly && (
          <div className="acct-integrity-head">
            <ShieldCheck size={16} />
            <b>اختبار صحة ميزان المراجعة</b>
            <span>يفحص توازن القيود وسلامة الشجرة والفترات المالية — والإصلاح ينفّذ تغييراً حقيقياً في القاعدة</span>
            <button className="btn btn-gold btn-sm" onClick={runChecks} disabled={checking}>
              {checking ? 'جارٍ الفحص…' : 'تشغيل الفحص'}
            </button>
            {checks && failCount > 0 && (
              <button className="btn btn-danger btn-sm" onClick={() => runRepair(null)} disabled={checking}>
                <Wrench size={13} /> إصلاح الكل ({failCount})
              </button>
            )}
          </div>
        )}

        {checkOnly && checks && (
          <div className="acct-kpis">
            <div><span>إجمالي الفحوص</span><b>{checks.length}</b></div>
            <div><span>سليم</span><b style={{ color: '#065F46' }}>{checks.length - failCount}</b></div>
            <div className={failCount ? 'due' : ''}><span>يحتاج إصلاح</span><b>{failCount}</b></div>
          </div>
        )}

        {checks && (
          <table className="acct-table sm">
            <thead><tr><th>الرمز</th><th>الفحص</th><th>النتيجة</th><th>التفصيل</th><th>إجراء</th></tr></thead>
            <tbody>
              {checks.map(c => (
                <tr key={c.o_code}>
                  <td>{c.o_code}</td>
                  <td>{c.o_title}</td>
                  <td>
                    <span className={'acct-badge ' + (c.o_status === 'pass' ? 'ok' : 'bad')}>
                      {c.o_status === 'pass' ? 'سليم' : 'خطأ'}
                    </span>
                  </td>
                  <td>{c.o_detail}</td>
                  <td>
                    {c.o_status === 'fail' && c.o_fixable && (
                      <button className="btn btn-ghost btn-sm" onClick={() => runRepair(c.o_code)} disabled={checking}>
                        <Wrench size={12} /> إصلاح
                      </button>
                    )}
                    {c.o_status === 'fail' && !c.o_fixable && <small>يحتاج تصحيحاً يدوياً</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {repairLog && (
          <Notice kind="ok" onClose={() => setRepairLog(null)}>
            نتيجة الإصلاح: {repairLog.map(l => `${l.action} (${l.rows})`).join(' · ')}
          </Notice>
        )}
      </div>

      {/* ---- تبويبات الحسابات الافتراضية (الصورة 1) داخل ميزان المراجعة ---- */}
      {!checkOnly && (
        <div className="acct-integrity" style={{ borderColor: 'rgba(14,35,64,.18)', background: 'linear-gradient(180deg,#F8FAFC,#fff)' }}>
          <div className="acct-integrity-head">
            <Settings2 size={16} />
            <b>الحسابات الافتراضية المكوِّنة للميزان</b>
            <span>هذه الحسابات هي مصدر الأرصدة التي يرحّلها النظام تلقائياً — أي حساب غير محدَّد يعني رصيداً قد لا يظهر</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowDefaults(v => !v)}>
              {showDefaults ? 'إخفاء' : 'عرض التبويبات'}
            </button>
          </div>

          {showDefaults && (
            <>
              {defAccounts === null ? (
                <EmptyState>جارٍ تحميل الحسابات الافتراضية…</EmptyState>
              ) : (
                <div className="tb-deftabs">
                  {DEFAULT_ACCT_TABS.map(g => (
                    <div key={g.title} className="tb-deftab">
                      <b>{g.title}</b>
                      <table className="acct-table sm">
                        <tbody>
                          {g.items.map(([key, label]) => {
                            const id = defAccounts?.[key]
                            const acc = id ? rows.find(r => r.o_account_id === id) : null
                            return (
                              <tr key={key}>
                                <td>{label}</td>
                                <td>
                                  {id
                                    ? (acc ? `${acc.o_code} — ${acc.o_name}` : 'محدَّد')
                                    : <span className="acct-badge bad">غير محدَّد</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
              <p className="sbset-hint">
                التعديل على هذه الحسابات يتم من «إعدادات المحاسبة» في قائمة الإيرادات والنفقات المؤجلة.
              </p>
            </>
          )}
        </div>
      )}

      {checkOnly && !checks && !checking && (
        <EmptyState>جارٍ تجهيز الفحص…</EmptyState>
      )}

      {/* ------- الميزان ------- */}
      {!checkOnly && (
      <div id="tb-print" className="acct-table-wrap">
        {!shown.length && !busy ? (
          <EmptyState>لا توجد حسابات مطابقة للمرشّحات المختارة.</EmptyState>
        ) : (
          <table className="acct-table">
            <thead>
              <tr>
                <th rowSpan={2}>رقم الحساب</th>
                <th rowSpan={2}>اسم الحساب</th>
                <th rowSpan={2}>النوع</th>
                <th colSpan={2}>رصيد أول المدة</th>
                <th colSpan={2}>الحركة خلال الفترة</th>
                <th colSpan={2}>رصيد آخر المدة</th>
              </tr>
              <tr>
                <th>مدين</th><th>دائن</th><th>مدين</th><th>دائن</th><th>مدين</th><th>دائن</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.o_account_id} className={r.o_is_group ? 'grp' : ''}>
                  <td className="num">{r.o_code}</td>
                  <td>
                    <span className="acct-lvl-pad" style={{ width: (r.o_level - 1) * 14 }} />
                    {r.o_name}
                  </td>
                  <td>{ACCOUNT_TYPES[r.o_type] || r.o_type}</td>
                  <td className="num">{money(r.o_open_debit)}</td>
                  <td className="num">{money(r.o_open_credit)}</td>
                  <td className="num">{money(r.o_period_debit)}</td>
                  <td className="num">{money(r.o_period_credit)}</td>
                  <td className="num">{money(r.o_close_debit)}</td>
                  <td className="num">{money(r.o_close_credit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>الإجمالي ({shown.length} حساباً)</td>
                <td className="num">{money(totals.od)}</td>
                <td className="num">{money(totals.oc)}</td>
                <td className="num">{money(totals.pd)}</td>
                <td className="num">{money(totals.pc)}</td>
                <td className="num">{money(totals.cd)}</td>
                <td className="num">{money(totals.cc)}</td>
              </tr>
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', color: balanced ? '#065F46' : '#991B1B' }}>
                  {balanced
                    ? '✓ الميزان متوازن — مجموع المدين يساوي مجموع الدائن'
                    : `⚠ فارق ${money(Math.abs(totals.cd - totals.cc))} ر.س — شغّل اختبار صحة الميزان أعلاه`}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      )}
    </AcctPage>
  )
}
