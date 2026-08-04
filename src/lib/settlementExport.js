/*
  تصدير تقرير تصفية حساب الوحدة (PDF / Excel)
  كل بند مرتبط برقم القيد المحاسبي ورمز الحساب في شجرة الحسابات.
*/
import { downloadPDF } from './pdf'
import { downloadWorkbook } from './excel'
import { SAR } from './helpers'
import { totalDebit, totalCredit } from './settlementLedger'

const n2 = (v) => Math.round((Number(v) || 0) * 100) / 100

export function buildSettlementReport({
  unit, booking, calc, expectedLines = [], postedLines = [],
  reconciliation, entryNumber = '', tenantName = '', companyName = 'المازن',
  outDate = '', payMethod = 'cash',
}) {
  const unitLabel = unit?.unit_number || unit?.name || '—'

  const summaryRows = [
    { 'البند': 'عدد أيام السكن', 'المبلغ (ر.س)': n2(calc.daysCount), 'رقم القيد': entryNumber || '—', 'رمز الحساب': '—' },
    { 'البند': 'قيمة الإيجار المحتسبة', 'المبلغ (ر.س)': n2(calc.calculatedRent), 'رقم القيد': entryNumber || '—', 'رمز الحساب': '4100' },
    { 'البند': 'إجمالي الخصومات', 'المبلغ (ر.س)': -n2(calc.totalDiscounts), 'رقم القيد': entryNumber || '—', 'رمز الحساب': '4100' },
    { 'البند': 'خدمات إضافية', 'المبلغ (ر.س)': n2(calc.totalExtraFees), 'رقم القيد': entryNumber || '—', 'رمز الحساب': '4300' },
    { 'البند': 'غرامات تأخير', 'المبلغ (ر.س)': n2(calc.totalLatePenalty), 'رقم القيد': entryNumber || '—', 'رمز الحساب': '4200' },
    { 'البند': 'التأمين المستلم', 'المبلغ (ر.س)': n2(calc.initialInsurance), 'رقم القيد': entryNumber || '—', 'رمز الحساب': '2120' },
    { 'البند': 'التأمين المستقطع (تلفيات)', 'المبلغ (ر.س)': n2(calc.retainedInsurance), 'رقم القيد': entryNumber || '—', 'رمز الحساب': '4200' },
    { 'البند': 'التأمين المسترد للعميل', 'المبلغ (ر.س)': n2(calc.refundedInsurance), 'رقم القيد': entryNumber || '—', 'رمز الحساب': '2120' },
    { 'البند': 'ضريبة القيمة المضافة', 'المبلغ (ر.س)': n2(calc.vatAmount), 'رقم القيد': entryNumber || '—', 'رمز الحساب': '2300' },
    { 'البند': 'إجمالي فاتورة المستأجر', 'المبلغ (ر.س)': n2(calc.finalTenantBill), 'رقم القيد': entryNumber || '—', 'رمز الحساب': '—' },
    { 'البند': 'المسدد سابقاً', 'المبلغ (ر.س)': n2(calc.paidSoFar), 'رقم القيد': '—', 'رمز الحساب': '1110/1120' },
    { 'البند': calc.netDue >= 0 ? 'المديونية المستحقة على المستأجر' : 'الرصيد المسترد للمستأجر', 'المبلغ (ر.س)': n2(Math.abs(calc.netDue)), 'رقم القيد': entryNumber || '—', 'رمز الحساب': payMethod === 'cash' ? '1101' : '1102' },
  ]

  const mapLines = (lines) => lines.map((l, i) => ({
    'م': i + 1,
    'رقم القيد': l.entryNumber || entryNumber || '—',
    'رمز الحساب': l.code,
    'اسم الحساب': l.accountName || '',
    'مدين': n2(l.debit),
    'دائن': n2(l.credit),
    'البيان': l.description || '',
  }))

  const recRows = (reconciliation?.rows || []).map(r => ({
    'رمز الحساب': r.code,
    'اسم الحساب': r.accountName,
    'مدين متوقع': r.expectedDebit,
    'مدين مُرحَّل': r.postedDebit,
    'دائن متوقع': r.expectedCredit,
    'دائن مُرحَّل': r.postedCredit,
    'الفرق': n2(r.debitDiff - r.creditDiff),
    'الحالة': r.matched ? 'مطابق' : 'يوجد فرق',
  }))

  return {
    unitLabel,
    title: `تقرير تصفية حساب الوحدة ${unitLabel}`,
    subtitle: `المستأجر: ${tenantName || '—'} · تاريخ الخروج: ${outDate || '—'} · رقم القيد: ${entryNumber || 'لم يُرحَّل بعد'}`,
    companyName,
    sheets: [
      { name: 'ملخص التصفية', rows: summaryRows, numeric: ['المبلغ (ر.س)'] },
      { name: 'القيد المتوقع', rows: mapLines(expectedLines), numeric: ['مدين', 'دائن'] },
      { name: 'القيد المُرحَّل', rows: mapLines(postedLines), numeric: ['مدين', 'دائن'] },
      { name: 'لوحة المطابقة', rows: recRows, numeric: ['مدين متوقع', 'مدين مُرحَّل', 'دائن متوقع', 'دائن مُرحَّل', 'الفرق'] },
    ],
    summaryCards: [
      { label: 'إجمالي الفاتورة', value: SAR(calc.finalTenantBill) },
      { label: calc.netDue >= 0 ? 'المديونية المستحقة' : 'المسترد للعميل', value: SAR(Math.abs(calc.netDue)), color: calc.netDue >= 0 ? '#B91C1C' : '#15803D' },
      { label: 'التأمين المسترد', value: SAR(calc.refundedInsurance) },
      { label: 'ضريبة القيمة المضافة', value: SAR(calc.vatAmount) },
      { label: 'توازن القيد المُرحَّل', value: `مدين ${n2(totalDebit(postedLines))} / دائن ${n2(totalCredit(postedLines))}` },
    ],
    filters: {
      'الوحدة': unitLabel,
      'المستأجر': tenantName || '—',
      'رقم الحجز': booking?.id ? String(booking.id).slice(0, 8) : '—',
      'رقم القيد': entryNumber || 'غير مُرحَّل',
    },
  }
}

export function exportSettlementPdf(args) {
  const rep = buildSettlementReport(args)
  downloadPDF({
    title: rep.title,
    subtitle: rep.subtitle,
    company: rep.companyName,
    filters: rep.filters,
    sheets: rep.sheets,
    summaryCards: rep.summaryCards,
  })
}

export function exportSettlementExcel(args) {
  const rep = buildSettlementReport(args)
  downloadWorkbook(`تصفية-الوحدة-${rep.unitLabel}-${new Date().toISOString().slice(0, 10)}.xlsx`, rep.sheets)
}
