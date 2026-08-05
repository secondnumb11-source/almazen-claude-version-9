import React, { Suspense, lazy, useState } from 'react'
import { useAuth } from '../../AuthContext'
import { supabase } from '../../lib/supabase'
import { tbIntegrityCheck, tbRepair } from '../../lib/accountingApi'
import { AcctPage, Field, Notice, EmptyState, PrintButton, ExcelButton } from '../../components/accounting/AcctKit'
import { FlaskConical, Play, Wrench, ShieldCheck } from 'lucide-react'

/*
  مركز الاختبارات الذكية.
  كل اختبارات النظام في قائمة منسدلة واحدة بدل تناثر الأزرار داخل الصفحات.
  كل اختبار له زر إصلاح حقيقي عند اكتشاف خطأ — الإصلاح ينفّذ تغييراً في
  قاعدة البيانات ويُعاد الفحص بعده مباشرةً لإثبات النتيجة.
*/

/* حزم الاختبار القائمة في النظام — تُعرض هنا بدل تناثرها في تبويبات الصفحات */
const AccountingIntegrityTool = lazy(() => import('../../components/AccountingIntegrityTool'))
const UnitStatusTransitionTests = lazy(() => import('../../components/UnitStatusTransitionTests'))
const BranchSmartTests = lazy(() => import('../../components/BranchSmartTests'))
const DeepMaintenanceReconciliation = lazy(() => import('../../components/DeepMaintenanceReconciliation'))
const AutomatedMaintenanceReconciliationTool = lazy(() => import('../../components/AutomatedMaintenanceReconciliationTool'))
const LedgerRegressionTests = lazy(() => import('../AccountingSmartTests').then(m => ({ default: m.LedgerRegressionTests })))
const ChartOfAccountsTests = lazy(() => import('../AccountingSmartTests').then(m => ({ default: m.ChartOfAccountsTests })))
const JournalEntriesTests = lazy(() => import('../AccountingSmartTests').then(m => ({ default: m.JournalEntriesTests })))
const FullRegressionSuite = lazy(() => import('../AccountingSmartTests').then(m => ({ default: m.FullRegressionSuite })))

/** حزم مبنية كمكوّنات مستقلة — تُعرض كما هي داخل نفس القائمة المنسدلة. */
const COMPONENT_SUITES = [
  { id: 'c-engine', label: 'اختبارات محرك التصفية', icon: '⚖️', C: LedgerRegressionTests },
  { id: 'c-chart', label: 'اختبارات شجرة الحسابات', icon: '🌳', C: ChartOfAccountsTests },
  { id: 'c-journals', label: 'اختبارات القيود المُرحَّلة', icon: '📚', C: JournalEntriesTests },
  { id: 'c-regression', label: 'اختبار الانحدار الشامل', icon: '🚀', C: FullRegressionSuite },
  { id: 'c-integrity', label: 'سلامة القيود والأرصدة (الأداة التفصيلية)', icon: '🧮', C: AccountingIntegrityTool },
  { id: 'c-maint', label: 'مطابقة الصيانة الآلية', icon: '🛠️', C: AutomatedMaintenanceReconciliationTool },
  { id: 'c-deep', label: 'المطابقة العميقة للصيانة', icon: '🔬', C: DeepMaintenanceReconciliation },
  { id: 'c-unit', label: 'انتقالات حالة الوحدة', icon: '🏢', C: UnitStatusTransitionTests, superOnly: true },
  { id: 'c-branch', label: 'اختبارات الفروع الذكية', icon: '🏬', C: BranchSmartTests, superOnly: true },
  // نُقل اختبار عزل المنشآت إلى «لوحة التحكم الشاملة» في حسابات السوبر أدمن
  // حصراً — فهو يفحص الحدود بين المنشآت، ومكانه الطبيعي إدارة المنصة لا
  // مركز اختبارات المحاسبة الذي يخص منشأة واحدة.
]

