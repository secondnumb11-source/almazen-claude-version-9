import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { useBranches } from '../BranchContext'
import { SAR } from '../lib/helpers'
import { syncExpenseToAccounting } from '../lib/accountingSync'

/**
 * المصالحة العميقة: طلب صيانة ← مصروف ← قيد محاسبي
 * -------------------------------------------------
 * تربط كل طلب صيانة له تكلفة بالمصروف المقابل له، ثم بالقيد المُرحّل في
 * دفتر اليومية، وتعرض للمحاسب سجل الترحيل خطوة بخطوة مع أسطر المدين/الدائن.
 */

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100
const dayDiff = (a, b) => {
  if (!a || !b) return null
  return Math.abs(Math.round((new Date(a) - new Date(b)) / 86400000))
}

const STATUS_META = {
  matched: { label: 'مطابق ومُرحّل', color: '#166534', bg: '#F0FDF4', border: '#BBF7D0', icon: '✅' },
  unposted: { label: 'مصروف بلا قيد', color: '#B45309', bg: '#FFFBEB', border: '#FDE68A', icon: '⚠️' },
  unbalanced: { label: 'قيد غير متوازن', color: '#991B1B', bg: '#FEF2F2', border: '#FECACA', icon: '❌' },
  mismatch: { label: 'فرق في المبلغ', color: '#991B1B', bg: '#FEF2F2', border: '#FECACA', icon: '❌' },
  no_expense: { label: 'طلب صيانة بلا مصروف', color: '#B45309', bg: '#FFFBEB', border: '#FDE68A', icon: '⚠️' },
}

