import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isEntryBalanced,
  entryTotals,
  invalidLines,
  findUnbalancedEntries,
  findUnpostedPayments,
  summarizeIntegrity,
  validateCoreQuery,
} from '../accountingIntegrity'

// عزل الاختبار عن أي اتصال حقيقي بقاعدة البيانات
vi.mock('../supabase', () => ({
  supabase: new Proxy({}, {
    get() { throw new Error('يجب ألا يستخدم محرك المزامنة العميل العام — مرّر العميل صراحةً') },
  }),
}))

import { syncPaymentToAccounting, syncExpenseToAccounting } from '../accountingSync'

/** عميل Supabase وهمي يسجّل كل ما يُدرج، ويحاكي سلاسل الاستعلام */
function makeFakeClient() {
  const inserted = {}
  function builder(table) {
    let filters = {}
    let didInsert = false
    const b = {
      select: () => b,
      order: () => b,
      in: () => b,
      eq: (col, val) => { filters[col] = val; return b },
      insert: (rows) => {
        didInsert = true
        inserted[table] = (inserted[table] || []).concat(Array.isArray(rows) ? rows : [rows])
        return b
      },
      maybeSingle: async () => {
        if (didInsert) return { data: { id: `${table}-new` }, error: null }
        if (table === 'chart_of_accounts') return { data: { id: `acc-${filters.code}` }, error: null }
        return { data: null, error: null }
      },
      then: (resolve) => resolve({ data: null, error: null }),
    }
    return b
  }
  return {
    inserted,
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    rpc: async () => ({ data: null, error: null }),
    from: (table) => builder(table),
  }
}

describe('توازن القيود المحاسبية', () => {
  it('يعتبر القيد المزدوج المتساوي متوازناً', () => {
    expect(isEntryBalanced([{ debit: 500 }, { credit: 500 }])).toBe(true)
    expect(entryTotals([{ debit: 500 }, { credit: 500 }])).toEqual({ debit: 500, credit: 500 })
  })

  it('يرفض القيد غير المتوازن أو ذا الطرف الواحد', () => {
    expect(isEntryBalanced([{ debit: 500 }, { credit: 400 }])).toBe(false)
    expect(isEntryBalanced([{ debit: 500 }])).toBe(false)
    expect(isEntryBalanced([])).toBe(false)
  })

  it('يتسامح مع فروق التقريب ضمن هللة واحدة', () => {
    expect(isEntryBalanced([{ debit: 333.34 }, { credit: 333.33 }])).toBe(true)
    expect(isEntryBalanced([{ debit: 333.5 }, { credit: 333.33 }])).toBe(false)
  })

  it('يرصد الأسطر المخالفة (مدين ودائن معاً أو صفر أو سالب)', () => {
    const bad = invalidLines([
      { debit: 100, credit: 0 },
      { debit: 50, credit: 50 },
      { debit: 0, credit: 0 },
      { debit: -10, credit: 0 },
    ])
    expect(bad).toHaveLength(3)
  })

  it('يعدّد القيود غير المتوازنة مع مقدار الفرق', () => {
    const res = findUnbalancedEntries([
      { id: 'a', entry_number: 'JV-1', lines: [{ debit: 100 }, { credit: 100 }] },
      { id: 'b', entry_number: 'JV-2', lines: [{ debit: 100 }, { credit: 90 }] },
    ])
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ entry_number: 'JV-2', difference: 10 })
  })
})

describe('الدفعات غير المرحّلة إلى دفتر اليومية', () => {
  const entries = [{ source_id: 'pay-1' }, { source_id: 'bk-9' }]

  it('يعتبر الدفعة مرحّلة عند وجود قيد بمعرّفها', () => {
    expect(findUnpostedPayments([{ id: 'pay-1', amount: 100 }], entries)).toHaveLength(0)
  })

  it('يعتبر الدفعة مرحّلة عند وجود قيد بمعرّف حجزها', () => {
    expect(findUnpostedPayments([{ id: 'pay-2', booking_id: 'bk-9', amount: 100 }], entries)).toHaveLength(0)
  })

  it('يرصد الدفعة التي لا يقابلها أي قيد', () => {
    const res = findUnpostedPayments([{ id: 'pay-3', booking_id: 'bk-3', amount: 250 }], entries)
    expect(res.map(p => p.id)).toEqual(['pay-3'])
  })

  it('يتجاهل الدفعات الصفرية أو السالبة', () => {
    expect(findUnpostedPayments([{ id: 'z', amount: 0 }], entries)).toHaveLength(0)
  })

  it('يبني ملخّصاً شاملاً للتكامل المحاسبي', () => {
    const s = summarizeIntegrity({
      entries: [{ id: 'e1', source_id: 'pay-1', lines: [{ debit: 100 }, { credit: 100 }] }],
      payments: [{ id: 'pay-1', amount: 100 }, { id: 'pay-x', amount: 50 }],
    })
    expect(s.ok).toBe(false)
    expect(s.unbalanced).toBe(0)
    expect(s.unposted).toBe(1)
  })
})

