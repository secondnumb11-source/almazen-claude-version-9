/*
  محرّك تصفية الحساب المحاسبي (Settlement Ledger Engine)
  ------------------------------------------------------
  وحدة نقية (Pure) بدون أي اتصال بقاعدة البيانات، وهي المصدر الوحيد للحقيقة:
    1) تحسب أرقام التصفية (إيجار، خصومات، تأمين، ضريبة، صافي مستحق).
    2) تبني أسطر القيد المزدوج المتوقعة مرتبطة برموز شجرة الحسابات.
    3) تُقارن الأسطر المتوقعة مع القيد المُرحَّل فعلياً لكشف الفروقات.

  تُستخدم في: SettlementModal (العرض والتصدير)، accountingSync (الترحيل)،
  ولوحة المطابقة، والاختبارات الآلية — لضمان تطابق الجميع دائماً.
*/

export const VAT_RATE = 0.15

/*
  رموز الحسابات مطابقة تماماً لشجرة الحسابات المعتمدة في قاعدة البيانات
  (seed_default_chart_of_accounts) حتى تظهر الأرصدة في الشجرة والتقارير
  بدل إنشاء حسابات يتيمة مكرّرة خارج الشجرة.
*/
export const SETTLEMENT_ACCOUNTS = {
  cash: { code: '1101', name: 'الصندوق (كاش)', type: 'asset' },
  bank: { code: '1102', name: 'البنك', type: 'asset' },
  insurance: { code: '2120', name: 'تأمينات المستأجرين المستردة', type: 'liability' },
  vat: { code: '2300', name: 'ضريبة القيمة المضافة المستحقة', type: 'liability' },
  rentRevenue: { code: '4100', name: 'إيرادات الإيجار', type: 'revenue' },
  damagesRevenue: { code: '4200', name: 'إيرادات التأمين', type: 'revenue' },
  servicesRevenue: { code: '4300', name: 'إيرادات أخرى', type: 'revenue' },
}

export const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100

export const isBankMethod = (method) =>
  method === 'bank_transfer' || method === 'card' || method === 'pos'

/**
 * تلخيص كل المبالغ المستلمة من المستأجر قبل التصفية.
 *
 * مصدران للحقيقة كانا يتعارضان: حقول الحجز (عربون/تأمين) وسجل الدفعات.
 * إن لم تُسجَّل دفعات صار المدفوع صفراً رغم وجود عربون وتأمين في الحجز،
 * وإن سُجّلت دفعة تأمين حُسبت خصماً من فاتورة الإيجار فانخفض المستحق خطأً
 * (التأمين أمانة تُقفل على حدة لا سداداً للإيجار).
 *
 * لذلك: التأمين يُفصل تماماً عن سداد الإيجار، ويُؤخذ أكبر القيمتين
 * (المسجّل في الحجز أو مجموع دفعات التأمين) تفادياً للازدواج، وكذلك العربون.
 */
export function summarizePayments({
  payments = [],
  initialDownPayment = 0,
  initialInsurance = 0,
} = {}) {
  let insuranceRows = 0
  let downRows = 0
  let rentRows = 0
  let refundRows = 0

  for (const p of payments || []) {
    const amount = Number(p?.amount) || 0
    if (!amount) continue
    const type = String(p?.payment_type || 'rent')
    if (type === 'insurance') insuranceRows += amount
    else if (type === 'down_payment') downRows += amount
    else if (type === 'refund') refundRows += Math.abs(amount)
    else rentRows += amount
  }

  const insuranceReceived = r2(Math.max(insuranceRows, Number(initialInsurance) || 0))
  const downPayment = r2(Math.max(downRows, Number(initialDownPayment) || 0))
  const rentPayments = r2(rentRows)
  const refunds = r2(refundRows)
  const paidSoFar = r2(Math.max(0, downPayment + rentPayments - refunds))

  return {
    insuranceReceived,
    downPayment,
    rentPayments,
    refunds,
    paidSoFar,                                   // المُطبَّق على فاتورة الإيجار فقط
    totalReceived: r2(paidSoFar + insuranceReceived), // كل ما دخل الخزينة فعلياً
  }
}

