/*
  اختبارات آلية لحالات التصفية الحرجة — تضمن توازن القيود دائماً.
  تشغيل: bunx vitest run
*/
import { describe, it, expect } from 'vitest'
import {
  computeSettlement, buildSettlementLines, reconcileSettlement,
  totalDebit, totalCredit, isBalanced, VAT_RATE, summarizePayments,
  validateSettlementConsistency,
} from '../settlementLedger'

const linesFor = (input, over = {}) => {
  const c = computeSettlement(input)
  return {
    c,
    lines: buildSettlementLines({
      netDue: c.netDue,
      method: input.method || 'cash',
      extraFees: c.totalExtraFees,
      latePenalty: c.totalLatePenalty,
      retainedInsurance: c.retainedInsurance,
      refundedInsurance: c.refundedInsurance,
      initialInsurance: c.initialInsurance,
      vatAmount: c.settlementVat,
      customerName: 'اختبار',
      ...over,
    }),
  }
}

/*
  التوازن وحده لا يثبت صحة القيد. سطرا إرجاع التأمين كانا يقعان على حساب
  التأمين 2120 نفسه (مدين ودائن)، فيلغي أحدهما الآخر: الالتزام لا يُقفل والمبلغ
  لا يخرج من الصندوق — والقيد يبقى متوازناً تماماً. اجتاز ذلك كل اختبارات
  isBalanced لأنها لم تفحص الحسابات المستهدفة قط. هذه المجموعة تفحصها.
*/
describe('محرك التصفية — صحة الحسابات المستهدفة لا التوازن فقط', () => {
  const sumFor = (lines, code, side) =>
    Math.round(lines.filter(l => l.code === code)
      .reduce((s, l) => s + (Number(l[side]) || 0), 0) * 100) / 100

  it('إرجاع التأمين يخرج من النقدية ويقفل الالتزام — لا يُقيَّد على 2120 طرفين', () => {
    const { c, lines } = linesFor({ daysCount: 0, dailyRate: 250, initialInsurance: 800, paidSoFar: 0 })
    expect(c.refundedInsurance).toBe(800)

    // الالتزام يُقفل بالمدين فقط، بلا دائن يلغيه
    expect(sumFor(lines, '2120', 'debit')).toBe(800)
    expect(sumFor(lines, '2120', 'credit')).toBe(0)

    // والمقابل خروج نقدي حقيقي
    const refund = lines.find(l => l.tag === 'insurance_refund')
    expect(refund.code).toBe('1101')
    expect(refund.credit).toBe(800)

    expect(isBalanced(lines)).toBe(true)
  })

  it('التحويل البنكي يوجّه إرجاع التأمين إلى حساب البنك 1102', () => {
    const { lines } = linesFor(
      { daysCount: 0, dailyRate: 250, initialInsurance: 600, paidSoFar: 0, method: 'bank_transfer' },
    )
    const refund = lines.find(l => l.tag === 'insurance_refund')
    expect(refund.code).toBe('1102')
    expect(refund.credit).toBe(600)
    expect(sumFor(lines, '2120', 'credit')).toBe(0)
    expect(isBalanced(lines)).toBe(true)
  })

  it('الاستقطاع الجزئي: المستقطع إيراد تعويض والباقي خروج نقدي', () => {
    const { c, lines } = linesFor({
      daysCount: 0, dailyRate: 0, initialInsurance: 1000,
      insuranceAction: 'deduct_part', deductedInsurance: 400, paidSoFar: 0,
    })
    expect(c.retainedInsurance).toBe(400)
    expect(c.refundedInsurance).toBe(600)

    expect(sumFor(lines, '2120', 'debit')).toBe(1000)   // الالتزام يُقفل بالكامل
    expect(sumFor(lines, '2120', 'credit')).toBe(0)
    expect(sumFor(lines, '4200', 'credit')).toBe(400)   // المستقطع إيراد تعويض
    expect(sumFor(lines, '1101', 'credit')).toBe(600)   // الباقي يخرج نقداً
    expect(isBalanced(lines)).toBe(true)
  })

  it('الاحتفاظ بكامل التأمين للأضرار: لا خروج نقدي إطلاقاً', () => {
    const { c, lines } = linesFor({
      daysCount: 0, dailyRate: 0, initialInsurance: 900,
      insuranceAction: 'keep_damages', paidSoFar: 0,
    })
    expect(c.retainedInsurance).toBe(900)
    expect(c.refundedInsurance).toBe(0)
    expect(lines.some(l => l.tag === 'insurance_refund')).toBe(false)
    expect(sumFor(lines, '2120', 'debit')).toBe(900)
    expect(sumFor(lines, '4200', 'credit')).toBe(900)
    expect(isBalanced(lines)).toBe(true)
  })

  it('كل سطر يستهدف رمزاً موجوداً في شجرة الحسابات المعتمدة', () => {
    const known = new Set(['1101', '1102', '2120', '2300', '4100', '4200', '4300'])
    const { lines } = linesFor({
      daysCount: 7, dailyRate: 350, initialInsurance: 1000,
      insuranceAction: 'deduct_part', deductedInsurance: 250,
      extraFees: 150, latePenalty: 100, paidSoFar: 500,
    })
    expect(lines.length).toBeGreaterThan(0)
    lines.forEach(l => expect(known.has(l.code)).toBe(true))
    expect(isBalanced(lines)).toBe(true)
  })
})