describe('صحة الاستعلامات الأساسية', () => {
  it('يقبل استعلاماً مقيّداً بالشركة ويحوي الأعمدة المطلوبة', () => {
    const res = validateCoreQuery(
      { table: 'units', columns: 'id,unit_number,status,company_id', filters: ['company_id', 'is_active'] },
      ['id', 'unit_number', 'status'],
    )
    expect(res.ok).toBe(true)
  })

  it('يرفض استعلاماً غير مقيّد بشركة المستخدم (خطر تسريب بيانات)', () => {
    const res = validateCoreQuery({ table: 'bookings', columns: '*', filters: ['status'] }, [])
    expect(res.ok).toBe(false)
    expect(res.problems.join(' ')).toContain('company_id')
  })

  it('يرفض استعلاماً ينقصه عمود تعتمد عليه الواجهة', () => {
    const res = validateCoreQuery(
      { table: 'bookings', columns: 'id,unit_id', filters: ['company_id'] },
      ['id', 'unit_id', 'check_in_date'],
    )
    expect(res.ok).toBe(false)
    expect(res.problems.join(' ')).toContain('check_in_date')
  })
})

describe('اختبار تكامل: محرك المزامنة المحاسبية يولّد قيوداً متوازنة', () => {
  let client
  beforeEach(() => { client = makeFakeClient() })

  it('دفعة نقدية: مدين الصندوق 1101 / دائن إيراد الإيجار 4100 — متوازن', async () => {
    await syncPaymentToAccounting(client, {
      companyId: 'co-1', paymentId: 'pay-1', amount: 1500, method: 'cash', paymentType: 'rent',
    })
    const lines = client.inserted['journal_entry_lines']
    expect(lines).toHaveLength(2)
    expect(isEntryBalanced(lines)).toBe(true)
    expect(invalidLines(lines)).toHaveLength(0)
    expect(lines.find(l => l.debit > 0).account_id).toBe('acc-1101')
    expect(lines.find(l => l.credit > 0).account_id).toBe('acc-4100')
  })

  it('دفعة بنكية: مدين البنك 1102 بدل الصندوق', async () => {
    await syncPaymentToAccounting(client, {
      companyId: 'co-1', paymentId: 'pay-2', amount: 800, method: 'bank_transfer', paymentType: 'rent',
    })
    const lines = client.inserted['journal_entry_lines']
    expect(lines.find(l => l.debit > 0).account_id).toBe('acc-1102')
    expect(isEntryBalanced(lines)).toBe(true)
  })

  it('دفعة تأمين: دائن التزام التأمينات 2120 لا الإيراد', async () => {
    await syncPaymentToAccounting(client, {
      companyId: 'co-1', paymentId: 'pay-3', amount: 1000, method: 'cash', paymentType: 'insurance',
    })
    const lines = client.inserted['journal_entry_lines']
    expect(lines.find(l => l.credit > 0).account_id).toBe('acc-2120')
    expect(isEntryBalanced(lines)).toBe(true)
  })

  it('كل دفعة مرحّلة تُنشئ قيداً مرتبطاً بمصدرها فلا تظهر كدفعة غير مرحّلة', async () => {
    await syncPaymentToAccounting(client, {
      companyId: 'co-1', paymentId: 'pay-7', amount: 300, method: 'cash', paymentType: 'rent',
    })
    const entry = client.inserted['journal_entries'][0]
    expect(entry.source_type).toBe('payment')
    expect(entry.source_id).toBe('pay-7')
    expect(findUnpostedPayments([{ id: 'pay-7', amount: 300 }], client.inserted['journal_entries'])).toHaveLength(0)
  })

  it('مصروف صيانة: مدين 5110 / دائن الصندوق — متوازن', async () => {
    await syncExpenseToAccounting(client, {
      companyId: 'co-1', expenseId: 'exp-1', amount: 450, category: 'maintenance', paymentMethod: 'cash',
    })
    const lines = client.inserted['journal_entry_lines']
    expect(isEntryBalanced(lines)).toBe(true)
    expect(lines.find(l => l.debit > 0).account_id).toBe('acc-5110')
    expect(lines.find(l => l.credit > 0).account_id).toBe('acc-1101')
    expect(client.inserted['audit_logs']?.[0]).toMatchObject({ company_id: 'co-1', user_id: 'user-1' })
  })

  it('لا يُنشئ أي قيد لمبلغ صفري أو سالب', async () => {
    await syncPaymentToAccounting(client, { companyId: 'co-1', amount: 0 })
    await syncPaymentToAccounting(client, { companyId: 'co-1', amount: -50 })
    expect(client.inserted['journal_entry_lines']).toBeUndefined()
  })
})