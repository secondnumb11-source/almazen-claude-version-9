import { describe, it, expect } from 'vitest'
import {
  normalize, similarity, parseNumber, parsePhone, parseDate, parseBool,
  coerceEnum, autoMapColumns, classifySheet, transformRow, dedupe,
  detectVendor, buildReport, TARGETS,
} from './importEngine.js'

describe('تطبيع وتحويل القيم', () => {
  it('يحوّل الأرقام العربية ويوحّد الهمزات', () => {
    expect(normalize('٠٥٥١٢٣٤٥٦٧')).toBe('0551234567')
    expect(normalize('الإسم  الكامل')).toBe(normalize('الاسم الكامل'))
    expect(normalize('أحمد')).toBe(normalize('احمد'))
  })

  it('يقرأ الأرقام مع الفواصل والعملات', () => {
    expect(parseNumber('1,250.50')).toBe(1250.5)
    expect(parseNumber('٣٥٠٠ ريال')).toBe(3500)
    expect(parseNumber('SAR 2,000')).toBe(2000)
    expect(parseNumber('غير رقم')).toBeNull()
  })

  it('يوحّد صيغ الجوال السعودي', () => {
    expect(parsePhone('+966551234567')).toBe('0551234567')
    expect(parsePhone('966 55 123 4567')).toBe('0551234567')
    expect(parsePhone('٠٥٥١٢٣٤٥٦٧')).toBe('0551234567')
    expect(parsePhone('551234567')).toBe('0551234567')
  })

  it('يفهم التواريخ بصيغ متعددة وتواريخ Excel الرقمية', () => {
    expect(parseDate('2024-03-05')).toBe('2024-03-05')
    expect(parseDate('05/03/2024')).toBe('2024-03-05')
    expect(parseDate('25/12/2023')).toBe('2023-12-25')
    expect(parseDate(45000)).toBe('2023-03-15')
    expect(parseDate('كلام')).toBeNull()
  })

  it('يفهم القيم المنطقية بالعربية', () => {
    expect(parseBool('نعم')).toBe(true)
    expect(parseBool('مفروشة')).toBe(true)
    expect(parseBool('لا')).toBe(false)
  })
})

describe('القيم المعدودة (enums)', () => {
  it('يطابق التصنيفات العربية والإنجليزية', () => {
    expect(coerceEnum('شقة', 'unit_category').value).toBe('apartment')
    expect(coerceEnum('Chalet', 'unit_category').value).toBe('chalet')
    expect(coerceEnum('مشغول', 'unit_status').value).toBe('occupied')
    expect(coerceEnum('إيرادات', 'account_type').value).toBe('revenue')
    expect(coerceEnum('كهرباء', 'expense_category').value).toBe('electricity')
    expect(coerceEnum('محاسب', 'user_role').value).toBe('accountant')
  })
  it('يرجع الافتراضي عند قيمة غير معروفة', () => {
    const r = coerceEnum('xyz???', 'account_type')
    expect(r.value).toBe('expense')
    expect(r.usedDefault).toBe(true)
  })
})

describe('المطابقة الذكية للأعمدة', () => {
  it('يربط أعمدة عربية بحقول العملاء', () => {
    const headers = ['اسم العميل', 'رقم الهوية', 'رقم الجوال', 'البريد الإلكتروني']
    const rows = [{ 'اسم العميل': 'أحمد علي', 'رقم الهوية': '1012345678', 'رقم الجوال': '0551234567', 'البريد الإلكتروني': 'a@b.com' }]
    const { mapping } = autoMapColumns(headers, 'customers', rows)
    expect(mapping.full_name).toBe('اسم العميل')
    expect(mapping.id_number).toBe('رقم الهوية')
    expect(mapping.phone).toBe('رقم الجوال')
    expect(mapping.email).toBe('البريد الإلكتروني')
  })

  it('يربط أعمدة إنجليزية بحقول الوحدات', () => {
    const headers = ['Unit No', 'Type', 'Status', 'Monthly Rent', 'Bedrooms']
    const { mapping } = autoMapColumns(headers, 'units', [])
    expect(mapping.unit_number).toBe('Unit No')
    expect(mapping.category).toBe('Type')
    expect(mapping.status).toBe('Status')
    expect(mapping.monthly_price).toBe('Monthly Rent')
    expect(mapping.bedrooms).toBe('Bedrooms')
  })

  it('لا يستخدم نفس العمود لحقلين', () => {
    const headers = ['الاسم', 'الجوال', 'رقم الهوية']
    const { mapping } = autoMapColumns(headers, 'customers', [])
    const cols = Object.values(mapping)
    expect(new Set(cols).size).toBe(cols.length)
  })
})

describe('التصنيف التلقائي للأوراق', () => {
  it('يصنّف ورقة عملاء', () => {
    const headers = ['الاسم الكامل', 'رقم الهوية', 'الجوال']
    expect(classifySheet(headers, []).best.target).toBe('customers')
  })
  it('يصنّف ورقة شجرة حسابات', () => {
    const headers = ['كود الحساب', 'اسم الحساب', 'نوع الحساب', 'الرصيد الافتتاحي']
    expect(classifySheet(headers, []).best.target).toBe('chart_of_accounts')
  })
  it('يصنّف ورقة وحدات', () => {
    const headers = ['رقم الوحدة', 'نوع الوحدة', 'الإيجار الشهري', 'الدور']
    expect(classifySheet(headers, []).best.target).toBe('units')
  })
})

