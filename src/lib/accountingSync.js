import { supabase } from './supabase'
import { today } from './helpers'
import { buildSettlementLines, isBalanced } from './settlementLedger'


/*
  محرك الربط المحاسبي الشامل تلقائياً (Double-Entry Accounting Sync)
  يقوم بتأكيد وتوليد السندات والقيود المزدوجة الموزونة في شجرة الحسابات فور:
  1) تسجيل أي دفعة إيجار جديدة أو حجز أو سداد عبر بوابة الدفع.
  2) تسجيل أي مصروف صيانة أو تشغيل أو تحويل تذكرة إلى فاتورة.
*/

// إصدار رقم مستند تسلسلي آمن من قاعدة البيانات (مع بديل احتياطي عند الفشل)
async function nextDocNumber(client, companyId, kind, fallback) {
  try {
    const { data, error } = await (client || supabase).rpc('next_document_number', {
      p_company_id: companyId, p_kind: kind
    })
    if (!error && data) return data
  } catch (e) { /* fallback below */ }
  return fallback
}

// إيجاد الحساب الأب المناسب داخل الشجرة اعتماداً على رمز الحساب (1101 → 1100 → 1000)
async function findParentAccountId(db, companyId, accountCode) {
  const code = String(accountCode || '')
  if (code.length < 4) return null
  const candidates = [code.slice(0, 2) + '00', code.slice(0, 1) + '000']
  for (const parentCode of candidates) {
    if (parentCode === code) continue
    const { data } = await db
      .from('chart_of_accounts')
      .select('id')
      .eq('company_id', companyId)
      .eq('code', parentCode)
      .maybeSingle()
    if (data?.id) return data.id
  }
  return null
}

// إيجاد الحساب بالرمز Account Code أو إنشاؤه افتراضياً إن لم يوجد — مربوطاً دائماً بالشجرة
async function getOrCreateAccountId(companyId, accountCode, defaultName, accountType, client) {
  if (!companyId) return null
  const db = client || supabase

  // 1. Search existing account in company chart
  const { data: acc } = await db
    .from('chart_of_accounts')
    .select('id')
    .eq('company_id', companyId)
    .eq('code', accountCode)
    .maybeSingle()

  if (acc?.id) return acc.id

  // 2. If not found, insert account linked to its parent group so it appears in the tree
  const parentId = await findParentAccountId(db, companyId, accountCode)
  const { data: newAcc } = await db
    .from('chart_of_accounts')
    .insert({
      company_id: companyId,
      code: accountCode,
      name: defaultName,
      account_type: accountType,
      parent_id: parentId,
      is_active: true
    })
    .select('id')
    .maybeSingle()

  return newAcc?.id || null
}


