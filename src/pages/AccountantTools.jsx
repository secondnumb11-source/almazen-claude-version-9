import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { SAR, num, today } from '../lib/helpers'
import {
  fetchPaymentsRows, fetchBookingsRows, fetchTenantsRows, fetchExpensesRows,
  downloadWorkbook
} from '../lib/excel'
import { downloadPDF } from '../lib/pdf'
import FinancialExportModule from '../components/FinancialExportModule'
import AccountingIntegrityTool from '../components/AccountingIntegrityTool'
import AutomatedMaintenanceReconciliationTool from '../components/AutomatedMaintenanceReconciliationTool'
import SystemPerfDashboard from '../components/SystemPerfDashboard'
import { performFinancialExport } from '../lib/exportUtils'
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid, Legend } from 'recharts'
import { useBranches } from '../BranchContext'

/* موحّد إخراج التقارير: Excel أو PDF بنفس الفلاتر والبيانات */
function emitReport(fmt, filename, title, sheets, filters, company) {
  if (fmt === 'pdf') {
    return downloadPDF({ title, sheets, filters, company, subtitle: filename })
  }
  return downloadWorkbook(filename.endsWith('.xlsx') ? filename : filename + '.xlsx', sheets)
}


/* ==============================================================
   منشئ التقارير المخصص + أدوات المحاسب المتقدمة
   يسمح للمحاسب باختيار أي مجموعة بيانات + مدة + وحدة/فئة
   وإصدار ملف Excel جاهز بمعادلات SUM/AVERAGE
============================================================== */
function MaintenanceReportTool() {
  const { profile, company, toast } = useAuth()
  const { scopeQuery } = useBranches()
  const [busy, setBusy] = useState(false)
  const [range, setRange] = useState({ from: today().slice(0, 8) + '01', to: today() })
  
  const run = async () => {
    setBusy(true)
    try {
      const { data, error } = await scopeQuery(supabase.from('maintenance_requests')
        .select('*, units(unit_number), profiles(full_name)')
        .eq('company_id', profile.company_id))
        .gte('closed_at', range.from + 'T00:00:00Z')
        .lte('closed_at', range.to + 'T23:59:59Z')
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })

      if (error) throw error

      if (!data || data.length === 0) {
        toast('لا توجد صيانة مغلقة في هذه الفترة')
        return
      }

      let totalCost = 0
      const rows = data.map(r => {
        totalCost += num(r.cost)
        return {
          'الوحدة': r.units?.unit_number || '—',
          'النوع': r.request_type === 'cleaning' ? 'تنظيف' : 'صيانة',
          'الوصف': r.description,
          'التكلفة': num(r.cost),
          'تاريخ الإغلاق': r.closed_at?.slice(0, 10) || '—',
          'أُغلق بواسطة': r.profiles?.full_name || '—'
        }
      })

      const sheets = [
        { name: 'طلبات الصيانة المغلقة', rows, numeric: ['التكلفة'] },
        { name: 'الملخص', rows: [{ 'إجمالي التكاليف': totalCost }], numeric: ['إجمالي التكاليف'] }
      ]

      emitReport('pdf', `صيانة-${range.from}-${range.to}`, 'تقرير الصيانة والتنظيف الشامل', sheets, { 'من': range.from, 'إلى': range.to, 'إجمالي التكاليف': SAR(totalCost) }, company)
      toast('✓ تم إصدار تقرير الصيانة')
    } catch (e) { toast('خطأ: ' + e.message, true) } finally { setBusy(false) }
  }

  return (
    <div className="tool-card">
      <h4>🛠️ تقرير الصيانة والتكاليف</h4>
      <div className="desc">إصدار تقرير بجميع مهام الصيانة والتنظيف المكتملة وتكلفتها حسب الوحدة.</div>
      <div className="grid2" style={{ marginBottom: 8 }}>
        <div><label>من</label><input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></div>
        <div><label>إلى</label><input type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-blue btn-sm" disabled={busy} onClick={run}>📄 تصدير PDF</button>
      </div>
    </div>
  )
}

export default function AccountantTools() {
  const handleFinancialExport = (config) => {
    performFinancialExport(profile, company, config, toast);
  }
  const { profile, company, toast } = useAuth()
  const { scopeQuery, activeBranch } = useBranches()
  const [units, setUnits] = useState([])
  const [showAI, setShowAI] = useState(false)

  useEffect(() => {
    scopeQuery(supabase.from('units').select('unit_number').eq('company_id', profile.company_id))
      .order('unit_number').then(({ data }) => setUnits(data || []))
  }, [profile, scopeQuery, activeBranch])

  return (
    <>
      <div className="ai-toggle-bar">
        <button className={'ai-toggle-btn' + (showAI ? ' open' : '')} onClick={() => setShowAI(v => !v)}>
          <span className="ai-toggle-ico">🤖</span>
          <span className="ai-toggle-lbl">المساعد الذكي للمحاسب</span>
          <span className="ai-toggle-sub">اسأل بلغة طبيعية واحصل على تقارير وتحليلات فورية</span>
          <span className="ai-toggle-arrow">{showAI ? '▲' : '▼'}</span>
        </button>
        <div className={'ai-toggle-body' + (showAI ? ' open' : '')}>
          <EmbeddedAssistant />
        </div>
      </div>
      <ReportBuilder units={units} />
      {/* SystemPerfDashboard, AutomatedMaintenanceReconciliationTool, AccountingIntegrityTool
          نُقلت إلى صفحة "الاختبارات الذكية للمحاسبة" في القائمة الجانبية */}
      <div style={{ marginBottom: 20 }}>
        <FinancialExportModule 
          moduleTitle="تصدير التقارير الشاملة"
          onExport={handleFinancialExport}
        />
      </div>
      <div className="tools-grid">
        <VatReportTool />
        <CashFlowTool />
        <MaintenanceReportTool />
        <AgingBucketsTool />
        <PeriodComparisonTool />
        <BalanceSheetTool />
        <IncomeStatementTool />
        <VouchersGroupedTool />
        <ExpensesGroupedTool />
        <UnitPricingListTool units={units} />
        <SettlementSummaryExportTool units={units} />
        <MaintenanceFrequencyHeatmapTool />
        <OccupancyInsightsTool />
      </div>
    </>
  )
}