/**
 * حساب أرقام التصفية النهائية للوحدة.
 */
export function computeSettlement({
  daysCount = 1,
  dailyRate = 0,
  initialDiscount = 0,
  extraDiscount = 0,
  extraFees = 0,
  latePenalty = 0,
  insuranceAction = 'refund_full', // refund_full | keep_damages | deduct_part
  initialInsurance = 0,
  deductedInsurance = 0,
  paidSoFar = 0,
  vatRate = VAT_RATE,
} = {}) {
  const days = Math.max(0, Number(daysCount) || 0)
  const rate = Number(dailyRate) || 0
  const ins = Number(initialInsurance) || 0

  const calculatedRent = r2(days * rate)
  const totalDiscounts = r2(Number(initialDiscount || 0) + Number(extraDiscount || 0))
  const totalExtraFees = r2(extraFees)
  const totalLatePenalty = r2(latePenalty)

  const retainedInsurance =
    insuranceAction === 'keep_damages'
      ? ins
      : insuranceAction === 'deduct_part'
        ? Math.min(ins, Math.max(0, r2(deductedInsurance)))
        : 0
  const refundedInsurance = r2(Math.max(0, ins - retainedInsurance))

  const grossRentAfterDiscount = Math.max(0, r2(calculatedRent - totalDiscounts))
  const finalTenantBill = r2(
    grossRentAfterDiscount + totalExtraFees + totalLatePenalty + retainedInsurance,
  )

  const paid = r2(paidSoFar)
  const netDue = r2(finalTenantBill - paid)

  const subtotalBeforeVat = r2(finalTenantBill / (1 + vatRate))
  const vatAmount = r2(finalTenantBill - subtotalBeforeVat)

  // الضريبة المحمّلة على فارق التسوية فقط (تفادي ازدواج ضريبة الدفعات السابقة)
  const settlementVat = netDue > 0 ? r2(netDue - netDue / (1 + vatRate)) : 0
  const settlementNetOfVat = r2(Math.max(netDue, 0) - settlementVat)

  return {
    daysCount: days,
    dailyRate: rate,
    calculatedRent,
    totalDiscounts,
    totalExtraFees,
    totalLatePenalty,
    initialInsurance: ins,
    retainedInsurance,
    refundedInsurance,
    grossRentAfterDiscount,
    finalTenantBill,
    paidSoFar: paid,
    netDue,
    subtotalBeforeVat,
    vatAmount,
    settlementVat,
    settlementNetOfVat,
  }
}

/**
 * بناء أسطر القيد المزدوج المتوقعة للتصفية (مرتبطة برموز شجرة الحسابات).
 * يُنتج قيداً موزوناً دائماً: أي فارق يُرحَّل إلى حساب إيرادات الإيجار 4110.
 */
