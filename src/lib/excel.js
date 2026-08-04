/*
  محرك إكسيل ذكي — يبني ملفات .xlsx حقيقية بعدة أوراق
  مع معادلات جاهزة (SUM / AVERAGE / COUNT) ورؤوس عربية منسقة
*/
import * as XLSX from 'xlsx'

// بناء ورقة من صفوف مع صف معادلات إجمالية للأعمدة الرقمية
export function sheetFromRows(rows, numericCols = []) {
  if (!rows.length) return XLSX.utils.aoa_to_sheet([['لا توجد بيانات']])
  const heads = Object.keys(rows[0])
  const ws = XLSX.utils.json_to_sheet(rows, { header: heads })
  const n = rows.length

  // صف الإجماليات بمعادلات إكسيل حقيقية
  const totalRowIdx = n + 2 // 1 رؤوس + n بيانات + 1
  heads.forEach((h, ci) => {
    const col = XLSX.utils.encode_col(ci)
    const addr = `${col}${totalRowIdx}`
    if (numericCols.includes(h)) {
      ws[addr] = { t: 'n', f: `SUM(${col}2:${col}${n + 1})` }
      const avgAddr = `${col}${totalRowIdx + 1}`
      ws[avgAddr] = { t: 'n', f: `AVERAGE(${col}2:${col}${n + 1})` }
    } else if (ci === 0) {
      ws[addr] = { t: 's', v: 'الإجمالي (معادلة SUM)' }
      ws[`${col}${totalRowIdx + 1}`] = { t: 's', v: 'المتوسط (معادلة AVERAGE)' }
    }
  })
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRowIdx + 1, c: heads.length - 1 } })
  // عرض أعمدة مناسب
  ws['!cols'] = heads.map(h => ({ wch: Math.max(14, String(h).length + 6) }))
  return ws
}