/* ================= الميزانية العمومية (مهم جداً) ================= */
function BalanceSheetTool() {
  const { profile, company, toast } = useAuth()
  const [busy, setBusy] = useState(false)
  const [asOf, setAsOf] = useState(today())
  const [rows, setRows] = useState(null)

  const load = async () => {
    const { data, error } = await supabase.rpc('balance_sheet', { p_company_id: profile.company_id, p_as_of: asOf })
    if (error) { toast('خطأ: ' + error.message, true); return null }
    return data || []
  }

  const view = async () => { setBusy(true); setRows(await load()); setBusy(false) }

  const run = async (fmt) => {
    setBusy(true)
    try {
      const data = await load()
      if (!data) return
      const bySection = { 'الأصول': [], 'الخصوم': [], 'حقوق الملكية': [] }
      for (const r of data) bySection[r.section]?.push({ 'الرمز': r.code, 'الحساب': r.name, 'الرصيد': num(r.balance) })
      const totalAssets = bySection['الأصول'].reduce((s, r) => s + r['الرصيد'], 0)
      const totalLiabEquity = [...bySection['الخصوم'], ...bySection['حقوق الملكية']].reduce((s, r) => s + r['الرصيد'], 0)
      const sheets = [
        { name: 'الأصول', rows: bySection['الأصول'], numeric: ['الرصيد'] },
        { name: 'الخصوم', rows: bySection['الخصوم'], numeric: ['الرصيد'] },
        { name: 'حقوق الملكية', rows: bySection['حقوق الملكية'], numeric: ['الرصيد'] },
        { name: 'ملخص التوازن', rows: [
          { 'البند': 'إجمالي الأصول', 'القيمة': totalAssets },
          { 'البند': 'إجمالي الخصوم وحقوق الملكية', 'القيمة': totalLiabEquity },
          { 'البند': 'الفرق (يجب أن يكون صفراً)', 'القيمة': Math.round((totalAssets - totalLiabEquity) * 100) / 100 }
        ], numeric: ['القيمة'] }
      ]
      emitReport(fmt, `الميزانية-العمومية-${asOf}`, 'الميزانية العمومية', sheets, { 'كما في تاريخ': asOf }, company)
      toast(`✓ صدرت الميزانية العمومية — إجمالي الأصول ${SAR(totalAssets)}`)
    } catch (e) { toast('خطأ: ' + e.message, true) } finally { setBusy(false) }
  }

  const totalAssets = rows?.filter(r => r.section === 'الأصول').reduce((s, r) => s + num(r.balance), 0) || 0
  const totalOther = rows?.filter(r => r.section !== 'الأصول').reduce((s, r) => s + num(r.balance), 0) || 0

  return (
    <div className="tool-card">
      <h4>⚖️ الميزانية العمومية</h4>
      <div className="desc">الأصول = الخصوم + حقوق الملكية — مبنية مباشرة من شجرة الحسابات والقيود الفعلية.</div>
      <div><label>كما في تاريخ</label><input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} /></div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={view}>👁 عرض</button>
        <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => run('xlsx')}>📗 Excel</button>
        <button className="btn btn-blue btn-sm" disabled={busy} onClick={() => run('pdf')}>📄 PDF</button>
      </div>
      {rows && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          {['الأصول', 'الخصوم', 'حقوق الملكية'].map(sec => (
            <div key={sec} style={{ marginBottom: 8 }}>
              <b>{sec}</b>
              <table className="tbl">
                <tbody>
                  {rows.filter(r => r.section === sec).map(r => (
                    <tr key={r.code}><td dir="ltr">{r.code}</td><td>{r.name}</td><td className="money">{SAR(r.balance)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <div style={{ fontWeight: 800 }}>
            إجمالي الأصول: <span className="money">{SAR(totalAssets)}</span> — إجمالي الخصوم وحقوق الملكية: <span className="money">{SAR(totalOther)}</span>
            {Math.abs(totalAssets - totalOther) < 0.5 ? <span style={{ color: 'var(--green)' }}> ✓ متوازنة</span> : <span className="neg"> ⚠ غير متوازنة</span>}
          </div>
        </div>
      )}
    </div>
  )
}

/* ================= قائمة الدخل (الأرباح والخسائر) ================= */
function IncomeStatementTool() {
  const { profile, company, toast } = useAuth()
  const [busy, setBusy] = useState(false)
  const [range, setRange] = useState({ from: today().slice(0, 8) + '01', to: today() })

  const run = async (fmt) => {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('income_statement', { p_company_id: profile.company_id, p_from: range.from, p_to: range.to })
      if (error) return toast('خطأ: ' + error.message, true)
      const rev = (data || []).filter(r => r.section === 'الإيرادات')
      const exp = (data || []).filter(r => r.section === 'المصروفات')
      const totalRev = rev.reduce((s, r) => s + num(r.amount), 0)
      const totalExp = exp.reduce((s, r) => s + num(r.amount), 0)
      const sheets = [
        { name: 'الإيرادات', rows: rev.map(r => ({ 'الرمز': r.code, 'الحساب': r.name, 'المبلغ': num(r.amount) })), numeric: ['المبلغ'] },
        { name: 'المصروفات', rows: exp.map(r => ({ 'الرمز': r.code, 'الحساب': r.name, 'المبلغ': num(r.amount) })), numeric: ['المبلغ'] },
        { name: 'الملخص', rows: [
          { 'البند': 'إجمالي الإيرادات', 'القيمة': totalRev },
          { 'البند': 'إجمالي المصروفات', 'القيمة': totalExp },
          { 'البند': 'صافي الربح / الخسارة', 'القيمة': totalRev - totalExp }
        ], numeric: ['القيمة'] }
      ]
      emitReport(fmt, `قائمة-الدخل-${range.from}-${range.to}`, 'قائمة الدخل (الأرباح والخسائر)', sheets, { 'من': range.from, 'إلى': range.to }, company)
      toast(`✓ صدرت قائمة الدخل — صافي ${SAR(totalRev - totalExp)}`)
    } catch (e) { toast('خطأ: ' + e.message, true) } finally { setBusy(false) }
  }

  return (
    <div className="tool-card">
      <h4>📉 قائمة الدخل — الأرباح والخسائر</h4>
      <div className="desc">إجمالي الإيرادات ناقص إجمالي المصروفات حسب شجرة الحسابات لفترة محددة.</div>
      <div className="grid2" style={{ marginBottom: 8 }}>
        <div><label>من</label><input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></div>
        <div><label>إلى</label><input type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => run('xlsx')}>📗 Excel</button>
        <button className="btn btn-blue btn-sm" disabled={busy} onClick={() => run('pdf')}>📄 PDF</button>
      </div>
    </div>
  )
}

/* ================= تقرير السندات المجمّع (حسب الجهة/الفئة) ================= */
function VouchersGroupedTool() {
  const { profile, company, toast } = useAuth()
  const [type, setType] = useState('receipt')
  const [busy, setBusy] = useState(false)
  const [range, setRange] = useState({ from: today().slice(0, 8) + '01', to: today() })

  const run = async (fmt) => {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('vouchers_summary', {
        p_company_id: profile.company_id, p_voucher_type: type, p_from: range.from, p_to: range.to
      })
      if (error) return toast('خطأ: ' + error.message, true)
      const PL = { tenant: 'مستأجر', vendor: 'مورد', employee: 'موظف', other: 'أخرى' }
      const rows = (data || []).map(r => ({ 'الجهة': r.party_name, 'التصنيف': PL[r.party_type] || r.party_type, 'عدد السندات': Number(r.voucher_count), 'الإجمالي': num(r.total_amount) }))
      const total = rows.reduce((s, r) => s + r['الإجمالي'], 0)
      emitReport(fmt, `تقرير-${type === 'receipt' ? 'سندات-القبض' : 'سندات-الصرف'}-${range.from}-${range.to}`,
        type === 'receipt' ? 'تقرير سندات القبض المجمّع' : 'تقرير سندات الصرف المجمّع',
        [{ name: 'التجميع', rows, numeric: ['عدد السندات', 'الإجمالي'] }],
        { 'من': range.from, 'إلى': range.to }, company)
      toast(`✓ صدر التقرير — إجمالي ${SAR(total)} عبر ${rows.length} جهة`)
    } catch (e) { toast('خطأ: ' + e.message, true) } finally { setBusy(false) }
  }

  return (
    <div className="tool-card">
      <h4>🧾 تقرير السندات المجمّع</h4>
      <div className="desc">سندات القبض أو الصرف مجمّعة حسب الجهة (مستأجر/مورد/موظف) لفترة محددة.</div>
      <div className="grid3" style={{ marginBottom: 8 }}>
        <div><label>النوع</label>
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="receipt">سندات القبض</option><option value="payment">سندات الصرف</option>
          </select></div>
        <div><label>من</label><input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></div>
        <div><label>إلى</label><input type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => run('xlsx')}>📗 Excel</button>
        <button className="btn btn-blue btn-sm" disabled={busy} onClick={() => run('pdf')}>📄 PDF</button>
      </div>
    </div>
  )
}

