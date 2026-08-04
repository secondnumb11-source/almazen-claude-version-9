import React, { useMemo, useState } from 'react'
import { useAuth } from '../../AuthContext'
import { supabase } from '../../lib/supabase'
import { money } from '../../lib/accountingApi'
import {
  AcctPage, Field, ExcelButton, PrintButton, Notice, EmptyState,
} from '../../components/accounting/AcctKit'
import { BarChart3, Play, FileText } from 'lucide-react'

const yearStart = () => `${new Date().getFullYear()}-01-01`
const today = () => new Date().toISOString().slice(0, 10)

/*
  مركز التقارير المحاسبية.
  كل التقارير في قائمة منسدلة واحدة بدل تناثرها داخل الصفحات:
  يختار المحاسب التقرير، فيظهر مربع البيانات والتواريخ، ثم يُصدر التقرير.
*/

const REPORTS = [
  { g: 'القوائم المالية', id: 'income', label: 'قائمة الدخل', fn: 'rpt_income_statement', params: ['from', 'to', 'cost_center', 'branch'], num: ['المبلغ'] },
  { g: 'القوائم المالية', id: 'income_group', label: 'قائمة الدخل حسب المجموعة', fn: 'rpt_income_statement', params: ['from', 'to'], groupBy: 'o_section', num: ['المبلغ'] },
  { g: 'القوائم المالية', id: 'balance', label: 'قائمة المركز المالي', fn: 'rpt_balance_sheet', params: ['as_of', 'branch'], num: ['المبلغ'] },
  { g: 'القوائم المالية', id: 'balance_group', label: 'المركز المالي حسب المجموعة', fn: 'rpt_balance_sheet', params: ['as_of'], groupBy: 'o_section', num: ['المبلغ'] },
  { g: 'القوائم المالية', id: 'cash', label: 'قائمة التدفقات النقدية', fn: 'rpt_cash_flow', params: ['from', 'to', 'branch'], num: ['المبلغ'] },
  { g: 'القوائم المالية', id: 'equity', label: 'قائمة التغيرات في حقوق الملكية', fn: 'rpt_balance_sheet', params: ['as_of'], filterSection: 'حقوق الملكية', num: ['المبلغ'] },

  { g: 'الرموز الضريبية', id: 'vat_full', label: 'المراجعة الضريبية (تفصيلي)', fn: 'vat_report', params: ['from', 'to'], num: ['الصافي', 'الضريبة', 'الإجمالي'] },
  { g: 'الرموز الضريبية', id: 'vat_sum', label: 'ملخص الضريبة', fn: 'rpt_vat_summary', params: ['from', 'to'], num: ['الصافي', 'الضريبة', 'الإجمالي'] },
  { g: 'الرموز الضريبية', id: 'vat_rec', label: 'مطابقة حساب الضريبة', fn: 'rpt_vat_reconcile', params: ['from', 'to'], num: ['المبلغ'] },

  { g: 'العملاء', id: 'ar_aging', label: 'جدول أعمار الذمم المدينة', fn: 'rpt_ar_aging', params: ['as_of'], num: ['الإجمالي', 'المسدد', 'المستحق'] },
  { g: 'العملاء', id: 'cust_sum', label: 'ملخص العملاء', fn: 'rpt_customer_summary', params: ['from', 'to'], num: ['إجمالي الفواتير', 'المسدد', 'الرصيد'] },
  { g: 'العملاء', id: 'cust_stmt', label: 'كشف حساب العميل (العمليات)', fn: 'rpt_party_statement', params: ['party', 'from', 'to'], num: ['مدين', 'دائن', 'الرصيد'] },

  { g: 'الموردون', id: 'ap_aging', label: 'جدول أعمار الذمم الدائنة', fn: 'rpt_ap_aging', params: ['as_of'], num: ['المبلغ'] },
  { g: 'الموردون', id: 'vend_stmt', label: 'كشف حساب المورد (العمليات)', fn: 'rpt_party_statement', params: ['party', 'from', 'to'], num: ['مدين', 'دائن', 'الرصيد'] },

  { g: 'الأصول الثابتة', id: 'fa', label: 'ملخص الأصول الثابتة', fn: 'rpt_fixed_assets', params: [], num: ['التكلفة', 'مجمع الإهلاك', 'القيمة الدفترية'] },

  { g: 'الحسابات', id: 'tb', label: 'ميزان المراجعة', fn: 'trial_balance', params: ['from', 'to', 'cost_center', 'branch'], num: ['رصيد أول المدة مدين', 'رصيد أول المدة دائن', 'الحركة مدين', 'الحركة دائن', 'رصيد آخر المدة مدين', 'رصيد آخر المدة دائن'] },
  { g: 'الحسابات', id: 'gl', label: 'دفتر الأستاذ (كل الحسابات)', fn: 'gl_ledger', params: ['from', 'to', 'cost_center', 'branch'], num: ['مدين', 'دائن', 'الرصيد'] },
]