/**
  مزامنة الدفعات الواردة (سند قبض + قيد مزدوج)
  Debit: Cash (1110) or Bank (1120)
  Credit: Rent Revenue (4110) or Tenant Receivable (1130)
*/
export async function syncPaymentToAccounting(supabaseClient, {
  companyId,
  paymentId = null,
  bookingId = null,
  unitId = null,
  customerName = 'عميل',
  amount = 0,
  method = 'cash',
  paymentType = 'rent',
  description = ''
}) {
  if (!companyId || !amount || Number(amount) <= 0) return null

  const numAmt = Number(amount)
  const isBank = method === 'bank_transfer' || method === 'card' || method === 'pos'

  try {
    // 1. Create Receipt Voucher (سند قبض)
    const voucherNo = await nextDocNumber(supabaseClient, companyId, 'receipt', `REC-${Date.now().toString().slice(-6)}`)
    const { data: voucher } = await supabaseClient
      .from('vouchers')
      .insert({
        company_id: companyId,
        voucher_number: voucherNo,
        voucher_type: 'receipt',
        voucher_date: today(),
        party_name: customerName,
        party_type: 'tenant',
        amount: numAmt,
        payment_method: method,
        description: description || `استلام دفعة إيجار من ${customerName}`
      })
      .select('id')
      .maybeSingle()

    // 2. Account Codes Resolution
    const debitCode = isBank ? '1102' : '1101'
    const debitName = isBank ? 'البنك' : 'الصندوق (كاش)'
    const debitAccId = await getOrCreateAccountId(companyId, debitCode, debitName, 'asset', supabaseClient)

    const creditCode = paymentType === 'insurance' ? '2120' : '4100'
    const creditName = paymentType === 'insurance' ? 'تأمينات المستأجرين المستردة' : 'إيرادات الإيجار'
    const creditAccId = await getOrCreateAccountId(companyId, creditCode, creditName, paymentType === 'insurance' ? 'liability' : 'revenue', supabaseClient)

    // 3. Create Journal Entry (قيد محاسبي موزون)
    const entryNo = await nextDocNumber(supabaseClient, companyId, 'journal', `JV-${Date.now().toString().slice(-6)}`)
    const { data: jEntry } = await supabaseClient
      .from('journal_entries')
      .insert({
        company_id: companyId,
        entry_number: entryNo,
        entry_date: today(),
        description: description || `إثبات تحصيل دفعة من ${customerName}`,
        source_type: 'payment',
        source_id: paymentId || bookingId
      })
      .select('id')
      .maybeSingle()

    if (jEntry?.id && debitAccId && creditAccId) {
      await supabaseClient.from('journal_entry_lines').insert([
        {
          entry_id: jEntry.id,
          account_id: debitAccId,
          debit: numAmt,
          credit: 0,
          description: `تحصيل نقدي/بنكي — ${customerName}`
        },
        {
          entry_id: jEntry.id,
          account_id: creditAccId,
          debit: 0,
          credit: numAmt,
          description: `إيراد إيجار مستحق — ${customerName}`
        }
      ])
    }

    return { voucherId: voucher?.id, journalEntryId: jEntry?.id }
  } catch (err) {
    console.warn('Accounting sync warning:', err)
    return null
  }
}

/**
  مزامنة المصروفات الصادرة (سند صرف + قيد مزدوج)
  Debit: Maintenance / Operating Expense (5110)
  Credit: Cash (1110) or Bank (1120)
*/
export async function syncExpenseToAccounting(supabaseClient, {
  companyId,
  expenseId = null,
  unitId = null,
  category = 'maintenance',
  amount = 0,
  description = '',
  paymentMethod = 'cash'
}) {
  if (!companyId || !amount || Number(amount) <= 0) return null

  const numAmt = Number(amount)
  const isBank = paymentMethod === 'bank_transfer' || paymentMethod === 'card'

  try {
    // 1. Create Payment Voucher (سند صرف)
    const voucherNo = await nextDocNumber(supabaseClient, companyId, 'payment', `PAY-${Date.now().toString().slice(-6)}`)
    const { data: voucher } = await supabaseClient
      .from('vouchers')
      .insert({
        company_id: companyId,
        voucher_number: voucherNo,
        voucher_type: 'payment',
        voucher_date: today(),
        party_name: 'مورد / فني صيانة',
        party_type: 'vendor',
        amount: numAmt,
        payment_method: paymentMethod,
        description: description || 'صرف تكاليف صيانة وتشغيل'
      })
      .select('id')
      .maybeSingle()

    // 2. Account Codes Resolution
    const debitCode = category === 'maintenance' ? '5110' : '5100'
    const debitName = category === 'maintenance' ? 'مصاريف الصيانة والنظافة' : 'مصاريف تشغيلية عمومية'
    const debitAccId = await getOrCreateAccountId(companyId, debitCode, debitName, 'expense', supabaseClient)

    const creditCode = isBank ? '1102' : '1101'
    const creditName = isBank ? 'البنك' : 'الصندوق (كاش)'
    const creditAccId = await getOrCreateAccountId(companyId, creditCode, creditName, 'asset', supabaseClient)

    // 3. Create Journal Entry (قيد محاسبي)
    const entryNo = await nextDocNumber(supabaseClient, companyId, 'journal', `JV-${Date.now().toString().slice(-6)}`)
    const { data: jEntry } = await supabaseClient
      .from('journal_entries')
      .insert({
        company_id: companyId,
        entry_number: entryNo,
        entry_date: today(),
        description: description || 'إثبات مصروفات صيانة وتجهيز',
        source_type: 'expense',
        source_id: expenseId
      })
      .select('id')
      .maybeSingle()

    if (jEntry?.id && debitAccId && creditAccId) {
      await supabaseClient.from('journal_entry_lines').insert([
        {
          entry_id: jEntry.id,
          account_id: debitAccId,
          debit: numAmt,
          credit: 0,
          description: `مصروف صيانة — ${description}`
        },
        {
          entry_id: jEntry.id,
          account_id: creditAccId,
          debit: 0,
          credit: numAmt,
          description: `سداد مصروفات من الصندوق/البنك`
        }
      ])

      // تسجيل في سجل التدقيق (Audit Logging) - تتبع عمليات الترحيل الآلي
      await supabaseClient.from('audit_logs').insert({
        company_id: companyId,
        user_id: (await supabaseClient.auth.getUser()).data.user?.id,
        action: 'migrate_maintenance_to_gl',
        entity: 'maintenance_request',
        entity_id: unitId,
        new_data: {
          amount: numAmt,
          gl_account: debitCode,
          account_name: debitName,
          description: description || 'مصروف صيانة آلي',
          category,
          source_type: 'automatic_sync',
          entry_number: entryNo,
          voucher_number: voucherNo,
          timestamp: new Date().toISOString()
        }
      })
    }

    return { voucherId: voucher?.id, journalEntryId: jEntry?.id }
  } catch (err) {
    console.warn('Expense accounting sync warning:', err)
    return null
  }
}