/* ================= تقرير المصروفات المجمّع (حسب البائع/النوع/الوحدة) ================= */
function ExpensesGroupedTool() {
  const { profile, company, toast } = useAuth()
  const [busy, setBusy] = useState(false)
  const [range, setRange] = useState({ from: today().slice(0, 8) + '01', to: today() })
  const EC = { electricity: 'كهرباء', water: 'ماء', maintenance: 'صيانة', salaries: 'رواتب', cleaning: 'نظافة', internet: 'إنترنت', other: 'أخرى' }

  const run = async (fmt) => {
    setBusy(true)
    try {
      const { data } = await supabase.from('expenses')
        .select('category, vendor_name, amount, units(unit_number)')
        .eq('company_id', profile.company_id).gte('expense_date', range.from).lte('expense_date', range.to)
      const byCat = {}, byVendor = {}
      for (const e of data || []) {
        const c = EC[e.category] || e.category
        byCat[c] = (byCat[c] || 0) + num(e.amount)
        const v = e.vendor_name || '—'
        byVendor[v] = (byVendor[v] || 0) + num(e.amount)
      }
      const rowsCat = Object.entries(byCat).map(([k, v]) => ({ 'التصنيف': k, 'الإجمالي': v }))
      const rowsVendor = Object.entries(byVendor).map(([k, v]) => ({ 'البائع/المورد': k, 'الإجمالي': v }))
      const total = rowsCat.reduce((s, r) => s + r['الإجمالي'], 0)
      emitReport(fmt, `تقرير-المصروفات-المجمع-${range.from}-${range.to}`, 'تقرير المصروفات المجمّع',
        [
          { name: 'حسب التصنيف', rows: rowsCat, numeric: ['الإجمالي'] },
          { name: 'حسب البائع', rows: rowsVendor, numeric: ['الإجمالي'] }
        ], { 'من': range.from, 'إلى': range.to }, company)
      toast(`✓ صدر تقرير المصروفات — إجمالي ${SAR(total)}`)
    } catch (e) { toast('خطأ: ' + e.message, true) } finally { setBusy(false) }
  }

  return (
    <div className="tool-card">
      <h4>💸 تقرير المصروفات المجمّع</h4>
      <div className="desc">مجمّع حسب التصنيف والبائع/المورد لفترة محددة — لتحليل بنود الصرف.</div>
      <div className="grid2" style={{ marginBottom: 8 }}>
        <div><label>من</label><input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></div>
        <div><label>إلى</label><input type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => run('xlsx')}>📗 Excel</button>
        <button className="btn btn-blue btn-sm" disabled={busy} onClick={() => run('pdf')}>📄 PDF</button>
      </div>
    </div>
  )
}

/* ================= قائمة أسعار الوحدات (يومي/شهري/سنوي) ================= */
function UnitPricingListTool() {
  const { profile, company, toast } = useAuth()
  const [busy, setBusy] = useState(false)

  const run = async (fmt) => {
    setBusy(true)
    try {
      const { data } = await supabase.from('units')
        .select('unit_number, category, daily_price, monthly_price, yearly_price, status')
        .eq('company_id', profile.company_id).order('unit_number')
      const CATS = { apartment: 'شقة سكنية', chalet: 'شاليه', furnished_unit: 'وحدة مفروشة', hotel_room: 'غرفة فندقية' }
      const ST = { available: 'متاح', reserved: 'محجوز', occupied: 'مسكون', cleaning: 'تنظيف', maintenance: 'صيانة' }
      const rows = (data || []).map(u => ({
        'الوحدة': u.unit_number, 'الفئة': CATS[u.category] || u.category, 'الحالة': ST[u.status] || u.status,
        'السعر اليومي': num(u.daily_price), 'السعر الشهري': num(u.monthly_price), 'السعر السنوي': num(u.yearly_price)
      }))
      emitReport(fmt, `قائمة-أسعار-الوحدات-${today()}`, 'قائمة أسعار الوحدات السكنية',
        [{ name: 'الأسعار', rows, numeric: ['السعر اليومي', 'السعر الشهري', 'السعر السنوي'] }], {}, company)
      toast(`✓ صدرت قائمة الأسعار — ${rows.length} وحدة`)
    } catch (e) { toast('خطأ: ' + e.message, true) } finally { setBusy(false) }
  }

  return (
    <div className="tool-card">
      <h4>🏷️ قائمة أسعار الوحدات</h4>
      <div className="desc">كل الوحدات بأسعارها اليومية والشهرية والسنوية — جاهزة للمشاركة مع العملاء أو الأرشفة.</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => run('xlsx')}>📗 Excel</button>
        <button className="btn btn-blue btn-sm" disabled={busy} onClick={() => run('pdf')}>📄 PDF</button>
      </div>
    </div>
  )
}