/** أسماء عربية لأعمدة الإخراج القادمة من دوال القاعدة. */
const COL_LABELS = {
  o_section: 'القسم', o_code: 'الرمز', o_name: 'البيان', o_amount: 'المبلغ',
  o_bucket: 'النوع', o_doc_type: 'المستند', o_doc_number: 'الرقم', o_doc: 'المستند',
  o_doc_date: 'التاريخ', o_date: 'التاريخ', o_party: 'الطرف', o_customer: 'العميل',
  o_net: 'الصافي', o_vat: 'الضريبة', o_gross: 'الإجمالي', o_count: 'العدد',
  o_total: 'الإجمالي', o_paid: 'المسدد', o_due: 'المستحق', o_days: 'عدد الأيام',
  o_invoices: 'عدد الفواتير', o_billed: 'إجمالي الفواتير', o_balance: 'الرصيد',
  o_debit: 'مدين', o_credit: 'دائن', o_description: 'الشرح', o_item: 'البند', o_note: 'ملاحظة',
  o_purchase_date: 'تاريخ الشراء', o_cost: 'التكلفة', o_accumulated: 'مجمع الإهلاك',
  o_book_value: 'القيمة الدفترية', o_category: 'التصنيف',
  o_account_id: 'م', o_code_: 'الرمز', o_type: 'النوع',
  o_open_debit: 'رصيد أول المدة مدين', o_open_credit: 'رصيد أول المدة دائن',
  o_period_debit: 'الحركة مدين', o_period_credit: 'الحركة دائن',
  o_close_debit: 'رصيد آخر المدة مدين', o_close_credit: 'رصيد آخر المدة دائن',
  o_account_code: 'رقم الحساب', o_account_name: 'اسم الحساب', o_account_type: 'النوع',
  o_entry_number: 'رقم القيد', o_entry_date: 'التاريخ', o_reference: 'المرجع',
  o_status: 'الحالة', o_opening: 'رصيد افتتاحي', o_cost_center: 'مركز التكلفة', o_branch: 'الفرع',
  o_parent_id: '', o_is_group: 'رئيسي', o_level: 'المستوى', o_entry_id: '',
}

const HIDDEN_COLS = new Set(['o_account_id', 'o_parent_id', 'o_entry_id'])

