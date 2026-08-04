import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { useBranches } from '../BranchContext'
import { SAR } from '../lib/helpers'
import BranchFilter from '../components/BranchFilter'
import DeepMaintenanceReconciliation from '../components/DeepMaintenanceReconciliation'
import AutomatedMaintenanceReconciliationTool from '../components/AutomatedMaintenanceReconciliationTool'
import AccountingIntegrityTool from '../components/AccountingIntegrityTool'
import BranchSmartTests from '../components/BranchSmartTests'
import UnitStatusTransitionTests from '../components/UnitStatusTransitionTests'
import {
  LedgerRegressionTests, ChartOfAccountsTests, JournalEntriesTests,
  FullRegressionSuite, ScopeNotice,
} from './AccountingSmartTests'
import { runRepair } from '../lib/accountingRepairs'

/**
 * صفحة تقرير التدقيق المحاسبي
 * ------------------------------
 * مركز موحّد للتدقيق: القيود المُرحّلة والتصفيات + جميع الاختبارات الذكية
 * للمحاسبة (التسوية الآلية، المصالحة العميقة، محرك التصفية، شجرة الحسابات،
 * القيود، والانحدار الشامل) موزّعة على مجموعات واضحة.
 */


const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100

const SOURCE_AR = {
  settlement: 'تصفية عقد',
  booking: 'حجز',
  payment: 'دفعة',
  invoice: 'فاتورة',
  expense: 'مصروف',
  cancellation: 'إلغاء حجز',
  manual: 'قيد يدوي',
  maintenance: 'صيانة',
}