describe('محرك التصفية — التوازن المحاسبي', () => {
  it('فحص الاتساق يقبل الإجمالي الصحيح ويرفض أي تلاعب في الإجمالي', () => {
    const { c, lines } = linesFor({ daysCount: 4, dailyRate: 300, extraFees: 50, latePenalty: 25, paidSoFar: 400 })
    expect(validateSettlementConsistency(c, lines).ok).toBe(true)
    expect(validateSettlementConsistency({ ...c, finalTenantBill: c.finalTenantBill + 10 }, lines).ok).toBe(false)
  })
  it('تصفية كاملة عادية: القيد متوازن', () => {
    const { c, lines } = linesFor({ daysCount: 10, dailyRate: 300, initialInsurance: 1000, paidSoFar: 1000 })
    expect(c.calculatedRent).toBe(3000)
    expect(c.netDue).toBe(2000)
    expect(isBalanced(lines)).toBe(true)
  })

  it('تصفية جزئية (المستأجر دفع أكثر من المستحق) تُنتج رصيداً مسترداً وقيداً متوازناً', () => {
    const { c, lines } = linesFor({ daysCount: 5, dailyRate: 200, paidSoFar: 1500, initialInsurance: 500 })
    expect(c.netDue).toBeLessThan(0)
    expect(isBalanced(lines)).toBe(true)
    expect(lines.some(l => l.tag === 'cash_out')).toBe(true)
  })

  it('إلغاء حجز (صفر أيام) مع إرجاع التأمين بالكامل يبقى متوازناً', () => {
    const { c, lines } = linesFor({ daysCount: 0, dailyRate: 250, initialInsurance: 800, paidSoFar: 0 })
    expect(c.finalTenantBill).toBe(0)
    expect(c.refundedInsurance).toBe(800)
    expect(isBalanced(lines)).toBe(true)
    expect(totalDebit(lines)).toBe(totalCredit(lines))
  })

  it('تعدد الدفعات: نفس النتيجة سواء دُفعت دفعة واحدة أو عدة دفعات', () => {
    const single = computeSettlement({ daysCount: 8, dailyRate: 400, paidSoFar: 2600, initialInsurance: 600 })
    const multi = computeSettlement({ daysCount: 8, dailyRate: 400, paidSoFar: 1000 + 800 + 800, initialInsurance: 600 })
    expect(multi.netDue).toBe(single.netDue)
    expect(multi.finalTenantBill).toBe(single.finalTenantBill)
  })

  it('تغيير نسبة الضريبة يغيّر التفكيك ولا يغيّر إجمالي الفاتورة', () => {
    const base = computeSettlement({ daysCount: 4, dailyRate: 500, paidSoFar: 0 })
    const zero = computeSettlement({ daysCount: 4, dailyRate: 500, paidSoFar: 0, vatRate: 0 })
    const five = computeSettlement({ daysCount: 4, dailyRate: 500, paidSoFar: 0, vatRate: 0.05 })
    expect(base.finalTenantBill).toBe(zero.finalTenantBill)
    expect(zero.vatAmount).toBe(0)
    expect(five.vatAmount).toBeLessThan(base.vatAmount)
    expect(base.subtotalBeforeVat + base.vatAmount).toBeCloseTo(base.finalTenantBill, 2)
    expect(VAT_RATE).toBe(0.15)
  })

  it('استقطاع جزء من التأمين للتلفيات يبقى متوازناً ولا يتجاوز التأمين المستلم', () => {
    const { c, lines } = linesFor({
      daysCount: 6, dailyRate: 300, initialInsurance: 1000,
      insuranceAction: 'deduct_part', deductedInsurance: 4000, paidSoFar: 1800,
    })
    expect(c.retainedInsurance).toBe(1000)
    expect(c.refundedInsurance).toBe(0)
    expect(isBalanced(lines)).toBe(true)
  })

  it('غرامة تأخير ورسوم إضافية وخصم إضافي معاً: القيد متوازن', () => {
    const { lines } = linesFor({
      daysCount: 12, dailyRate: 350, extraFees: 400, latePenalty: 250,
      extraDiscount: 300, initialInsurance: 1000, insuranceAction: 'keep_damages', paidSoFar: 2000,
    })
    expect(isBalanced(lines)).toBe(true)
  })

  it('الدفع البنكي يستخدم حساب البنك 1102 بدل الصندوق 1101', () => {
    const { lines } = linesFor({ daysCount: 3, dailyRate: 300, paidSoFar: 0, method: 'bank_transfer' }, {})
    const cashLine = lines.find(l => l.tag === 'cash_in')
    expect(cashLine.code).toBe('1102')
  })
})

