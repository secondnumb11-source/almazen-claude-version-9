import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../AuthContext'
import {
  fetchDeferred, saveDeferred, deleteDeferred, recognizeDeferredLine,
  fetchAccounts, fetchCostCenters, fetchAccountingSettings, money,
} from '../../lib/accountingApi'
import {
  AcctPage, AcctFilters, Field, ExcelButton, PrintButton, RefreshButton,
  Notice, Modal, useConfirm, EmptyState,
} from '../../components/accounting/AcctKit'
import { CalendarClock, Plus, Trash2, CheckCircle2, ChevronDown, ChevronLeft } from 'lucide-react'

const today = () => new Date().toISOString().slice(0, 10)
const plusYear = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10) }

/**
 * قيود الإيرادات والنفقات المؤجلة.
 * الجدولة تولّد أقساط الاستحقاق، وكل قسط يُعترف به بقيدٍ مُرحَّل حقيقي
 * بين حساب التأجيل وحساب الاعتراف — لا مجرد سجل معلوماتي.
 */
export default function DeferredPage({ kind = 'revenue' }) {
  const { profile, company } = useAuth()
  const cid = profile?.company_id
  const { confirm, confirmNode } = useConfirm()

  const [rows, setRows] = useState([])
  const [accounts, setAccounts] = useState([])
  const [centers, setCenters] = useState([])
  const [settings, setSettings] = useState(null)
  const [open, setOpen] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [edit, setEdit] = useState(null)

  const isRev = kind === 'revenue'

  const load = useCallback(async () => {
    if (!cid) return
    setBusy(true); setErr('')
    try { setRows(await fetchDeferred(cid, kind)) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [cid, kind])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!cid) return
    fetchAccounts(cid).then(a => setAccounts(a.filter(x => !x.is_group))).catch(() => {})
    fetchCostCenters(cid).then(setCenters).catch(() => {})
    fetchAccountingSettings(cid).then(setSettings).catch(() => {})
  }, [cid])

  const totals = useMemo(() => rows.reduce((t, s) => ({
    total: t.total + Number(s.total_amount),
    done: t.done + Number(s.recognized_amount || 0),
  }), { total: 0, done: 0 }), [rows])

  const excelRows = useMemo(() => rows.flatMap(s => s.lines.map(l => ({
    'الجدولة': s.name, 'الإجمالي': Number(s.total_amount),
    'الدورية': PERIODICITY[s.periodicity] || s.periodicity,
    'الاحتساب': COMPUTATION[s.computation] || s.computation,
    'من': s.start_date, 'إلى': s.end_date,
    'تاريخ القسط': l.period_date, 'مبلغ القسط': Number(l.amount),
    'معترف به': l.recognized ? 'نعم' : 'لا',
  }))), [rows])

  const doSave = async (s) => {
    setBusy(true); setErr('')
    try { await saveDeferred(cid, { ...s, kind }); setEdit(null); setOk('حُفظت الجدولة وتولّدت أقساطها'); await load() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const doRecognize = (line) => confirm(
    `سيُنشأ قيد مُرحَّل بمبلغ ${money(line.amount)} ر.س بتاريخ ${line.period_date}. متابعة؟`,
    async () => {
      setBusy(true); setErr('')
      try { await recognizeDeferredLine(line.id); setOk('أُنشئ قيد الاستحقاق'); await load() }
      catch (e) { setErr(e.message) } finally { setBusy(false) }
    },
  )

  const doDelete = (s) => confirm(`حذف الجدولة "${s.name}" وكل أقساطها غير المعترف بها؟`, async () => {
    try { await deleteDeferred(s.id); setOk('حُذفت الجدولة'); await load() }
    catch (e) { setErr(e.message) }
  })

  const toggle = (id) => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <AcctPage
      title={isRev ? 'قيود الإيرادات المؤجلة' : 'قيود النفقات المؤجلة'}
      icon={<CalendarClock size={20} />}
      subtitle={isRev
        ? 'إيراد مقبوض لم يُستحق بعد — يُعترف به على فترات بقيود حقيقية'
        : 'مصروف مدفوع مقدماً — يُحمَّل على فترات بقيود حقيقية'}
      tools={
        <>
          <button className="btn btn-gold btn-sm" onClick={() => setEdit({
            periodicity: settings?.deferred_periodicity || 'monthly',
            computation: settings?.deferred_computation || 'by_months',
            start_date: today(), end_date: plusYear(),
            deferred_account_id: isRev ? settings?.deferred_revenue_account_id : settings?.deferred_expense_account_id,
          })}>
            <Plus size={14} /> جدولة جديدة
          </button>
          <RefreshButton onClick={load} busy={busy} />
          <ExcelButton filename={`${isRev ? 'الإيرادات' : 'النفقات'}-المؤجلة.xlsx`}
            sheet="الجدولة" rows={excelRows} numericCols={['الإجمالي', 'مبلغ القسط']} onError={setErr} />
          <PrintButton docKind="report" targetId="def-print" title={`${isRev ? 'الإيرادات' : 'النفقات'} المؤجلة — ${company?.name || ''}`} />
        </>
      }
    >
      <Notice kind="error" onClose={() => setErr('')}>{err}</Notice>
      <Notice kind="ok" onClose={() => setOk('')}>{ok}</Notice>

      <div className="acct-kpis">
        <div><span>إجمالي المؤجل</span><b>{money(totals.total)}</b></div>
        <div><span>المعترف به</span><b>{money(totals.done)}</b></div>
        <div className="due"><span>المتبقي</span><b>{money(totals.total - totals.done)}</b></div>
      </div>

      <div id="def-print" className="acct-table-wrap">
        {!rows.length && !busy ? (
          <EmptyState>لا توجد جدولات. أنشئ جدولة لتوزيع المبلغ على فترات الاستحقاق.</EmptyState>
        ) : (
          <table className="acct-table">
            <thead>
              <tr><th className="no-print" style={{ width: 34 }} /><th>الاسم</th><th>الإجمالي</th><th>المعترف به</th>
                <th>المتبقي</th><th>الدورية</th><th>الاحتساب</th><th>من</th><th>إلى</th>
                <th>الحالة</th><th className="no-print">إجراءات</th></tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <React.Fragment key={s.id}>
                  <tr>
                    <td className="no-print">
                      <button type="button" className="coa-toggle" onClick={() => toggle(s.id)}>
                        {open.has(s.id) ? <ChevronDown size={13} /> : <ChevronLeft size={13} />}
                      </button>
                    </td>
                    <td><b>{s.name}</b></td>
                    <td className="num">{money(s.total_amount)}</td>
                    <td className="num">{money(s.recognized_amount)}</td>
                    <td className="num">{money(Number(s.total_amount) - Number(s.recognized_amount))}</td>
                    <td>{PERIODICITY[s.periodicity]}</td>
                    <td>{COMPUTATION[s.computation]}</td>
                    <td>{s.start_date}</td><td>{s.end_date}</td>
                    <td><span className={'acct-badge ' + (s.status === 'done' ? 'ok' : 'warn')}>
                      {s.status === 'done' ? 'مكتملة' : 'جارية'}</span></td>
                    <td className="no-print">
                      <button className="btn btn-ghost btn-sm" onClick={() => doDelete(s)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                  {open.has(s.id) && s.lines.map(l => (
                    <tr key={l.id} className="def-line">
                      <td className="no-print" />
                      <td colSpan={3}>قسط {l.period_date}</td>
                      <td className="num">{money(l.amount)}</td>
                      <td colSpan={4}>{l.recognized ? 'تم إنشاء قيد الاستحقاق' : 'بانتظار الاعتراف'}</td>
                      <td><span className={'acct-badge ' + (l.recognized ? 'ok' : 'warn')}>
                        {l.recognized ? 'معترف به' : 'معلّق'}</span></td>
                      <td className="no-print">
                        {!l.recognized && (
                          <button className="btn btn-ghost btn-sm" onClick={() => doRecognize(l)} disabled={busy}>
                            <CheckCircle2 size={13} /> اعتراف
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {edit && (
        <Modal wide title={isRev ? 'جدولة إيراد مؤجل' : 'جدولة مصروف مؤجل'} onClose={() => setEdit(null)}>
          <DeferredForm value={edit} accounts={accounts} centers={centers} isRev={isRev}
            busy={busy} onSave={doSave} onCancel={() => setEdit(null)} />
        </Modal>
      )}
      {confirmNode}
    </AcctPage>
  )
}

const PERIODICITY = { monthly: 'شهري', quarterly: 'ربع سنوي', yearly: 'سنوي' }
const COMPUTATION = { by_months: 'بالأشهر', by_days: 'بالأيام' }

function DeferredForm({ value, accounts, centers, isRev, busy, onSave, onCancel }) {
  const [f, setF] = useState({ name: '', total_amount: 0, ...value })
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  return (
    <>
      <div className="acct-form">
        <label className="wide"><span>اسم الجدولة *</span><input value={f.name} onChange={e => set('name', e.target.value)} /></label>
        <label><span>المبلغ الإجمالي *</span>
          <input type="number" step="0.01" value={f.total_amount} onChange={e => set('total_amount', e.target.value)} />
        </label>
        <label><span>الدورية</span>
          <select value={f.periodicity} onChange={e => set('periodicity', e.target.value)}>
            {Object.entries(PERIODICITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label><span>الاحتساب</span>
          <select value={f.computation} onChange={e => set('computation', e.target.value)}>
            {Object.entries(COMPUTATION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label><span>من تاريخ *</span><input type="date" value={f.start_date} onChange={e => set('start_date', e.target.value)} /></label>
        <label><span>إلى تاريخ *</span><input type="date" value={f.end_date} onChange={e => set('end_date', e.target.value)} /></label>
        <label className="wide"><span>{isRev ? 'حساب الإيرادات المؤجلة (التزام)' : 'حساب المصروف المدفوع مقدماً (أصل)'} *</span>
          <select value={f.deferred_account_id || ''} onChange={e => set('deferred_account_id', e.target.value)}>
            <option value="">—</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </label>
        <label className="wide"><span>{isRev ? 'حساب الإيراد المعترف به' : 'حساب المصروف'} *</span>
          <select value={f.recognition_account_id || ''} onChange={e => set('recognition_account_id', e.target.value)}>
            <option value="">—</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </label>
        <label className="wide"><span>مركز التكلفة</span>
          <select value={f.cost_center_id || ''} onChange={e => set('cost_center_id', e.target.value)}>
            <option value="">—</option>
            {centers.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
        </label>
      </div>
      <div className="acct-form-actions">
        <button className="btn btn-gold btn-sm"
          disabled={busy || !f.name || !f.total_amount || !f.deferred_account_id || !f.recognition_account_id}
          onClick={() => onSave(f)}>حفظ وتوليد الأقساط</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>إلغاء</button>
      </div>
    </>
  )
}