export default function AuditReport() {
  const { profile, isSuperAdmin, company } = useAuth()
  const { enabled: branchesOn, activeBranch, activeBranchName } = useBranches()
  const [tab, setTab] = useState('ledger')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [entries, setEntries] = useState([])
  const [q, setQ] = useState('')
  const [source, setSource] = useState('all')
  const [balance, setBalance] = useState('all')
  const [detail, setDetail] = useState(null)
  const [repairing, setRepairing] = useState(null)

  const cid = profile?.company_id

  const load = async () => {
    if (!cid) return
    setLoading(true); setError('')
    try {
      let entriesQ = supabase.from('journal_entries')
        .select('id, entry_number, entry_date, description, source_type, source_id, branch_id, created_at')
        .eq('company_id', cid)
      if (branchesOn && activeBranch) entriesQ = entriesQ.eq('branch_id', activeBranch)
      const AUDIT_ROW_CAP = 5000
      const { data: rows, error: e1 } = await entriesQ.order('entry_date', { ascending: false }).limit(AUDIT_ROW_CAP)
      if (e1) throw e1

      const ids = (rows || []).map(e => e.id)
      const { data: lines } = ids.length
        ? await supabase.from('journal_entry_lines')
            .select('entry_id, debit, credit, description, chart_of_accounts(code, name)')
            .in('entry_id', ids)
        : { data: [] }

      const byEntry = new Map()
      ;(lines || []).forEach(l => {
        const arr = byEntry.get(l.entry_id) || []
        arr.push({
          code: l.chart_of_accounts?.code || '—',
          accountName: l.chart_of_accounts?.name || 'حساب غير مرتبط',
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          description: l.description || '',
        })
        byEntry.set(l.entry_id, arr)
      })

      setEntries((rows || []).map(e => {
        const ls = byEntry.get(e.id) || []
        const debit = r2(ls.reduce((s, l) => s + l.debit, 0))
        const credit = r2(ls.reduce((s, l) => s + l.credit, 0))
        const diff = r2(Math.abs(debit - credit))
        const hasLines = ls.length > 0
        const orphanAccount = ls.some(l => l.code === '—')
        const missingSource = !!e.source_type && e.source_type !== 'manual' && !e.source_id
        return {
          ...e, lines: ls, debit, credit, diff, hasLines, orphanAccount, missingSource,
          balanced: hasLines && diff <= 0.01,
        }
      }))
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [cid, activeBranch, branchesOn])

  const sources = useMemo(
    () => [...new Set(entries.map(e => e.source_type || 'manual'))],
    [entries]
  )

  const filtered = entries.filter(e => {
    if (source !== 'all' && (e.source_type || 'manual') !== source) return false
    if (balance === 'balanced' && !e.balanced) return false
    if (balance === 'issues' && e.balanced && !e.missingSource && !e.orphanAccount) return false
    if (q) {
      const hay = `${e.entry_number || ''} ${e.description || ''} ${e.source_type || ''} ${e.source_id || ''}`.toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  })

  const totals = {
    count: filtered.length,
    debit: r2(filtered.reduce((s, e) => s + e.debit, 0)),
    credit: r2(filtered.reduce((s, e) => s + e.credit, 0)),
    unbalanced: filtered.filter(e => !e.balanced).length,
    noSource: filtered.filter(e => e.missingSource).length,
    orphan: filtered.filter(e => e.orphanAccount).length,
    settlements: entries.filter(e => e.source_type === 'settlement').length,
  }
  const grandDiff = r2(Math.abs(totals.debit - totals.credit))

  const exportCsv = () => {
    const head = ['رقم القيد', 'التاريخ', 'المصدر', 'رقم المصدر', 'البيان', 'مدين', 'دائن', 'الفرق', 'الحالة']
    const body = filtered.map(e => [
      e.entry_number || '', (e.entry_date || '').slice(0, 10),
      SOURCE_AR[e.source_type] || e.source_type || 'غير محدد',
      e.source_id || '', (e.description || '').replace(/[",\n]/g, ' '),
      e.debit, e.credit, e.diff, e.balanced ? 'متوازن' : (e.hasLines ? 'غير متوازن' : 'بلا أسطر'),
    ])
    const csv = '\uFEFF' + [head, ...body].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url; a.download = `audit-report-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const repairEntry = async (entry) => {
    const action = !entry.hasLines ? 'orphans' : entry.orphanAccount ? 'chart' : entry.missingSource ? 'dangling_source' : !entry.balanced ? 'unbalanced' : null
    if (!action) return
    if (!confirm('سيتم تنفيذ إصلاح محاسبي مقيّد ببيانات منشأتك ثم إعادة الفحص. متابعة؟')) return
    setRepairing(entry.id)
    const result = await runRepair(action, { companyId: cid })
    setRepairing(null)
    if (!result.ok) return setError(result.message)
    await load()
  }

  // مجموعات منظّمة: التدقيق ثم الاختبارات الذكية للمحاسبة (منقولة إلى هنا)
  const SUPER_ONLY = ['unitstatus', 'integrity', 'branches']
  const groups = [
    {
      title: 'التدقيق المحاسبي',
      items: [
        { k: 'ledger', label: 'تدقيق القيود والتصفيات', icon: '📖' },
        { k: 'deep', label: 'المصالحة العميقة (صيانة ↔ مصروف)', icon: '🔗' },
        { k: 'maint', label: 'التسوية الآلية للصيانة والخدمات', icon: '🔧' },
      ],
    },
    {
      title: 'الاختبارات الذكية للمحاسبة',
      items: [
        { k: 'engine', label: 'اختبارات محرك التصفية', icon: '⚖️' },
        { k: 'chart', label: 'اختبارات شجرة الحسابات', icon: '🌳' },
        { k: 'journals', label: 'اختبارات القيود المُرحَّلة', icon: '📚' },
        { k: 'regression', label: 'اختبار الانحدار الشامل', icon: '🚀' },
        ...(isSuperAdmin ? [
          { k: 'unitstatus', label: 'انتقالات حالة الوحدة', icon: '🔁' },
          { k: 'integrity', label: 'سلامة المحاسبة الشاملة', icon: '🛡️' },
          { k: 'branches', label: 'سيناريوهات الفروع', icon: '🏢' },
        ] : []),
      ],
    },
  ]
  const activeTab = (!isSuperAdmin && SUPER_ONLY.includes(tab)) ? 'ledger' : tab
  const isTestsTab = activeTab !== 'ledger'

  return (
    <div className="panel" style={{ padding: 20 }}>
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0 }}>🧾 تقرير التدقيق المحاسبي</h2>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
            القيود المُرحّلة والتصفيات وجميع الاختبارات الذكية للمحاسبة في مكان واحد — للتأكد من صحة جميع الحسابات
            {branchesOn && activeBranch ? ` — نطاق الفرع: ${activeBranchName}` : ''}
          </div>
        </div>
        <BranchFilter label="نطاق الفرع" />
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 18, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
        {groups.map(g => (
          <div key={g.title} style={{ minWidth: 220 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', marginBottom: 6, letterSpacing: 0.3 }}>
              {g.title}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {g.items.map(t => (
                <button key={t.k} className={'btn btn-sm ' + (activeTab === t.k ? 'btn-gold' : 'btn-ghost')} onClick={() => setTab(t.k)}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {isTestsTab && <ScopeNotice isSuperAdmin={isSuperAdmin} companyName={company?.name} companyId={profile?.company_id} />}

      {activeTab === 'deep' && <DeepMaintenanceReconciliation />}
      {activeTab === 'maint' && <AutomatedMaintenanceReconciliationTool />}
      {activeTab === 'engine' && <LedgerRegressionTests />}
      {activeTab === 'chart' && <ChartOfAccountsTests />}
      {activeTab === 'journals' && <JournalEntriesTests />}
      {activeTab === 'regression' && <FullRegressionSuite />}
      {isSuperAdmin && activeTab === 'unitstatus' && <UnitStatusTransitionTests />}
      {isSuperAdmin && activeTab === 'integrity' && <AccountingIntegrityTool />}
      {isSuperAdmin && activeTab === 'branches' && <BranchSmartTests />}


      {activeTab === 'ledger' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
            <Stat label="عدد القيود" value={totals.count} />
            <Stat label="إجمالي المدين" value={SAR(totals.debit)} />
            <Stat label="إجمالي الدائن" value={SAR(totals.credit)} />
            <Stat label="فرق الميزان" value={SAR(grandDiff)} bad={grandDiff > 0.01} good={grandDiff <= 0.01} />
            <Stat label="قيود غير متوازنة" value={totals.unbalanced} bad={totals.unbalanced > 0} good={totals.unbalanced === 0} />
            <Stat label="قيود تصفية" value={totals.settlements} />
          </div>

          <div style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700,
            border: `1px solid ${totals.unbalanced || totals.noSource || totals.orphan ? '#FDE68A' : '#BBF7D0'}`,
            background: totals.unbalanced || totals.noSource || totals.orphan ? '#FFFBEB' : '#F0FDF4',
            color: totals.unbalanced || totals.noSource || totals.orphan ? '#92400E' : '#166534',
          }}>
            {totals.unbalanced || totals.noSource || totals.orphan
              ? `⚠️ يحتاج مراجعة: ${totals.unbalanced} قيد غير متوازن · ${totals.noSource} قيد بلا مصدر · ${totals.orphan} سطر بحساب غير مرتبط`
              : '✅ جميع القيود متوازنة ومرتبطة بمصادرها وشجرة الحسابات — الحسابات سليمة.'}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <input
              className="input" placeholder="🔍 بحث برقم القيد أو البيان أو المصدر"
              value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 240 }}
            />
            <select className="input" value={source} onChange={e => setSource(e.target.value)}>
              <option value="all">كل المصادر</option>
              {sources.map(s => <option key={s} value={s}>{SOURCE_AR[s] || s}</option>)}
            </select>
            <select className="input" value={balance} onChange={e => setBalance(e.target.value)}>
              <option value="all">كل الحالات</option>
              <option value="balanced">متوازنة فقط</option>
              <option value="issues">تحتاج مراجعة</option>
            </select>
            <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
              {loading ? '⏳ جاري التحميل...' : '🔄 تحديث'}
            </button>
            <button className="btn btn-blue btn-sm" onClick={exportCsv} disabled={!filtered.length}>⬇️ تصدير CSV</button>
          </div>

          {error && <div style={{ color: '#B91C1C', fontSize: 13, marginBottom: 10 }}>❌ {error}</div>}

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  <th>رقم القيد</th><th>التاريخ</th><th>المصدر</th><th>البيان</th>
                  <th>مدين</th><th>دائن</th><th>الحالة</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id}>
                    <td style={{ fontWeight: 700 }}>{e.entry_number || '—'}</td>
                    <td>{(e.entry_date || '').slice(0, 10) || '—'}</td>
                    <td>
                      {SOURCE_AR[e.source_type] || e.source_type || 'غير محدد'}
                      <div style={{ fontSize: 11, color: e.missingSource ? '#B91C1C' : 'var(--muted)' }}>
                        {e.missingSource ? 'مصدر مفقود ⚠️' : (e.source_id ? `#${String(e.source_id).slice(0, 8)}…` : '—')}
                      </div>
                    </td>
                    <td style={{ maxWidth: 260 }}>{e.description || '—'}</td>
                    <td>{SAR(e.debit)}</td>
                    <td>{SAR(e.credit)}</td>
                    <td style={{ fontWeight: 700, color: e.balanced ? '#166534' : '#B91C1C' }}>
                      {e.balanced ? '✅ متوازن' : (e.hasLines ? `❌ فرق ${SAR(e.diff)}` : '⚠️ بلا أسطر')}
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => setDetail(e)}>تفاصيل</button>
                      {(!e.balanced || e.missingSource || e.orphanAccount) && (
                        <button className="btn btn-gold btn-sm" disabled={repairing === e.id} onClick={() => repairEntry(e)}>
                          {repairing === e.id ? '⏳' : '🛠️ إصلاح'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!filtered.length && !loading && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>لا توجد قيود مطابقة للفلاتر الحالية</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {detail && (
        <div
          onClick={() => setDetail(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 16 }}
        >
          <div onClick={ev => ev.stopPropagation()} className="card" style={{ background: 'var(--card)', borderRadius: 14, padding: 20, maxWidth: 760, width: '100%', maxHeight: '86vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>📖 قيد رقم {detail.entry_number || '—'}</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setDetail(null)}>✕</button>
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              {(detail.entry_date || '').slice(0, 10)} · المصدر: {SOURCE_AR[detail.source_type] || detail.source_type || 'غير محدد'}
              {detail.source_id ? ` (#${String(detail.source_id).slice(0, 8)}…)` : ''} · {detail.description || '—'}
            </div>
            <table className="table" style={{ width: '100%', fontSize: 12 }}>
              <thead><tr><th>الحساب</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead>
              <tbody>
                {detail.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.code} — {l.accountName}</td>
                    <td>{l.description || '—'}</td>
                    <td>{l.debit ? SAR(l.debit) : '—'}</td>
                    <td>{l.credit ? SAR(l.credit) : '—'}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={2}>الإجمالي</td><td>{SAR(detail.debit)}</td><td>{SAR(detail.credit)}</td>
                </tr>
              </tbody>
            </table>
            <div style={{ marginTop: 10, fontWeight: 700, color: detail.balanced ? '#166534' : '#B91C1C' }}>
              {detail.balanced ? '✅ القيد متوازن (مدين = دائن)' : `❌ القيد غير متوازن — فرق ${SAR(detail.diff)}`}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, bad, good }) {
  return (
    <div style={{
      border: `1px solid ${bad ? '#FECACA' : good ? '#BBF7D0' : 'var(--border)'}`,
      background: bad ? '#FEF2F2' : good ? '#F0FDF4' : 'var(--card)',
      borderRadius: 12, padding: '12px 14px',
    }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{value}</div>
    </div>
  )
}