describe('لوحة المطابقة', () => {
  const { lines } = linesFor({ daysCount: 10, dailyRate: 300, initialInsurance: 1000, paidSoFar: 1000 })

  it('تطابق تام عندما يُرحَّل القيد كما هو متوقع', () => {
    const rec = reconcileSettlement(lines, lines.map(l => ({ ...l })))
    expect(rec.ok).toBe(true)
    expect(rec.mismatches).toHaveLength(0)
  })

  it('يكشف الفروقات عند اختلاف مبلغ مُرحَّل', () => {
    const tampered = lines.map((l, i) => (i === 0 ? { ...l, debit: l.debit + 100 } : l))
    const rec = reconcileSettlement(lines, tampered)
    expect(rec.ok).toBe(false)
    expect(rec.mismatches.length).toBeGreaterThan(0)
  })

  it('يعتبر التصفية غير محققة إذا لم يوجد قيد مُرحَّل', () => {
    const rec = reconcileSettlement(lines, [])
    expect(rec.hasPostedEntry).toBe(false)
    expect(rec.ok).toBe(false)
  })
})

describe('لوحة المطابقة — حالات التحمّل (tolerance) وحالة الفرق صفر', () => {
  const expected = [
    { code: '1101', accountName: 'الصندوق', debit: 1000, credit: 0 },
    { code: '4100', accountName: 'إيرادات الإيجار', debit: 0, credit: 1000 },
  ]

  it('القيم متطابقة تمامًا ⇒ الفرق صفر في كل سطر والحالة مطابقة', () => {
    const rec = reconcileSettlement(expected, expected.map(l => ({ ...l })))
    expect(rec.ok).toBe(true)
    expect(rec.maxDiff).toBe(0)
    rec.rows.forEach(r => {
      expect(r.debitDiff).toBe(0)
      expect(r.creditDiff).toBe(0)
      expect(r.netDiff).toBe(0)
      expect(r.matched).toBe(true)
    })
  })

  it('فروقات كسرية دقيقة (تقريب عائم) تُعامل كصفر تام', () => {
    const posted = [
      { code: '1101', debit: 1000.0000000001, credit: 0 },
      { code: '4100', debit: 0, credit: 999.9999999999 },
    ]
    const rec = reconcileSettlement(expected, posted)
    expect(rec.maxDiff).toBe(0)
    expect(rec.mismatches).toHaveLength(0)
    expect(rec.ok).toBe(true)
  })

  it('فرق يساوي حد التحمّل بالضبط (0.01) يُعتبر مطابقاً', () => {
    const posted = [
      { code: '1101', debit: 1000.01, credit: 0 },
      { code: '4100', debit: 0, credit: 1000.01 },
    ]
    const rec = reconcileSettlement(expected, posted)
    expect(rec.rows.every(r => r.netDiff === 0.01)).toBe(true)
    expect(rec.mismatches).toHaveLength(0)
  })

  it('فرق أكبر من حد التحمّل (0.02) يُكشف كفرق حقيقي', () => {
    const posted = [
      { code: '1101', debit: 1000.02, credit: 0 },
      { code: '4100', debit: 0, credit: 1000 },
    ]
    const rec = reconcileSettlement(expected, posted)
    expect(rec.ok).toBe(false)
    expect(rec.mismatches).toHaveLength(1)
    expect(rec.mismatches[0].netDiff).toBe(0.02)
  })

  it('فرق مدين وفرق دائن متساويان لا يُلغيان بعضهما ولا يظهر "فرق صفر"', () => {
    const posted = [
      { code: '1101', debit: 1100, credit: 100 },
      { code: '4100', debit: 0, credit: 1000 },
    ]
    const rec = reconcileSettlement(expected, posted)
    expect(rec.ok).toBe(false)
    const row = rec.rows.find(r => r.code === '1101')
    expect(row.debitDiff).toBe(100)
    expect(row.creditDiff).toBe(100)
    expect(row.netDiff).toBe(100) // وليس صفراً كما كان يظهر سابقاً
    expect(rec.maxDiff).toBe(100)
  })

  it('لا يوجد تحذير فرق عندما يكون كل سطر مطابقاً (maxDiff = 0)', () => {
    const { lines } = linesFor({ daysCount: 7, dailyRate: 275.33, initialInsurance: 950, paidSoFar: 1200 })
    const rec = reconcileSettlement(lines, lines.map(l => ({ ...l })))
    expect(rec.maxDiff).toBe(0)
    expect(rec.mismatches).toHaveLength(0)
    expect(rec.ok).toBe(true)
  })
})