export function downloadWorkbook(filename, sheets) {
  // sheets: [{ name, rows, numeric }]
  const wb = XLSX.utils.book_new()
  wb.Workbook = { Views: [{ RTL: true }] } // اتجاه عربي
  for (const s of sheets) {
    XLSX.utils.book_append_sheet(wb, sheetFromRows(s.rows || [], s.numeric || []), s.name.slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}

/* ===== جامعو البيانات من Supabase (يعيدون صفوفاً عربية جاهزة) ===== */
const M = { cash: 'كاش', bank_transfer: 'تحويل بنكي', card: 'بطاقة' }
const PT = { rent: 'إيجار', down_payment: 'عربون', insurance: 'تأمين', penalty: 'غرامة', other: 'أخرى' }
const BS = { pending: 'معلق', confirmed: 'محجوز', checked_in: 'ساكن', checked_out: 'منتهي', cancelled: 'ملغي', pending_approval: 'بانتظار موافقة الخصم' }
const EJ = { not_linked: '—', pending_landlord: 'بانتظار موافقة المؤجر', pending_tenant: 'بانتظار موافقة المستأجر', registered: 'موثّق', rejected: 'مرفوض', cancelled: 'ملغي التوثيق', expired: 'منتهي الصلاحية' }
const EC = { electricity: 'كهرباء', water: 'ماء', maintenance: 'صيانة', salaries: 'رواتب', cleaning: 'نظافة', internet: 'إنترنت', other: 'أخرى' }

export async function fetchPaymentsRows(supabase, cid, { from, to, unit } = {}) {
  let q = supabase.from('payments')
    .select('amount, payment_type, method, payment_date, reference_number, bookings(check_in_date, check_out_date, units(unit_number), customers(full_name, phone))')
    .eq('company_id', cid).order('payment_date')
  if (from) q = q.gte('payment_date', from)
  if (to) q = q.lte('payment_date', to)
  const { data } = await q
  return (data || [])
    .filter(p => !unit || p.bookings?.units?.unit_number === unit)
    .map(p => ({
      'التاريخ': p.payment_date, 'الوحدة': p.bookings?.units?.unit_number || '—',
      'المستأجر': p.bookings?.customers?.full_name || '—', 'الجوال': p.bookings?.customers?.phone || '—',
      'النوع': PT[p.payment_type], 'الطريقة': M[p.method], 'رقم الإيصال': p.reference_number || '—',
      'المبلغ': Number(p.amount)
    }))
}

export async function fetchBookingsRows(supabase, cid, { from, to, unit } = {}) {
  let q = supabase.from('bookings')
    .select('check_in_date, check_out_date, status, total_amount, discount_amount, down_payment, insurance_amount, ejar_status, ejar_contract_number, units(unit_number), customers(full_name, id_number, phone), payments(amount)')
    .eq('company_id', cid).order('check_in_date')
  if (from) q = q.gte('check_out_date', from)
  if (to) q = q.lte('check_in_date', to)
  const { data } = await q
  return (data || [])
    .filter(b => !unit || b.units?.unit_number === unit)
    .map(b => {
      const paid = (b.payments || []).reduce((s, p) => s + Number(p.amount), 0)
      return {
        'الوحدة': b.units?.unit_number, 'المستأجر': b.customers?.full_name,
        'رقم الهوية': b.customers?.id_number, 'الجوال': b.customers?.phone,
        'من': b.check_in_date, 'إلى': b.check_out_date, 'الحالة': BS[b.status] || b.status,
        'الإجمالي': Number(b.total_amount), 'الخصم': Number(b.discount_amount),
        'العربون': Number(b.down_payment), 'التأمين': Number(b.insurance_amount),
        'المدفوع': paid, 'المتبقي': Number(b.total_amount) - paid,
        'حالة توثيق إيجار': EJ[b.ejar_status] || '—', 'رقم عقد إيجار': b.ejar_contract_number || '—'
      }
    })
}

export async function fetchTenantsRows(supabase, cid) {
  const { data } = await supabase.from('customers')
    .select('full_name, id_type, id_number, phone, loyalty_points, is_vip, bookings(total_amount, payments(amount))')
    .eq('company_id', cid).order('full_name')
  return (data || []).map(c => {
    const total = (c.bookings || []).reduce((s, b) => s + Number(b.total_amount), 0)
    const paid = (c.bookings || []).reduce((s, b) => s + (b.payments || []).reduce((x, p) => x + Number(p.amount), 0), 0)
    return {
      'الاسم': c.full_name, 'نوع الإثبات': { national_id: 'هوية', iqama: 'إقامة', passport: 'جواز' }[c.id_type],
      'رقم الإثبات': c.id_number, 'الجوال': c.phone,
      'عدد الإقامات': (c.bookings || []).length, 'إجمالي التعاقدات': total,
      'إجمالي المدفوع': paid, 'نقاط الولاء': c.loyalty_points, 'VIP': c.is_vip ? 'نعم' : 'لا'
    }
  })
}

export async function fetchExpensesRows(supabase, cid, { from, to } = {}) {
  let q = supabase.from('expenses')
    .select('expense_date, category, amount, description, units(unit_number)')
    .eq('company_id', cid).order('expense_date')
  if (from) q = q.gte('expense_date', from)
  if (to) q = q.lte('expense_date', to)
  const { data } = await q
  return (data || []).map(e => ({
    'التاريخ': e.expense_date, 'الوحدة': e.units?.unit_number || 'عام',
    'النوع': EC[e.category], 'الوصف': e.description || '—', 'المبلغ': Number(e.amount)
  }))
}

// صفوف طلبات الصيانة والخدمات
export async function fetchMaintenanceRows(supabase, cid, { from, to, unit } = {}) {
  let q = supabase.from('maintenance_requests')
    .select('opened_at, closed_at, request_type, description, status, cost, units(unit_number)')
    .eq('company_id', cid).order('opened_at', { ascending: false })
  if (from) q = q.gte('opened_at', from)
  if (to)   q = q.lte('opened_at', to + 'T23:59:59')
  const { data } = await q
  const RT = { cleaning: 'تنظيف', ac: 'تكييف', plumbing: 'سباكة', electrical: 'كهرباء', furniture: 'أثاث', other: 'أخرى' }
  const ST = { open: 'مفتوح', in_progress: 'قيد التنفيذ', done: 'منجز', cancelled: 'ملغي' }
  return (data || [])
    .filter(r => !unit || r.units?.unit_number === unit)
    .map(r => ({
      'تاريخ الفتح': r.opened_at?.slice(0, 10),
      'تاريخ الإغلاق': r.closed_at?.slice(0, 10) || '—',
      'الوحدة': r.units?.unit_number || 'عام',
      'النوع': RT[r.request_type] || r.request_type || '—',
      'الوصف': r.description || '—',
      'الحالة': ST[r.status] || r.status || '—',
      'التكلفة': Number(r.cost || 0)
    }))
}

// الملف الشامل: كل الحسابات بعدة أوراق + ورقة ملخص
export async function exportFullAccounts(supabase, cid, companyName = 'المازن') {
  const [pays, books, tenants, exps] = await Promise.all([
    fetchPaymentsRows(supabase, cid), fetchBookingsRows(supabase, cid),
    fetchTenantsRows(supabase, cid), fetchExpensesRows(supabase, cid)
  ])
  const rev = pays.reduce((s, r) => s + r['المبلغ'], 0)
  const exp = exps.reduce((s, r) => s + r['المبلغ'], 0)
  const summary = [
    { 'البند': 'إجمالي الإيرادات (كل الدفعات)', 'القيمة': rev },
    { 'البند': 'إجمالي المصروفات', 'القيمة': exp },
    { 'البند': 'صافي الربح', 'القيمة': rev - exp },
    { 'البند': 'عدد الحجوزات', 'القيمة': books.length },
    { 'البند': 'عدد المستأجرين', 'القيمة': tenants.length },
    { 'البند': 'إجمالي العربون المحصل', 'القيمة': books.reduce((s, b) => s + b['العربون'], 0) },
    { 'البند': 'إجمالي التأمين المحصل', 'القيمة': books.reduce((s, b) => s + b['التأمين'], 0) },
    { 'البند': 'إجمالي المتبقي غير المحصل', 'القيمة': books.reduce((s, b) => s + b['المتبقي'], 0) },
  ]
  downloadWorkbook(`حسابات-${companyName}-${new Date().toISOString().slice(0, 10)}.xlsx`, [
    { name: 'الملخص', rows: summary, numeric: ['القيمة'] },
    { name: 'الدفعات', rows: pays, numeric: ['المبلغ'] },
    { name: 'الحجوزات', rows: books, numeric: ['الإجمالي', 'الخصم', 'العربون', 'التأمين', 'المدفوع', 'المتبقي'] },
    { name: 'المستأجرون', rows: tenants, numeric: ['عدد الإقامات', 'إجمالي التعاقدات', 'إجمالي المدفوع', 'نقاط الولاء'] },
    { name: 'المصروفات', rows: exps, numeric: ['المبلغ'] },
  ])
  return { rev, exp, count: pays.length }
}