export default function ReportsHubPage() {
  const { profile, company } = useAuth()
  const cid = profile?.company_id

  const [sel, setSel] = useState('')
  const [from, setFrom] = useState(yearStart)
  const [to, setTo] = useState(today)
  const [asOf, setAsOf] = useState(today)
  const [party, setParty] = useState('')
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const report = REPORTS.find(r => r.id === sel)
  const grouped = useMemo(() => {
    const m = new Map()
    REPORTS.forEach(r => { if (!m.has(r.g)) m.set(r.g, []); m.get(r.g).push(r) })
    return [...m.entries()]
  }, [])

  const run = async () => {
    if (!report) return
    setBusy(true); setErr(''); setRows(null)
    try {
      const args = { p_company: cid }
      if (report.params.includes('from')) args.p_from = from
      if (report.params.includes('to')) args.p_to = to
      if (report.params.includes('as_of')) args.p_as_of = asOf
      if (report.params.includes('party')) args.p_party = party || null
      if (report.fn === 'trial_balance') { args.p_include_zero = false; args.p_include_draft = false; args.p_cost_center = null; args.p_branch = null }
      if (report.fn === 'gl_ledger') { args.p_account = null; args.p_cost_center = null; args.p_branch = null; args.p_include_draft = false }
      if (report.fn === 'rpt_income_statement') { args.p_cost_center = null; args.p_branch = null }
      if (report.fn === 'rpt_balance_sheet' || report.fn === 'rpt_cash_flow') args.p_branch = null

      const { data, error } = await supabase.rpc(report.fn, args)
      if (error) throw new Error(error.message)
      let out = data || []
      if (report.filterSection) out = out.filter(r => r.o_section === report.filterSection || r.o_section === 'الإجمالي')
      setRows(out)
      if (!out.length) setErr('التقرير صدر بنجاح لكن لا توجد بيانات مطابقة للفترة المختارة.')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const cols = useMemo(() => {
    if (!rows?.length) return []
    return Object.keys(rows[0]).filter(k => !HIDDEN_COLS.has(k))
  }, [rows])

  const excelRows = useMemo(() => (rows || []).map(r => {
    const o = {}
    cols.forEach(c => { o[COL_LABELS[c] || c] = r[c] })
    return o
  }), [rows, cols])

  return (
    <AcctPage
      title="مركز التقارير المحاسبية"
      icon={<BarChart3 size={20} />}
      subtitle="كل التقارير في مكان واحد — اختر التقرير، حدّد الفترة، ثم أصدره"
      tools={rows?.length ? (
        <>
          <ExcelButton filename={`${report?.label || 'تقرير'}.xlsx`} sheet={report?.label || 'تقرير'}
            rows={excelRows} numericCols={report?.num || []} onError={setErr} />
          <PrintButton docKind="report" targetId="rpt-print" title={`${report?.label} — ${company?.name || ''}`} />
        </>
      ) : null}
    >
      <div className="acct-hub">
        <div className="acct-hub-head">
          <FileText size={18} />
          <div>
            <b>اختر التقرير الذي تريد إصداره</b>
            <span>{REPORTS.length} تقريراً محاسبياً متصلاً بدفاتر النظام مباشرةً</span>
          </div>
        </div>

        <div className="acct-hub-bar">
          <Field label="التقرير" wide>
            <select value={sel} onChange={e => { setSel(e.target.value); setRows(null); setErr('') }}>
              <option value="">— اختر تقريراً —</option>
              {grouped.map(([g, list]) => (
                <optgroup key={g} label={g}>
                  {list.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>

          {report?.params.includes('from') && (
            <Field label="من تاريخ"><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
          )}
          {report?.params.includes('to') && (
            <Field label="إلى تاريخ"><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
          )}
          {report?.params.includes('as_of') && (
            <Field label="كما في تاريخ"><input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} /></Field>
          )}
          {report?.params.includes('party') && (
            <Field label="اسم الطرف"><input value={party} onChange={e => setParty(e.target.value)} placeholder="اسم العميل أو المورد (اتركه فارغاً للكل)" /></Field>
          )}

          <button className="btn btn-gold btn-sm" onClick={run} disabled={!report || busy}>
            <Play size={14} /> {busy ? 'جارٍ الإصدار…' : 'إصدار التقرير'}
          </button>
        </div>
      </div>

      <Notice kind={rows && !rows.length ? 'warn' : 'error'} onClose={() => setErr('')}>{err}</Notice>

      {rows?.length > 0 && (
        <div id="rpt-print" className="acct-table-wrap">
          <table className="acct-table">
            <thead>
              <tr>{cols.map(c => <th key={c}>{COL_LABELS[c] || c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={r.o_section === 'الإجمالي' || r.o_code === 'NET' || r.o_code === 'DIFF' ? 'grp' : ''}>
                  {cols.map(c => (
                    <td key={c} className={typeof r[c] === 'number' ? 'num' : ''}>
                      {typeof r[c] === 'number' ? money(r[c]) : (r[c] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!rows && !busy && (
        <EmptyState>اختر تقريراً من القائمة المنسدلة أعلاه ثم اضغط «إصدار التقرير».</EmptyState>
      )}
    </AcctPage>
  )
}
