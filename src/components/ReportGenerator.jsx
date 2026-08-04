import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { SAR, num, today, exportCSV } from '../lib/helpers'
import { downloadPDF } from '../lib/pdf'
import { useAuth } from '../AuthContext'

const REPORT_TITLE = {
  customer_movement: 'تقرير حركة العملاء',
  services: 'تقرير الخدمات',
  maintenance: 'تقرير الصيانة والمدفوعات',
  occupancy: 'تقرير الإشغال والتوفر',
  available_units: 'الوحدات المتاحة',
  occupied_units: 'الوحدات المسكونة',
  revenue_summary: 'ملخص الإيرادات والمصروفات',
}

// يحوّل بيانات التقرير الحالية إلى صفوف جاهزة لمولّد الـ PDF المشترك
function reportToSheets(data) {
  if (!data) return []
  if (data.type === 'customer_movement') return [{
    name: REPORT_TITLE[data.type], numeric: ['عدد الحجوزات'],
    rows: data.rows.map(c => ({ 'العميل': c.full_name, 'تاريخ الإضافة': c.created_at?.slice(0, 10), 'عدد الحجوزات': (c.bookings || []).length })),
  }]
  if (data.type === 'services') return [{
    name: REPORT_TITLE[data.type], numeric: ['المبلغ'],
    rows: data.rows.map(s => ({ 'العميل': s.customers?.full_name, 'الوحدة': s.units?.unit_number, 'المبلغ': num(s.base_price), 'تاريخ الدخول': s.check_in_date })),
  }]
  if (data.type === 'maintenance') return [{
    name: REPORT_TITLE[data.type], numeric: ['المبلغ'],
    rows: [
      ...data.expenses.map(e => ({ 'الوصف': e.description, 'المورد': e.vendor_name, 'المبلغ': num(e.amount), 'التاريخ': e.expense_date })),
      ...data.payments.map(p => ({ 'الوصف': 'دفع صيانة', 'المورد': '—', 'المبلغ': num(p.amount), 'التاريخ': p.payment_date })),
    ],
  }]
  if (data.type === 'available_units') return [{
    name: REPORT_TITLE[data.type],
    rows: data.rows.map(u => ({ 'الوحدة': u.units?.unit_number, 'تاريخ التوفر': u.check_out_date })),
  }]
  if (data.type === 'occupied_units') return [{
    name: REPORT_TITLE[data.type],
    rows: data.rows.map(u => ({ 'الوحدة': u.units?.unit_number, 'المستأجر': u.customers?.full_name, 'من': u.check_in_date, 'إلى': u.check_out_date })),
  }]
  if (data.type === 'revenue_summary') return [{
    name: REPORT_TITLE[data.type], numeric: ['المبلغ'],
    rows: [
      ...data.payments.map(p => ({ 'النوع': 'إيراد - ' + p.payment_type, 'المبلغ': num(p.amount), 'التاريخ': p.payment_date })),
      ...data.expenses.map(e => ({ 'النوع': 'مصروف - ' + e.category, 'المبلغ': num(e.amount), 'التاريخ': e.expense_date })),
    ],
  }]
  return []
}

