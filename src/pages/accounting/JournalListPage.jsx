import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../AuthContext'
import { fetchEntries, postEntry, money, JE_STATUS } from '../../lib/accountingApi'
import {
  AcctPage, AcctFilters, Field, ExcelButton, PrintButton, RefreshButton,
  SearchBox, Notice, EmptyState,
} from '../../components/accounting/AcctKit'
import { ListChecks, Plus, Eye, Pencil, CheckCircle2 } from 'lucide-react'
import JournalEditor from './JournalEditor'

const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-01-01` }
const today = () => new Date().toISOString().slice(0, 10)

/**
 * ملخص القيود المسجلة + تقرير القيود.
 * النقر على رقم القيد أو الشرح يفتح القيد كاملاً بتفاصيله وسطوره،
 * قابلاً للتعديل إن كان مسودة وللعكس إن كان مُرحَّلاً.
 */
export default function JournalListPage({ initialEntryId, mode = 'summary' }) {
  const { profile, company } = useAuth()
  const cid = profile?.company_id

  const [openId, setOpenId] = useState(initialEntryId ?? undefined)
  const [rows, setRows] = useState([])
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  const load = useCallback(async () => {
    if (!cid) return
    setBusy(true); setErr('')
    try { setRows(await fetchEntries(cid, { from, to, status, search })) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [cid, from, to, status, search])

  useEffect(() => { if (openId === undefined) load() }, [load, openId])

  const totals = useMemo(() => rows.reduce(
    (t, r) => ({ d: t.d + r.total_debit, c: t.c + r.total_credit }), { d: 0, c: 0 }), [rows])

  const excelRows = useMemo(() => rows.map(r => ({
    'رقم القيد': r.entry_number, 'التاريخ': r.entry_date, 'الشرح': r.description || '',
    'المرجع': r.reference || '', 'المصدر': r.source_type, 'عدد السطور': r.line_count,
    'مدين': r.total_debit, 'دائن': r.total_credit,
    'الحالة': JE_STATUS[r.status]?.label || r.status,
  })), [rows])

  const quickPost = async (id) => {
    setBusy(true); setErr('')
    try { await postEntry(id); setOk('تم الترحيل'); await load() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  if (openId !== undefined) {
    return (
      <JournalEditor
        entryId={openId || null}
        onDone={() => { setOpenId(undefined); load() }}
        onOpenEntry={(id) => setOpenId(id)}
      />
    )
  }

  const isReport = mode === 'report'

  return (
    <AcctPage
      title={isReport ? 'تقرير القيود المحاسبية' : 'ملخص القيود المسجلة'}
      icon={<ListChecks size={20} />}
      subtitle="انقر رقم القيد أو شرحه لفتحه بتفاصيله الكاملة مع التعديل والحذف والقيد العكسي"
      tools={
        <>
          <button className="btn btn-gold btn-sm" onClick={() => setOpenId(null)}>
            <Plus size={14} /> قيد محاسبي جديد
          </button>
          <RefreshButton onClick={load} busy={busy} />
          <ExcelButton filename={`القيود-${from}_${to}.xlsx`} sheet="القيود المحاسبية"
            rows={excelRows} numericCols={['مدين', 'دائن']} onError={setErr} />
          <PrintButton docKind="report" targetId="jl-print" title={`القيود المحاسبية — ${company?.name || ''} — من ${from} إلى ${to}`} />
        </>
      }
    >
      <Notice kind="error" onClose={() => setErr('')}>{err}</Notice>
      <Notice kind="ok" onClose={() => setOk('')}>{ok}</Notice>

      <AcctFilters>
        <Field label="من تاريخ"><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="إلى تاريخ"><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
        <Field label="الحالة">
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="all">كل الحالات</option>
            <option value="draft">مسودة</option>
            <option value="posted">مُرحَّل</option>
            <option value="void">ملغى</option>
          </select>
        </Field>
        <Field label="بحث" wide>
          <SearchBox value={search} onChange={setSearch} placeholder="رقم القيد أو الشرح أو المرجع…" />
        </Field>
      </AcctFilters>

      <div id="jl-print" className="acct-table-wrap">
        {!rows.length && !busy ? (
          <EmptyState>لا توجد قيود في هذه الفترة. ابدأ بإنشاء قيد محاسبي جديد.</EmptyState>
        ) : (
          <table className="acct-table">
            <thead>
              <tr>
                <th>رقم القيد</th><th>التاريخ</th><th>الشرح</th><th>المرجع</th>
                <th>المصدر</th><th>مدين</th><th>دائن</th><th>الحالة</th>
                <th className="no-print">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const st = JE_STATUS[r.status] || {}
                const bal = Math.abs(r.total_debit - r.total_credit) < 0.01
                return (
                  <tr key={r.id}>
                    <td>
                      <button type="button" className="gl-link no-print" onClick={() => setOpenId(r.id)}>{r.entry_number}</button>
                      <span className="only-print">{r.entry_number}</span>
                    </td>
                    <td>{r.entry_date}</td>
                    <td>
                      <button type="button" className="gl-link no-print" onClick={() => setOpenId(r.id)}>
                        {r.description || '—'}
                      </button>
                      <span className="only-print">{r.description || '—'}</span>
                      {r.reversal_of_id && <span className="acct-badge warn">قيد عكسي</span>}
                      {r.reversed_by_id && <span className="acct-badge warn">مَعكوس</span>}
                    </td>
                    <td>{r.reference || '—'}</td>
                    <td>{SOURCE_LABEL[r.source_type] || r.source_type}</td>
                    <td className="num">{money(r.total_debit)}</td>
                    <td className="num">{money(r.total_credit)}</td>
                    <td>
                      <span className="acct-badge" style={{ background: st.bg, color: st.color }}>{st.label || r.status}</span>
                      {!bal && <span className="acct-badge bad">غير متوازن</span>}
                    </td>
                    <td className="no-print">
                      <button className="btn btn-ghost btn-sm" onClick={() => setOpenId(r.id)} title="عرض / تحرير">
                        {r.status === 'draft' ? <Pencil size={13} /> : <Eye size={13} />}
                      </button>
                      {r.status === 'draft' && bal && (
                        <button className="btn btn-ghost btn-sm" onClick={() => quickPost(r.id)} title="ترحيل مباشر">
                          <CheckCircle2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>الإجمالي ({rows.length} قيداً)</td>
                <td className="num">{money(totals.d)}</td>
                <td className="num">{money(totals.c)}</td>
                <td colSpan={2}>
                  {Math.abs(totals.d - totals.c) < 0.01 ? '✓ متوازن' : `⚠ فارق ${money(Math.abs(totals.d - totals.c))}`}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </AcctPage>
  )
}

const SOURCE_LABEL = {
  manual: 'يدوي', reversal: 'قيد عكسي', deferred: 'استحقاق مؤجل',
  payment: 'دفعة', expense: 'مصروف', invoice: 'فاتورة', booking: 'حجز',
}