export function buildSettlementLines({
  netDue = 0,
  method = 'cash',
  extraFees = 0,
  latePenalty = 0,
  retainedInsurance = 0,
  refundedInsurance = 0,
  initialInsurance = 0,
  vatAmount = 0,
  customerName = 'المستأجر',
} = {}) {
  const lines = []
  const finalNet = r2(netDue)
  const absNet = Math.abs(finalNet)
  const cashAcc = isBankMethod(method) ? SETTLEMENT_ACCOUNTS.bank : SETTLEMENT_ACCOUNTS.cash

  const push = (acc, debit, credit, description, tag) => {
    lines.push({
      tag,
      code: acc.code,
      accountName: acc.name,
      accountType: acc.type,
      debit: r2(debit),
      credit: r2(credit),
      description,
    })
  }

  // أ) حركة النقدية / البنك
  if (absNet > 0) {
    if (finalNet > 0) {
      push(cashAcc, absNet, 0, `تحصيل تصفية الحساب النهائي — ${customerName}`, 'cash_in')
    } else {
      push(cashAcc, 0, absNet, `إرجاع فائض الرصيد المسترد للعميل — ${customerName}`, 'cash_out')
    }
  }

  // ب) إقفال أمانة التأمين
  const ins = r2(initialInsurance)
  if (ins > 0) {
    push(SETTLEMENT_ACCOUNTS.insurance, ins, 0, `إقفال حساب أمانة التأمين المستلم عند الدخول — ${customerName}`, 'insurance_close')
    if (r2(refundedInsurance) > 0) {
      // المقابل هنا هو النقدية/البنك وليس 2120 مرة أخرى. كان السطران يقعان على
      // حساب التأمين نفسه، فيلغي أحدهما الآخر: الالتزام لا يُقفل والمبلغ المعاد
      // للمستأجر لا يخرج من الصندوق. القيد يبقى متوازناً — ولهذا لم يظهر العطل —
      // بينما تُضخَّم النقدية والالتزام معاً بنفس المبلغ في الميزانية.
      push(cashAcc, 0, refundedInsurance, `إرجاع مبلغ التأمين أو جزء منه للعميل — ${customerName}`, 'insurance_refund')
    }
    if (r2(retainedInsurance) > 0) {
      push(SETTLEMENT_ACCOUNTS.damagesRevenue, 0, retainedInsurance, `إيراد تعويض أضرار وتلفيات مستقطع من التأمين — ${customerName}`, 'insurance_retained')
    }
  }

  // ج) الخدمات الإضافية والغرامات
  if (r2(extraFees) > 0) {
    push(SETTLEMENT_ACCOUNTS.servicesRevenue, 0, extraFees, `إيراد رسوم خدمات إضافية عند الخروج — ${customerName}`, 'extra_fees')
  }
  if (r2(latePenalty) > 0) {
    push(SETTLEMENT_ACCOUNTS.damagesRevenue, 0, latePenalty, `إيراد غرامات تأخير في التسليم — ${customerName}`, 'late_penalty')
  }

  // د) ضريبة القيمة المضافة على فارق التسوية
  if (r2(vatAmount) > 0) {
    push(SETTLEMENT_ACCOUNTS.vat, 0, vatAmount, `ضريبة القيمة المضافة المستحقة عن تسوية الخروج — ${customerName}`, 'vat')
  }

  // هـ) سطر الموازنة على إيرادات الإيجار
  const diff = r2(totalDebit(lines) - totalCredit(lines))
  if (diff > 0) {
    push(SETTLEMENT_ACCOUNTS.rentRevenue, 0, diff, `تسوية فارق مدة السكن وإيراد الإيجار المستحق النهائي — ${customerName}`, 'balancing')
  } else if (diff < 0) {
    push(SETTLEMENT_ACCOUNTS.rentRevenue, Math.abs(diff), 0, `تسوية خصم إيجاري أو فارق رصيد دائن للمستأجر — ${customerName}`, 'balancing')
  }

  return lines
}

export const totalDebit = (lines = []) => r2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0))
export const totalCredit = (lines = []) => r2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0))
export const isBalanced = (lines = [], tolerance = 0.01) =>
  r2(Math.abs(totalDebit(lines) - totalCredit(lines))) <= tolerance