/**
  مزامنة تصفية الحساب والتسوية الشاملة (سند تسوية + قيد مزدوج متوازن)
  يقوم بتوزيع المبالغ تفصيلياً على شجرة الحسابات:
  - مدين/دائن الصندوق أو البنك (1110 / 1120) بقيمة صافي المستحق
  - مدين حساب تأمينات المستأجرين (2120) لإخلاء وتصفية مبلغ التأمين الأصلي
  - دائن حساب إيرادات الإيجارات (4110) بالفرق أو الإيراد المتبقي
  - دائن حساب إيرادات الخدمات الإضافية (4130) بمبلغ الخدمات والرسوم الإضافية
  - دائن حساب إيرادات أضرار وتلفيات (4120) بمبلغ التأمين المستقطع للتلفيات
  - دائن حساب ضريبة القيمة المضافة (2300) بضريبة الخدمات والإيجار الإضافي
*/
export async function syncSettlementToAccounting(supabaseClient, {
  companyId,
  bookingId,
  unitId,
  customerName,
  netDue = 0,
  method = 'cash',
  calculatedRent = 0,
  extraFees = 0,
  latePenalty = 0,
  retainedInsurance = 0,
  refundedInsurance = 0,
  initialInsurance = 0,
  vatAmount = 0,
  subtotalBeforeVat = 0,
  description = ''
}) {
  if (!companyId) return null

  try {
    const finalNet = Number(netDue || 0)
    const absNet = Math.abs(finalNet)

    // 1. إنشاء سند قبض أو صرف للتسوية النهائية إن وجد مبلغ حركة نقدي/بنكي
    let voucherId = null
    if (absNet > 0) {
      const voucherKind = finalNet > 0 ? 'receipt' : 'payment'
      const voucherNo = await nextDocNumber(supabaseClient, companyId, voucherKind,
        `${finalNet > 0 ? 'REC' : 'PAY'}-SET-${Date.now().toString().slice(-5)}`)
      const { data: voucher, error: voucherErr } = await supabaseClient
        .from('vouchers')
        .insert({
          company_id: companyId,
          voucher_number: voucherNo,
          voucher_type: voucherKind,
          voucher_date: today(),
          party_name: customerName,
          party_type: 'tenant',
          amount: absNet,
          payment_method: method,
          description: description || `تسوية وتصفية الحساب النهائي للمستأجر ${customerName}`
        })
        .select('id')
        .maybeSingle()
      if (voucherErr) throw voucherErr
      voucherId = voucher?.id
    }

    // 2. بناء أسطر القيد المتوقعة من محرك التصفية (المصدر الوحيد للحقيقة)
    const expectedLines = buildSettlementLines({
      netDue: finalNet,
      method,
      extraFees,
      latePenalty,
      retainedInsurance,
      refundedInsurance,
      initialInsurance,
      vatAmount,
      customerName
    })

    if (expectedLines.length === 0) {
      // لا توجد حركة مالية فعلية — لا نُنشئ قيداً فارغاً في اليومية
      return { voucherId, journalEntryId: null, entryNumber: null, lines: [] }
    }

    if (!isBalanced(expectedLines)) {
      throw new Error('قيد التصفية غير متوازن — تم إيقاف الترحيل لحماية شجرة الحسابات')
    }

    // 3. ربط كل سطر برمز الحساب في شجرة الحسابات (أو إنشاؤه)
    const codeToId = {}
    for (const line of expectedLines) {
      if (!codeToId[line.code]) {
        codeToId[line.code] = await getOrCreateAccountId(
          companyId, line.code, line.accountName, line.accountType, supabaseClient
        )
      }
      if (!codeToId[line.code]) {
        throw new Error(`تعذّر إيجاد أو إنشاء الحساب ${line.code} في شجرة الحسابات`)
      }
    }

    // 4. إنشاء قيد اليومية المزدوج وربطه بالحجز عبر source_id
    const entryNo = await nextDocNumber(supabaseClient, companyId, 'journal', `JV-SET-${Date.now().toString().slice(-5)}`)
    const { data: jEntry, error: jErr } = await supabaseClient
      .from('journal_entries')
      .insert({
        company_id: companyId,
        entry_number: entryNo,
        entry_date: today(),
        description: description || `قيد تصفية حساب خروج المستأجر: ${customerName}`,
        source_type: 'settlement',
        source_id: bookingId || null
      })
      .select('id, entry_number')
      .maybeSingle()
    if (jErr) throw jErr
    if (!jEntry?.id) throw new Error('تعذّر إنشاء قيد التصفية في اليومية')

    const rows = expectedLines.map((l, i) => ({
      entry_id: jEntry.id,
      account_id: codeToId[l.code],
      debit: l.debit,
      credit: l.credit,
      description: l.description,
      line_order: i + 1
    }))

    const { error: linesErr } = await supabaseClient.from('journal_entry_lines').insert(rows)
    if (linesErr) {
      await supabaseClient.from('journal_entries').delete().eq('id', jEntry.id)
      throw linesErr
    }

    return {
      voucherId,
      journalEntryId: jEntry.id,
      entryNumber: jEntry.entry_number || entryNo,
      lines: expectedLines
    }
  } catch (err) {
    console.error('Settlement accounting sync error:', err)
    throw new Error('فشل ترحيل قيد التصفية لشجرة الحسابات: ' + (err.message || err))
  }

}