const SUITES = [
  {
    id: 'tb', label: 'سلامة ميزان المراجعة والقيود', icon: '⚖️',
    desc: 'توازن كل قيد، القيود الفارغة، سلامة شجرة الحسابات، الفترات المالية، وتكرار الأرقام.',
    run: (cid) => tbIntegrityCheck(cid).then(rows => rows.map(r => ({
      code: r.o_code, title: r.o_title, status: r.o_status, detail: r.o_detail, fixable: r.o_fixable,
    }))),
    fix: (cid, code) => tbRepair(cid, code, false),
  },
  {
    id: 'stability', label: 'حزمة استقرار النظام الشاملة', icon: '🛡️',
    desc: 'المحاسبة، العزل بين المنشآت، أمن التخزين، صلاحيات الدوال، والفروع — على مستوى النظام كله.',
    superOnly: true,
    run: async () => {
      const { data, error } = await supabase.rpc('ci_stab_checks')
      if (error) throw new Error(error.message)
      return (data || []).map(r => ({
        code: r.o_suite, title: r.o_name, status: r.o_status, detail: r.o_message, fixable: !!r.o_fix, fixKey: r.o_fix,
      }))
    },
    fix: async (cid, code, row) => {
      if (!row?.fixKey) throw new Error('لا يوجد إصلاح آلي لهذا الفحص')
      // مفاتيح الإصلاح في ci_stab_checks هي نفسها check_id في ci_fix_catalog
      const { data, error } = await supabase.rpc('ci_apply_fix_to_all_users', { _check_id: row.fixKey })
      if (error) throw new Error(error.message)
      return data
    },
  },
  {
    id: 'perf', label: 'أداء النظام وسرعة فتح الأقسام', icon: '⚡',
    desc: 'يقيس زمن فتح كل قسم فعلياً من متصفحات المستخدمين، ويفحص الفهارس والصفوف الميتة وإحصاءات المخطِّط وجداول البث اللحظي. زر الإصلاح ينشئ الفهارس الناقصة ويقلّم السجلات ويحدّث الإحصاءات على مستوى النظام كله.',
    superOnly: true,
    run: async () => {
      const { data, error } = await supabase.rpc('ci_perf_checks')
      if (error) throw new Error(error.message)
      return (data || []).map(r => ({
        code: r.o_suite, title: r.o_name, status: r.o_status,
        detail: r.o_message, fixable: !!r.o_fix, fixKey: r.o_fix,
      }))
    },
    fix: async () => {
      const { data, error } = await supabase.rpc('perf_optimize_now', { p_dry: false })
      if (error) throw new Error(error.message)
      if (data && data.ok === false) throw new Error(data.error || 'تعذّر التسريع')
      return data
    },
  },
  {
    id: 'ota', label: 'سلامة طابور الربط مع منصات الحجز', icon: '🌐',
    desc: 'يتأكد أن كل نوع مهمة له منفّذ فعلي، وألا تتراكم مهام محكوم عليها بالفشل، وأن مُشغّل الطابور يعمل.',
    superOnly: true,
    run: async () => {
      const { data, error } = await supabase.rpc('ci_ota_checks')
      if (error) throw new Error(error.message)
      return (data || []).map(r => ({
        code: r.o_suite, title: r.o_name, status: r.o_status,
        detail: r.o_message, fixable: !!r.o_fix, fixKey: r.o_fix,
      }))
    },
    fix: async (cid, code, row) => {
      if (!row?.fixKey) throw new Error('لا يوجد إصلاح آلي — راجع الرسالة')
      const { data, error } = await supabase.rpc('ci_apply_fix_to_all_users', { _check_id: row.fixKey })
      if (error) throw new Error(error.message)
      return data
    },
  },
  {
    id: 'vouchers', label: 'ترحيل السندات اليدوية للدفاتر', icon: '🧾',
    desc: 'السند اليدوي يوثّق حركة نقدية حقيقية؛ فإن لم يصل الدفاتر اختفت الحركة من الأستاذ وميزان المراجعة وقائمة الدخل. هذا الفحص يكشف ذلك، وزر الإصلاح ينشئ القيد الناقص لكل المنشآت.',
    superOnly: true,
    run: async () => {
      const { data, error } = await supabase.rpc('ci_voucher_checks')
      if (error) throw new Error(error.message)
      return (data || []).map(r => ({
        code: r.o_suite, title: r.o_name, status: r.o_status,
        detail: r.o_message, fixable: !!r.o_fix, fixKey: r.o_fix,
      }))
    },
    fix: async () => {
      const { data, error } = await supabase.rpc('voucher_backfill_ledger', { p_dry: false })
      if (error) throw new Error(error.message)
      return data
    },
  },
  {
    id: 'posting', label: 'اكتمال ترحيل المستندات', icon: '📌',
    desc: 'يتأكد أن كل مصروف ودفعة لها قيد محاسبي — وهو الخلل الذي أخفى ١٬٨٩٩ ر.س سابقاً.',
    run: async (cid) => {
      const rows = await tbIntegrityCheck(cid)
      return rows.filter(r => ['TB01', 'TB02', 'TB04'].includes(r.o_code)).map(r => ({
        code: r.o_code, title: r.o_title, status: r.o_status, detail: r.o_detail, fixable: r.o_fixable,
      }))
    },
    fix: (cid, code) => tbRepair(cid, code, false),
  },
]