/** فحص مستقل يمنع اعتماد تصفية تختلف مكوناتها عن الإجمالي أو قيدها غير موزون. */
export function validateSettlementConsistency(calc = {}, lines = [], tolerance = 0.01) {
  const errors = []
  const componentsTotal = r2(
    Math.max(0, r2((Number(calc.calculatedRent) || 0) - (Number(calc.totalDiscounts) || 0)))
    + (Number(calc.totalExtraFees) || 0)
    + (Number(calc.totalLatePenalty) || 0)
    + (Number(calc.retainedInsurance) || 0),
  )
  const expectedNetDue = r2((Number(calc.finalTenantBill) || 0) - (Number(calc.paidSoFar) || 0))
  if (Math.abs(componentsTotal - (Number(calc.finalTenantBill) || 0)) > tolerance) {
    errors.push(`مجموع البنود ${componentsTotal} لا يطابق الإجمالي ${r2(calc.finalTenantBill)}`)
  }
  if (Math.abs(expectedNetDue - (Number(calc.netDue) || 0)) > tolerance) {
    errors.push(`الرصيد المحتسب ${expectedNetDue} لا يطابق الرصيد النهائي ${r2(calc.netDue)}`)
  }
  if (!isBalanced(lines, tolerance)) {
    errors.push(`القيد غير متوازن (مدين ${totalDebit(lines)} / دائن ${totalCredit(lines)})`)
  }
  return { ok: errors.length === 0, errors, componentsTotal, expectedNetDue }
}

/**
 * مطابقة الأسطر المتوقعة مع أسطر القيد المُرحَّل فعلياً في قاعدة البيانات.
 * postedLines: [{ code, debit, credit }]
 * يعيد صفوف المقارنة + قائمة الفروقات.
 */
export function reconcileSettlement(expectedLines = [], postedLines = [], tolerance = 0.01) {
  const agg = (lines) => {
    const map = new Map()
    for (const l of lines) {
      const code = String(l.code ?? l.account_code ?? '—')
      const cur = map.get(code) || { code, accountName: l.accountName || l.account_name || '', debit: 0, credit: 0 }
      cur.debit = r2(cur.debit + (Number(l.debit) || 0))
      cur.credit = r2(cur.credit + (Number(l.credit) || 0))
      if (!cur.accountName) cur.accountName = l.accountName || l.account_name || ''
      map.set(code, cur)
    }
    return map
  }

  const exp = agg(expectedLines)
  const post = agg(postedLines)
  const codes = [...new Set([...exp.keys(), ...post.keys()])].sort()

  const rows = codes.map((code) => {
    const e = exp.get(code) || { debit: 0, credit: 0, accountName: '' }
    const p = post.get(code) || { debit: 0, credit: 0, accountName: '' }
    const debitDiff = r2(p.debit - e.debit)
    const creditDiff = r2(p.credit - e.credit)
    // أكبر فرق مطلق بين طرفي القيد — لا يجوز طرح الفروقات من بعضها
    // (فرق مدين +100 وفرق دائن +100 ليس "صفر"، بل فرق حقيقي 100)
    const netDiff = r2(Math.max(Math.abs(debitDiff), Math.abs(creditDiff)))
    return {
      code,
      accountName: e.accountName || p.accountName || '',
      expectedDebit: e.debit,
      expectedCredit: e.credit,
      postedDebit: p.debit,
      postedCredit: p.credit,
      debitDiff,
      creditDiff,
      netDiff,
      matched: netDiff <= tolerance,
    }
  })

  const mismatches = rows.filter((r) => !r.matched)
  const postedBalanced = r2(Math.abs(totalDebit(postedLines) - totalCredit(postedLines))) <= tolerance
  // أكبر فرق فعلي عبر كل الحسابات — يُستخدم في التحذيرات حتى لا يظهر تحذير بفرق صفر
  const maxDiff = rows.reduce((m, r) => Math.max(m, r.netDiff), 0)

  return {
    rows,
    mismatches,
    maxDiff: r2(maxDiff),
    hasPostedEntry: postedLines.length > 0,
    expectedDebit: totalDebit(expectedLines),
    expectedCredit: totalCredit(expectedLines),
    postedDebit: totalDebit(postedLines),
    postedCredit: totalCredit(postedLines),
    expectedBalanced: isBalanced(expectedLines),
    postedBalanced,
    ok: postedLines.length > 0 && mismatches.length === 0 && postedBalanced,
  }
}