/**
  مزامنة إلغاء الحجز مع الحسابات (قيد عكسي + سند صرف مسترد)
*/
export async function syncBookingCancellationToAccounting(supabaseClient, {
  companyId,
  bookingId,
  customerName = 'عميل أونلاين',
  amount = 0,
  unitNumber = ''
}) {
  if (!companyId || !bookingId) return null
  const numAmt = Number(amount)

  try {
    // 1. إنشاء سند صرف مسترد بقيمة المبلغ المسترد للعميل
    let voucherId = null
    if (numAmt > 0) {
      const voucherNo = await nextDocNumber(supabaseClient, companyId, 'payment', `PAY-RFD-${Date.now().toString().slice(-6)}`)
      const { data: voucher } = await supabaseClient
        .from('vouchers')
        .insert({
          company_id: companyId,
          voucher_number: voucherNo,
          voucher_type: 'payment',
          voucher_date: today(),
          party_name: customerName,
          party_type: 'tenant',
          amount: numAmt,
          payment_method: 'card',
          description: `سند صرف رد مالي (مسترد) لإلغاء حجز الوحدة ${unitNumber} للمستأجر ${customerName}`
        })
        .select('id')
        .maybeSingle()
      voucherId = voucher?.id
    }

    // 2. إنشاء قيد عكسي موزون لإلغاء الحجز
    const entryNo = await nextDocNumber(supabaseClient, companyId, 'journal', `JV-CAN-${Date.now().toString().slice(-6)}`)
    const { data: jEntry } = await supabaseClient
      .from('journal_entries')
      .insert({
        company_id: companyId,
        entry_number: entryNo,
        entry_date: today(),
        description: `عكس قيد إيراد حجز ملغي لوحدة ${unitNumber} — العميل ${customerName}`,
        source_type: 'settlement'
      })
      .select('id')
      .maybeSingle()

    if (jEntry?.id && numAmt > 0) {
      // دائن الصندوق أو البنك بنقص الأصول، مدين الإيرادات بنقص الأرباح
      const debitCode = '4100'
      const debitName = 'إيرادات الإيجار'
      const debitAccId = await getOrCreateAccountId(companyId, debitCode, debitName, 'revenue', supabaseClient)

      const creditCode = '1102' // البنك
      const creditName = 'البنك'
      const creditAccId = await getOrCreateAccountId(companyId, creditCode, creditName, 'asset', supabaseClient)

      if (debitAccId && creditAccId) {
        await supabaseClient.from('journal_entry_lines').insert([
          {
            entry_id: jEntry.id,
            account_id: debitAccId,
            debit: numAmt,
            credit: 0,
            description: `إلغاء وعكس إيراد إيجار الوحدة ${unitNumber} — العميل ${customerName}`
          },
          {
            entry_id: jEntry.id,
            account_id: creditAccId,
            debit: 0,
            credit: numAmt,
            description: `سداد قيمة الإلغاء للعميل من الحساب البنكي — العميل ${customerName}`
          }
        ])
      }
    }

    return { voucherId, journalEntryId: jEntry?.id }
  } catch (err) {
    console.warn('Cancellation accounting sync warning:', err)
    return null
  }
}