export function ReportGenerator({ companyId }) {
  const { company } = useAuth()
  const [reportType, setReportType] = useState('customer_movement')
  const [dateFrom, setDateFrom] = useState(today().slice(0, 8) + '01')
  const [dateTo, setDateTo] = useState(today())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  const generateReport = async () => {
    setLoading(true)
    try {
      if (reportType === 'customer_movement') {
        const { data: customers } = await supabase.from('customers')
          .select('id, full_name, created_at, bookings(id, check_in_date, status)')
          .eq('company_id', companyId)
          .gte('created_at', dateFrom)
          .lte('created_at', dateTo)
        setData({ type: 'customer_movement', rows: customers || [] })
      } else if (reportType === 'services') {
        const { data: services } = await supabase.from('bookings')
          .select('id, customers(full_name), units(unit_number), base_price, check_in_date, status')
          .eq('company_id', companyId)
          .gte('check_in_date', dateFrom)
          .lte('check_in_date', dateTo)
        setData({ type: 'services', rows: services || [] })
      } else if (reportType === 'maintenance') {
        const { data: expenses } = await supabase.from('expenses')
          .select('id, description, vendor_name, amount, expense_date, category')
          .eq('company_id', companyId)
          .eq('category', 'maintenance')
          .gte('expense_date', dateFrom)
          .lte('expense_date', dateTo)
        const { data: payments } = await supabase.from('payments')
          .select('id, amount, payment_date, bookings(units(unit_number))')
          .eq('company_id', companyId)
          .eq('payment_type', 'maintenance')
          .gte('payment_date', dateFrom)
          .lte('payment_date', dateTo)
        setData({ type: 'maintenance', expenses: expenses || [], payments: payments || [] })
      } else if (reportType === 'occupancy') {
        const { data: units } = await supabase.from('units').select('id, unit_number').eq('company_id', companyId)
        const { data: bookings } = await supabase.from('bookings')
          .select('unit_id, check_in_date, check_out_date, status')
          .eq('company_id', companyId)
          .lte('check_in_date', dateTo)
          .gte('check_out_date', dateFrom)
        setData({ type: 'occupancy', units: units || [], bookings: bookings || [] })
      } else if (reportType === 'available_units') {
        const { data: bookings } = await supabase.from('bookings')
          .select('unit_id, check_out_date, units(unit_number)')
          .eq('company_id', companyId)
          .eq('status', 'confirmed')
          .gte('check_out_date', dateFrom)
          .lte('check_out_date', dateTo)
        setData({ type: 'available_units', rows: bookings || [] })
      } else if (reportType === 'occupied_units') {
        const { data: bookings } = await supabase.from('bookings')
          .select('unit_id, check_in_date, check_out_date, customers(full_name), units(unit_number)')
          .eq('company_id', companyId)
          .in('status', ['checked_in', 'confirmed'])
          .lte('check_in_date', dateTo)
          .gte('check_out_date', dateFrom)
        setData({ type: 'occupied_units', rows: bookings || [] })
      } else if (reportType === 'revenue_summary') {
        const { data: payments } = await supabase.from('payments')
          .select('amount, payment_type, payment_date, bookings(customers(full_name), units(unit_number))')
          .eq('company_id', companyId)
          .gte('payment_date', dateFrom)
          .lte('payment_date', dateTo)
        const { data: expenses } = await supabase.from('expenses')
          .select('amount, category, expense_date')
          .eq('company_id', companyId)
          .gte('expense_date', dateFrom)
          .lte('expense_date', dateTo)
        setData({ type: 'revenue_summary', payments: payments || [], expenses: expenses || [] })
      }
    } catch (err) {
      console.error('Report error:', err)
    }
    setLoading(false)
  }

  return (
    <div className="panel">
      <h3>📊 منشئ التقارير المحاسبية</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <select value={reportType} onChange={e => setReportType(e.target.value)}>
          <option value="customer_movement">تقرير حركة العملاء</option>
          <option value="services">تقرير الخدمات</option>
          <option value="maintenance">تقرير الصيانة والمدفوعات</option>
          <option value="occupancy">تقرير الإشغال والتوفر</option>
          <option value="available_units">الوحدات المتاحة</option>
          <option value="occupied_units">الوحدات المسكونة</option>
          <option value="revenue_summary">ملخص الإيرادات والمصروفات</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        <button className="btn btn-blue btn-sm" disabled={loading} onClick={generateReport}>{loading ? '...' : 'إنشاء التقرير'}</button>
        <button className="btn btn-gold btn-sm" disabled={!data} onClick={() => downloadPDF({
          title: REPORT_TITLE[reportType],
          company,
          filters: { 'من': dateFrom, 'إلى': dateTo },
          sheets: reportToSheets(data),
        })}>🖨 طباعة / PDF</button>
        <button className="btn btn-green btn-sm" disabled={!data} onClick={() => {
          const sheets = reportToSheets(data)
          if (sheets && sheets[0] && sheets[0].rows) {
            exportCSV(`${REPORT_TITLE[reportType]}.csv`, sheets[0].rows)
          }
        }}>📉 تصدير CSV</button>
      </div>

      {data && (
        <div>
          <table className="tbl" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              {data.type === 'customer_movement' && <tr><th>العميل</th><th>تاريخ الإضافة</th><th>عدد الحجوزات</th></tr>}
              {data.type === 'services' && <tr><th>العميل</th><th>الوحدة</th><th>المبلغ</th><th>تاريخ الدخول</th></tr>}
              {data.type === 'maintenance' && <tr><th>الوصف</th><th>المورد</th><th>المبلغ</th><th>التاريخ</th></tr>}
              {data.type === 'available_units' && <tr><th>الوحدة</th><th>تاريخ التوفر</th></tr>}
              {data.type === 'occupied_units' && <tr><th>الوحدة</th><th>المستأجر</th><th>من</th><th>إلى</th></tr>}
              {data.type === 'revenue_summary' && <tr><th>النوع</th><th>المبلغ</th><th>التاريخ</th></tr>}
            </thead>
            <tbody>
              {data.type === 'customer_movement' && data.rows.map((c, i) => (
                <tr key={i}>
                  <td>{c.full_name}</td>
                  <td>{c.created_at?.slice(0, 10)}</td>
                  <td>{(c.bookings || []).length}</td>
                </tr>
              ))}
              {data.type === 'services' && data.rows.map((s, i) => (
                <tr key={i}>
                  <td>{s.customers?.full_name}</td>
                  <td>{s.units?.unit_number}</td>
                  <td>{SAR(s.base_price)}</td>
                  <td>{s.check_in_date}</td>
                </tr>
              ))}
              {data.type === 'maintenance' && <>
                {data.expenses.map((e, i) => (
                  <tr key={`e${i}`}>
                    <td>{e.description}</td>
                    <td>{e.vendor_name}</td>
                    <td>{SAR(e.amount)}</td>
                    <td>{e.expense_date}</td>
                  </tr>
                ))}
                {data.payments.map((p, i) => (
                  <tr key={`p${i}`}>
                    <td>دفع صيانة</td>
                    <td>—</td>
                    <td>{SAR(p.amount)}</td>
                    <td>{p.payment_date}</td>
                  </tr>
                ))}
              </>}
              {data.type === 'available_units' && data.rows.map((u, i) => (
                <tr key={i}>
                  <td>{u.units?.unit_number}</td>
                  <td>{u.check_out_date}</td>
                </tr>
              ))}
              {data.type === 'occupied_units' && data.rows.map((u, i) => (
                <tr key={i}>
                  <td>{u.units?.unit_number}</td>
                  <td>{u.customers?.full_name}</td>
                  <td>{u.check_in_date}</td>
                  <td>{u.check_out_date}</td>
                </tr>
              ))}
              {data.type === 'revenue_summary' && (
                <>
                  {data.payments.map((p, i) => (
                    <tr key={`p${i}`}>
                      <td>إيراد - {p.payment_type}</td>
                      <td>{SAR(p.amount)}</td>
                      <td>{p.payment_date}</td>
                    </tr>
                  ))}
                  {data.expenses.map((e, i) => (
                    <tr key={`e${i}`}>
                      <td>مصروف - {e.category}</td>
                      <td>{SAR(e.amount)}</td>
                      <td>{e.expense_date}</td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