export default function TestsHubPage() {
  const { profile, isSuperAdmin, company } = useAuth()
  const cid = profile?.company_id

  const [sel, setSel] = useState('')
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  const suites = SUITES.filter(s => !s.superOnly || isSuperAdmin)
  const compSuites = COMPONENT_SUITES.filter(s => !s.superOnly || isSuperAdmin)
  const suite = suites.find(s => s.id === sel)
  const compSuite = compSuites.find(s => s.id === sel)

  const run = async () => {
    if (!suite) return
    setBusy(true); setErr(''); setOk(''); setRows(null)
    try { setRows(await suite.run(cid)) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const fix = async (row) => {
    setBusy(true); setErr(''); setOk('')
    try {
      const res = await suite.fix(cid, row.code, row)
      setOk('نُفِّذ الإصلاح: ' + summarize(res) + ' — أُعيد الفحص للتحقق')
      setRows(await suite.run(cid))
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const fixAll = async () => {
    setBusy(true); setErr(''); setOk('')
    try {
      const failing = (rows || []).filter(r => r.status === 'fail' && r.fixable)
      for (const r of failing) await suite.fix(cid, r.code, r)
      setOk(`نُفِّذ الإصلاح على ${failing.length} فحصاً — أُعيد الفحص للتحقق`)
      setRows(await suite.run(cid))
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const failCount = (rows || []).filter(r => r.status === 'fail').length
  const fixableCount = (rows || []).filter(r => r.status === 'fail' && r.fixable).length

  return (
    <AcctPage
      title="اختبارات ذكية لسلامة النظام"
      icon={<FlaskConical size={20} />}
      subtitle="اختر الحزمة، شغّلها، وأصلح ما يظهر من أخطاء بإصلاح حقيقي في قاعدة البيانات"
      tools={rows?.length ? (
        <>
          <ExcelButton filename={`نتائج-${suite?.label}.xlsx`} sheet="نتائج الفحص"
            rows={rows.map(r => ({ 'الرمز': r.code, 'الفحص': r.title, 'النتيجة': r.status === 'pass' ? 'سليم' : 'خطأ', 'التفصيل': r.detail || '' }))}
            onError={setErr} />
          <PrintButton docKind="report" targetId="tests-print" title={`${suite?.label} — ${company?.name || ''}`} />
        </>
      ) : null}
    >
      <div className="acct-hub tests">
        <div className="acct-hub-head">
          <ShieldCheck size={18} />
          <div>
            <b>اختر الاختبار الذي تريد تشغيله</b>
            <span>كل اختبار يفحص جانباً من سلامة النظام، وعند اكتشاف خطأ يظهر زر إصلاح ينفّذ تصحيحاً فعلياً</span>
          </div>
        </div>

        <div className="acct-hub-bar">
          <Field label="حزمة الاختبار" wide>
            <select value={sel} onChange={e => { setSel(e.target.value); setRows(null); setErr(''); setOk('') }}>
              <option value="">— اختر اختباراً —</option>
              <optgroup label="فحوص فورية بإصلاح آلي">
                {suites.map(s => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
              </optgroup>
              <optgroup label="حزم الاختبار التفصيلية">
                {compSuites.map(s => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
              </optgroup>
            </select>
          </Field>
          {!compSuite && <button className="btn btn-gold btn-sm" onClick={run} disabled={!suite || busy}>
            <Play size={14} /> {busy ? 'جارٍ الفحص…' : 'تشغيل الفحص'}
          </button>}
          {fixableCount > 0 && (
            <button className="btn btn-danger btn-sm" onClick={fixAll} disabled={busy}>
              <Wrench size={14} /> إصلاح كل الأخطاء ({fixableCount})
            </button>
          )}
        </div>
        {suite && <p className="acct-hub-desc">{suite.desc}</p>}
        {compSuite && <p className="acct-hub-desc">حزمة تفصيلية — تُعرض أدواتها كاملة أدناه بأزرار التشغيل والإصلاح الخاصة بها.</p>}
      </div>

      {compSuite && (
        <Suspense fallback={<EmptyState>جارٍ تحميل حزمة الاختبار…</EmptyState>}>
          <compSuite.C />
        </Suspense>
      )}

      <Notice kind="error" onClose={() => setErr('')}>{err}</Notice>
      <Notice kind="ok" onClose={() => setOk('')}>{ok}</Notice>

      {rows && (
        <>
          <div className="acct-kpis">
            <div><span>إجمالي الفحوص</span><b>{rows.length}</b></div>
            <div><span>سليم</span><b style={{ color: '#065F46' }}>{rows.length - failCount}</b></div>
            <div className={failCount ? 'due' : ''}><span>يحتاج إصلاح</span><b>{failCount}</b></div>
          </div>

          <div id="tests-print" className="acct-table-wrap">
            <table className="acct-table">
              <thead><tr><th>الرمز</th><th>الفحص</th><th>النتيجة</th><th>التفصيل</th><th className="no-print">إجراء</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.code + i}>
                    <td>{r.code}</td>
                    <td>{r.title}</td>
                    <td><span className={'acct-badge ' + (r.status === 'pass' ? 'ok' : 'bad')}>
                      {r.status === 'pass' ? 'سليم' : 'خطأ'}</span></td>
                    <td>{r.detail || '—'}</td>
                    <td className="no-print">
                      {r.status === 'fail' && r.fixable && (
                        <button className="btn btn-ghost btn-sm" onClick={() => fix(r)} disabled={busy}>
                          <Wrench size={12} /> إصلاح
                        </button>
                      )}
                      {r.status === 'fail' && !r.fixable && <small>يحتاج تصحيحاً يدوياً</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!rows && !busy && !compSuite && (
        <EmptyState>اختر حزمة اختبار من القائمة أعلاه ثم اضغط «تشغيل الفحص».</EmptyState>
      )}
    </AcctPage>
  )
}

function summarize(res) {
  if (!res) return 'تم'
  if (Array.isArray(res?.log)) return res.log.filter(l => l.rows).map(l => `${l.action} (${l.rows})`).join(' · ') || 'لا تغييرات مطلوبة'
  if (typeof res === 'object') return JSON.stringify(res).slice(0, 160)
  return String(res)
}
