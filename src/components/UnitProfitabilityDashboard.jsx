import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { SAR, num, today } from '../lib/helpers'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell
} from 'recharts'

export default function UnitProfitabilityDashboard({ embeddedUnitId = null }) {
  const { profile } = useAuth()
  const [dateRange, setDateRange] = useState({
    from: `${new Date().getFullYear()}-01-01`,
    to: today()
  })
  const [selectedUnitId, setSelectedUnitId] = useState(embeddedUnitId || 'all')
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [reportData, setReportData] = useState([])
  const [totals, setTotals] = useState({
    totalRevenue: 0,
    totalExpenses: 0,
    netProfit: 0,
    profitMargin: 0
  })

  // Preset date filters
  const applyPreset = (preset) => {
    const now = new Date()
    let from = dateRange.from
    let to = today()

    if (preset === 'this_month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    } else if (preset === 'last_3_months') {
      from = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10)
    } else if (preset === 'this_year') {
      from = `${now.getFullYear()}-01-01`
    }
    setDateRange({ from, to })
  }

  // Load units list
  useEffect(() => {
    supabase
      .from('units')
      .select('id, unit_number, category, status')
      .eq('company_id', profile.company_id)
      .eq('is_active', true)
      .order('unit_number')
      .then(({ data }) => setUnits(data || []))
  }, [profile.company_id])

  // Fetch profitability data
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // 1. Fetch payments (Rent Revenues)
      let payQuery = supabase
        .from('payments')
        .select('amount, payment_date, booking_id, bookings(unit_id, units(unit_number))')
        .eq('company_id', profile.company_id)
        .gte('payment_date', dateRange.from)
        .lte('payment_date', dateRange.to)

      // 2. Fetch expenses (Maintenance & Operating Costs)
      let expQuery = supabase
        .from('expenses')
        .select('amount, expense_date, category, unit_id, units(unit_number)')
        .eq('company_id', profile.company_id)
        .gte('expense_date', dateRange.from)
        .lte('expense_date', dateRange.to)

      const [{ data: payments }, { data: expenses }] = await Promise.all([
        payQuery,
        expQuery
      ])

      // Map unit metrics
      const unitMap = {}
      units.forEach(u => {
        unitMap[u.id] = {
          unit_id: u.id,
          unit_number: `وحدة ${u.unit_number}`,
          revenue: 0,
          maintenance: 0,
          other_expenses: 0,
          total_expenses: 0,
          net_profit: 0
        }
      })

      // Aggregate Revenues
      ;(payments || []).forEach(p => {
        const uid = p.bookings?.unit_id
        if (uid && unitMap[uid]) {
          unitMap[uid].revenue += num(p.amount)
        }
      })

      // Aggregate Expenses
      ;(expenses || []).forEach(e => {
        const uid = e.unit_id
        if (uid && unitMap[uid]) {
          if (e.category === 'maintenance' || e.category === 'cleaning') {
            unitMap[uid].maintenance += num(e.amount)
          } else {
            unitMap[uid].other_expenses += num(e.amount)
          }
          unitMap[uid].total_expenses += num(e.amount)
        }
      })

      // Process totals and list
      let list = Object.values(unitMap).map(u => {
        const net = u.revenue - u.total_expenses
        return {
          ...u,
          net_profit: net,
          margin: u.revenue > 0 ? Math.round((net / u.revenue) * 100) : 0
        }
      })

      if (selectedUnitId !== 'all') {
        list = list.filter(u => u.unit_id === selectedUnitId)
      }

      const totRev = list.reduce((a, b) => a + b.revenue, 0)
      const totExp = list.reduce((a, b) => a + b.total_expenses, 0)
      const net = totRev - totExp
      const margin = totRev > 0 ? Math.round((net / totRev) * 100) : 0

      setTotals({
        totalRevenue: totRev,
        totalExpenses: totExp,
        netProfit: net,
        profitMargin: margin
      })

      setReportData(list)
    } catch (err) {
      console.error('Error loading profitability:', err)
    } finally {
      setLoading(false)
    }
  }, [profile.company_id, dateRange, units, selectedUnitId])

  useEffect(() => {
    if (units.length > 0) {
      loadData()
    }
  }, [loadData, units.length])

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            📊 مؤشر ربحية الوحدات (المقبوضات vs مصاريف الصيانة)
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            مقارنة الإيرادات المحصلة من إيجارات كل وحدة مقابل تكاليف صيانتا وتشغيلها
          </p>
        </div>

        {/* Filters bar */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {!embeddedUnitId && (
            <select
              value={selectedUnitId}
              onChange={e => setSelectedUnitId(e.target.value)}
              style={{ minWidth: 140 }}
            >
              <option value="all">كل الوحدات</option>
              {units.map(u => (
                <option key={u.id} value={u.id}>وحدة {u.unit_number}</option>
              ))}
            </select>
          )}

          <input
            type="date"
            value={dateRange.from}
            onChange={e => setDateRange({ ...dateRange, from: e.target.value })}
            style={{ padding: '6px 10px', fontSize: 13 }}
          />
          <span style={{ fontSize: 12 }}>إلى</span>
          <input
            type="date"
            value={dateRange.to}
            onChange={e => setDateRange({ ...dateRange, to: e.target.value })}
            style={{ padding: '6px 10px', fontSize: 13 }}
          />

          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => applyPreset('this_month')}>الشهر الحالي</button>
            <button className="btn btn-ghost btn-sm" onClick={() => applyPreset('last_3_months')}>3 أشهر</button>
            <button className="btn btn-ghost btn-sm" onClick={() => applyPreset('this_year')}>السنة الحالية</button>
          </div>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid4" style={{ marginBottom: 20 }}>
        <div className="card" style={{ padding: 14, borderRight: '4px solid #10B981', background: 'var(--soft)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>إجمالي إيرادات الإيجار</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#10B981', marginTop: 4 }}>
            {SAR(totals.totalRevenue)}
          </div>
        </div>

        <div className="card" style={{ padding: 14, borderRight: '4px solid #EF4444', background: 'var(--soft)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>إجمالي مصاريف الصيانة والتشغيل</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#EF4444', marginTop: 4 }}>
            {SAR(totals.totalExpenses)}
          </div>
        </div>

        <div className="card" style={{ padding: 14, borderRight: '4px solid #3B82F6', background: 'var(--soft)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>صافي أرباح الوحدات</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: totals.netProfit >= 0 ? '#3B82F6' : '#DC2626', marginTop: 4 }}>
            {SAR(totals.netProfit)}
          </div>
        </div>

        <div className="card" style={{ padding: 14, borderRight: '4px solid #F59E0B', background: 'var(--soft)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>متوسط هامش الربح</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#F59E0B', marginTop: 4 }}>
            {totals.profitMargin}%
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>جارٍ تحليل أداء وربحية الوحدات…</div>
      ) : reportData.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>لا توجد بيانات مالية مسجلة لهذه الفترة</div>
      ) : (
        <div className="grid2" style={{ gap: 20 }}>
          {/* Recharts Bar Comparison Chart */}
          <div style={{ background: 'var(--panel)', padding: 16, borderRadius: 10, border: '1px solid var(--border)' }}>
            <h4 style={{ margin: '0 0 14px', fontSize: 14, display: 'flex', justifyContent: 'space-between' }}>
              <span>📈 مقارنة إيرادات الإيجارات مقابل الصيانة لكل وحدة</span>
            </h4>
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reportData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="unit_number" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value) => SAR(value)}
                    contentStyle={{ background: '#1f2937', color: '#fff', borderRadius: 8, border: 'none' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: 10, fontSize: 12 }} />
                  <Bar dataKey="revenue" name="إيرادات الإيجار" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="maintenance" name="مصاريف الصيانة" fill="#EF4444" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="net_profit" name="صافي الربح" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Unit Profitability Breakdown Table */}
          <div style={{ background: 'var(--panel)', padding: 16, borderRadius: 10, border: '1px solid var(--border)', overflowX: 'auto' }}>
            <h4 style={{ margin: '0 0 14px', fontSize: 14 }}>
              📋 جدول التفاصيل المالي بالوحدات
            </h4>
            <table className="tbl" style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  <th>الوحدة</th>
                  <th>الإيراد الإجمالي</th>
                  <th>تكلفة الصيانة</th>
                  <th>صافي الربح</th>
                  <th>نسبة الهامش</th>
                </tr>
              </thead>
              <tbody>
                {reportData.map(u => (
                  <tr key={u.unit_id}>
                    <td><b>{u.unit_number}</b></td>
                    <td style={{ color: '#10B981', fontWeight: 600 }}>{SAR(u.revenue)}</td>
                    <td style={{ color: '#EF4444' }}>{SAR(u.maintenance)}</td>
                    <td style={{ color: u.net_profit >= 0 ? '#3B82F6' : '#DC2626', fontWeight: 'bold' }}>
                      {SAR(u.net_profit)}
                    </td>
                    <td>
                      <span className={`chip ${u.margin >= 50 ? 'chip-ok' : u.margin >= 20 ? 'chip-gold' : 'chip-danger'}`}>
                        {u.margin}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