describe('تلخيص المدفوعات — العربون والتأمين والغرامات لا تُهمل ولا تُزدوج', () => {
  it('بلا سجل دفعات: يعتمد العربون والتأمين المسجلين في الحجز', () => {
    const s = summarizePayments({ payments: [], initialDownPayment: 500, initialInsurance: 300 })
    expect(s.paidSoFar).toBe(500)
    expect(s.insuranceReceived).toBe(300)
    expect(s.totalReceived).toBe(800)
  })

  it('دفعة تأمين مسجلة لا تُخصم من فاتورة الإيجار', () => {
    const s = summarizePayments({
      payments: [{ payment_type: 'insurance', amount: 300 }, { payment_type: 'rent', amount: 200 }],
      initialDownPayment: 0, initialInsurance: 300,
    })
    expect(s.paidSoFar).toBe(200)
    expect(s.insuranceReceived).toBe(300)
  })

  it('العربون المسجل في الحجز وفي الدفعات لا يُحتسب مرتين', () => {
    const s = summarizePayments({
      payments: [{ payment_type: 'down_payment', amount: 500 }],
      initialDownPayment: 500, initialInsurance: 0,
    })
    expect(s.paidSoFar).toBe(500)
  })

  it('المبالغ المردودة تُخصم من المدفوع', () => {
    const s = summarizePayments({
      payments: [{ payment_type: 'rent', amount: 1000 }, { payment_type: 'refund', amount: 250 }],
    })
    expect(s.paidSoFar).toBe(750)
    expect(s.refunds).toBe(250)
  })

  it('السيناريو الكامل: إيجار + غرامة + رسوم مع عربون وتأمين ⇒ مستحق صحيح وقيد متوازن', () => {
    const s = summarizePayments({
      payments: [
        { payment_type: 'down_payment', amount: 400 },
        { payment_type: 'insurance', amount: 300 },
      ],
      initialDownPayment: 400, initialInsurance: 300,
    })
    const { c, lines } = linesFor({
      daysCount: 3, dailyRate: 200, initialInsurance: s.insuranceReceived,
      extraFees: 100, latePenalty: 50, paidSoFar: s.paidSoFar,
    })
    expect(c.finalTenantBill).toBe(750)   // 600 إيجار + 100 رسوم + 50 غرامة
    expect(c.netDue).toBe(350)            // بعد خصم العربون 400
    expect(c.refundedInsurance).toBe(300)
    expect(isBalanced(lines)).toBe(true)
  })
})
