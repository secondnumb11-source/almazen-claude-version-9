import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../AuthContext'
import {
  fetchCostCenters, saveCostCenter, deleteCostCenter, trialBalance,
  money, COST_CENTER_KINDS,
} from '../../lib/accountingApi'
import { supabase } from '../../lib/supabase'
import {
  AcctPage, AcctFilters, Field, ExcelButton, PrintButton, RefreshButton,
  SearchBox, Notice, Modal, useConfirm, EmptyState,
} from '../../components/accounting/AcctKit'
import { Target, Plus, Pencil, Trash2, BarChart3 } from 'lucide-react'

const yearStart = () => `${new Date().getFullYear()}-01-01`
const today = () => new Date().toISOString().slice(0, 10)

/**
 * مراكز التكلفة — تحدّد المصروف تابع لأي إدارة وتحت أي بند ولأي فرع أو وحدة.
 * كل مركز يعرض تحميله الفعلي من القيود المرحّلة، لا رقماً تعريفياً فقط.
 */
export default function CostCentersPage() {
  const { profile, company } = useAuth()
  const cid = profile?.company_id
  const { confirm, confirmNode } = useConfirm()

  const [rows, setRows] = useState([])
  const [branches, setBranches] = useState([])
  const [units, setUnits] = useState([])
  const [loads, setLoads] = useState({})
  const [from, setFrom] = useState(yearStart)
  const [to, setTo] = useState(today)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [edit, setEdit] = useState(null)

  const load = useCallback(async () => {
    if (!cid) return
    setBusy(true); setErr('')
    try { setRows(await fetchCostCenters(cid)) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [cid])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!cid) return
    supabase.from('branches').select('id, name').eq('company_id', cid).then(({ data }) => setBranches(data || []))
    supabase.from('units').select('id, unit_number').eq('company_id', cid).limit(500)
      .then(({ data }) => setUnits(data || []))
  }, [cid])

  /* تحميل كل مركز: مجموع الحركة على قيوده خلال الفترة */
  const loadLoads = useCallback(async () => {
    if (!cid || !rows.length) return
    setBusy(true)
    try {
      const out = {}
      for (const c of rows) {
        const tb = await trialBalance({ company_id: cid, from, to, cost_center_id: c.id, include_zero: false })
        out[c.id] = (tb || []).reduce((t, r) => ({
          d: t.d + Number(r.o_period_debit), c: t.c + Number(r.o_period_credit),
        }), { d: 0, c: 0 })
      }
      setLoads(out)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [cid, rows, from, to])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? rows.filter(r => `${r.code} ${r.name}`.toLowerCase().includes(q)) : rows
  }, [rows, search])

  const excelRows = useMemo(() => shown.map(r => ({
    'الرمز': r.code, 'الاسم': r.name, 'النوع': COST_CENTER_KINDS[r.kind] || r.kind,
    'الفرع': r.branches?.name || '', 'الوحدة': r.units?.unit_number || '',
    'مدين خلال الفترة': loads[r.id]?.d || 0, 'دائن خلال الفترة': loads[r.id]?.c || 0,
    'الحالة': r.is_active ? 'نشط' : 'معطّل',
  })), [shown, loads])

  const doSave = async (cc) => {
    setBusy(true); setErr('')
    try { await saveCostCenter(cid, cc); setEdit(null); setOk('حُفظ مركز التكلفة'); await load() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const doDelete = (c) => confirm(`حذف مركز التكلفة ${c.code} — ${c.name}؟`, async () => {
    setBusy(true)
    try { await deleteCostCenter(c.id); setOk('حُذف المركز'); await load() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  })

  return (
    <AcctPage
      title="مراكز التكلفة"
      icon={<Target size={20} />}
      subtitle="لكل مصروف إدارة وبند وفرع ووحدة — والتحميل يُحتسب من القيود المرحّلة فعلاً"
      tools={
        <>
          <button className="btn btn-gold btn-sm" onClick={() => setEdit({ kind: 'department', is_active: true })}>
            <Plus size={14} /> مركز جديد
          </button>
          <button className="btn btn-ghost btn-sm" onClick={loadLoads} disabled={busy}>
            <BarChart3 size={14} /> احتساب التحميل
          </button>
          <RefreshButton onClick={load} busy={busy} />
          <ExcelButton filename="مراكز-التكلفة.xlsx" sheet="مراكز التكلفة" rows={excelRows}
            numericCols={['مدين خلال الفترة', 'دائن خلال الفترة']} onError={setErr} />
          <PrintButton docKind="report" targetId="cc-print" title={`مراكز التكلفة — ${company?.name || ''}`} />
        </>
      }
    >
      <Notice kind="error" onClose={() => setErr('')}>{err}</Notice>
      <Notice kind="ok" onClose={() => setOk('')}>{ok}</Notice>

      <AcctFilters>
        <Field label="بحث" wide><SearchBox value={search} onChange={setSearch} placeholder="رمز أو اسم المركز…" /></Field>
        <Field label="من تاريخ"><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="إلى تاريخ"><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
      </AcctFilters>

      <div id="cc-print" className="acct-table-wrap">
        {!shown.length && !busy ? <EmptyState>لا توجد مراكز تكلفة بعد.</EmptyState> : (
          <table className="acct-table">
            <thead>
              <tr>
                <th>الرمز</th><th>الاسم</th><th>النوع</th><th>الفرع</th><th>الوحدة</th>
                <th>مدين</th><th>دائن</th><th>الحالة</th><th className="no-print">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.id} className={r.is_group ? 'grp' : ''}>
                  <td className="num">{r.code}</td>
                  <td>{r.name}</td>
                  <td>{COST_CENTER_KINDS[r.kind] || r.kind}</td>
                  <td>{r.branches?.name || '—'}</td>
                  <td>{r.units?.unit_number || '—'}</td>
                  <td className="num">{loads[r.id] ? money(loads[r.id].d) : '—'}</td>
                  <td className="num">{loads[r.id] ? money(loads[r.id].c) : '—'}</td>
                  <td><span className={'acct-badge ' + (r.is_active ? 'ok' : 'bad')}>{r.is_active ? 'نشط' : 'معطّل'}</span></td>
                  <td className="no-print">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEdit(r)}><Pencil size={13} /></button>
                    <button className="btn btn-ghost btn-sm" onClick={() => doDelete(r)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {edit && (
        <Modal title={edit.id ? `تعديل ${edit.code}` : 'مركز تكلفة جديد'} onClose={() => setEdit(null)}>
          <CostCenterForm value={edit} parents={rows} branches={branches} units={units}
            onCancel={() => setEdit(null)} onSave={doSave} busy={busy} />
        </Modal>
      )}
      {confirmNode}
    </AcctPage>
  )
}

function CostCenterForm({ value, parents, branches, units, onCancel, onSave, busy }) {
  const [f, setF] = useState({ code: '', name: '', kind: 'department', is_active: true, ...value })
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  return (
    <>
      <div className="acct-form">
        <label><span>الرمز *</span><input value={f.code} onChange={e => set('code', e.target.value)} placeholder="CC-001" /></label>
        <label><span>الاسم *</span><input value={f.name} onChange={e => set('name', e.target.value)} /></label>
        <label><span>النوع</span>
          <select value={f.kind} onChange={e => set('kind', e.target.value)}>
            {Object.entries(COST_CENTER_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label><span>المركز الأصل</span>
          <select value={f.parent_id || ''} onChange={e => set('parent_id', e.target.value)}>
            <option value="">— بلا أصل —</option>
            {parents.filter(p => p.id !== f.id).map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select>
        </label>
        <label><span>الفرع</span>
          <select value={f.branch_id || ''} onChange={e => set('branch_id', e.target.value)}>
            <option value="">—</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label><span>الوحدة</span>
          <select value={f.unit_id || ''} onChange={e => set('unit_id', e.target.value)}>
            <option value="">—</option>
            {units.map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
          </select>
        </label>
        <label className="acct-chk">
          <input type="checkbox" checked={!!f.is_group} onChange={e => set('is_group', e.target.checked)} />
          مركز تجميعي
        </label>
        <label className="acct-chk">
          <input type="checkbox" checked={f.is_active !== false} onChange={e => set('is_active', e.target.checked)} />
          نشط
        </label>
        <label className="wide"><span>ملاحظات</span><input value={f.notes || ''} onChange={e => set('notes', e.target.value)} /></label>
      </div>
      <div className="acct-form-actions">
        <button className="btn btn-gold btn-sm" disabled={busy || !f.code || !f.name} onClick={() => onSave(f)}>حفظ</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>إلغاء</button>
      </div>
    </>
  )
}
