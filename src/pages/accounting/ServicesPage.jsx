import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../AuthContext'
import {
  fetchServices, saveService, deleteService, fetchAccounts, fetchTaxCodes,
  fetchCostCenters, money, computeVat,
} from '../../lib/accountingApi'
import {
  AcctPage, AcctFilters, Field, ExcelButton, PrintButton, RefreshButton,
  SearchBox, Notice, Modal, useConfirm, EmptyState,
} from '../../components/accounting/AcctKit'
import { Boxes, Plus, Pencil, Trash2 } from 'lucide-react'

/**
 * كتالوج الخدمات — كل بند مرتبط بحساب حقيقي في شجرة الحسابات
 * ورمز ضريبي، فينعكس أثره في الدفاتر عند استخدامه لا في الاسم فقط.
 */
export default function ServicesPage({ initialCategory }) {
  const { profile, company } = useAuth()
  const cid = profile?.company_id
  const { confirm, confirmNode } = useConfirm()

  const [rows, setRows] = useState([])
  const [accounts, setAccounts] = useState([])
  const [taxes, setTaxes] = useState([])
  const [centers, setCenters] = useState([])
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState(initialCategory || 'all')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [edit, setEdit] = useState(null)

  useEffect(() => { if (initialCategory) setCat(initialCategory) }, [initialCategory])

  const load = useCallback(async () => {
    if (!cid) return
    setBusy(true); setErr('')
    try { setRows(await fetchServices(cid)) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [cid])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!cid) return
    fetchAccounts(cid).then(a => setAccounts(a.filter(x => !x.is_group))).catch(() => {})
    fetchTaxCodes(cid).then(setTaxes).catch(() => {})
    fetchCostCenters(cid).then(setCenters).catch(() => {})
  }, [cid])

  const categories = useMemo(
    () => [...new Set(rows.map(r => r.category).filter(Boolean))].sort(), [rows])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r =>
      (cat === 'all' || r.category === cat) &&
      (!q || `${r.code} ${r.name} ${r.category || ''}`.toLowerCase().includes(q)))
  }, [rows, search, cat])

  const excelRows = useMemo(() => shown.map(r => {
    const rate = r.tax_codes?.rate || 0
    const { vat, gross } = computeVat(r.unit_price, rate)
    return {
      'الرمز': r.code, 'اسم الخدمة': r.name, 'التصنيف': r.category || '',
      'السعر قبل الضريبة': Number(r.unit_price), 'نسبة الضريبة': rate,
      'قيمة الضريبة': vat, 'السعر شامل الضريبة': gross,
      'التكلفة': Number(r.cost_price),
      'حساب الإيراد': r.income ? `${r.income.code} — ${r.income.name}` : '',
      'حساب المصروف': r.expense ? `${r.expense.code} — ${r.expense.name}` : '',
      'الحالة': r.is_active ? 'نشط' : 'معطّل',
    }
  }), [shown])

  const doSave = async (s) => {
    setBusy(true); setErr('')
    try { await saveService(cid, s); setEdit(null); setOk('حُفظت الخدمة'); await load() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const doDelete = (s) => confirm(`حذف الخدمة ${s.name}؟`, async () => {
    try { await deleteService(s.id); setOk('حُذفت الخدمة'); await load() }
    catch (e) { setErr(e.message) }
  })

  return (
    <AcctPage
      title={cat !== 'all' ? `الخدمات — ${cat}` : 'الخدمات'}
      icon={<Boxes size={20} />}
      subtitle="كل بند مرتبط بحسابه في شجرة الحسابات ورمزه الضريبي"
      tools={
        <>
          <button className="btn btn-gold btn-sm" onClick={() => setEdit({ is_active: true, uom: 'خدمة', unit_price: 0, cost_price: 0 })}>
            <Plus size={14} /> خدمة جديدة
          </button>
          <RefreshButton onClick={load} busy={busy} />
          <ExcelButton filename="الخدمات.xlsx" sheet="الخدمات" rows={excelRows}
            numericCols={['السعر قبل الضريبة', 'قيمة الضريبة', 'السعر شامل الضريبة', 'التكلفة']} onError={setErr} />
          <PrintButton targetId="srv-print" title={`الخدمات — ${company?.name || ''}`} />
        </>
      }
    >
      <Notice kind="error" onClose={() => setErr('')}>{err}</Notice>
      <Notice kind="ok" onClose={() => setOk('')}>{ok}</Notice>

      <AcctFilters>
        <Field label="بحث" wide><SearchBox value={search} onChange={setSearch} placeholder="رمز أو اسم الخدمة…" /></Field>
        <Field label="التصنيف">
          <select value={cat} onChange={e => setCat(e.target.value)}>
            <option value="all">كل التصنيفات</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <span className="acct-hint">{shown.length} من {rows.length} خدمة</span>
      </AcctFilters>

      <div id="srv-print" className="acct-table-wrap">
        {!shown.length && !busy ? <EmptyState>لا توجد خدمات مطابقة.</EmptyState> : (
          <table className="acct-table">
            <thead>
              <tr><th>الرمز</th><th>اسم الخدمة</th><th>التصنيف</th><th>السعر</th>
                <th>الضريبة</th><th>شامل الضريبة</th><th>الحساب المرتبط</th>
                <th>الحالة</th><th className="no-print">إجراءات</th></tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const rate = r.tax_codes?.rate || 0
                const { vat, gross } = computeVat(r.unit_price, rate)
                const acc = r.income || r.expense
                return (
                  <tr key={r.id}>
                    <td className="num">{r.code}</td>
                    <td>{r.name}</td>
                    <td>{r.category || '—'}</td>
                    <td className="num">{money(r.unit_price)}</td>
                    <td className="num">{rate ? `${money(vat)} (${rate}%)` : '—'}</td>
                    <td className="num">{money(gross)}</td>
                    <td>{acc ? `${acc.code} — ${acc.name}` : <span className="acct-badge bad">غير مرتبط</span>}</td>
                    <td><span className={'acct-badge ' + (r.is_active ? 'ok' : 'bad')}>{r.is_active ? 'نشط' : 'معطّل'}</span></td>
                    <td className="no-print">
                      <button className="btn btn-ghost btn-sm" onClick={() => setEdit(r)}><Pencil size={13} /></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => doDelete(r)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>الإجمالي ({shown.length})</td>
                <td className="num">{money(shown.reduce((t, r) => t + Number(r.unit_price), 0))}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {edit && (
        <Modal wide title={edit.id ? `تعديل ${edit.name}` : 'خدمة جديدة'} onClose={() => setEdit(null)}>
          <ServiceForm value={edit} accounts={accounts} taxes={taxes} centers={centers}
            categories={categories} busy={busy} onSave={doSave} onCancel={() => setEdit(null)} />
        </Modal>
      )}
      {confirmNode}
    </AcctPage>
  )
}

function ServiceForm({ value, accounts, taxes, centers, categories, busy, onSave, onCancel }) {
  const [f, setF] = useState({ code: '', name: '', unit_price: 0, cost_price: 0, is_active: true, ...value })
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const rate = taxes.find(t => t.id === f.tax_code_id)?.rate || 0
  const calc = computeVat(f.unit_price, rate)
  return (
    <>
      <div className="acct-form">
        <label><span>الرمز *</span><input value={f.code} onChange={e => set('code', e.target.value)} /></label>
        <label><span>اسم الخدمة *</span><input value={f.name} onChange={e => set('name', e.target.value)} /></label>
        <label><span>التصنيف</span>
          <input list="srv-cats" value={f.category || ''} onChange={e => set('category', e.target.value)} />
          <datalist id="srv-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
        </label>
        <label><span>وحدة القياس</span><input value={f.uom || ''} onChange={e => set('uom', e.target.value)} /></label>
        <label><span>السعر قبل الضريبة</span>
          <input type="number" step="0.01" value={f.unit_price} onChange={e => set('unit_price', e.target.value)} />
        </label>
        <label><span>التكلفة</span>
          <input type="number" step="0.01" value={f.cost_price} onChange={e => set('cost_price', e.target.value)} />
        </label>
        <label><span>الرمز الضريبي</span>
          <select value={f.tax_code_id || ''} onChange={e => set('tax_code_id', e.target.value)}>
            <option value="">بدون</option>
            {taxes.map(t => <option key={t.id} value={t.id}>{t.code} ({t.rate}%)</option>)}
          </select>
        </label>
        <label><span>مركز التكلفة</span>
          <select value={f.cost_center_id || ''} onChange={e => set('cost_center_id', e.target.value)}>
            <option value="">—</option>
            {centers.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
        </label>
        <label className="wide"><span>حساب الإيراد</span>
          <select value={f.income_account_id || ''} onChange={e => set('income_account_id', e.target.value)}>
            <option value="">—</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </label>
        <label className="wide"><span>حساب المصروف</span>
          <select value={f.expense_account_id || ''} onChange={e => set('expense_account_id', e.target.value)}>
            <option value="">—</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </label>
        <label className="wide"><span>الوصف</span>
          <input value={f.description || ''} onChange={e => set('description', e.target.value)} />
        </label>
        <label className="acct-chk">
          <input type="checkbox" checked={f.is_active !== false} onChange={e => set('is_active', e.target.checked)} /> نشط
        </label>
        <div className="acct-calcbox wide">
          الصافي {money(calc.net)} + ضريبة {money(calc.vat)} = <b>{money(calc.gross)} ر.س</b>
        </div>
      </div>
      <div className="acct-form-actions">
        <button className="btn btn-gold btn-sm" disabled={busy || !f.code || !f.name} onClick={() => onSave(f)}>حفظ</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>إلغاء</button>
      </div>
    </>
  )
}