export default function DeepMaintenanceReconciliation() {
  const { profile, toast } = useAuth()
  const { enabled: branchesOn, activeBranch, activeBranchName } = useBranches()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(null)
  const [filter, setFilter] = useState('all')
  const [repairing, setRepairing] = useState(null)

  const cid = profile?.company_id

  const run = async () => {
    if (!cid) return
    setLoading(true); setError(''); setOpen(null)
    try {
      let tktQ = supabase.from('maintenance_requests')
        .select('id, unit_id, request_type, description, cost, status, opened_at, closed_at, branch_id, units(unit_number)')
        .eq('company_id', cid).gt('cost', 0)
      if (branchesOn && activeBranch) tktQ = tktQ.eq('branch_id', activeBranch)
      const { data: tickets, error: e1 } = await tktQ.order('opened_at', { ascending: false }).limit(200)
      if (e1) throw e1

      const { data: expenses, error: e2 } = await supabase.from('expenses')
        .select('id, unit_id, category, amount, description, expense_date, vendor_name, invoice_url, created_at')
        .eq('company_id', cid)
        .in('category', ['maintenance', 'cleaning', 'elec_bill', 'water_bill', 'other_bill'])
        .order('expense_date', { ascending: false }).limit(500)
      if (e2) throw e2

      const { data: entries, error: e3 } = await supabase.from('journal_entries')
        .select('id, entry_number, entry_date, description, source_type, source_id, created_at')
        .eq('company_id', cid).order('entry_date', { ascending: false }).limit(5000)
      if (e3) throw e3

      const entryIds = (entries || []).map(e => e.id)
      const { data: lines, error: e4 } = entryIds.length
        ? await supabase.from('journal_entry_lines')
            .select('entry_id, debit, credit, description, chart_of_accounts(code, name)')
            .in('entry_id', entryIds)
        : { data: [] }
      if (e4) throw e4

      const linesByEntry = new Map()
      ;(lines || []).forEach(l => {
        const arr = linesByEntry.get(l.entry_id) || []
        arr.push({
          code: l.chart_of_accounts?.code || '—',
          accountName: l.chart_of_accounts?.name || 'حساب غير مرتبط',
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          description: l.description || '',
        })
        linesByEntry.set(l.entry_id, arr)
      })

      const entryBySource = new Map()
      ;(entries || []).forEach(e => { if (e.source_id) entryBySource.set(String(e.source_id), e) })

      const usedExpenses = new Set()
      const out = (tickets || []).map(t => {
        const cost = r2(t.cost)
        const refDate = t.closed_at || t.opened_at

        // مطابقة المصروف: نفس الوحدة + أقرب مبلغ + أقرب تاريخ
        const candidates = (expenses || [])
          .filter(x => !usedExpenses.has(x.id))
          .filter(x => (t.unit_id ? x.unit_id === t.unit_id : true))
          .map(x => ({
            exp: x,
            amountDiff: Math.abs(r2(x.amount) - cost),
            days: dayDiff(x.expense_date || x.created_at, refDate) ?? 999,
          }))
          .sort((a, b) => (a.amountDiff - b.amountDiff) || (a.days - b.days))

        const best = candidates.find(c => c.amountDiff <= 0.01 && c.days <= 30)
          || candidates.find(c => c.days <= 7)
          || null
        if (best) usedExpenses.add(best.exp.id)

        const exp = best?.exp || null
        const entry = exp ? (entryBySource.get(String(exp.id)) || null) : null
        const entryLines = entry ? (linesByEntry.get(entry.id) || []) : []
        const debit = r2(entryLines.reduce((s, l) => s + l.debit, 0))
        const credit = r2(entryLines.reduce((s, l) => s + l.credit, 0))
        const diff = r2(Math.abs(debit - credit))
        const amountDiff = exp ? r2(Math.abs(r2(exp.amount) - cost)) : null

        let status = 'matched'
        if (!exp) status = 'no_expense'
        else if (amountDiff > 0.01) status = 'mismatch'
        else if (!entry || entryLines.length === 0) status = 'unposted'
        else if (diff > 0.01) status = 'unbalanced'

        return {
          ticket: t, exp, entry, entryLines,
          cost, debit, credit, diff, amountDiff, status,
          unitLabel: t.units?.unit_number ? `وحدة ${t.units.unit_number}` : 'صيانة عامة',
        }
      })

      setRows(out)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  const repair = async (row) => {
    if (!row.exp) return toast('سجّل مصروفاً مطابقاً من شاشة الصيانة أولاً؛ لن ينشئ النظام مصروفاً مالياً بالتخمين.', true)
    if (!confirm(`إنشاء قيد محاسبي مرتبط بالمصروف ${SAR(row.exp.amount)}؟`)) return
    setRepairing(row.ticket.id)
    try {
      const result = await syncExpenseToAccounting(supabase, {
        companyId: cid,
        expenseId: row.exp.id,
        unitId: row.exp.unit_id,
        category: row.exp.category || 'maintenance',
        amount: row.exp.amount,
        description: row.exp.description || row.ticket.description || 'مصروف صيانة',
        paymentMethod: 'bank_transfer',
      })
      if (!result?.journalEntryId) throw new Error('لم يتم إنشاء القيد أو ربطه بالمصدر')
      toast('✓ تم إنشاء القيد الموزون وربطه بالمصروف الفعلي')
      await run()
    } catch (e) { toast('تعذّر الإصلاح: ' + e.message, true) }
    finally { setRepairing(null) }
  }

  const shown = filter === 'all' ? rows : rows.filter(r => (filter === 'issues' ? r.status !== 'matched' : r.status === 'matched'))
  const stats = {
    total: rows.length,
    matched: rows.filter(r => r.status === 'matched').length,
    issues: rows.filter(r => r.status !== 'matched').length,
    amount: r2(rows.reduce((s, r) => s + r.cost, 0)),
  }

  return (
    <div className="tool-card" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      <h4 style={{ margin: '0 0 6px' }}>🔗 المصالحة العميقة: صيانة ← مصروف ← قيد</h4>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        تربط كل طلب صيانة بتكلفة بالمصروف المقابل ثم بالقيد المُرحّل، وتعرض سجل الترحيل خطوة بخطوة للمحاسب
        {branchesOn && activeBranch ? ` — نطاق الفرع: ${activeBranchName}` : ''}.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-blue btn-sm" onClick={run} disabled={loading || !cid}>
          {loading ? '⏳ جاري تتبّع المسار...' : '▶️ تشغيل المصالحة العميقة'}
        </button>
        {rows.length > 0 && (
          <>
            <button className={'btn btn-sm ' + (filter === 'all' ? 'btn-gold' : 'btn-ghost')} onClick={() => setFilter('all')}>الكل ({stats.total})</button>
            <button className={'btn btn-sm ' + (filter === 'issues' ? 'btn-gold' : 'btn-ghost')} onClick={() => setFilter('issues')}>يحتاج مراجعة ({stats.issues})</button>
            <button className={'btn btn-sm ' + (filter === 'ok' ? 'btn-gold' : 'btn-ghost')} onClick={() => setFilter('ok')}>مطابق ({stats.matched})</button>
          </>
        )}
      </div>

      {error && <div style={{ marginTop: 12, color: '#B91C1C', fontSize: 13 }}>❌ {error}</div>}

      {rows.length > 0 && (
        <div style={{
          marginTop: 14, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700,
          border: `1px solid ${stats.issues ? '#FDE68A' : '#BBF7D0'}`,
          background: stats.issues ? '#FFFBEB' : '#F0FDF4',
          color: stats.issues ? '#92400E' : '#166534',
        }}>
          {stats.total} طلب صيانة بتكلفة إجمالية {SAR(stats.amount)} — مطابق ومُرحّل: {stats.matched} · يحتاج مراجعة: {stats.issues}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
        {shown.map((r) => {
          const meta = STATUS_META[r.status]
          const isOpen = open === r.ticket.id
          return (
            <div key={r.ticket.id} style={{ border: `1px solid ${meta.border}`, borderRadius: 10, background: meta.bg, overflow: 'hidden' }}>
              <button
                onClick={() => setOpen(isOpen ? null : r.ticket.id)}
                style={{
                  width: '100%', textAlign: 'start', border: 'none', background: 'transparent',
                  padding: '10px 12px', cursor: 'pointer', display: 'flex', gap: 10,
                  alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: meta.color }}>
                  {meta.icon} {r.unitLabel} — {r.ticket.request_type || 'صيانة'} · {SAR(r.cost)}
                </span>
                <span style={{ fontSize: 12, color: meta.color }}>
                  {meta.label} {isOpen ? '▲' : '▼'}
                </span>
              </button>

              {isOpen && (
                <div style={{ padding: '4px 14px 14px', background: 'var(--card)' }}>
                  <Step n={1} title="طلب الصيانة" ok>
                    <Kv k="الوحدة" v={r.unitLabel} />
                    <Kv k="النوع" v={r.ticket.request_type || '—'} />
                    <Kv k="الوصف" v={r.ticket.description || '—'} />
                    <Kv k="الحالة" v={r.ticket.status || '—'} />
                    <Kv k="التكلفة المعتمدة" v={SAR(r.cost)} />
                    <Kv k="تاريخ الإغلاق" v={(r.ticket.closed_at || r.ticket.opened_at || '').slice(0, 10) || '—'} />
                  </Step>

                  <Step n={2} title="المصروف المقابل" ok={!!r.exp && r.status !== 'mismatch'}>
                    {r.exp ? (
                      <>
                        <Kv k="التصنيف" v={r.exp.category} />
                        <Kv k="المبلغ" v={SAR(r.exp.amount)} />
                        <Kv k="المورّد" v={r.exp.vendor_name || '—'} />
                        <Kv k="التاريخ" v={(r.exp.expense_date || '').slice(0, 10) || '—'} />
                        <Kv k="فرق المبلغ عن الطلب" v={r.amountDiff > 0.01 ? `${SAR(r.amountDiff)} ⚠️` : 'لا يوجد'} />
                        <Kv k="الفاتورة" v={r.exp.invoice_url ? 'مرفقة ✅' : 'غير مرفقة'} />
                      </>
                    ) : <div style={{ fontSize: 12, color: '#B45309' }}>لم يُعثر على مصروف مطابق لهذا الطلب — يجب تسجيل المصروف قبل الترحيل.</div>}
                  </Step>

                  <Step n={3} title="القيد في دفتر اليومية" ok={!!r.entry && r.entryLines.length > 0 && r.diff <= 0.01}>
                    {r.entry ? (
                      <>
                        <Kv k="رقم القيد" v={r.entry.entry_number || '—'} />
                        <Kv k="تاريخ القيد" v={(r.entry.entry_date || '').slice(0, 10) || '—'} />
                        <Kv k="المصدر" v={`${r.entry.source_type || 'غير محدد'} · ${String(r.entry.source_id || '').slice(0, 8)}…`} />
                        <Kv k="البيان" v={r.entry.description || '—'} />
                      </>
                    ) : <div style={{ fontSize: 12, color: '#B45309' }}>المصروف لم يُرحّل بعد إلى دفتر اليومية (لا يوجد قيد بمصدر يطابق رقم المصروف).</div>}
                  </Step>

                  <Step n={4} title="تطابق المدين/الدائن" ok={r.entryLines.length > 0 && r.diff <= 0.01}>
                    {r.entryLines.length ? (
                      <div style={{ overflowX: 'auto' }}>
                        <table className="table" style={{ width: '100%', fontSize: 12 }}>
                          <thead>
                            <tr><th>الحساب</th><th>البيان</th><th>مدين</th><th>دائن</th></tr>
                          </thead>
                          <tbody>
                            {r.entryLines.map((l, i) => (
                              <tr key={i}>
                                <td>{l.code} — {l.accountName}</td>
                                <td>{l.description || '—'}</td>
                                <td>{l.debit ? SAR(l.debit) : '—'}</td>
                                <td>{l.credit ? SAR(l.credit) : '—'}</td>
                              </tr>
                            ))}
                            <tr style={{ fontWeight: 700 }}>
                              <td colSpan={2}>الإجمالي</td>
                              <td>{SAR(r.debit)}</td>
                              <td>{SAR(r.credit)}</td>
                            </tr>
                          </tbody>
                        </table>
                        <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: r.diff <= 0.01 ? '#166534' : '#991B1B' }}>
                          {r.diff <= 0.01 ? '✅ القيد متوازن تماماً (مدين = دائن)' : `❌ فرق غير متوازن: ${SAR(r.diff)}`}
                        </div>
                      </div>
                    ) : <div style={{ fontSize: 12, color: '#B45309' }}>لا توجد أسطر مدين/دائن لهذا المسار.</div>}
                  </Step>
                  {r.status !== 'matched' && (
                    <div style={{ marginTop: 10 }}>
                      <button className="btn btn-gold btn-sm" disabled={repairing === r.ticket.id || !r.exp || (r.entry && r.status !== 'unposted')} onClick={() => repair(r)}>
                        {repairing === r.ticket.id ? '⏳ جاري الإصلاح...' : r.exp && !r.entry ? '🛠️ إنشاء القيد وربطه بالمصروف' : 'يتطلب مراجعة يدوية'}
                      </button>
                    </div>
                  )}
                </div>
              )
              }
            </div>
          )
        })}
      </div>

      {!loading && rows.length === 0 && !error && (
        <div style={{ marginTop: 14, fontSize: 13, color: 'var(--muted)' }}>
          شغّل المصالحة لعرض مسار الترحيل الكامل لكل طلب صيانة بتكلفة.
        </div>
      )}
    </div>
  )
}

function Step({ n, title, ok, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px dashed var(--border)' }}>
      <div style={{
        flex: '0 0 26px', height: 26, borderRadius: '50%', display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800,
        background: ok ? '#DCFCE7' : '#FEF3C7', color: ok ? '#166534' : '#92400E',
      }}>{n}</div>
      <div style={{ flex: 1 }}>
        <b style={{ fontSize: 13 }}>{title}</b>
        <div style={{ marginTop: 4 }}>{children}</div>
      </div>
    </div>
  )
}

function Kv({ k, v }) {
  return (
    <div style={{ fontSize: 12, display: 'flex', gap: 6 }}>
      <span style={{ color: 'var(--muted)', minWidth: 130 }}>{k}:</span>
      <span style={{ fontWeight: 600 }}>{v}</span>
    </div>
  )
}
