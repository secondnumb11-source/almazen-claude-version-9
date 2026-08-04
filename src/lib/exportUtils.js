import { supabase } from './supabase'
import { downloadPDF } from './pdf'
import { downloadWorkbook } from './excel'
import { exportCSV, num, SAR } from './helpers'

export const performFinancialExport = async (profile, company, config, toast) => {
  const { format, type } = config
  toast(`جاري جلب بيانات ${type} لتصديرها بصيغة ${format.toUpperCase()}...`, false)

  try {
    let rows = []
    let sheets = []
    let title = ''
    let filename = ''

    if (type === 'balances') {
      title = 'أرصدة شجرة الحسابات'
      filename = 'Account-Balances'
      const { data } = await supabase.from('payments').select('amount, payment_type, method').eq('company_id', profile.company_id)
      const mapped = {}
      ;(data || []).forEach(p => {
        const k = `${p.payment_type} - ${p.method}`
        mapped[k] = (mapped[k] || 0) + num(p.amount)
      })
      rows = Object.keys(mapped).map(k => ({ 'الحساب': k, 'الرصيد': mapped[k] }))
      sheets = [{ name: 'الأرصدة', rows, numeric: ['الرصيد'] }]
    } 
    else if (type === 'transactions') {
      title = 'سجل العمليات المالية'
      filename = 'Financial-Transactions'
      const { data } = await supabase.from('payments').select('amount, payment_type, method, payment_date, reference_number').eq('company_id', profile.company_id).order('payment_date', { ascending: false }).limit(100)
      rows = (data || []).map(p => ({
        'التاريخ': p.payment_date,
        'النوع': p.payment_type === 'income' ? 'قبض' : 'صرف',
        'طريقة الدفع': p.method,
        'رقم المرجع': p.reference_number || '-',
        'المبلغ': num(p.amount)
      }))
      sheets = [{ name: 'العمليات', rows, numeric: ['المبلغ'] }]
    }
    else if (type === 'settlements') {
      title = 'تسويات الوحدات'
      filename = 'Unit-Settlements'
      const { data } = await supabase.from('bookings').select('id, check_out_date, total_amount, units(unit_number), customers(full_name)').eq('company_id', profile.company_id).eq('status', 'checked_out').order('check_out_date', { ascending: false }).limit(100)
      rows = (data || []).map(b => ({
        'الوحدة': b.units?.unit_number || '-',
        'العميل': b.customers?.full_name || '-',
        'تاريخ المغادرة': b.check_out_date,
        'الإجمالي': num(b.total_amount)
      }))
      sheets = [{ name: 'التسويات', rows, numeric: ['الإجمالي'] }]
    }

    if (rows.length === 0) {
      toast('لا توجد بيانات متاحة للتصدير في هذا القسم.', true)
      return
    }

    if (format === 'csv') {
       exportCSV(rows, filename)
    } else if (format === 'pdf') {
       downloadPDF({ title, subtitle: filename, company, sheets, filters: {} })
    } else {
       downloadWorkbook(filename + '.xlsx', sheets)
    }

    toast(`✓ تم التصدير بنجاح (${format.toUpperCase()})`)
  } catch (err) {
    console.error(err)
    toast('حدث خطأ أثناء التصدير: ' + err.message, true)
  }
}
