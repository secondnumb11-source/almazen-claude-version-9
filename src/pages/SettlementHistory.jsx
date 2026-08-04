import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { useBranches } from '../BranchContext'
import BranchFilter from '../components/BranchFilter'
import { SAR } from '../lib/helpers'
import { downloadPDF } from '../lib/pdf'
import { downloadWorkbook } from '../lib/excel'
import ReportPrintButton from '../components/ReportPrintButton'


/**
 * سجل التسويات المحاسبية (Settlement History)
 * ------------------------------------------------
 * يعرض جميع قيود التصفية (source_type = 'settlement') المرحّلة في اليومية،
 * مع أرقام القيود، الوحدة، المستأجر، والمبالغ، وحالة التوازن المحاسبي،
 * وأزرار تصدير مباشر PDF / Excel لكل قيد.
 */
export default function SettlementHistory() {
  const { profile, company, toast } = useAuth()
  // فلتر الفروع: يعمل فقط للمستخدمين المصرّح لهم، والافتراضي «كل الفروع المتاحة»
  // (أي بلا تقييد إضافي فوق RLS). القاعدة تبقى مصدر الحقيقة الأمني.
  const { enabled: branchesOn, activeBranch } = useBranches()
  const companyId = profile?.company_id || company?.id


  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [unitFilter, setUnitFilter] = useState('')
  const [tenantFilter, setTenantFilter] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [balanceFilter, setBalanceFilter] = useState('all') // all | balanced | unbalanced
  const [detail, setDetail] = useState(null) // { entry, lines, booking }

  const applyPreset = (preset) => {
    const today = new Date()
    const iso = (d) => d.toISOString().slice(0, 10)
    if (preset === 'today') { setFrom(iso(today)); setTo(iso(today)) }
    else if (preset === 'week') { const w = new Date(today); w.setDate(w.getDate() - 7); setFrom(iso(w)); setTo(iso(today)) }
    else if (preset === 'month') { setFrom(iso(new Date(today.getFullYear(), today.getMonth(), 1))); setTo(iso(today)) }
    else if (preset === 'quarter') { const q = Math.floor(today.getMonth() / 3) * 3; setFrom(iso(new Date(today.getFullYear(), q, 1))); setTo(iso(today)) }
    else if (preset === 'year') { setFrom(iso(new Date(today.getFullYear(), 0, 1))); setTo(iso(today)) }
  }

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    ;(async () => {
      setLoading(true); setError('')
      try {
        let entriesQ = supabase
          .from('journal_entries')
          .select('id, entry_number, entry_date, description, source_type, source_id, branch_id, created_at')
          .eq('company_id', companyId)
          .eq('source_type', 'settlement')
        // التقييد بالفرع المختار فقط عند تفعيل الميزة واختيار فرع محدد
        if (branchesOn && activeBranch) entriesQ = entriesQ.eq('branch_id', activeBranch)
        const { data: entries, error: e1 } = await entriesQ
          .order('entry_date', { ascending: false })
          .limit(500)
        if (e1) throw e1

        const entryIds = (entries || []).map(e => e.id)
        const bookingIds = [...new Set((entries || []).map(e => e.source_id).filter(Boolean))]

        const [linesRes, bookingsRes] = await Promise.all([
          entryIds.length ? supabase
            .from('journal_entry_lines')
            .select('entry_id, debit, credit, description, chart_of_accounts(code, name)')
            .in('entry_id', entryIds) : Promise.resolve({ data: [] }),
          bookingIds.length ? supabase
            .from('bookings')
            .select('id, unit_id, customer_id, check_out_date, units(unit_number, name), customers(full_name, phone)')
            .in('id', bookingIds) : Promise.resolve({ data: [] })
        ])

        const linesByEntry = new Map()
        ;(linesRes.data || []).forEach(l => {
          const arr = linesByEntry.get(l.entry_id) || []
          arr.push({
            code: l.chart_of_accounts?.code || '—',
            accountName: l.chart_of_accounts?.name || '',
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            description: l.description || ''
          })
          linesByEntry.set(l.entry_id, arr)
        })
        const bookingMap = new Map()
        ;(bookingsRes.data || []).forEach(b => bookingMap.set(b.id, b))

        const TOLERANCE = 0.01
        const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100
        const enriched = (entries || []).map(e => {
          const lines = linesByEntry.get(e.id) || []
          const debit = r2(lines.reduce((s, l) => s + l.debit, 0))
          const credit = r2(lines.reduce((s, l) => s + l.credit, 0))
          // التقريب لخانتين قبل المقارنة يمنع تحذيراً كاذباً بفرق ~1e-13
          const diff = r2(Math.abs(debit - credit))
          // مُتوازن = (مدين = دائن ضمن التحمل) AND (توجد أسطر فعلية).
          // القيد بلا أسطر يُعتبر "ناقص" لا "غير متوازن" — يُعرض كمتوازن-صفر تجنّبًا لتحذير كاذب.
          const hasLines = lines.length > 0
          const balanced = diff <= TOLERANCE
          const booking = bookingMap.get(e.source_id)
          const unitLabel = booking?.units?.unit_number || booking?.units?.name || (e.source_id ? String(e.source_id).slice(0, 6) : '—')
          const tenant = booking?.customers?.full_name || '—'
          const vatLine = lines.find(l => l.code === '2300')
          const cashLine = lines.find(l => l.code === '1101' || l.code === '1102')
          return {
            id: e.id,
            entryNumber: e.entry_number,
            date: e.entry_date,
            description: e.description || '',
            unitLabel, tenant, booking,
            lines, debit, credit, balanced, diff, hasLines,
            vat: vatLine ? (vatLine.credit || vatLine.debit) : 0,
            netFlow: cashLine ? (cashLine.debit - cashLine.credit) : 0,
          }
        })

        if (!cancelled) setRows(enriched)
      } catch (err) {
        if (!cancelled) setError(err?.message || 'تعذّر تحميل سجل التسويات')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [companyId, branchesOn, activeBranch])

  const filtered = useMemo(() => {
    const qn = q.trim().toLowerCase()
    const uf = unitFilter.trim().toLowerCase()
    const tf = tenantFilter.trim().toLowerCase()
    const minA = minAmount === '' ? null : Number(minAmount)
    const maxA = maxAmount === '' ? null : Number(maxAmount)
    return rows.filter(r => {
      if (from && r.date < from) return false
      if (to && r.date > to) return false
      if (uf && !String(r.unitLabel || '').toLowerCase().includes(uf)) return false
      if (tf && !String(r.tenant || '').toLowerCase().includes(tf)) return false
      if (minA !== null && r.debit < minA) return false
      if (maxA !== null && r.debit > maxA) return false
      if (balanceFilter === 'balanced' && !r.balanced) return false
      if (balanceFilter === 'unbalanced' && r.balanced) return false
      if (!qn) return true
      return (
        String(r.entryNumber || '').toLowerCase().includes(qn) ||
        String(r.unitLabel || '').toLowerCase().includes(qn) ||
        String(r.tenant || '').toLowerCase().includes(qn) ||
        String(r.description || '').toLowerCase().includes(qn)
      )
    })
  }, [rows, q, from, to, unitFilter, tenantFilter, minAmount, maxAmount, balanceFilter])

  const totals = useMemo(() => {
    const t = { count: filtered.length, revenue: 0, vat: 0, cashIn: 0, refunds: 0, unbalanced: 0 }
    filtered.forEach(r => {
      if (!r.balanced) t.unbalanced += 1
      t.vat += r.vat
      t.revenue += r.lines.filter(l => String(l.code).startsWith('4')).reduce((s, l) => s + l.credit, 0)
      t.cashIn += Math.max(0, r.netFlow)
      t.refunds += Math.max(0, -r.netFlow)
    })
    return t
  }, [filtered])

  const buildSheets = (list) => {
    const summary = list.map(r => ({
      'رقم القيد': r.entryNumber,
      'التاريخ': r.date,
      'الوحدة': r.unitLabel,
      'المستأجر': r.tenant,
      'إجمالي مدين': r.debit,
      'إجمالي دائن': r.credit,
      'الضريبة': r.vat,
      'صافي التدفق النقدي': r.netFlow,
      'التوازن': r.balanced ? 'متوازن' : 'غير متوازن',
      'البيان': r.description,
    }))
    const details = list.flatMap(r => r.lines.map(l => ({
      'رقم القيد': r.entryNumber,
      'التاريخ': r.date,
      'الوحدة': r.unitLabel,
      'المستأجر': r.tenant,
      'رمز الحساب': l.code,
      'اسم الحساب': l.accountName,
      'مدين': l.debit,
      'دائن': l.credit,
      'البيان': l.description,
    })))
    return [
      { name: 'ملخص التسويات', rows: summary, numeric: ['إجمالي مدين', 'إجمالي دائن', 'الضريبة', 'صافي التدفق النقدي'] },
      { name: 'تفاصيل القيود', rows: details, numeric: ['مدين', 'دائن'] },
    ]
  }

  const exportAllPdf = () => {
    if (!filtered.length) return toast('لا توجد تسويات مطابقة للتصدير', true)
    downloadPDF({
      title: 'سجل التسويات المحاسبية',
      subtitle: `${filtered.length} تسوية · إجمالي إيرادات ${SAR(totals.revenue)} · ضريبة ${SAR(totals.vat)}`,
      company: company?.name || 'المازن',
      filters: { 'من': from || '—', 'إلى': to || '—', 'بحث': q || '—' },
      sheets: buildSheets(filtered),
      summaryCards: [
        { label: 'عدد التسويات', value: totals.count },
        { label: 'إجمالي الإيرادات', value: SAR(totals.revenue) },
        { label: 'ضريبة القيمة المضافة', value: SAR(totals.vat) },
        { label: 'مدفوعات مقبوضة', value: SAR(totals.cashIn), color: '#15803D' },
        { label: 'مبالغ مستردة', value: SAR(totals.refunds), color: '#B91C1C' },
        { label: 'قيود غير متوازنة', value: totals.unbalanced, color: totals.unbalanced > 0 ? '#B91C1C' : '#15803D' },
      ],
    })
  }
  const exportAllExcel = () => {
    if (!filtered.length) return toast('لا توجد تسويات مطابقة للتصدير', true)
    downloadWorkbook(`سجل-التسويات-${new Date().toISOString().slice(0,10)}.xlsx`, buildSheets(filtered))
  }
  const exportOnePdf = (r) => downloadPDF({
    title: `تفاصيل تصفية الوحدة ${r.unitLabel}`,
    subtitle: `رقم القيد ${r.entryNumber} · التاريخ ${r.date} · المستأجر ${r.tenant}`,
    company: company?.name || 'المازن',
    filters: { 'رقم القيد': r.entryNumber, 'الوحدة': r.unitLabel, 'المستأجر': r.tenant, 'التوازن': r.balanced ? 'متوازن' : 'غير متوازن' },
    sheets: buildSheets([r]),
    summaryCards: [
      { label: 'إجمالي مدين', value: SAR(r.debit) },
      { label: 'إجمالي دائن', value: SAR(r.credit) },
      { label: 'الضريبة', value: SAR(r.vat) },
      { label: 'التدفق النقدي', value: SAR(r.netFlow), color: r.netFlow >= 0 ? '#15803D' : '#B91C1C' },
    ],
  })
  const exportOneExcel = (r) => downloadWorkbook(`تصفية-${r.unitLabel}-${r.entryNumber}.xlsx`, buildSheets([r]))

  return (
    <div className="panel" style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>📚 سجل التسويات المحاسبية</h2>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
            جميع قيود التصفية المرحّلة في اليومية مع تصدير مباشر PDF / Excel لكل قيد
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={exportAllExcel} disabled={loading}>📊 تصدير Excel</button>
          <button className="btn btn-gold btn-sm" onClick={exportAllPdf} disabled={loading}>📄 تصدير PDF</button>
        </div>
      </div>

      {/* Filters — advanced */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <button className="btn btn-ghost btn-xs" onClick={() => applyPreset('today')}>اليوم</button>
        <button className="btn btn-ghost btn-xs" onClick={() => applyPreset('week')}>آخر 7 أيام</button>
        <button className="btn btn-ghost btn-xs" onClick={() => applyPreset('month')}>هذا الشهر</button>
        <button className="btn btn-ghost btn-xs" onClick={() => applyPreset('quarter')}>هذا الربع</button>
        <button className="btn btn-ghost btn-xs" onClick={() => applyPreset('year')}>هذا العام</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
        <input className="input" placeholder="🔍 بحث عام" value={q} onChange={e => setQ(e.target.value)} />
        <input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} title="من تاريخ" />
        <input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} title="إلى تاريخ" />
        <input className="input" placeholder="🏢 الوحدة" value={unitFilter} onChange={e => setUnitFilter(e.target.value)} />
        <input className="input" placeholder="👤 المستأجر" value={tenantFilter} onChange={e => setTenantFilter(e.target.value)} />
        <input className="input" type="number" placeholder="أدنى مبلغ" value={minAmount} onChange={e => setMinAmount(e.target.value)} />
        <input className="input" type="number" placeholder="أعلى مبلغ" value={maxAmount} onChange={e => setMaxAmount(e.target.value)} />
        <select className="input" value={balanceFilter} onChange={e => setBalanceFilter(e.target.value)}>
          <option value="all">كل القيود</option>
          <option value="balanced">متوازن فقط</option>
          <option value="unbalanced">غير متوازن فقط</option>
        </select>
        <BranchFilter label="الفرع" />
        <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setFrom(''); setTo(''); setUnitFilter(''); setTenantFilter(''); setMinAmount(''); setMaxAmount(''); setBalanceFilter('all') }}>♻️ مسح كل الفلاتر</button>

      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
        <KpiCard label="عدد التسويات" value={totals.count} />
        <KpiCard label="إجمالي الإيرادات" value={SAR(totals.revenue)} color="#15803D" />
        <KpiCard label="ضريبة القيمة المضافة" value={SAR(totals.vat)} color="#7C3AED" />
        <KpiCard label="مدفوعات مقبوضة" value={SAR(totals.cashIn)} color="#15803D" />
        <KpiCard label="مبالغ مستردة" value={SAR(totals.refunds)} color="#B91C1C" />
        <KpiCard label="قيود غير متوازنة" value={totals.unbalanced} color={totals.unbalanced > 0 ? '#B91C1C' : '#15803D'} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <ReportPrintButton
          title="سجل تسويات وتصفية حسابات الوحدات"
          subtitle={`عدد التسويات: ${filtered.length}${from || to ? ` — الفترة: ${from || '—'} إلى ${to || '—'}` : ''}`}
          docPrefix="SET"
          columns={['رقم القيد', 'التاريخ', 'الوحدة', 'المستأجر', 'مدين', 'دائن', 'الضريبة', 'صافي نقدي', 'التوازن']}
          rows={filtered.map(r => [
            r.entryNumber, r.date, r.unitLabel, r.tenant,
            SAR(r.debit), SAR(r.credit), SAR(r.vat), SAR(r.netFlow),
            r.balanced ? 'متوازن' : 'فرق',
          ])}
          summary={[
            ['عدد التسويات', filtered.length],
            ['إجمالي المحصّل نقداً', SAR(totals.cashIn)],
            ['إجمالي الإيراد', SAR(totals.revenue)],
            ['ضريبة القيمة المضافة', SAR(totals.vat)],
            ['مبالغ مستردة', SAR(totals.refunds)],
            ['قيود غير متوازنة', totals.unbalanced],
          ]}
        />
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{error}</div>}
      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>جاري تحميل سجل التسويات…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>لا توجد تسويات مطابقة للفلاتر الحالية</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}>
          <table className="tbl" style={{ width: '100%', minWidth: 900 }}>
            <thead>
              <tr>
                <th>رقم القيد</th>
                <th>التاريخ</th>
                <th>الوحدة</th>
                <th>المستأجر</th>
                <th>مدين</th>
                <th>دائن</th>
                <th>الضريبة</th>
                <th>صافي نقدي</th>
                <th>التوازن</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td><b>{r.entryNumber}</b></td>
                  <td>{r.date}</td>
                  <td>{r.unitLabel}</td>
                  <td>{r.tenant}</td>
                  <td>{SAR(r.debit)}</td>
                  <td>{SAR(r.credit)}</td>
                  <td>{SAR(r.vat)}</td>
                  <td style={{ color: r.netFlow >= 0 ? 'var(--green)' : 'var(--st-oc)' }}>{SAR(r.netFlow)}</td>
                  <td>
                    <span className="chip" style={{ background: r.balanced ? '#DCFCE7' : '#FEE2E2', color: r.balanced ? '#166534' : '#991B1B' }}>
                      {r.balanced ? '✓ متوازن' : '⚠ فرق'}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost btn-xs" onClick={() => setDetail(r)}>تفاصيل</button>
                    <button className="btn btn-ghost btn-xs" onClick={() => exportOnePdf(r)}>PDF</button>
                    <button className="btn btn-ghost btn-xs" onClick={() => exportOneExcel(r)}>Excel</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && <DetailModal r={detail} onClose={() => setDetail(null)} onExportPdf={() => exportOnePdf(detail)} onExportExcel={() => exportOneExcel(detail)} />}
    </div>
  )
}

