import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../AuthContext'
import {
  glLedger, fetchAccounts, fetchCostCenters, money, ACCOUNT_TYPES, JE_STATUS,
} from '../../lib/accountingApi'
import { supabase } from '../../lib/supabase'
import {
  AcctPage, AcctFilters, Field, ExcelButton, PrintButton, RefreshButton, Notice, EmptyState,
} from '../../components/accounting/AcctKit'
import { BookOpen } from 'lucide-react'

const yearStart = () => `${new Date().getFullYear()}-01-01`
const today = () => new Date().toISOString().slice(0, 10)

/**
 * دفتر الأستاذ (كشف حساب الأستاذ).
 * حساب واحد أو كل الحسابات مجمّعة، مع رصيد جارٍ يبدأ من رصيد ما قبل الفترة
 * حتى تكون الأرقام قابلة للتوفيق مع ميزان المراجعة سطراً بسطر.
 */
export default function GeneralLedgerPage({ onOpenEntry }) {
  const { profile, company } = useAuth()
  const cid = profile?.company_id

  const [accounts, setAccounts] = useState([])
  const [centers, setCenters] = useState([])
  const [branches, setBranches] = useState([])

  const [account, setAccount] = useState('')
  const [from, setFrom] = useState(yearStart)
  const [to, setTo] = useState(today)
  const [costCenter, setCostCenter] = useState('')
  const [branch, setBranch] = useState('')
  const [includeDraft, setIncludeDraft] = useState(false)

  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!cid) return
    fetchAccounts(cid).then(a => setAccounts(a.filter(x => !x.is_group))).catch(e => setErr(e.message))
    fetchCostCenters(cid).then(setCenters).catch(() => {})
    supabase.from('branches').select('id, name').eq('company_id', cid)
      .then(({ data }) => setBranches(data || []))
  }, [cid])

  const load = useCallback(async () => {
    if (!cid) return
    setBusy(true); setErr('')
    try {
      const data = await glLedger({
        company_id: cid, account_id: account || null, from, to,
        cost_center_id: costCenter || null, branch_id: branch || null,
        include_draft: includeDraft,
      })
      setRows(data || [])
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [cid, account, from, to, costCenter, branch, includeDraft])

  useEffect(() => { load() }, [load])

  /* يقسّم الحركات إلى مجموعات حسب الحساب — الشكل المعتاد لكشف الأستاذ */
  const groups = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      if (!m.has(r.o_account_id)) {
        m.set(r.o_account_id, {
          id: r.o_account_id, code: r.o_account_code, name: r.o_account_name,
          type: r.o_account_type, opening: Number(r.o_opening || 0), lines: [],
        })
      }
      m.get(r.o_account_id).lines.push(r)
    }
    return [...m.values()].map(g => ({
      ...g,
      debit: g.lines.reduce((s, l) => s + Number(l.o_debit), 0),
      credit: g.lines.reduce((s, l) => s + Number(l.o_credit), 0),
      closing: g.lines.length ? Number(g.lines[g.lines.length - 1].o_balance) : g.opening,
    }))
  }, [rows])

  const excelRows = useMemo(() => rows.map(r => ({
    'رقم الحساب': r.o_account_code, 'اسم الحساب': r.o_account_name,
    'التاريخ': r.o_entry_date, 'رقم القيد': r.o_entry_number, 'المرجع': r.o_reference || '',
    'البيان': r.o_description || '', 'مركز التكلفة': r.o_cost_center || '', 'الفرع': r.o_branch || '',
    'مدين': Number(r.o_debit), 'دائن': Number(r.o_credit), 'الرصيد': Number(r.o_balance),
    'الحالة': JE_STATUS[r.o_status]?.label || r.o_status,
  })), [rows])

  const selectedName = account ? accounts.find(a => a.id === account) : null

  return (
    <AcctPage
      title="دفتر الأستاذ"
      icon={<BookOpen size={20} />}
      subtitle="كشف حساب الأستاذ: كل حركة على الحساب مع الرصيد الجاري بعدها"
      tools={
        <>
          <RefreshButton onClick={load} busy={busy} />
          <ExcelButton
            filename={`دفتر-الأستاذ-${from}_${to}.xlsx`} sheet="دفتر الأستاذ" rows={excelRows}
            numericCols={['مدين', 'دائن', 'الرصيد']} onError={setErr}
          />
          <PrintButton
            targetId="gl-print"
            title={`دفتر الأستاذ${selectedName ? ' — ' + selectedName.code + ' ' + selectedName.name : ''} — ${company?.name || ''}`}
          />
        </>
      }
    >
      <Notice kind="error" onClose={() => setErr('')}>{err}</Notice>

      <AcctFilters>
        <Field label="الحساب" wide>
          <select value={account} onChange={e => setAccount(e.target.value)}>
            <option value="">كل الحسابات (مجمّع)</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.code} — {a.name} ({ACCOUNT_TYPES[a.account_type]})</option>
            ))}
          </select>
        </Field>
        <Field label="من تاريخ"><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="إلى تاريخ"><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
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
          <input type="checkbox" checked={includeDraft} onChange={e => setIncludeDraft(e.target.checked)} />
          تضمين المسودات
        </label>
      </AcctFilters>

      <div id="gl-print" className="acct-table-wrap">
        {!groups.length && !busy ? (
          <EmptyState>لا توجد حركات على الحساب في هذه الفترة.</EmptyState>
        ) : groups.map(g => (
          <div key={g.id} className="gl-group">
            <div className="gl-group-head">
              <b>{g.code} — {g.name}</b>
              <span className="acct-badge">{ACCOUNT_TYPES[g.type] || g.type}</span>
              <span className="gl-group-open">رصيد ما قبل الفترة: <b>{money(g.opening)}</b></span>
            </div>
            <table className="acct-table">
              <thead>
                <tr>
                  <th>التاريخ</th><th>رقم القيد</th><th>المرجع</th><th>البيان</th>
                  <th>مركز التكلفة</th><th>مدين</th><th>دائن</th><th>الرصيد</th><th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                <tr className="gl-open-row">
                  <td colSpan={5}>رصيد أول المدة</td>
                  <td className="num">—</td><td className="num">—</td>
                  <td className="num"><b>{money(g.opening)}</b></td><td>—</td>
                </tr>
                {g.lines.map((l, i) => (
                  <tr key={l.o_entry_id + '-' + i}>
                    <td>{l.o_entry_date}</td>
                    <td>
                      <button type="button" className="gl-link no-print" onClick={() => onOpenEntry?.(l.o_entry_id)}>
                        {l.o_entry_number}
                      </button>
                      <span className="only-print">{l.o_entry_number}</span>
                    </td>
                    <td>{l.o_reference || '—'}</td>
                    <td>{l.o_description || '—'}</td>
                    <td>{l.o_cost_center || '—'}</td>
                    <td className="num">{Number(l.o_debit) ? money(l.o_debit) : '—'}</td>
                    <td className="num">{Number(l.o_credit) ? money(l.o_credit) : '—'}</td>
                    <td className="num"><b>{money(l.o_balance)}</b></td>
                    <td>
                      <span className="acct-badge" style={{ background: JE_STATUS[l.o_status]?.bg, color: JE_STATUS[l.o_status]?.color }}>
                        {JE_STATUS[l.o_status]?.label || l.o_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>إجمالي حركة الفترة</td>
                  <td className="num">{money(g.debit)}</td>
                  <td className="num">{money(g.credit)}</td>
                  <td className="num">{money(g.closing)}</td>
                  <td>رصيد آخر المدة</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}
      </div>
    </AcctPage>
  )
}
