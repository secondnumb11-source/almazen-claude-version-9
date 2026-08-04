import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../AuthContext'
import {
  fetchTaxCodes, saveTaxCode, deleteTaxCode, vatReport, fetchAccounts, money,
} from '../../lib/accountingApi'
import {
  AcctPage, AcctFilters, Field, ExcelButton, PrintButton, RefreshButton,
  Notice, Modal, useConfirm, EmptyState,
} from '../../components/accounting/AcctKit'
import { Percent, Plus, Pencil, Trash2 } from 'lucide-react'

const yearStart = () => `${new Date().getFullYear()}-01-01`
const today = () => new Date().toISOString().slice(0, 10)

/**
 * مركز ضريبة القيمة المضافة: رموز الضريبة وحساباتها، وتقرير مفصّل
 * بالمخرجات والمدخلات وصافي المستحق للهيئة.
 */
export default function TaxCenterPage() {
  const { profile, company } = useAuth()
  const cid = profile?.company_id
  const { confirm, confirmNode } = useConfirm()

  const [tab, setTab] = useState('report')
  const [codes, setCodes] = useState([])
  const [accounts, setAccounts] = useState([])
  const [rows, setRows] = useState([])
  const [from, setFrom] = useState(yearStart)
  const [to, setTo] = useState(today)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [edit, setEdit] = useState(null)

  const loadCodes = useCallback(async () => {
    if (!cid) return
    try { setCodes(await fetchTaxCodes(cid)) } catch (e) { setErr(e.message) }
  }, [cid])

  const loadReport = useCallback(async () => {
    if (!cid) return
    setBusy(true); setErr('')
    try { setRows(await vatReport(cid, from, to) || []) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [cid, from, to])

  useEffect(() => { loadCodes() }, [loadCodes])
  useEffect(() => { if (tab === 'report') loadReport() }, [tab, loadReport])
  useEffect(() => {
    if (cid) fetchAccounts(cid).then(a => setAccounts(a.filter(x => !x.is_group))).catch(() => {})
  }, [cid])

  const totals = useMemo(() => rows.reduce((t, r) => {
    const out = r.o_bucket === 'مخرجات'
    return {
      outNet: t.outNet + (out ? Number(r.o_net) : 0), outVat: t.outVat + (out ? Number(r.o_vat) : 0),
      inNet: t.inNet + (out ? 0 : Number(r.o_net)), inVat: t.inVat + (out ? 0 : Number(r.o_vat)),
    }
  }, { outNet: 0, outVat: 0, inNet: 0, inVat: 0 }), [rows])

  const due = totals.outVat - totals.inVat

  const excelRows = useMemo(() => rows.map(r => ({
    'النوع': r.o_bucket, 'المستند': r.o_doc_type, 'الرقم': r.o_doc_number, 'التاريخ': r.o_doc_date,
    'الطرف': r.o_party || '', 'الصافي': Number(r.o_net), 'الضريبة': Number(r.o_vat), 'الإجمالي': Number(r.o_gross),
  })), [rows])

  const doSave = async (t) => {
    setBusy(true); setErr('')
    try { await saveTaxCode(cid, t); setEdit(null); setOk('حُفظ الرمز الضريبي'); await loadCodes() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const doDelete = (t) => confirm(`حذف الرمز ${t.code}؟`, async () => {
    try { await deleteTaxCode(t.id); setOk('حُذف الرمز'); await loadCodes() }
    catch { setErr('تعذّر الحذف — الرمز مستخدم في قيود. عطّله بدل حذفه.') }
  })

  return (
    <AcctPage
      title="ضريبة القيمة المضافة"
      icon={<Percent size={20} />}
      subtitle="رموز الضريبة وحساباتها، وتقرير المخرجات والمدخلات وصافي المستحق"
      tools={
        <>
          {tab === 'codes' && (
            <button className="btn btn-gold btn-sm" onClick={() => setEdit({ rate: 15, kind: 'both', is_active: true })}>
              <Plus size={14} /> رمز ضريبي
            </button>
          )}
          {tab === 'report' && (
            <>
              <RefreshButton onClick={loadReport} busy={busy} />
              <ExcelButton filename={`تقرير-الضريبة-${from}_${to}.xlsx`} sheet="ضريبة القيمة المضافة"
                rows={excelRows} numericCols={['الصافي', 'الضريبة', 'الإجمالي']} onError={setErr} />
              <PrintButton targetId="vat-print" title={`تقرير ضريبة القيمة المضافة — ${company?.name || ''} — من ${from} إلى ${to}`} />
            </>
          )}
        </>
      }
    >
      <Notice kind="error" onClose={() => setErr('')}>{err}</Notice>
      <Notice kind="ok" onClose={() => setOk('')}>{ok}</Notice>

      <div className="acct-tabs">
        <button className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')}>تقرير الضريبة</button>
        <button className={tab === 'codes' ? 'on' : ''} onClick={() => setTab('codes')}>رموز الضريبة</button>
      </div>

      {tab === 'report' && (
        <>
          <AcctFilters>
            <Field label="من تاريخ"><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
            <Field label="إلى تاريخ"><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
          </AcctFilters>

          <div className="acct-kpis">
            <div><span>ضريبة المخرجات</span><b>{money(totals.outVat)}</b></div>
            <div><span>ضريبة المدخلات</span><b>{money(totals.inVat)}</b></div>
            <div className={due >= 0 ? 'due' : 'refund'}>
              <span>{due >= 0 ? 'المستحق للهيئة' : 'المسترد من الهيئة'}</span>
              <b>{money(Math.abs(due))}</b>
            </div>
          </div>

          <div id="vat-print" className="acct-table-wrap">
            {!rows.length && !busy ? <EmptyState>لا توجد عمليات خاضعة للضريبة في هذه الفترة.</EmptyState> : (
              <table className="acct-table">
                <thead>
                  <tr><th>النوع</th><th>المستند</th><th>الرقم</th><th>التاريخ</th><th>الطرف</th>
                    <th>الصافي</th><th>الضريبة</th><th>الإجمالي</th></tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td><span className={'acct-badge ' + (r.o_bucket === 'مخرجات' ? 'ok' : 'warn')}>{r.o_bucket}</span></td>
                      <td>{r.o_doc_type}</td><td>{r.o_doc_number}</td><td>{r.o_doc_date}</td>
                      <td>{r.o_party || '—'}</td>
                      <td className="num">{money(r.o_net)}</td>
                      <td className="num">{money(r.o_vat)}</td>
                      <td className="num">{money(r.o_gross)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5}>الإجمالي ({rows.length} عملية)</td>
                    <td className="num">{money(totals.outNet + totals.inNet)}</td>
                    <td className="num">{money(totals.outVat + totals.inVat)}</td>
                    <td className="num">{money(totals.outNet + totals.inNet + totals.outVat + totals.inVat)}</td>
                  </tr>
                  <tr>
                    <td colSpan={8}>
                      صافي الضريبة = مخرجات {money(totals.outVat)} − مدخلات {money(totals.inVat)} ={' '}
                      <b>{money(Math.abs(due))} ر.س {due >= 0 ? 'مستحقة للهيئة' : 'مستردة'}</b>
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'codes' && (
        <div className="acct-table-wrap">
          {!codes.length ? <EmptyState>لا توجد رموز ضريبية.</EmptyState> : (
            <table className="acct-table">
              <thead>
                <tr><th>الرمز</th><th>الاسم</th><th>النسبة</th><th>النطاق</th>
                  <th>حساب الضريبة</th><th>افتراضي</th><th>الحالة</th><th>إجراءات</th></tr>
              </thead>
              <tbody>
                {codes.map(t => (
                  <tr key={t.id}>
                    <td className="num">{t.code}</td><td>{t.name}</td>
                    <td className="num">{t.rate}%</td>
                    <td>{{ sales: 'مبيعات', purchase: 'مشتريات', both: 'الكل' }[t.kind]}</td>
                    <td>{t.chart_of_accounts ? `${t.chart_of_accounts.code} — ${t.chart_of_accounts.name}` : '⚠ غير مرتبط'}</td>
                    <td>{t.is_default ? '✓' : '—'}</td>
                    <td><span className={'acct-badge ' + (t.is_active ? 'ok' : 'bad')}>{t.is_active ? 'نشط' : 'معطّل'}</span></td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEdit(t)}><Pencil size={13} /></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => doDelete(t)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {edit && (
        <Modal title={edit.id ? `تعديل ${edit.code}` : 'رمز ضريبي جديد'} onClose={() => setEdit(null)}>
          <TaxForm value={edit} accounts={accounts} busy={busy} onSave={doSave} onCancel={() => setEdit(null)} />
        </Modal>
      )}
      {confirmNode}
    </AcctPage>
  )
}

function TaxForm({ value, accounts, busy, onSave, onCancel }) {
  const [f, setF] = useState({ code: '', name: '', rate: 15, kind: 'both', is_active: true, ...value })
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  return (
    <>
      <div className="acct-form">
        <label><span>الرمز *</span><input value={f.code} onChange={e => set('code', e.target.value)} /></label>
        <label><span>الاسم *</span><input value={f.name} onChange={e => set('name', e.target.value)} /></label>
        <label><span>النسبة %</span><input type="number" step="0.001" value={f.rate} onChange={e => set('rate', e.target.value)} /></label>
        <label><span>النطاق</span>
          <select value={f.kind} onChange={e => set('kind', e.target.value)}>
            <option value="sales">مبيعات (مخرجات)</option>
            <option value="purchase">مشتريات (مدخلات)</option>
            <option value="both">الكل</option>
          </select>
        </label>
        <label className="wide"><span>حساب الضريبة</span>
          <select value={f.account_id || ''} onChange={e => set('account_id', e.target.value)}>
            <option value="">— غير مرتبط —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </label>
        <label className="acct-chk">
          <input type="checkbox" checked={!!f.is_default} onChange={e => set('is_default', e.target.checked)} /> افتراضي
        </label>
        <label className="acct-chk">
          <input type="checkbox" checked={f.is_active !== false} onChange={e => set('is_active', e.target.checked)} /> نشط
        </label>
      </div>
      <div className="acct-form-actions">
        <button className="btn btn-gold btn-sm" disabled={busy || !f.code || !f.name} onClick={() => onSave(f)}>حفظ</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>إلغاء</button>
      </div>
    </>
  )
}
