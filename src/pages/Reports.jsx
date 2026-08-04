import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { useBranches } from '../BranchContext'
import { SAR, num, today, exportCSV, CATS, STATUS, uploadFile } from '../lib/helpers'
import { exportFullAccounts, fetchBookingsRows, fetchTenantsRows, fetchPaymentsRows, downloadWorkbook } from '../lib/excel'
import AdvancedAnalytics from './AdvancedAnalytics'
import ReceiptOCR from './ReceiptOCR'
import AccountantTools from './AccountantTools'
import AccountingCore from './AccountingCore'
import Assistant from './Assistant'
import DiscountApprovals from '../components/DiscountApprovals'
import ReportPrintButton from '../components/ReportPrintButton'

export default function Reports() {
  const { profile, isOwner, toast } = useAuth()
  const { scopeQuery, activeBranch } = useBranches()
  const [profit, setProfit] = useState([])     // ربحية الوحدات
  const [overdue, setOverdue] = useState([])   // المتأخرات
  const [byType, setByType] = useState([])     // الإيراد حسب النوع
  const [kpi, setKpi] = useState(null)

  useEffect(() => {
    (async () => {
      const cid = profile.company_id
      const first = today().slice(0, 8) + '01'

      // الإيرادات لكل وحدة + المصروفات = صافي الربح
      const { data: pays } = await scopeQuery(supabase.from('payments')
        .select('amount, bookings(unit_id, units(unit_number, category))')
        .eq('company_id', cid))
      const { data: exps } = await scopeQuery(supabase.from('expenses').select('amount, unit_id').eq('company_id', cid))
      const map = {}
      for (const p of pays || []) {
        const u = p.bookings?.units; if (!u) continue
        const k = p.bookings.unit_id
        map[k] = map[k] || { unit: u.unit_number, cat: u.category, rev: 0, exp: 0 }
        map[k].rev += num(p.amount)
      }
      for (const e of exps || []) {
        if (e.unit_id && map[e.unit_id]) map[e.unit_id].exp += num(e.amount)
      }
      const rows = Object.values(map).map(r => ({ ...r, net: r.rev - r.exp })).sort((a, b) => b.net - a.net)
      setProfit(rows)

      const tMap = {}
      rows.forEach(r => { tMap[r.cat] = (tMap[r.cat] || 0) + r.rev })
      setByType(Object.entries(tMap))

      // المتأخرات عبر الدالة الجاهزة
      const { data: od } = await supabase.rpc('overdue_payments', { p_company: cid, p_days: 1 })
      setOverdue(od || [])

      // مؤشرات
      const { data: occ } = await supabase.rpc('occupancy_rate', { p_company: cid, p_from: first, p_to: today() })
      const { data: bks } = await scopeQuery(supabase.from('bookings').select('status, check_in_date, check_out_date')
        .eq('company_id', cid))
      const done = (bks || []).filter(b => b.status !== 'cancelled')
      const cancelled = (bks || []).filter(b => b.status === 'cancelled').length
      const stayAvg = done.length
        ? (done.reduce((s, b) => s + (new Date(b.check_out_date) - new Date(b.check_in_date)) / 86400000, 0) / done.length).toFixed(1)
        : 0
      const { count: unitsCount } = await scopeQuery(supabase.from('units').select('id', { count: 'exact', head: true }).eq('company_id', cid))
      const monthRev = rows.reduce((s, r) => s + r.rev, 0)
      setKpi({
        occ: occ ?? 0, stayAvg,
        cancelRate: bks?.length ? Math.round(cancelled / bks.length * 100) : 0,
        revpar: unitsCount ? Math.round(monthRev / unitsCount) : 0
      })
    })()
  }, [profile, activeBranch, scopeQuery])

  const maxType = Math.max(...byType.map(([, v]) => v), 1)
  const [activeTab, setActiveTab] = useState('reports'); // 'reports', 'assistant', 'accounting', 'tools'

  return (
    <div>
      <div className="pg-title"><h2>قسم المحاسبة والتقارير المالية</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-gold btn-sm" onClick={async () => {
            toast('جارٍ تجهيز ملف الحسابات الشامل…')
            const r = await exportFullAccounts(supabase, profile.company_id)
            toast(`✓ صدر ملف إكسيل بـ 5 أوراق ومعادلات جاهزة — إيرادات ${SAR(r.rev)} ومصروفات ${SAR(r.exp)}`)
          }}>📗 ملف الحسابات الشامل (Excel)</button>
        </div>
      </div>

      <div className="tabs-container" style={{ display: 'flex', gap: 10, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 10, overflowX: 'auto' }}>
        <button 
          className={`btn btn-sm ${activeTab === 'reports' ? 'btn-blue' : 'btn-ghost'}`} 
          onClick={() => setActiveTab('reports')}>
          📊 التقارير والأداء المالي
        </button>
        <button 
          className={`btn btn-sm ${activeTab === 'assistant' ? 'btn-gold' : 'btn-ghost'}`} 
          onClick={() => setActiveTab('assistant')}>
          🤖 المساعد الذكي AI
        </button>
        <button 
          className={`btn btn-sm ${activeTab === 'accounting' ? 'btn-blue' : 'btn-ghost'}`} 
          onClick={() => setActiveTab('accounting')}>
          🌳 النظام المحاسبي (الشجرة والقيود)
        </button>
        <button 
          className={`btn btn-sm ${activeTab === 'tools' ? 'btn-blue' : 'btn-ghost'}`} 
          onClick={() => setActiveTab('tools')}>
          🧰 أدوات المحاسب والموافقات
        </button>
      </div>

      {activeTab === 'reports' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="kpis">
            <div className="kpi"><div className="v">{kpi ? kpi.occ + '%' : '…'}</div><div className="l">نسبة الإشغال</div></div>
            <div className="kpi"><div className="v">{kpi ? SAR(kpi.revpar) : '…'}</div><div className="l">RevPAR — متوسط الإيراد لكل وحدة</div></div>
            <div className="kpi"><div className="v">{kpi ? kpi.stayAvg + ' يوم' : '…'}</div><div className="l">متوسط مدة الإقامة</div></div>
            <div className="kpi"><div className="v">{kpi ? kpi.cancelRate + '%' : '…'}</div><div className="l">معدل الإلغاء</div></div>
          </div>
          {/* نُقل مولّد التقارير إلى «مركز التقارير المحاسبية» في القائمة الجانبية
              حتى لا تزدحم هذه الصفحة بمربعات لا علاقة لها بمؤشراتها. */}

          <div className="grid2">
            <div className="panel"><h3>الإيرادات حسب نوع الوحدة</h3>
              {byType.length === 0 ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>لا توجد إيرادات مسجلة بعد</p> :
                <div className="bars">
                  {byType.map(([cat, v]) =>
                    <div className="bar" key={cat}><b>{Math.round(v / 1000)}K</b>
                      <i style={{ height: (v / maxType * 100) + '%' }} />{CATS[cat]}</div>)}
                </div>}
            </div>
            <div className="panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>أكثر الوحدات ربحاً (صافي وليس إيراداً فقط)</h3>
                <ReportPrintButton
                  title="تقرير ربحية الوحدات"
                  subtitle={`صافي الربح لكل وحدة — تاريخ الإصدار: ${today()}`}
                  docPrefix="PRF"
                  columns={['الوحدة', 'الإيراد', 'المصروف', 'صافي الربح']}
                  rows={profit.map(r => [r.unit, SAR(r.rev), SAR(r.exp), SAR(r.net)])}
                  summary={[
                    ['عدد الوحدات', profit.length],
                    ['إجمالي الإيراد', SAR(profit.reduce((s, r) => s + (Number(r.rev) || 0), 0))],
                    ['إجمالي المصروف', SAR(profit.reduce((s, r) => s + (Number(r.exp) || 0), 0))],
                    ['صافي الربح', SAR(profit.reduce((s, r) => s + (Number(r.net) || 0), 0))],
                  ]}
                />
              </div>
              <table className="tbl">
                <thead><tr><th>الوحدة</th><th>الإيراد</th><th>المصروف</th><th>صافي الربح</th></tr></thead>
                <tbody>
                  {profit.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا توجد بيانات بعد</td></tr>}
                  {profit.slice(0, 8).map(r =>
                    <tr key={r.unit}><td>{r.unit}</td><td className="money">{SAR(r.rev)}</td>
                      <td className="neg">{SAR(r.exp)}</td><td className="money">{SAR(r.net)}</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
          <AdvancedAnalytics />
        </div>
      )}

      {activeTab === 'assistant' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Assistant />
        </div>
      )}

      {activeTab === 'accounting' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <AccountingCore />
        </div>
      )}

      {activeTab === 'tools' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <AccountantTools />
          <DiscountApprovals />
          <ReceiptOCR />
        </div>
      )}

    </div>
  )
}