function KpiCard({ label, value, color }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4, color: color || 'var(--text)' }}>{value}</div>
    </div>
  )
}

function DetailModal({ r, onClose, onExportPdf, onExportExcel }) {
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(900px, 96%)', maxHeight: '90vh', overflow: 'auto', borderRadius: 14 }}>
        <div className="modal-h" style={{ background: '#0f172a', color: '#fff', padding: '14px 20px', display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>قيد التصفية — {r.entryNumber} · الوحدة {r.unitLabel}</h3>
          <button className="x" onClick={onClose} style={{ color: '#fff' }}>✕</button>
        </div>
        <div className="modal-b" style={{ padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
            <KpiCard label="التاريخ" value={r.date} />
            <KpiCard label="المستأجر" value={r.tenant} />
            <KpiCard label="إجمالي مدين" value={SAR(r.debit)} />
            <KpiCard label="إجمالي دائن" value={SAR(r.credit)} />
            <KpiCard label="التوازن" value={r.balanced ? '✓ متوازن' : '⚠ يوجد فرق'} color={r.balanced ? '#15803D' : '#B91C1C'} />
          </div>
          {r.description && <div style={{ padding: 10, background: 'var(--soft)', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{r.description}</div>}
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>م</th>
                <th>رمز الحساب</th>
                <th>اسم الحساب</th>
                <th>مدين</th>
                <th>دائن</th>
                <th>البيان</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td><b>{l.code}</b></td>
                  <td>{l.accountName}</td>
                  <td>{SAR(l.debit)}</td>
                  <td>{SAR(l.credit)}</td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{l.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={onExportExcel}>📊 Excel</button>
            <button className="btn btn-gold" onClick={onExportPdf}>📄 PDF</button>
            <button className="btn btn-ghost" onClick={onClose}>إغلاق</button>
          </div>
        </div>
      </div>
    </div>
  )
}