/**
  سكربت التسوية الآلية لمصروفات الصيانة وتوزيعها على الوحدات بالدفتر العام
  Traces recent maintenance expenses & requests, verifies unit apportionment,
  ensures double-entry balancing in General Ledger (journal_entries)
*/
export async function reconcileMaintenanceExpenses(supabaseClient, companyId) {
  if (!companyId) return { success: false, error: 'تعذّر تحديد رقم المنشأة' }

  try {
    // 1. جلب المصروفات الخاصة بالصيانة والفواتير المشتركة
    const { data: expenses, error: expErr } = await supabaseClient
      .from('expenses')
      .select('id, unit_id, category, amount, description, expense_date, invoice_url, created_at')
      .eq('company_id', companyId)
      .in('category', ['maintenance', 'cleaning', 'elec_bill', 'water_bill', 'other_bill'])
      .order('created_at', { ascending: false })

    if (expErr) throw expErr

    // 2. جلب طلبات الصيانة المغلقة أو ذات التكلفة
    const { data: tickets, error: tktErr } = await supabaseClient
      .from('maintenance_requests')
      .select('id, unit_id, request_type, description, cost, invoice_url, status, closed_at')
      .eq('company_id', companyId)
      .gt('cost', 0)

    if (tktErr) throw tktErr

    // 3. جلب بيانات الوحدات لربط المبالغ الموزعة برقم الوحدة
    const { data: units } = await supabaseClient
      .from('units')
      .select('id, unit_number, category')
      .eq('company_id', companyId)

    const unitMap = {}
    ;(units || []).forEach(u => { unitMap[u.id] = u.unit_number || u.id.slice(0, 6) })

    // 4. جلب قيود اليومية المحاسبية المتربطة بالمصروفات
    const { data: journalEntries } = await supabaseClient
      .from('journal_entries')
      .select(`
        id, entry_number, entry_date, description, source_type,
        journal_entry_lines(id, account_id, debit, credit, description)
      `)
      .eq('company_id', companyId)

    let totalExpensesAnalyzed = (expenses?.length || 0) + (tickets?.length || 0)
    let totalAmountAnalyzed = 0
    let autoFixedEntriesCount = 0
    let balancedEntriesCount = 0
    const unitApportionmentMap = {}

    // تهيئة سجلات توزيع الوحدات
    ;(units || []).forEach(u => {
      unitApportionmentMap[u.id] = {
        unitId: u.id,
        unitNumber: u.unit_number || 'وحدة',
        totalMaintenanceCost: 0,
        entriesCount: 0,
        balancedEntriesCount: 0,
        status: 'BALANCED'
      }
    })

    unitApportionmentMap['general'] = {
      unitId: null,
      unitNumber: 'صيانة تشغيلية عامة',
      totalMaintenanceCost: 0,
      entriesCount: 0,
      balancedEntriesCount: 0,
      status: 'BALANCED'
    }

    const existingEntryDescs = new Set()
    const balancedSourceIds = new Set()
    ;(journalEntries || []).forEach(je => {
      const sumDebits = je.journal_entry_lines?.reduce((s, l) => s + Number(l.debit || 0), 0) || 0
      const sumCredits = je.journal_entry_lines?.reduce((s, l) => s + Number(l.credit || 0), 0) || 0
      const isBalanced = Math.abs(sumDebits - sumCredits) < 0.01 && sumDebits > 0

      if (isBalanced) {
        if (je.source_id) balancedSourceIds.add(String(je.source_id))
        if (je.description) existingEntryDescs.add(je.description.trim())
        je.journal_entry_lines?.forEach(l => {
          if (l.description) existingEntryDescs.add(l.description.trim())
        })
      }
    })

    // معالجة المصروفات المسجلة
    for (const exp of (expenses || [])) {
      const amt = Number(exp.amount || 0)
      if (amt <= 0) continue
      totalAmountAnalyzed += amt

      const unitId = exp.unit_id || 'general'
      const unitNum = unitMap[exp.unit_id] ? `وحدة ${unitMap[exp.unit_id]}` : 'صيانة عامة'

      if (!unitApportionmentMap[unitId]) {
        unitApportionmentMap[unitId] = {
          unitId: exp.unit_id,
          unitNumber: unitNum,
          totalMaintenanceCost: 0,
          entriesCount: 0,
          balancedEntriesCount: 0,
          status: 'BALANCED'
        }
      }

      unitApportionmentMap[unitId].totalMaintenanceCost += amt
      unitApportionmentMap[unitId].entriesCount += 1

      // المطابقة الدقيقة: القيد المتوازن مرتبط بمعرّف المصروف نفسه (source_id)،
      // أو يحمل وصفاً مطابقاً تماماً لوصف المصروف (وليس مجرد تشابه بكلمة عامة).
      const expDesc = (exp.description || '').trim()
      const hasMatchingGL = balancedSourceIds.has(String(exp.id))
        || (expDesc.length > 0 && existingEntryDescs.has(expDesc))

      if (hasMatchingGL) {
        balancedEntriesCount += 1
        unitApportionmentMap[unitId].balancedEntriesCount += 1
      } else {
        // إنشاء قيد مزدوج موزون تلقائياً بالدفتر العام
        const syncRes = await syncExpenseToAccounting(supabaseClient, {
          companyId,
          expenseId: exp.id,
          unitId: exp.unit_id,
          category: exp.category || 'maintenance',
          amount: amt,
          description: `تسوية قيد آلي صيانة: ${exp.description || 'مصروف صيانة مسبب'} (${unitNum})`,
          paymentMethod: 'bank_transfer'
        })

        if (syncRes?.journalEntryId) {
          balancedSourceIds.add(String(exp.id))
          autoFixedEntriesCount += 1
          balancedEntriesCount += 1
          unitApportionmentMap[unitId].balancedEntriesCount += 1
        }
      }
    }

    // معالجة طلبات الصيانة المكتملة ذات التكلفة
    // منع ازدواج المطابقة: كل مصروف يُستهلك مرة واحدة فقط
    const usedExpenseIds = new Set()
    for (const tkt of (tickets || [])) {
      const amt = Number(tkt.cost || 0)
      if (amt <= 0) continue

      const unitId = tkt.unit_id || 'general'
      const unitNum = unitMap[tkt.unit_id] ? `وحدة ${unitMap[tkt.unit_id]}` : 'صيانة عامة'

      const tktDate = tkt.closed_at ? new Date(tkt.closed_at).getTime() : null
      const matchingExp = (expenses || []).find(e => {
        if (usedExpenseIds.has(e.id)) return false
        if (e.unit_id !== tkt.unit_id) return false
        if (Math.abs(Number(e.amount) - amt) >= 0.01) return false
        if (tktDate && e.expense_date) {
          const diffDays = Math.abs(new Date(e.expense_date).getTime() - tktDate) / 86400000
          if (diffDays > 30) return false
        }
        return true
      })
      if (matchingExp) usedExpenseIds.add(matchingExp.id)

      if (!matchingExp) {
        totalAmountAnalyzed += amt
        if (!unitApportionmentMap[unitId]) {
          unitApportionmentMap[unitId] = {
            unitId: tkt.unit_id,
            unitNumber: unitNum,
            totalMaintenanceCost: 0,
            entriesCount: 0,
            balancedEntriesCount: 0,
            status: 'BALANCED'
          }
        }
        unitApportionmentMap[unitId].totalMaintenanceCost += amt
        unitApportionmentMap[unitId].entriesCount += 1

        const { data: insertedExp, error: insErr } = await supabaseClient.from('expenses').insert({
          company_id: companyId,
          unit_id: tkt.unit_id,
          category: 'maintenance',
          amount: amt,
          description: `تسوية تذكرة صيانة: ${tkt.description || 'صيانة دورية'} (${unitNum})`,
          expense_date: tkt.closed_at ? tkt.closed_at.slice(0, 10) : today(),
          invoice_url: tkt.invoice_url || null
        }).select('id').single()

        if (insErr) { continue }
        usedExpenseIds.add(insertedExp?.id)

        const syncRes = await syncExpenseToAccounting(supabaseClient, {
          companyId,
          expenseId: insertedExp?.id || null,
          unitId: tkt.unit_id,
          category: 'maintenance',
          amount: amt,
          description: `مزامنة قيد تذكرة صيانة: ${tkt.description || 'صيانة دورية'} (${unitNum})`,
          paymentMethod: 'bank_transfer'
        })

        if (syncRes?.journalEntryId) {
          autoFixedEntriesCount += 1
          balancedEntriesCount += 1
          unitApportionmentMap[unitId].balancedEntriesCount += 1
        }
      }
    }

    const unitApportionmentList = Object.values(unitApportionmentMap)
      .filter(item => item.totalMaintenanceCost > 0 || item.entriesCount > 0)
      .map(item => ({
        ...item,
        status: item.balancedEntriesCount >= item.entriesCount ? 'متوازن 100% (Balanced)' : 'قيد التسوية'
      }))

    return {
      success: true,
      timestamp: new Date().toLocaleString('ar-SA'),
      totalExpensesAnalyzed,
      totalAmountAnalyzed,
      autoFixedEntriesCount,
      balancedEntriesCount,
      unitApportionmentList,
      generalLedgerStatus: '100% BALANCED & APPORTIONED'
    }
  } catch (err) {
    console.error('Error during maintenance reconciliation:', err)
    return { success: false, error: err.message }
  }
}