describe('كشف نظام المصدر', () => {
  it('يتعرف على تصدير Booking.com', () => {
    const v = detectVendor(['Booker name', 'Check-in', 'Check-out', 'Room nights'])
    expect(v?.id).toBe('booking')
  })
  it('يتعرف على تصدير قيود', () => {
    const v = detectVendor(['رقم الحساب', 'اسم الحساب', 'نوع الحساب'])
    expect(v?.id).toBe('qoyod')
  })
})

describe('تحويل الصفوف والتحقق', () => {
  const mapping = { full_name: 'الاسم', id_number: 'الهوية', phone: 'الجوال' }

  it('ينتج سجل عميل صالح ويستنتج نوع الهوية', () => {
    const r = transformRow({ 'الاسم': ' أحمد  علي ', 'الهوية': '1012345678', 'الجوال': '+966551234567' }, 'customers', mapping)
    expect(r.ok).toBe(true)
    expect(r.data.full_name).toBe('أحمد علي')
    expect(r.data.phone).toBe('0551234567')
    expect(r.data.id_type).toBe('national_id')
  })

  it('يستنتج الإقامة من رقم يبدأ بـ 2', () => {
    const r = transformRow({ 'الاسم': 'محمد', 'الهوية': '2012345678', 'الجوال': '0551234567' }, 'customers', mapping)
    expect(r.data.id_type).toBe('iqama')
  })

  it('يرصد الحقول الإلزامية المفقودة مع اقتراح حل', () => {
    const r = transformRow({ 'الاسم': '', 'الهوية': '1012345678', 'الجوال': '0551234567' }, 'customers', mapping)
    expect(r.ok).toBe(false)
    expect(r.errors[0].code).toBe('REQUIRED_MISSING')
    expect(r.errors[0].suggestion).toBeTruthy()
  })

  it('يرصد الجوال غير الصالح', () => {
    const r = transformRow({ 'الاسم': 'خالد', 'الهوية': '1012345678', 'الجوال': 'لا يوجد' }, 'customers', mapping)
    expect(r.ok).toBe(false)
    expect(r.errors.some(e => e.code === 'BAD_PHONE')).toBe(true)
  })

  it('يحوّل بيانات الوحدة ويحوّل التصنيف والحالة', () => {
    const r = transformRow(
      { 'الوحدة': 'A-101', 'النوع': 'شاليه', 'الحالة': 'مؤجرة', 'الشهري': '3,500 ريال', 'مفروشة': 'نعم', 'العمارة': 'برج المازن' },
      'units',
      { unit_number: 'الوحدة', category: 'النوع', status: 'الحالة', monthly_price: 'الشهري', is_furnished: 'مفروشة', property_name: 'العمارة' },
    )
    expect(r.ok).toBe(true)
    expect(r.data.category).toBe('chalet')
    expect(r.data.status).toBe('occupied')
    expect(r.data.monthly_price).toBe(3500)
    expect(r.data.is_furnished).toBe(true)
    expect(r.lookups.property_name).toBe('برج المازن')
    expect(r.data.property_name).toBeUndefined()
  })

  it('يعطي المصروف تاريخ اليوم عند غيابه', () => {
    const r = transformRow({ 'المبلغ': '500', 'البند': 'كهرباء' }, 'expenses', { amount: 'المبلغ', category: 'البند' })
    expect(r.data.category).toBe('electricity')
    expect(r.data.expense_date).toBe(new Date().toISOString().slice(0, 10))
  })

  it('يضبط نوع العميل إلى شركة عند وجود اسم شركة', () => {
    const r = transformRow(
      { 'الاسم': 'مؤسسة النور', 'الهوية': '1012345678', 'الجوال': '0551234567', 'الشركة': 'مؤسسة النور' },
      'customers', { ...mapping, company_name: 'الشركة' },
    )
    expect(r.data.customer_type).toBe('company')
  })
})

describe('كشف التكرار', () => {
  it('يفصل المكرر داخل الملف وداخل قاعدة البيانات', () => {
    const recs = [
      { data: { id_number: '1012345678' } },
      { data: { id_number: '1012345678' } },
      { data: { id_number: '2012345678' } },
    ]
    const res = dedupe(recs, 'customers', ['2012345678'])
    expect(res.unique.length).toBe(1)
    expect(res.duplicatesInFile.length).toBe(1)
    expect(res.duplicatesInDb.length).toBe(1)
  })
})

describe('تقرير الاستيراد', () => {
  it('يجمّع الأسباب ويحسب نسبة النجاح', () => {
    const rep = buildReport({
      targetKey: 'customers',
      rowsTotal: 10,
      inserted: 7, updated: 1, skipped: 1,
      results: [{ warnings: [{ message: 'تنبيه' }], fixes: [{ message: 'إصلاح' }] }],
      failedRows: [{ errors: [{ code: 'BAD_PHONE', message: 'جوال غير صالح' }] }],
      startedAt: '2024-01-01T00:00:00Z', endedAt: '2024-01-01T00:00:05Z',
    })
    expect(rep.successRate).toBe(80)
    expect(rep.failed).toBe(1)
    expect(rep.reasons[0].count).toBe(1)
    expect(rep.table).toBe('customers')
    expect(rep.durationMs).toBe(5000)
  })
})

describe('سلامة تعريف الأقسام', () => {
  it('كل قسم له جدول وحقل إلزامي واحد على الأقل', () => {
    for (const [key, t] of Object.entries(TARGETS)) {
      expect(t.table, key).toBeTruthy()
      const req = Object.values(t.fields).filter(f => f.required)
      expect(req.length, key).toBeGreaterThan(0)
    }
  })
})