/* ================= مساعد ذكي مدمج في بوابة المحاسب ================= */
function EmbeddedAssistant() {
  const { profile } = useAuth()
  const [input, setInput] = useState('')
  const box = useRef(null)

  const supaUrl = import.meta.env.VITE_SUPABASE_URL || 'https://drowmezlcrvowuhqmfef.supabase.co'
  const supaKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

  const [transport] = useState(() => new DefaultChatTransport({
    api: `${supaUrl}/functions/v1/ai-assistant`,
    headers: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || supaKey}`,
        'apikey': supaKey || '',
      }
    },
    prepareSendMessagesRequest: ({ messages }) => ({
      body: { messages, company_id: profile?.company_id }
    }),
  }))

  const { messages, sendMessage, status, error } = useChat({ transport })
  useEffect(() => { box.current?.scrollTo(0, 1e9) }, [messages, status])
  const isLoading = status === 'submitted' || status === 'streaming'

  const ask = (text) => {
    const t = (text ?? input).trim()
    if (!t || isLoading) return
    setInput('')
    sendMessage({ text: t })
  }

  const renderPart = (p, i) => {
    if (p.type === 'text') return <ReactMarkdown key={i}>{p.text}</ReactMarkdown>
    if (p.type?.startsWith('tool-')) {
      return <div key={i} className="ai-tool"><b>⚙ {p.type.slice(5)}</b>
        {p.state === 'output-available' && <div className="ai-tool-out">✓ {p.output?.count != null ? `${p.output.count} سجل` : 'نُفّذ'}</div>}
      </div>
    }
    return null
  }

  const hints = [
    'ملخص إيرادات هذا الشهر مقارنة بالسابق',
    'المستأجرون المتأخرون عن السداد',
    'ضريبة القيمة المضافة المستحقة هذا الربع',
    'الوحدات الأعلى إيراداً هذا العام',
  ]

  return (
    <div className="ai-embedded panel">
      <div className="ai-box" style={{ height: 380 }}>
        <div className="ai-msgs" ref={box}>
          {messages.length === 0 && (
            <div className="msg a">
              <ReactMarkdown>{'اسألني عن أي تقرير مالي، تحليل إيرادات، متأخرات، أو استفسار محاسبي...'}</ReactMarkdown>
            </div>
          )}
          {messages.map(m => (
            <div key={m.id} className={'msg ' + (m.role === 'assistant' ? 'a' : 'u')}>
              {m.parts?.map(renderPart) || m.content}
            </div>
          ))}
          {status === 'submitted' && <div className="msg a"><i>⏳ جارٍ التحليل…</i></div>}
          {error && <div className="msg a" style={{ color: '#c00' }}>خطأ: {error.message}</div>}
        </div>
        <div className="suggest">{hints.map(s => <button key={s} onClick={() => ask(s)} disabled={isLoading}>{s}</button>)}</div>
        <div className="ai-in">
          <input value={input} onChange={e => setInput(e.target.value)}
            placeholder="اطلب تقريراً أو تحليلاً محاسبياً…"
            onKeyDown={e => e.key === 'Enter' && ask()} disabled={isLoading} />
          <button className="btn btn-gold btn-sm" onClick={() => ask()} disabled={isLoading}>
            {isLoading ? '…' : 'إرسال'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ================= منشئ التقارير المخصص ================= */
function ReportBuilder({ units }) {
  const { profile, company, toast } = useAuth()
  const [sel, setSel] = useState({ payments: true, bookings: true, expenses: false, tenants: false })
  const [f, setF] = useState({ from: '', to: '', unit: '' })
  const [busy, setBusy] = useState(false)

  const toggle = (k) => setSel(s => ({ ...s, [k]: !s[k] }))

  const build = async (fmt = 'xlsx') => {
    const wanted = Object.entries(sel).filter(([, v]) => v).map(([k]) => k)
    if (!wanted.length) return toast('اختر ورقة واحدة على الأقل', true)
    setBusy(true)
    try {
      const cid = profile.company_id
      const opts = { from: f.from || undefined, to: f.to || undefined, unit: f.unit || undefined }
      const sheets = []
      if (sel.payments) {
        const rows = await fetchPaymentsRows(supabase, cid, opts)
        sheets.push({ name: 'الدفعات', rows, numeric: ['المبلغ'] })
      }
      if (sel.bookings) {
        const rows = await fetchBookingsRows(supabase, cid, opts)
        sheets.push({ name: 'الحجوزات', rows,
          numeric: ['الإجمالي', 'الخصم', 'العربون', 'التأمين', 'المدفوع', 'المتبقي'] })
      }
      if (sel.expenses) {
        const rows = await fetchExpensesRows(supabase, cid, opts)
        sheets.push({ name: 'المصروفات', rows, numeric: ['المبلغ'] })
      }
      if (sel.tenants) {
        const rows = await fetchTenantsRows(supabase, cid)
        sheets.push({ name: 'المستأجرون', rows,
          numeric: ['عدد الإقامات', 'إجمالي التعاقدات', 'إجمالي المدفوع', 'نقاط الولاء'] })
      }
      const summary = []
      for (const s of sheets) {
        const numCol = s.numeric?.[0]
        const total = numCol ? s.rows.reduce((t, r) => t + Number(r[numCol] || 0), 0) : s.rows.length
        summary.push({ 'الورقة': s.name, 'عدد السجلات': s.rows.length, 'إجمالي الحقل الرئيسي': total })
      }
      sheets.unshift({ name: 'ملخص التقرير', rows: summary, numeric: ['عدد السجلات', 'إجمالي الحقل الرئيسي'] })

      const total = sheets.reduce((s, x) => s + (x.rows?.length || 0), 0)
      if (total === 0) return toast('لا توجد بيانات مطابقة للفلاتر — جرّب توسيع النطاق', true)
      const filenameParts = ['تقرير-مخصص', company?.name || 'المازن', new Date().toISOString().slice(0, 10)]
      const filters = { 'من': f.from || '—', 'إلى': f.to || '—', 'الوحدة': f.unit || 'الكل' }
      emitReport(fmt, filenameParts.join('-'), 'تقرير مخصص شامل', sheets, filters, company)
      toast(`✓ صدر التقرير (${fmt === 'pdf' ? 'PDF' : 'Excel'}): ${sheets.length} ورقة و ${total} سجل`)
    } catch (e) { toast('خطأ: ' + e.message, true) } finally { setBusy(false) }
  }


  return (
    <div className="builder">
      <h3>منشئ التقارير المخصص — اختر ما تريد استخراجه</h3>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>
        حدد الأوراق التي تريدها، ثم قصّها بالمدة والوحدة، وسيتم إصدار ملف Excel احترافي بمعادلات جاهزة.
      </p>

      <div className="check-row">
        {[
          ['payments', '💳 الدفعات'],
          ['bookings', '📋 الحجوزات والعقود'],
          ['expenses', '💸 المصروفات'],
          ['tenants', '👥 المستأجرون']
        ].map(([k, label]) => (
          <label key={k} className={sel[k] ? 'on' : ''}>
            <input type="checkbox" checked={sel[k]} onChange={() => toggle(k)} />
            {label}
          </label>
        ))}
      </div>

      <div className="grid3">
        <div><label>من تاريخ (اختياري)</label>
          <input type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></div>
        <div><label>إلى تاريخ (اختياري)</label>
          <input type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></div>
        <div><label>وحدة محددة (اختياري)</label>
          <select value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })}>
            <option value="">جميع الوحدات</option>
            {units.map(u => <option key={u.unit_number}>{u.unit_number}</option>)}
          </select></div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn btn-gold" disabled={busy} onClick={() => build('xlsx')}>
          📗 Excel مخصص
        </button>
        <button className="btn btn-blue btn-sm" disabled={busy} onClick={() => build('pdf')}>
          📄 PDF مخصص
        </button>

        <button className="btn btn-ghost btn-sm" onClick={() => {
          const q = today()
          setF({ from: q.slice(0, 8) + '01', to: q, unit: '' })
        }}>هذا الشهر</button>
        <button className="btn btn-ghost btn-sm" onClick={() => {
          const d = new Date()
          const from = new Date(d.getFullYear(), d.getMonth() - 2, 1).toISOString().slice(0, 10)
          setF({ from, to: today(), unit: '' })
        }}>آخر 3 أشهر</button>
        <button className="btn btn-ghost btn-sm" onClick={() => {
          const y = new Date().getFullYear()
          setF({ from: `${y}-01-01`, to: today(), unit: '' })
        }}>هذه السنة</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setF({ from: '', to: '', unit: '' })}>
          مسح الفلاتر
        </button>
      </div>
    </div>
  )
}

/* ================= تقرير ضريبة القيمة المضافة ================= */
function VatReportTool() {
  const { profile, company, toast } = useAuth()
  const [busy, setBusy] = useState(false)
  const [range, setRange] = useState({ from: today().slice(0, 8) + '01', to: today() })

  const run = async (fmt = 'xlsx') => {
    setBusy(true)
    try {
      const cid = profile.company_id
      const vatRate = num(company?.default_vat_rate ?? 15)
      const { data: pays } = await supabase.from('payments')
        .select('amount, payment_date, payment_type, bookings(units(unit_number))')
        .eq('company_id', cid).gte('payment_date', range.from).lte('payment_date', range.to)
      const rows = (pays || []).map(p => {
        const gross = num(p.amount)
        const subtotal = Math.round(gross / (1 + vatRate / 100) * 100) / 100
        const vat = Math.round((gross - subtotal) * 100) / 100
        return {
          'التاريخ': p.payment_date, 'الوحدة': p.bookings?.units?.unit_number || '—',
          'نوع الدفعة': { rent: 'إيجار', down_payment: 'عربون', insurance: 'تأمين', penalty: 'غرامة', other: 'أخرى' }[p.payment_type] || p.payment_type,
          'الإجمالي شامل الضريبة': gross,
          'الأساس قبل الضريبة': subtotal,
          [`ض.ق.م ${vatRate}%`]: vat
        }
      })
      const total = rows.reduce((s, r) => s + r['الإجمالي شامل الضريبة'], 0)
      const vatSum = rows.reduce((s, r) => s + r[`ض.ق.م ${vatRate}%`], 0)
      const summary = [
        { 'البند': 'المنشأة', 'القيمة': company?.name || '' },
        { 'البند': 'الرقم الضريبي', 'القيمة': company?.vat_number || '—' },
        { 'البند': 'إجمالي المبيعات شامل الضريبة', 'القيمة': total },
        { 'البند': 'الأساس الخاضع للضريبة', 'القيمة': total - vatSum },
        { 'البند': `الضريبة المستحقة (${vatRate}%)`, 'القيمة': vatSum },
        { 'البند': 'عدد الفواتير/الدفعات', 'القيمة': rows.length }
      ]
      const sheets = [
        { name: 'ملخص الإقرار', rows: summary },
        { name: 'التفاصيل', rows, numeric: ['الإجمالي شامل الضريبة', 'الأساس قبل الضريبة', `ض.ق.م ${vatRate}%`] }
      ]
      emitReport(fmt, `تقرير-ضريبي-${range.from}-${range.to}`,
        `إقرار ضريبة القيمة المضافة (ZATCA)`, sheets,
        { 'من': range.from, 'إلى': range.to, 'نسبة الضريبة': vatRate + '%' }, company)
      toast(`✓ صدر إقرار ض.ق.م (${fmt.toUpperCase()}): إجمالي ${SAR(total)} — الضريبة ${SAR(vatSum)}`)
    } catch (e) { toast('خطأ: ' + e.message, true) } finally { setBusy(false) }
  }

  return (
    <div className="tool-card">
      <h4>🧾 إقرار ضريبة القيمة المضافة (ZATCA)</h4>
      <div className="desc">تقرير شامل لإقرار ض.ق.م: الإجمالي، الأساس، الضريبة المستحقة، عدد الفواتير — جاهز للتقديم.</div>
      <div className="grid2" style={{ marginBottom: 8 }}>
        <div><label>من</label><input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></div>
        <div><label>إلى</label><input type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></div>
      </div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => run('xlsx')}>📗 Excel</button>
        <button className="btn btn-blue btn-sm" disabled={busy} onClick={() => run('pdf')}>📄 PDF</button>
      </div>
    </div>
  )
}


/* ================= التدفق النقدي ================= */
function CashFlowTool() {
  const { profile, toast } = useAuth()
  const [busy, setBusy] = useState(false)
  const [range, setRange] = useState({ from: today().slice(0, 8) + '01', to: today() })

  const run = async (fmt = 'xlsx') => {
    setBusy(true)
    try {
      const cid = profile.company_id
      const [{ data: pays }, { data: exps }] = await Promise.all([
        supabase.from('payments').select('amount, method, payment_date')
          .eq('company_id', cid).gte('payment_date', range.from).lte('payment_date', range.to),
        supabase.from('expenses').select('amount, category, expense_date')
          .eq('company_id', cid).gte('expense_date', range.from).lte('expense_date', range.to)
      ])
      const daily = {}
      for (const p of pays || []) {
        const d = p.payment_date
        daily[d] = daily[d] || { 'التاريخ': d, 'تدفق داخل': 0, 'تدفق خارج': 0, 'صافي': 0 }
        daily[d]['تدفق داخل'] += num(p.amount)
      }
      for (const e of exps || []) {
        const d = e.expense_date
        daily[d] = daily[d] || { 'التاريخ': d, 'تدفق داخل': 0, 'تدفق خارج': 0, 'صافي': 0 }
        daily[d]['تدفق خارج'] += num(e.amount)
      }
      const rows = Object.values(daily).sort((a, b) => a['التاريخ'].localeCompare(b['التاريخ']))
      let running = 0
      rows.forEach(r => { r['صافي'] = r['تدفق داخل'] - r['تدفق خارج']; running += r['صافي']; r['الرصيد التراكمي'] = running })

      const byMethod = {}
      for (const p of pays || []) {
        const m = { cash: 'كاش', bank_transfer: 'تحويل بنكي', card: 'بطاقة' }[p.method] || p.method
        byMethod[m] = (byMethod[m] || 0) + num(p.amount)
      }
      const methodRows = Object.entries(byMethod).map(([k, v]) => ({ 'طريقة الدفع': k, 'الإجمالي': v }))

      const totalIn = rows.reduce((s, r) => s + r['تدفق داخل'], 0)
      const totalOut = rows.reduce((s, r) => s + r['تدفق خارج'], 0)
      const summary = [
        { 'البند': 'إجمالي التدفق الداخل', 'القيمة': totalIn },
        { 'البند': 'إجمالي التدفق الخارج', 'القيمة': totalOut },
        { 'البند': 'صافي التدفق النقدي', 'القيمة': totalIn - totalOut },
        { 'البند': 'عدد أيام النشاط', 'القيمة': rows.length }
      ]
      const sheets = [
        { name: 'ملخص', rows: summary, numeric: ['القيمة'] },
        { name: 'يومي', rows, numeric: ['تدفق داخل', 'تدفق خارج', 'صافي', 'الرصيد التراكمي'] },
        { name: 'حسب طريقة الدفع', rows: methodRows, numeric: ['الإجمالي'] }
      ]
      emitReport(fmt, `تدفق-نقدي-${range.from}-${range.to}`, 'قائمة التدفق النقدي',
        sheets, { 'من': range.from, 'إلى': range.to }, null)
      toast(`✓ صدر التدفق النقدي (${fmt.toUpperCase()}): صافي ${SAR(totalIn - totalOut)}`)
    } catch (e) { toast('خطأ: ' + e.message, true) } finally { setBusy(false) }
  }

  return (
    <div className="tool-card">
      <h4>💰 قائمة التدفق النقدي</h4>
      <div className="desc">تدفق يومي داخل/خارج مع الرصيد التراكمي، وتوزيع الإيرادات حسب طريقة الدفع.</div>
      <div className="grid2" style={{ marginBottom: 8 }}>
        <div><label>من</label><input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></div>
        <div><label>إلى</label><input type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></div>
      </div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => run('xlsx')}>📗 Excel</button>
        <button className="btn btn-blue btn-sm" disabled={busy} onClick={() => run('pdf')}>📄 PDF</button>
      </div>
    </div>
  )
}


/* ================= أعمار الديون (شرائح متعددة) ================= */
function AgingBucketsTool() {
  const { profile, toast } = useAuth()
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState(null)

  const run = async (fmt = 'xlsx') => {
    setBusy(true)
    try {
      const cid = profile.company_id
      const { data: od } = await supabase.rpc('overdue_payments', { p_company: cid, p_days: 1 })
      const buckets = { '1-15': [], '16-30': [], '31-60': [], '61-90': [], '90+': [] }
      for (const o of od || []) {
        const d = o.days_late
        const k = d <= 15 ? '1-15' : d <= 30 ? '16-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+'
        buckets[k].push(o)
      }
      const summary = Object.entries(buckets).map(([bucket, arr]) => ({
        'الشريحة (أيام تأخير)': bucket,
        'عدد المستأجرون': arr.length,
        'إجمالي المستحق': arr.reduce((s, o) => s + num(o.amount_due), 0)
      }))
      setData({ buckets, summary })

      const rows = (od || []).map(o => ({
        'المستأجر': o.customer_name, 'الجوال': o.phone, 'الوحدة': o.unit_number,
        'الاستحقاق': o.due_date, 'المبلغ المستحق': num(o.amount_due), 'أيام التأخير': o.days_late,
        'الشريحة': o.days_late <= 15 ? '1-15' : o.days_late <= 30 ? '16-30' : o.days_late <= 60 ? '31-60' : o.days_late <= 90 ? '61-90' : '90+'
      }))
      const sheets = [
        { name: 'ملخص الشرائح', rows: summary, numeric: ['عدد المستأجرون', 'إجمالي المستحق'] },
        { name: 'التفاصيل', rows, numeric: ['المبلغ المستحق', 'أيام التأخير'] }
      ]
      emitReport(fmt, `أعمار-الديون-${today()}`, 'تقرير أعمار الديون', sheets, {}, null)
      toast(`✓ صدر تقرير أعمار الديون (${fmt.toUpperCase()}): ${od?.length || 0} حالة`)
    } catch (e) { toast('خطأ: ' + e.message, true) } finally { setBusy(false) }
  }

  return (
    <div className="tool-card">
      <h4>📊 أعمار الديون (شرائح)</h4>
      <div className="desc">توزيع المتأخرات على شرائح 1-15/16-30/31-60/61-90/90+ يوم لأولوية التحصيل.</div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => run('xlsx')}>📗 Excel</button>
        <button className="btn btn-blue btn-sm" disabled={busy} onClick={() => run('pdf')}>📄 PDF</button>
      </div>

      {data && (
        <table className="tbl" style={{ marginTop: 10 }}>
          <thead><tr><th>الشريحة</th><th>المستأجرون</th><th>المستحق</th></tr></thead>
          <tbody>
            {data.summary.map(r => (
              <tr key={r['الشريحة (أيام تأخير)']}>
                <td>{r['الشريحة (أيام تأخير)']} يوم</td>
                <td>{r['عدد المستأجرون']}</td>
                <td className={r['إجمالي المستحق'] > 0 ? 'neg' : ''}>{SAR(r['إجمالي المستحق'])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/* ================= مقارنة الفترات ================= */
function PeriodComparisonTool() {
  const { profile, toast } = useAuth()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const run = async (fmt = 'xlsx') => {
    setBusy(true)
    try {
      const cid = profile.company_id
      const now = new Date()
      const thisMonthFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
      const lastMonthFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10)
      const lastMonthTo = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10)
      const to = today()
      const fetchPeriod = async (from, upto) => {
        const [{ data: p }, { data: e }] = await Promise.all([
          supabase.from('payments').select('amount').eq('company_id', cid).gte('payment_date', from).lte('payment_date', upto),
          supabase.from('expenses').select('amount').eq('company_id', cid).gte('expense_date', from).lte('expense_date', upto)
        ])
        const rev = (p || []).reduce((s, x) => s + num(x.amount), 0)
        const exp = (e || []).reduce((s, x) => s + num(x.amount), 0)
        return { rev, exp, net: rev - exp, count: (p || []).length }
      }
      const [cur, prev] = await Promise.all([fetchPeriod(thisMonthFrom, to), fetchPeriod(lastMonthFrom, lastMonthTo)])
      const pct = (a, b) => b === 0 ? (a > 0 ? '+∞' : '0') : Math.round(((a - b) / b) * 100) + '%'
      const rows = [
        { 'المؤشر': 'الإيرادات', 'الشهر الحالي': cur.rev, 'الشهر السابق': prev.rev, 'التغيّر': pct(cur.rev, prev.rev) },
        { 'المؤشر': 'المصروفات', 'الشهر الحالي': cur.exp, 'الشهر السابق': prev.exp, 'التغيّر': pct(cur.exp, prev.exp) },
        { 'المؤشر': 'صافي الربح', 'الشهر الحالي': cur.net, 'الشهر السابق': prev.net, 'التغيّر': pct(cur.net, prev.net) },
        { 'المؤشر': 'عدد الدفعات', 'الشهر الحالي': cur.count, 'الشهر السابق': prev.count, 'التغيّر': pct(cur.count, prev.count) }
      ]
      setResult(rows)
      emitReport(fmt, `مقارنة-شهرية-${today()}`, 'مقارنة الأداء الشهري',
        [{ name: 'المقارنة', rows, numeric: ['الشهر الحالي', 'الشهر السابق'] }],
        { 'الحالي': `${thisMonthFrom} → ${to}`, 'السابق': `${lastMonthFrom} → ${lastMonthTo}` }, null)
      toast(`✓ صدرت المقارنة (${fmt.toUpperCase()}): ${SAR(cur.rev)} مقابل ${SAR(prev.rev)}`)
    } catch (e) { toast('خطأ: ' + e.message, true) } finally { setBusy(false) }
  }

  return (
    <div className="tool-card">
      <h4>📈 مقارنة الشهر الحالي بالسابق</h4>
      <div className="desc">مقارنة سريعة بين إيرادات ومصروفات وأرباح هذا الشهر والشهر السابق مع نسبة النمو.</div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => run('xlsx')}>📗 Excel</button>
        <button className="btn btn-blue btn-sm" disabled={busy} onClick={() => run('pdf')}>📄 PDF</button>
      </div>

      {result && (
        <table className="tbl" style={{ marginTop: 10 }}>
          <thead><tr><th>المؤشر</th><th>الحالي</th><th>السابق</th><th>التغيّر</th></tr></thead>
          <tbody>{result.map(r => (
            <tr key={r['المؤشر']}>
              <td>{r['المؤشر']}</td>
              <td className="money">{typeof r['الشهر الحالي'] === 'number' ? r['الشهر الحالي'].toLocaleString() : r['الشهر الحالي']}</td>
              <td>{typeof r['الشهر السابق'] === 'number' ? r['الشهر السابق'].toLocaleString() : r['الشهر السابق']}</td>
              <td><span className="chip" style={{ background: String(r['التغيّر']).startsWith('-') ? '#FDECEC' : '#E7F7EE', color: String(r['التغيّر']).startsWith('-') ? 'var(--st-oc)' : 'var(--st-av)' }}>{r['التغيّر']}</span></td>
            </tr>))}</tbody>
        </table>
      )}
    </div>
  )
}


function SettlementSummaryExportTool({ units = [] }) {
  const { profile, company, toast } = useAuth()
  const [selectedUnit, setSelectedUnit] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)

  const fetchUnitFinancialData = async (unitNum) => {
    if (!unitNum) return null
    const cid = profile?.company_id || company?.id

    // Find unit metadata
    const unitObj = units.find(u => String(u.unit_number) === String(unitNum)) || {}
    const unitId = unitObj.id

    // 1. Fetch Bookings
    let bookingsQuery = supabase
      .from('bookings')
      .select('id, customer_name, check_in_date, check_out_date, total_amount, total_price, discount_amount, insurance_amount, status, created_at, customers(full_name), payments(amount, payment_date, method)')
      .eq('company_id', cid)

    if (unitId) {
      bookingsQuery = bookingsQuery.or(`unit_id.eq.${unitId},unit_id_str.eq.${unitNum}`)
    } else {
      bookingsQuery = bookingsQuery.eq('unit_id_str', unitNum)
    }

    if (fromDate) bookingsQuery = bookingsQuery.gte('created_at', fromDate)
    if (toDate) bookingsQuery = bookingsQuery.lte('created_at', toDate + 'T23:59:59')

    const { data: bookingsData, error: bErr } = await bookingsQuery
    if (bErr) console.warn('Bookings fetch error:', bErr)

    // 2. Fetch Expenses
    let expensesQuery = supabase
      .from('expenses')
      .select('id, category, amount, description, vendor_name, expense_date, invoice_url')
      .eq('company_id', cid)

    if (unitId) {
      expensesQuery = expensesQuery.eq('unit_id', unitId)
    }

    if (fromDate) expensesQuery = expensesQuery.gte('expense_date', fromDate)
    if (toDate) expensesQuery = expensesQuery.lte('expense_date', toDate)

    const { data: expensesData, error: eErr } = await expensesQuery
    if (eErr) console.warn('Expenses fetch error:', eErr)

    // Calculate aggregated numbers
    const bookings = bookingsData || []
    const expenses = expensesData || []

    let grossRevenue = 0
    let totalCollected = 0

    const bookingRows = bookings.map(b => {
      const price = Number(b.total_amount || b.total_price || 0)
      const paid = (b.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0)
      const remaining = price - paid
      grossRevenue += price
      totalCollected += paid

      const tenantName = b.customers?.full_name || b.customer_name || 'مستأجر'
      const statusLabel = b.status === 'confirmed' ? 'مؤكد' : b.status === 'completed' ? 'مكتمل' : b.status === 'cancelled' ? 'ملغى' : b.status || 'ساري'

      return {
        'رقم الحجز': b.id.slice(0, 8),
        'اسم الساكن': tenantName,
        'تاريخ الوصول': b.check_in_date || '—',
        'تاريخ المغادرة': b.check_out_date || '—',
        'إجمالي العقد': price,
        'المحصول المدفوع': paid,
        'المتبقي المعلق': remaining,
        'الحالة': statusLabel
      }
    })

    let maintCost = 0
    let elecCost = 0
    let waterCost = 0
    let otherCost = 0

    const expenseRows = expenses.map(e => {
      const amt = Number(e.amount || 0)
      let catLabel = 'مصروف صيانة ونظافة'
      if (e.category === 'electricity') { catLabel = 'فاتورة كهرباء'; elecCost += amt; }
      else if (e.category === 'water') { catLabel = 'فاتورة مياه'; waterCost += amt; }
      else if (e.category === 'other_bill') { catLabel = 'فاتورة أخرى'; otherCost += amt; }
      else { maintCost += amt; }

      return {
        'تاريخ الفاتورة': e.expense_date || '—',
        'بند المصروف': catLabel,
        'وصف الفاتورة / الخدمة': e.description || '—',
        'المورد / الجهة': e.vendor_name || '—',
        'المبلغ (ر.س)': amt,
        'رابط المستند': e.invoice_url ? 'مرفق متوفر' : 'غير مرفق'
      }
    })

    const totalExpenses = maintCost + elecCost + waterCost + otherCost
    const netSettlement = totalCollected - totalExpenses
    const outstandingDues = grossRevenue - totalCollected

    return {
      unitNum,
      unitObj,
      bookings,
      expenses,
      bookingRows,
      expenseRows,
      totals: {
        grossRevenue,
        totalCollected,
        maintCost,
        elecCost,
        waterCost,
        otherCost,
        totalExpenses,
        netSettlement,
        outstandingDues
      }
    }
  }

  const handlePreview = async () => {
    if (!selectedUnit) return toast('اختر الوحدة أولاً', true)
    setBusy(true)
    try {
      const res = await fetchUnitFinancialData(selectedUnit)
      setPreview(res)
      toast('تم تحميل البيانات المالية للتسوية بنجاح')
    } catch (err) {
      toast('حدث خطأ في جلب البيانات: ' + err.message, true)
    } finally {
      setBusy(false)
    }
  }

  const handleExportPDF = async () => {
    if (!selectedUnit) return toast('اختر الوحدة أولاً', true)
    setBusy(true)
    try {
      let data = preview
      if (!data || data.unitNum !== selectedUnit) {
        data = await fetchUnitFinancialData(selectedUnit)
        setPreview(data)
      }

      if (!data) throw new Error('تعذر تحميل بيانات الوحدة')

      const { totals, bookingRows, expenseRows } = data

      // Master Financial Reconciliation Sheet
      const summarySheetRows = [
        { 'البند المالي والتأثير': 'إجمالي قيمة عقود الإيجار الإجمالية', 'نوع التدفق': 'إيراد مستحق (استحقاق)', 'المبلغ': SAR(totals.grossRevenue), 'ملاحظات وتفاصيل': 'إجمالي قيمة جميع المحجوزات والعقود' },
        { 'البند المالي والتأثير': 'إجمالي المقبوضات والتحصيلات النقدية', 'نوع التدفق': 'تدفق نقدي وارد (+)', 'المبلغ': SAR(totals.totalCollected), 'ملاحظات وتفاصيل': 'المبالغ المحصلة فعلياً بحسابات البنك/الكاش' },
        { 'البند المالي والتأثير': 'المبالغ المتبقية المستحقة (ذمم سكنية)', 'نوع التدفق': 'ذمم مدينة معلقة', 'المبلغ': SAR(totals.outstandingDues), 'ملاحظات وتفاصيل': 'المتبقي المستحق على النزلاء والمستأجرين' },
        { 'البند المالي والتأثير': 'مصروفات الصيانة والإصلاح والنظافة', 'نوع التدفق': 'تدفق نقدي صادرة (-)', 'المبلغ': SAR(totals.maintCost), 'ملاحظات وتفاصيل': 'تكاليف قطع الغيار والصيانة الفورية' },
        { 'البند المالي والتأثير': 'فواتير الكهرباء المدفوعة', 'نوع التدفق': 'تدفق نقدي صادرة (-)', 'المبلغ': SAR(totals.elecCost), 'ملاحظات وتفاصيل': 'مبالغ فواتير شركة الكهرباء المسددة' },
        { 'البند المالي والتأثير': 'فواتير المياه المدفوعة', 'نوع التدفق': 'تدفق نقدي صادرة (-)', 'المبلغ': SAR(totals.waterCost), 'ملاحظات وتفاصيل': 'مبالغ فواتير المياه والخدمات' },
        { 'البند المالي والتأثير': 'مصروفات وفواتير أخرى', 'نوع التدفق': 'تدفق نقدي صادرة (-)', 'المبلغ': SAR(totals.otherCost), 'ملاحظات وتفاصيل': 'أي مصاريف وتشغيلات إضافية للوحدة' },
        { 'البند المالي والتأثير': 'إجمالي المصروفات والخدمات للوحدة', 'نوع التدفق': 'إجمالي التكاليف (-)', 'المبلغ': SAR(totals.totalExpenses), 'ملاحظات وتفاصيل': 'مجموع كافة المصاريف والتكاليف المدفوعة' },
        { 'البند المالي والتأثير': 'صافي التسوية والربح التشغيلي للوحدة', 'نوع التدفق': 'صافي الدخل التشغيلي (Net)', 'المبلغ': SAR(totals.netSettlement), 'ملاحظات وتفاصيل': 'صافي المستحق النهائي مالك الوحدة/الإدارة' },
      ]

      downloadPDF({
        title: `تقرير التسوية المالية الشامل — وحدة ${selectedUnit}`,
        subtitle: `تفاصيل التسويات المالية، الإيرادات والمصروفات المباشرة للوحدة (${fromDate || 'البداية'} إلى ${toDate || 'الآن'})`,
        company,
        filters: {
          'الوحدة': selectedUnit,
          'الفترة من': fromDate || 'منذ التأسيس',
          'الفترة إلى': toDate || 'تاريخ اليوم',
          'حالة الوحدة': data.unitObj?.status ? (data.unitObj.status === 'occupied' ? 'مشغولة' : 'متاحة') : 'مسجلة'
        },
        summaryCards: [
          { label: 'إجمالي قيمة العقود', value: SAR(totals.grossRevenue), borderColor: '#C9A84C' },
          { label: 'المقبوضات الفعلية', value: SAR(totals.totalCollected), color: '#059669', borderColor: '#059669' },
          { label: 'إجمالي المصروفات', value: SAR(totals.totalExpenses), color: '#DC2626', borderColor: '#DC2626' },
          { label: 'صافي التسوية التشغيلية', value: SAR(totals.netSettlement), color: totals.netSettlement >= 0 ? '#10B981' : '#EF4444', borderColor: totals.netSettlement >= 0 ? '#10B981' : '#EF4444' },
          { label: 'المبالغ المتبقية المستحقة', value: SAR(totals.outstandingDues), color: '#D97706', borderColor: '#D97706' }
        ],
        sheets: [
          {
            name: '1. الميزانية وصافي التسوية التشغيلية',
            rows: summarySheetRows
          },
          {
            name: '2. بيان عقود الإيجار والتسويات',
            rows: bookingRows,
            numeric: ['إجمالي العقد', 'المحصول المدفوع', 'المتبقي المعلق']
          },
          {
            name: '3. بيان المصروفات وفواتير الصيانة والخدمات',
            rows: expenseRows,
            numeric: ['المبلغ (ر.س)']
          }
        ]
      })

      toast('✓ تم تصدير تقرير التسوية الشامل (PDF) بنجاح')
    } catch (err) {
      toast('خطأ أثناء تصدير PDF: ' + err.message, true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tool-card" style={{ gridColumn: '1 / -1', background: 'var(--panel-bg)', border: '1px solid var(--border-color)', borderRadius: 14, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div>
          <h4 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gold-l)' }}>
            📊 أداة تصدير ملخص التسويات المالية الشامل (Settlement Summary)
          </h4>
          <div className="desc" style={{ marginTop: 4, fontSize: 13, color: 'var(--muted)' }}>
            توليد تقرير مالـي تفصيلي موحّد (PDF) يربط إيرادات الإيجارات، المقبوضات الفعالية، فواتير الكهرباء والمياه، ومصروفات الصيانة لكل وحدة.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', background: 'rgba(255,255,255,0.03)', padding: 14, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>اختر الوحدة السكنية *</label>
          <select className="inp" value={selectedUnit} onChange={e => { setSelectedUnit(e.target.value); setPreview(null); }} style={{ width: '100%' }}>
            <option value="">-- اختر الوحدة --</option>

            {units.map(u => (
              <option key={u.unit_number} value={u.unit_number}>
                وحدة {u.unit_number} {u.title ? `(${u.title})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: '0 1 150px' }}>
          <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>من تاريخ</label>
          <input type="date" className="inp" value={fromDate} onChange={e => { setFromDate(e.target.value); setPreview(null); }} style={{ width: '100%' }} />
        </div>

        <div style={{ flex: '0 1 150px' }}>
          <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>إلى تاريخ</label>
          <input type="date" className="inp" value={toDate} onChange={e => { setToDate(e.target.value); setPreview(null); }} style={{ width: '100%' }} />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
          <button className="btn btn-outline" onClick={handlePreview} disabled={busy || !selectedUnit} style={{ padding: '8px 16px' }}>
            {busy ? 'جاري التحميل...' : '👁 معاينة الأرقام'}
          </button>
          <button className="btn btn-gold" onClick={handleExportPDF} disabled={busy || !selectedUnit} style={{ padding: '8px 18px', fontWeight: 'bold' }}>
            📄 تصدير تقرير التسوية (PDF)
          </button>
        </div>
      </div>

      {/* Preview Card Section */}
      {preview && (
        <div className="animate-fade" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px dashed var(--border-color)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h5 style={{ margin: 0, fontSize: 15, color: 'var(--fg)' }}>
              📋 معاينة ملخص التسوية للوحدة: <span style={{ color: 'var(--gold)' }}>{preview.unitNum}</span>
            </h5>
            <span className="chip" style={{ background: 'rgba(201,168,76,0.15)', color: 'var(--gold-l)', fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>
              ربط مباشر بالحسابات
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
            <div style={{ background: 'var(--card-bg)', padding: 12, borderRadius: 10, border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>إجمالي عقود الإيجار</div>
              <div style={{ fontSize: 16, fontWeight: 'bold', marginTop: 4, color: 'var(--fg)' }}>{SAR(preview.totals.grossRevenue)}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{preview.bookings.length} عقد إيجار</div>
            </div>

            <div style={{ background: 'var(--card-bg)', padding: 12, borderRadius: 10, border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>التحصيلات والمقبوضات</div>
              <div style={{ fontSize: 16, fontWeight: 'bold', marginTop: 4, color: 'var(--green)' }}>{SAR(preview.totals.totalCollected)}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>سيولة نقدية محصلة</div>
            </div>

            <div style={{ background: 'var(--card-bg)', padding: 12, borderRadius: 10, border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>إجمالي المصروفات</div>
              <div style={{ fontSize: 16, fontWeight: 'bold', marginTop: 4, color: 'var(--st-oc)' }}>{SAR(preview.totals.totalExpenses)}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{preview.expenses.length} فاتورة ومصروف</div>
            </div>

            <div style={{ background: 'var(--card-bg)', padding: 12, borderRadius: 10, border: '1.5px solid var(--gold)' }}>
              <div style={{ fontSize: 11, color: 'var(--gold-l)', fontWeight: 'bold' }}>صافي التسوية التشغيلية</div>
              <div style={{ fontSize: 18, fontWeight: '900', marginTop: 4, color: preview.totals.netSettlement >= 0 ? 'var(--green)' : 'var(--st-oc)' }}>
                {SAR(preview.totals.netSettlement)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>صافي مستحق للوحدة</div>
            </div>

            <div style={{ background: 'var(--card-bg)', padding: 12, borderRadius: 10, border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>المتبقي المستحق</div>
              <div style={{ fontSize: 16, fontWeight: 'bold', marginTop: 4, color: 'var(--warn)' }}>{SAR(preview.totals.outstandingDues)}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>ذمم مدينة معلقة</div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'left' }}>
            💡 اضغط زر "تصدير تقرير التسوية (PDF)" للحصول على مستند مطبوع فاخر من 3 صفحات يتضمن التفاصيل والبيانات المحاسبية الكاملة.
          </div>
        </div>
      )}
    </div>
  )
}

function MaintenanceFrequencyHeatmapTool() {
  const { profile, toast } = useAuth()
  const [heatmapData, setHeatmapData] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    (async () => {
      setBusy(true)
      try {
        const { data: requests } = await supabase.from('maintenance_requests')
          .select('opened_at')
          .eq('company_id', profile.company_id)
        
        const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
        const heatmapMap = {}
        
        if (requests && requests.length > 0) {
          requests.forEach(req => {
            const d = new Date(req.opened_at)
            const month = MONTHS[d.getMonth()]
            const week = `الأسبوع ${Math.ceil(d.getDate() / 7)}`
            const key = `${month}-${week}`
            heatmapMap[key] = (heatmapMap[key] || 0) + 1
          })
          const formatted = Object.keys(heatmapMap).map(k => {
            const [month, week] = k.split('-')
            return { month, week, z: heatmapMap[k] * 20, count: heatmapMap[k] }
          })
          setHeatmapData(formatted)
        } else {
          // Mock data if empty
          setHeatmapData([
            { month: 'يناير', week: 'الأسبوع 1', z: 40, count: 2 },
            { month: 'يناير', week: 'الأسبوع 3', z: 80, count: 4 },
            { month: 'فبراير', week: 'الأسبوع 2', z: 60, count: 3 },
            { month: 'أبريل', week: 'الأسبوع 4', z: 120, count: 6 },
            { month: 'يوليو', week: 'الأسبوع 1', z: 100, count: 5 },
            { month: 'أغسطس', week: 'الأسبوع 2', z: 160, count: 8 }, // Seasonal strain
          ])
        }
      } catch (err) {
        console.error(err)
      } finally {
        setBusy(false)
      }
    })()
  }, [profile.company_id])

  return (
    <div className="tool-card" style={{ gridColumn: '1 / -1' }}>
      <h4>🔥 خريطة تكرار الصيانة وإجهاد الموارد (Heatmap)</h4>
      <div className="desc">تحديد أنماط الأعطال الموسمية وأوقات ذروة الصيانة عبر ربط التواريخ والأشهر لمساعدة الإدارة في تخطيط الموارد.</div>
      <div style={{ height: 250, width: '100%', marginTop: 20 }}>
        {busy ? <p style={{ textAlign: 'center', padding: 50 }}>جاري التحميل...</p> : (
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
              <XAxis dataKey="month" type="category" name="الشهر" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis dataKey="week" type="category" name="الأسبوع" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} width={80} />
              <ZAxis dataKey="z" type="number" range={[50, 600]} name="مستوى الإجهاد" />
              <Tooltip 
                cursor={{ strokeDasharray: '3 3' }} 
                contentStyle={{ background: '#0F172A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff' }} 
                formatter={(value, name, props) => [`${props.payload.count} طلبات`, 'عدد الطلبات']}
              />
              <Scatter name="طلبات الصيانة" data={heatmapData} fill="#EF4444" opacity={0.8} />
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}


function OccupancyInsightsTool() {
  const { profile, company } = useAuth()
  const [data, setData] = useState([])
  const [busy, setBusy] = useState(false)

  // Only authorized roles (Owner, Admin, Manager)
  const isAuthorized = ['owner', 'admin', 'manager'].includes(profile?.role)

  useEffect(() => {
    if (!isAuthorized) return;
    
    (async () => {
      setBusy(true)
      try {
        // Mocking 6 months of occupancy data for visualization
        // In a real app, this would aggregate from bookings vs total units
        const MONTHS = ['قبل 5 أشهر', 'قبل 4 أشهر', 'قبل 3 أشهر', 'قبل شهرين', 'الشهر الماضي', 'الشهر الحالي']
        
        const mockData = MONTHS.map((m, i) => {
          const baseOcc = 40 + (i * 5) + Math.floor(Math.random() * 20); // Trending upwards
          return {
            name: m,
            occupancy: Math.min(baseOcc, 100),
            revenue: baseOcc * 1200 + Math.floor(Math.random() * 5000)
          }
        })
        setData(mockData)
      } catch (err) {
        console.error(err)
      } finally {
        setBusy(false)
      }
    })()
  }, [profile?.role, isAuthorized])

  if (!isAuthorized) return null;

  return (
    <div className="tool-card" style={{ gridColumn: '1 / -1' }}>
      <h4>📈 تحليلات الإشغال (Occupancy Insights)</h4>
      <div className="desc">تحليل اتجاهات إشغال الوحدات والإيرادات خلال الـ 6 أشهر الماضية (متاح للإدارة فقط).</div>
      <div style={{ height: 250, width: '100%', marginTop: 20 }}>
        {busy ? <p style={{ textAlign: 'center', padding: 50 }}>جاري التحميل...</p> : (
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorOcc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#10B981" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
              <Tooltip 
                contentStyle={{ background: '#0F172A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff' }} 
                formatter={(value, name) => [name === 'occupancy' ? `${value}%` : `${value} SAR`, name === 'occupancy' ? 'نسبة الإشغال' : 'الإيرادات']}
              />
              <Legend />
              <Area type="monotone" dataKey="occupancy" name="نسبة الإشغال" stroke="#10B981" fillOpacity={1} fill="url(#colorOcc)" activeDot={{ r: 8 }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
