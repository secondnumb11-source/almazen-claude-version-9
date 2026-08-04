import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../AuthContext'
import {
  fetchAccounts, buildAccountTree, flattenTree, saveAccount, deleteAccount,
  money, ACCOUNT_TYPES,
} from '../../lib/accountingApi'
import {
  AcctPage, AcctFilters, Field, ExcelButton, PrintButton, RefreshButton,
  SearchBox, Notice, Modal, useConfirm, EmptyState,
} from '../../components/accounting/AcctKit'
import { Network, Plus, Pencil, Trash2, ChevronDown, ChevronLeft } from 'lucide-react'

/**
 * شجرة الحسابات — أصل وفروع لجميع الأقسام والإدارات والفروع.
 * العرض شجري قابل للطي حتى لا تزدحم الصفحة بمئات الحسابات دفعة واحدة.
 */
export default function ChartOfAccountsPage() {
  const { profile, company } = useAuth()
  const cid = profile?.company_id
  const { confirm, confirmNode } = useConfirm()

  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [edit, setEdit] = useState(null)

  const load = useCallback(async () => {
    if (!cid) return
    setBusy(true); setErr('')
    try { setRows(await fetchAccounts(cid)) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [cid])

  useEffect(() => { load() }, [load])

  const flat = useMemo(() => flattenTree(buildAccountTree(rows)), [rows])

  /* البحث يلغي الطي مؤقتاً: المستخدم يبحث ليجد، لا ليبحث ثم يفتح العقد يدوياً */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = flat
    if (q) list = list.filter(a => `${a.code} ${a.name}`.toLowerCase().includes(q))
    if (typeFilter !== 'all') list = list.filter(a => a.account_type === typeFilter)
    if (q || typeFilter !== 'all') return list
    const hidden = new Set()
    const walk = (node, hide) => {
      if (hide) hidden.add(node.id)
      const h = hide || collapsed.has(node.id)
      node.children?.forEach(c => walk(c, h))
    }
    buildAccountTree(rows).forEach(n => walk(n, false))
    return list.filter(a => !hidden.has(a.id))
  }, [flat, rows, search, typeFilter, collapsed])

  const excelRows = useMemo(() => flat.map(a => ({
    'رقم الحساب': a.code, 'اسم الحساب': a.name, 'المستوى': a.level + 1,
    'النوع': ACCOUNT_TYPES[a.account_type] || a.account_type,
    'حساب رئيسي': a.is_group ? 'نعم' : 'لا',
    'الرصيد الافتتاحي': Number(a.opening_balance || 0),
    'نشط': a.is_active ? 'نعم' : 'لا',
  })), [flat])

  const toggle = (id) => setCollapsed(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const doSave = async (acc) => {
    setBusy(true); setErr('')
    try { await saveAccount(cid, acc); setEdit(null); setOk('حُفظ الحساب'); await load() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const doDelete = (a) => confirm(
    `حذف الحساب ${a.code} — ${a.name}؟ لن يتم الحذف إن كانت عليه قيود.`,
    async () => {
      setBusy(true); setErr('')
      try { await deleteAccount(a.id); setOk('حُذف الحساب'); await load() }
      catch (e) { setErr('تعذّر الحذف — الحساب مستخدم في قيود محاسبية. عطّله بدل حذفه.') }
      finally { setBusy(false) }
    },
  )

  return (
    <AcctPage
      title="شجرة الحسابات"
      icon={<Network size={20} />}
      subtitle="أصل وفروع — لكل الأقسام والإدارات والفروع"
      tools={
        <>
          <button className="btn btn-gold btn-sm" onClick={() => setEdit({ account_type: 'asset', is_active: true })}>
            <Plus size={14} /> حساب جديد
          </button>
          <RefreshButton onClick={load} busy={busy} />
          <ExcelButton filename="شجرة-الحسابات.xlsx" sheet="شجرة الحسابات" rows={excelRows}
            numericCols={['الرصيد الافتتاحي']} onError={setErr} />
          <PrintButton docKind="statement" targetId="coa-print" title={`شجرة الحسابات — ${company?.name || ''}`} />
        </>
      }
    >
      <Notice kind="error" onClose={() => setErr('')}>{err}</Notice>
      <Notice kind="ok" onClose={() => setOk('')}>{ok}</Notice>

      <AcctFilters>
        <Field label="بحث" wide><SearchBox value={search} onChange={setSearch} placeholder="رقم أو اسم الحساب…" /></Field>
        <Field label="النوع">
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="all">كل الأنواع</option>
            {Object.entries(ACCOUNT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <span className="acct-hint">{flat.length} حساباً — {visible.length} معروض</span>
      </AcctFilters>

      <div id="coa-print" className="acct-table-wrap">
        {!visible.length && !busy ? <EmptyState>لا توجد حسابات مطابقة.</EmptyState> : (
          <table className="acct-table">
            <thead>
              <tr>
                <th>رقم الحساب</th><th>اسم الحساب</th><th>النوع</th>
                <th>رئيسي</th><th>الرصيد الافتتاحي</th><th>الحالة</th>
                <th className="no-print">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(a => (
                <tr key={a.id} className={a.is_group ? 'grp' : ''}>
                  <td className="num">{a.code}</td>
                  <td>
                    <span className="acct-lvl-pad" style={{ width: a.level * 16 }} />
                    {a.children?.length > 0 && (
                      <button type="button" className="coa-toggle no-print" onClick={() => toggle(a.id)}
                        title={collapsed.has(a.id) ? 'فتح الفروع' : 'طي الفروع'}>
                        {collapsed.has(a.id) ? <ChevronLeft size={13} /> : <ChevronDown size={13} />}
                      </button>
                    )}
                    <b style={{ fontWeight: a.is_group ? 800 : 500 }}>{a.name}</b>
                  </td>
                  <td>{ACCOUNT_TYPES[a.account_type] || a.account_type}</td>
                  <td>{a.is_group ? 'نعم' : '—'}</td>
                  <td className="num">{money(a.opening_balance)}</td>
                  <td>
                    <span className={'acct-badge ' + (a.is_active ? 'ok' : 'bad')}>
                      {a.is_active ? 'نشط' : 'معطّل'}
                    </span>
                  </td>
                  <td className="no-print">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEdit(a)}><Pencil size={13} /></button>
                    <button className="btn btn-ghost btn-sm" onClick={() => doDelete(a)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {edit && (
        <AccountForm
          value={edit} accounts={flat} onCancel={() => setEdit(null)} onSave={doSave} busy={busy}
        />
      )}
      {confirmNode}
    </AcctPage>
  )
}

function AccountForm({ value, accounts, onCancel, onSave, busy }) {
  const [f, setF] = useState({
    code: '', name: '', account_type: 'asset', parent_id: '', is_group: false,
    opening_balance: 0, is_active: true, ...value,
  })
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))

  return (
    <Modal title={value.id ? `تعديل الحساب ${value.code}` : 'حساب جديد'} onClose={onCancel}>
      <div className="acct-form">
        <label><span>رقم الحساب *</span><input value={f.code} onChange={e => set('code', e.target.value)} /></label>
        <label><span>اسم الحساب *</span><input value={f.name} onChange={e => set('name', e.target.value)} /></label>
        <label><span>النوع *</span>
          <select value={f.account_type} onChange={e => set('account_type', e.target.value)}>
            {Object.entries(ACCOUNT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label><span>الحساب الأصل</span>
          <select value={f.parent_id || ''} onChange={e => set('parent_id', e.target.value)}>
            <option value="">— حساب رئيسي بلا أصل —</option>
            {accounts.filter(a => a.id !== f.id).map(a => (
              <option key={a.id} value={a.id}>{'—'.repeat(a.level)} {a.code} — {a.name}</option>
            ))}
          </select>
        </label>
        <label><span>الرصيد الافتتاحي</span>
          <input type="number" step="0.01" value={f.opening_balance}
            onChange={e => set('opening_balance', e.target.value)} />
        </label>
        <label className="acct-chk">
          <input type="checkbox" checked={!!f.is_group} onChange={e => set('is_group', e.target.checked)} />
          حساب رئيسي (تجميعي — لا تُسجَّل عليه قيود مباشرة)
        </label>
        <label className="acct-chk">
          <input type="checkbox" checked={f.is_active !== false} onChange={e => set('is_active', e.target.checked)} />
          نشط
        </label>
      </div>
      <div className="acct-form-actions">
        <button className="btn btn-gold btn-sm" disabled={busy || !f.code || !f.name} onClick={() => onSave(f)}>حفظ</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>إلغاء</button>
      </div>
    </Modal>
  )
}
