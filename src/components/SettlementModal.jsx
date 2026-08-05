import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { SAR, today } from '../lib/helpers'
import { triggerChannexSync } from '../lib/channexSync'
import { printElement } from '../lib/printWindow'
import { syncSettlementToAccounting } from '../lib/accountingSync'
import {
  VAT_RATE, computeSettlement, buildSettlementLines, reconcileSettlement,
  totalDebit, totalCredit, summarizePayments,
  validateSettlementConsistency,
} from '../lib/settlementLedger'
import { exportSettlementPdf, exportSettlementExcel } from '../lib/settlementExport'
import { registerSerial } from '../lib/documentSerial'
import { reportIssue } from '../lib/systemMonitor'

/**
 * ZATCA Base64 TLV QR Encoder (Saudi E-Invoicing compliant)
 */
function generateZatcaQrTlv(sellerName, vatNo, timestamp, totalWithVat, vatTotal) {
  const encodeTLV = (tag, value) => {
    const valBuf = new TextEncoder().encode(value || '')
    const len = valBuf.length
    const buf = new Uint8Array(2 + len)
    buf[0] = tag
    buf[1] = len
    buf.set(valBuf, 2)
    return buf
  }
  try {
    const t1 = encodeTLV(1, sellerName || 'مجموعة المازن الفندقية')
    const t2 = encodeTLV(2, vatNo || '310023456700003')
    const t3 = encodeTLV(3, timestamp || new Date().toISOString())
    const t4 = encodeTLV(4, String(Number(totalWithVat || 0).toFixed(2)))
    const t5 = encodeTLV(5, String(Number(vatTotal || 0).toFixed(2)))

    const combined = new Uint8Array(t1.length + t2.length + t3.length + t4.length + t5.length)
    let offset = 0
    ;[t1, t2, t3, t4, t5].forEach(b => {
      combined.set(b, offset)
      offset += b.length
    })

    let binary = ''
    for (let i = 0; i < combined.byteLength; i++) {
      binary += String.fromCharCode(combined[i])
    }
    return btoa(binary)
  } catch (e) {
    return `ZATCA:${sellerName}:${vatNo}:${totalWithVat}:${vatTotal}`
  }
}

export default function SettlementModal({ unit, booking, onClose, isInline = false }) {
  const { profile, company, toast } = useAuth()
  const [busy, setBusy] = useState(false)
  const [doneInvoice, setDoneInvoice] = useState(null)
  const [invoiceType, setInvoiceType] = useState('simplified') // 'simplified' | 'corporate' | 'standard'

  // التواريخ الأساسية والتحكم بالخروج الفعلي
  const initialCheckIn = booking?.check_in_date || today()
  const initialCheckOut = booking?.check_out_date || today()
  const [outDate, setOutDate] = useState(initialCheckOut)

  // حساب الأيام بدقة
  const calcDays = (startStr, endStr) => {
    if (!startStr || !endStr) return 1
    const d1 = new Date(startStr)
    const d2 = new Date(endStr)
    const diffTime = d2.getTime() - d1.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 3600 * 24))
    return diffDays > 0 ? diffDays : 1
  }

  const daysCount = calcDays(initialCheckIn, outDate)
  const dailyRate = Number(booking?.daily_rate || (booking?.total_amount && booking?.duration ? booking.total_amount / booking.duration : unit?.daily_price || 0))
  
  // المبالغ الأصلية من الحجز
  const initialDiscount = Number(booking?.discount_amount || 0)
  const bookingInsurance = Number(booking?.insurance_amount || 0)
  const bookingDownPayment = Number(booking?.down_payment || 0)

  // سجل الدفعات بالكامل من قاعدة البيانات
  const [pastPaymentsList, setPastPaymentsList] = useState(booking?.payments || [])

  useEffect(() => {
    if (booking?.id) {
      supabase.from('payments').select('*').eq('booking_id', booking.id).order('payment_date', { ascending: true })
        .then(({ data }) => {
          if (data && data.length > 0) setPastPaymentsList(data)
        })
    }
  }, [booking?.id])

  // تلخيص موحّد: يفصل أمانة التأمين عن سداد الإيجار ويمنع ازدواج العربون
  const paySummary = useMemo(() => summarizePayments({
    payments: pastPaymentsList,
    initialDownPayment: bookingDownPayment,
    initialInsurance: bookingInsurance,
  }), [pastPaymentsList, bookingDownPayment, bookingInsurance])

  const initialInsurance = paySummary.insuranceReceived
  const initialDownPayment = paySummary.downPayment
  const paidSoFar = paySummary.paidSoFar


  // تفاصيل الساكن بالكامل قابلة للتعديل والمزامنة فورياً
  const [tenantName, setTenantName] = useState(booking?.customers?.full_name || booking?.customer_name || 'مستأجر')
  const [tenantIdNum, setTenantIdNum] = useState(booking?.customers?.id_number || booking?.customers?.national_id || '—')
  const [tenantPhone, setTenantPhone] = useState(booking?.customers?.phone || '—')
  const [tenantNationality, setTenantNationality] = useState(booking?.customers?.nationality || 'سعودي')
  const [companyName, setCompanyName] = useState(booking?.customers?.company_name || '')
  const [companyTaxNo, setCompanyTaxNo] = useState(booking?.customers?.vat_number || '')
  const [companyCr, setCompanyCr] = useState(booking?.customers?.cr_number || '')
  const [companyAddress, setCompanyAddress] = useState(booking?.customers?.national_address || '')

  // مبالغ الخدمات الإضافية والتعديلات والتسويات
  const [extraFees, setExtraFees] = useState(0)
  const [extraFeesReason, setExtraFeesReason] = useState('')
  const [latePenalty, setLatePenalty] = useState(0) // غرامة تأخير
  const [extraDiscount, setExtraDiscount] = useState(0)
  const [adjustmentReason, setAdjustmentReason] = useState('')
  
  // معالجة وحساب التأمين (مسترد بالكامل، مستقطع للتلفيات، مستقطع جزء)
  const [insuranceAction, setInsuranceAction] = useState('refund_full') // 'refund_full' | 'keep_damages' | 'deduct_part'
  const [deductedInsurance, setDeductedInsurance] = useState(0)
  const [insuranceDeductionReason, setInsuranceDeductionReason] = useState('') // سبب خصم التأمين

  // طريقة سداد فارق التصفية والتحويل للقسم المحاسبي
  const [payMethod, setPayMethod] = useState('cash')
  const [nextUnitStatus, setNextUnitStatus] = useState('cleaning') // 'cleaning' | 'available' | 'maintenance'

  // القيد المُرحَّل فعلياً في اليومية لهذا الحجز (لوحة التحقق والمطابقة)
  const [postedEntryInfo, setPostedEntryInfo] = useState(null)
  const [postedEntry, setPostedEntry] = useState(null)
  const [postedLines, setPostedLines] = useState([])
  const [loadingPosted, setLoadingPosted] = useState(false)
  const [reconError, setReconError] = useState('')
  const [chartCodes, setChartCodes] = useState(null) // Set من رموز شجرة الحسابات الفعلية

  const loadPostedEntry = useCallback(async () => {
    if (!booking?.id) return
    setLoadingPosted(true)
    setReconError('')
    try {
      const { data: entry, error: entryErr } = await supabase
        .from('journal_entries')
        .select('id, entry_number, entry_date, description')
        .eq('source_type', 'settlement')
        .eq('source_id', booking.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (entryErr) throw entryErr
      if (!entry?.id) { setPostedEntry(null); setPostedLines([]); return }
      // العلاقة الصحيحة: journal_entry_lines.account_id ← chart_of_accounts
      const { data: lines, error: linesErr } = await supabase
        .from('journal_entry_lines')
        .select('debit, credit, description, chart_of_accounts(code, name)')
        .eq('entry_id', entry.id)
        .order('line_order', { ascending: true })
      if (linesErr) throw linesErr
      setPostedEntry(entry)
      setPostedLines((lines || []).map(l => ({
        code: l.chart_of_accounts?.code || '—',
        accountName: l.chart_of_accounts?.name || '',
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        description: l.description || '',
        entryNumber: entry.entry_number,
      })))
    } catch (e) {
      setPostedEntry(null)
      setPostedLines([])
      setReconError(e?.message || 'تعذّر قراءة القيد المُرحَّل من اليومية')
    } finally {
      setLoadingPosted(false)
    }
  }, [booking?.id])

  useEffect(() => { loadPostedEntry() }, [loadPostedEntry, postedEntryInfo])

  // تحميل رموز شجرة الحسابات الفعلية للشركة — لكشف أي حساب ناقص قبل الترحيل
  const companyId = profile?.company_id || company?.id
  useEffect(() => {
    let cancelled = false
    if (!companyId) return
    ;(async () => {
      const { data } = await supabase
        .from('chart_of_accounts')
        .select('code')
        .eq('company_id', companyId)
        .eq('is_active', true)
      if (!cancelled) setChartCodes(new Set((data || []).map(a => String(a.code))))
    })()
    return () => { cancelled = true }
  }, [companyId, postedEntryInfo])

  // العمليات الحسابية التلقائية — عبر محرك التصفية الموحّد (settlementLedger)
  const calc = useMemo(() => computeSettlement({
    daysCount, dailyRate, initialDiscount,
    extraDiscount: Number(extraDiscount || 0),
    extraFees: Number(extraFees || 0),
    latePenalty: Number(latePenalty || 0),
    insuranceAction, initialInsurance,
    deductedInsurance: Number(deductedInsurance || 0),
    paidSoFar,
  }), [daysCount, dailyRate, initialDiscount, extraDiscount, extraFees, latePenalty, insuranceAction, initialInsurance, deductedInsurance, paidSoFar])

  const vatRate = VAT_RATE
  const {
    calculatedRent, totalDiscounts, totalExtraFees, totalLatePenalty,
    retainedInsurance, refundedInsurance, finalTenantBill, netDue,
    subtotalBeforeVat, vatAmount,
  } = calc

  // أسطر القيد المتوقعة (تُعرض في لوحة المطابقة وتُصدَّر في التقارير)
  const expectedLines = useMemo(() => buildSettlementLines({
    netDue, method: payMethod,
    extraFees: totalExtraFees, latePenalty: totalLatePenalty,
    retainedInsurance, refundedInsurance, initialInsurance,
    vatAmount: calc.settlementVat, customerName: tenantName,
  }), [netDue, payMethod, totalExtraFees, totalLatePenalty, retainedInsurance, refundedInsurance, initialInsurance, calc.settlementVat, tenantName])

  const reconciliation = useMemo(
    () => reconcileSettlement(expectedLines, postedLines),
    [expectedLines, postedLines]
  )
  const consistency = useMemo(() => validateSettlementConsistency(calc, expectedLines), [calc, expectedLines])

  // كشف تلقائي لأي حساب مطلوب في التصفية وغير موجود في شجرة حسابات الشركة
  const missingAccounts = useMemo(() => {
    if (!chartCodes) return []
    const seen = new Map()
    for (const l of expectedLines) if (!chartCodes.has(String(l.code))) seen.set(l.code, l.accountName)
    return [...seen].map(([code, name]) => ({ code, name }))
  }, [expectedLines, chartCodes])

  const hasAdjustments = (daysCount !== Number(booking?.duration || 1)) || Number(extraFees) > 0 || Number(extraDiscount) > 0 || insuranceAction !== 'refund_full'

  // تصفية الحساب وإنهاء السكن وربطه بشجرة الحسابات وتحديث قاعدة البيانات
  const handleSettleAndHandover = async () => {
    if (!booking?.id || !unit?.id) {
      return toast('تعذّر بدء التصفية لأن بيانات الحجز أو الوحدة غير مكتملة. أغلق النافذة وأعد فتح الوحدة.', true)
    }
    if (!consistency.ok) {
      return toast(`⚠️ لم تعتمد التصفية لوجود فرق حسابي: ${consistency.errors.join('، ')}`, true)
    }
    if (chartCodes === null) return toast('جارٍ التحقق من شجرة الحسابات، أعد المحاولة بعد لحظة.', true)
    if (missingAccounts.length) {
      return toast(`لا يمكن اعتماد التصفية قبل إضافة الحسابات الناقصة: ${missingAccounts.map(a => `${a.code} ${a.name}`).join('، ')}`, true)
    }
    if (hasAdjustments && !adjustmentReason.trim()) {
      return toast('⚠️ يرجى كتابة سبب التعديل والتسوية المالية للمتابعة والمطابقة المحاسبية', true)
    }
    setBusy(true)
    const cid = profile?.company_id || company?.id
    try {
      // 1) تحديث بيانات الساكن (اختياري) — لا يجوز أن يوقف التصفية المحاسبية
      //    أسماء الأعمدة مطابقة لمخطط قاعدة البيانات: vat_number / cr_number / national_address
      if (booking?.customer_id) {
        const basePatch = {
          full_name: tenantName,
          id_number: tenantIdNum,
          phone: tenantPhone,
          nationality: tenantNationality,
        }
        const optionalPatch = {}
        if (companyName) optionalPatch.company_name = companyName
        if (companyTaxNo) optionalPatch.vat_number = companyTaxNo
        if (companyCr) optionalPatch.cr_number = companyCr
        if (companyAddress) optionalPatch.national_address = companyAddress

        const updateCustomer = (patch) =>
          supabase.from('customers').update(patch).eq('id', booking.customer_id)

        let { error: custErr } = await updateCustomer({ ...basePatch, ...optionalPatch })
        // عمود غير موجود في مخطط قاعدة البيانات (PGRST204) — نعيد المحاولة بالحقول الأساسية فقط
        if (custErr) {
          console.warn('Customer profile update failed, retrying with base fields:', custErr)
          const retry = await updateCustomer(basePatch)
          if (retry.error) console.warn('Customer profile update skipped:', retry.error)
        }
      }


      // 2) حفظ دفعة التسوية النهائية (نقداً أو شبكة) إن وجد فارق تسوية مالية
      if (netDue !== 0) {
        const { error: payErr } = await supabase.from('payments').insert({
          company_id: cid,
          booking_id: booking.id,
          amount: Math.abs(netDue),
          payment_type: netDue > 0 ? 'settlement' : 'refund',
          method: payMethod,
          payment_date: today(),
          reference_number: 'SETTLE-' + Math.floor(100000 + Math.random() * 900000),
          notes: `تصفية حساب خروج النهائي وتأكيد تسوية سكن الوحدة ${unit.unit_number || unit.name}. السبب: ${adjustmentReason || 'خروج نهائي'}`
        })
        if (payErr) throw payErr
      }

      // 3) مزامنة محاسبية مزدوجة موزونة مع شجرة الحسابات
      //    تُنفَّذ أيضاً عند صفر الفارق طالما هناك تأمين يجب إقفاله محاسبياً
      let postedEntry = null
      if (netDue !== 0 || initialInsurance > 0) {
        // ضريبة القيمة المضافة المحمّلة على فارق التسوية فقط (لتفادي ازدواج الضريبة
        // المُرحَّلة سابقاً مع الدفعات المسددة أثناء فترة السكن)
        postedEntry = await syncSettlementToAccounting(supabase, {
          companyId: cid,
          bookingId: booking.id,
          unitId: unit.id,
          customerName: tenantName,
          netDue: netDue,
          method: payMethod,
          calculatedRent: calculatedRent,
          extraFees: extraFees,
          latePenalty: totalLatePenalty,
          retainedInsurance: retainedInsurance,
          refundedInsurance: refundedInsurance,
          initialInsurance: initialInsurance,
          vatAmount: calc.settlementVat,
          subtotalBeforeVat: calc.settlementNetOfVat,
          description: `تصفية حساب الوحدة ${unit.unit_number || unit.name} — المستأجر: ${tenantName}. سبب التسوية: ${adjustmentReason || 'بدون ملاحظات'}`
        })
        setPostedEntryInfo(postedEntry)
      }


      // 4) إنهاء وتحديث حالة الحجز إلى "checked_out" وتحديث تفاصيل التصفية
      const { error: bookErr } = await supabase.from('bookings').update({
        status: 'checked_out',
        check_out_date: outDate,
        total_amount: finalTenantBill,
        discount_amount: totalDiscounts,
        notes: (booking.notes ? booking.notes + ' · ' : '') + `تمت التصفية النهائية: ${adjustmentReason || 'تسوية خروج ومغادرة'}`
      }).eq('id', booking.id)
      if (bookErr) throw bookErr

      // 5) تحويل حالة الوحدة فورياً للخطوة التالية (تنظيف، متاح، صيانة) لتغيير لون الغرفة في الشاشة الرئيسية
      const { error: unitErr } = await supabase.from('units').update({ status: nextUnitStatus }).eq('id', unit.id)
      if (unitErr) throw unitErr

      
      // 6) إصدار الفاتورة الفاخرة للطباعة مع تشفير QR Code ZATCA
      // جلب رقم الفاتورة التسلسلي الجديد من قاعدة البيانات
      let invNo = null
      try {
        const { data: fetchedInvNo } = await supabase.rpc('next_invoice_number', { p_company: cid })
        invNo = fetchedInvNo
      } catch (rpcErr) {
        console.warn('RPC next_invoice_number failed, using fallback', rpcErr)
      }
      if (!invNo) {
        invNo = 'INV-' + Math.floor(100000 + Math.random() * 900000)
      }

      const sellerName = company?.name || 'مجموعة المازن الفندقية والوحدات المفروشة'
      const sellerVat = company?.vat_number || ''
      const timestampIso = new Date().toISOString()
      const zatcaQrData = generateZatcaQrTlv(sellerName, sellerVat, timestampIso, finalTenantBill, vatAmount)

      // حفظ الفاتورة رسمياً في جدول الفواتير (invoices) للتقارير والربط المحاسبي وضريبة القيمة المضافة
      const isCorpOrStandard = invoiceType === 'corporate' || invoiceType === 'standard'
      const invType = isCorpOrStandard ? 'standard' : 'simplified'
      const customerNameFinal = (isCorpOrStandard ? (companyName || tenantName) : tenantName) || 'مستأجر'
      const custType = invType === 'standard' ? 'company' : 'individual'
      const targetCompanyId = cid || profile?.company_id || booking?.company_id

      const { error: invoiceDbErr } = await supabase.from('invoices').insert({
        company_id: targetCompanyId,
        booking_id: booking?.id || null,
        invoice_number: invNo,
        invoice_type: invType,
        customer_name: customerNameFinal,
        customer_type: custType,
        customer_vat: isCorpOrStandard ? (companyTaxNo || null) : null,
        customer_cr: isCorpOrStandard ? (companyCr || null) : null,
        customer_address: isCorpOrStandard ? (companyAddress || null) : null,
        subtotal: subtotalBeforeVat || 0,
        vat_rate: 15,
        vat_amount: vatAmount || 0,
        total: finalTenantBill || 0,
        qr_code_data: zatcaQrData || null,
        issued_by: profile?.id || null
      })
      if (invoiceDbErr) {
        console.error('Error inserting invoice to database:', invoiceDbErr)
        await reportIssue('bookings', invoiceDbErr, {
          step: 'settlement_invoice_insert', booking_id: booking?.id || null, invoice_number: invNo,
        }, { severity: 'error', code: invoiceDbErr?.code || 'invoice_insert_failed' })
      }

      // تسجيل رقم الفاتورة في سجل المستندات الموحّد (لا يعطّل الطباعة عند الفشل)
      await registerSerial('invoice', invNo, {
        table: 'invoices', id: booking?.id || null,
        meta: { booking_id: booking?.id || null, invoice_type: invType, total: finalTenantBill || 0 },
      })

      setDoneInvoice({
        invoiceNo: invNo,
        date: today(),
        time: new Date().toLocaleTimeString('ar-SA'),
        invoiceType,
        sellerName,
        sellerVat,
        sellerAddress: company?.address || 'الرياض، المملكة العربية السعودية',
        tenantName,
        tenantIdNum,
        tenantPhone,
        tenantNationality,
        companyName,
        companyTaxNo,
        companyCr,
        companyAddress,
        unitNumber: unit.unit_number || unit.name,
        unitCategory: unit.category || 'شقة',
        checkIn: initialCheckIn,
        checkOut: outDate,
        daysCount,
        dailyRate,
        calculatedRent,
        initialDiscount,
        extraDiscount,
        totalDiscounts,
        initialInsurance,
        retainedInsurance,
        refundedInsurance,
        extraFees,
        extraFeesReason,
        finalTenantBill,
        subtotalBeforeVat,
        vatAmount,
        paidSoFar,
        netDue,
        payMethod,
        adjustmentReason,
        zatcaQrData
      })

      triggerChannexSync(cid)
      toast(`✓ تم إقفال الحساب وتصفية سكن الوحدة ${unit.unit_number || unit.name} بنجاح ومزامنة السندات والقيود مع شجرة الحسابات!`)
    } catch (err) {
      toast('❌ خطأ في إكمال التسوية والتصفية: ' + err.message, true)
    } finally {
      setBusy(false)
    }
  }

  const printSettlementInvoice = () => {
    if (!doneInvoice) return
    printElement(
      <SettlementPrintArea 
        doneInvoice={doneInvoice} 
        initialDownPayment={initialDownPayment} 
        paidSoFar={paidSoFar} 
        companyLogo={company?.logo || ''}
      />, 
      {
        title: doneInvoice.invoiceType === 'simplified' ? 'فاتورة ضريبية مبسطة'
             : doneInvoice.invoiceType === 'corporate' ? 'فاتورة ضريبية للشركات'
             : 'سند تصفية ومغادرة',
        // الفاتورة والتسوية مستندان يُقدَّمان للعميل والمراجع، فيُختمان
        docKind: doneInvoice.invoiceType ? 'invoice' : 'settlement',
        entityId: doneInvoice.id || null,
        total: doneInvoice.total ?? doneInvoice.grandTotal ?? null,
      }
    )
  }

  const exportArgs = () => ({
    unit, booking, calc, expectedLines, postedLines,
    reconciliation,
    entryNumber: postedEntry?.entry_number || postedEntryInfo?.entryNumber || '',
    tenantName, companyName: company?.name || 'المازن',
    outDate, payMethod,
  })
  const onExportPdf = () => exportSettlementPdf(exportArgs())
  const onExportExcel = () => exportSettlementExcel(exportArgs())

  const uiProps = {
    paySummary,
    unit, booking, busy, doneInvoice, setDoneInvoice, invoiceType, setInvoiceType,
    outDate, setOutDate, daysCount, dailyRate, calculatedRent,
    initialDiscount, initialInsurance, initialDownPayment,
    pastPaymentsList, paidSoFar, tenantName, setTenantName,
    tenantIdNum, setTenantIdNum, tenantPhone, setTenantPhone,
    tenantNationality, setTenantNationality, companyName, setCompanyName,
    companyTaxNo, setCompanyTaxNo, companyCr, setCompanyCr,
    companyAddress, setCompanyAddress, extraFees, setExtraFees,
    extraFeesReason, setExtraFeesReason, extraDiscount, setExtraDiscount,
    latePenalty, setLatePenalty,
    adjustmentReason, setAdjustmentReason, insuranceAction, setInsuranceAction,
    deductedInsurance, setDeductedInsurance, insuranceDeductionReason, setInsuranceDeductionReason,
    payMethod, setPayMethod,
    nextUnitStatus, setNextUnitStatus, finalTenantBill, netDue,
    subtotalBeforeVat, vatAmount, hasAdjustments, handleSettleAndHandover,
    printSettlementInvoice, onClose, isInline, totalDiscounts, retainedInsurance, refundedInsurance,
    calc, expectedLines, postedLines, postedEntry, reconciliation, loadingPosted,
    loadPostedEntry, onExportPdf, onExportExcel,
    reconError, missingAccounts
  }

  if (isInline) {
    return (
      <div id="inline-settlement-container" className="animate-in fade-in" style={{ background: 'var(--card)', borderRadius: '16px', padding: '24px', border: '1px solid var(--border)', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
        <SettlementUI {...uiProps} />
      </div>
    )
  }

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose(false)}>
      <div className="modal" style={{ width: 'min(1080px, 98%)', maxWidth: 1080, borderRadius: '18px', overflow: 'hidden' }}>
        <div className="modal-h" style={{ background: '#0f172a', color: '#fff', padding: '16px 22px' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold' }}>💰 نظام تصفية حساب وتسوية الوحدة {unit.unit_number || unit.name}</h3>
          <button className="x" onClick={() => onClose(false)} style={{ color: '#fff', fontSize: '20px' }}>✕</button>
        </div>
        <div className="modal-b" style={{ padding: '24px', maxHeight: '85vh', overflowY: 'auto', background: 'var(--bg)' }}>
          <SettlementUI {...uiProps} />
        </div>
      </div>
    </div>
  )
}

function SettlementUI({
  paySummary = { refunds: 0, totalReceived: 0, paidSoFar: 0, insuranceReceived: 0, downPayment: 0 },
  unit, booking, busy, doneInvoice, setDoneInvoice, invoiceType, setInvoiceType, outDate, setOutDate, daysCount, dailyRate,
  calculatedRent, initialDiscount, initialInsurance, initialDownPayment, pastPaymentsList, paidSoFar,
  tenantName, setTenantName, tenantIdNum, setTenantIdNum, tenantPhone, setTenantPhone,
  tenantNationality, setTenantNationality, companyName, setCompanyName, companyTaxNo, setCompanyTaxNo,
  companyCr, setCompanyCr, companyAddress, setCompanyAddress,
  extraFees, setExtraFees, extraFeesReason, setExtraFeesReason, extraDiscount, setExtraDiscount,
  latePenalty, setLatePenalty,
  adjustmentReason, setAdjustmentReason, insuranceAction, setInsuranceAction, deductedInsurance, setDeductedInsurance,
  insuranceDeductionReason, setInsuranceDeductionReason,
  payMethod, setPayMethod, nextUnitStatus, setNextUnitStatus, finalTenantBill, netDue, subtotalBeforeVat,
  vatAmount, hasAdjustments, handleSettleAndHandover, printSettlementInvoice, onClose, isInline,
  totalDiscounts, retainedInsurance, refundedInsurance,
  calc, expectedLines = [], postedLines = [], postedEntry, reconciliation, loadingPosted,
  loadPostedEntry, onExportPdf, onExportExcel, reconError = '', missingAccounts = []
}) {
  const { company } = useAuth()

  const livePreviewInvoice = {
    invoiceNo: 'DRAFT-' + (booking?.reference_number || '000000'),
    date: today(),
    time: new Date().toLocaleTimeString('ar-SA'),
    invoiceType: invoiceType, // 'simplified' | 'corporate' | 'standard'
    sellerName: company?.name || 'مجموعة المازن الفندقية والوحدات المفروشة',
    sellerVat: company?.vat_number || '',
    sellerAddress: company?.address || 'الرياض، المملكة العربية السعودية',
    tenantName: tenantName || 'مستأجر',
    tenantIdNum: tenantIdNum || '—',
    tenantPhone: tenantPhone || '—',
    tenantNationality: tenantNationality || 'سعودي',
    companyName: companyName,
    companyTaxNo: companyTaxNo,
    companyCr: companyCr,
    companyAddress: companyAddress,
    unitNumber: unit.unit_number || unit.name,
    unitCategory: unit.category || 'شقة',
    checkIn: booking?.check_in_date || today(),
    checkOut: outDate,
    daysCount: daysCount,
    dailyRate: dailyRate,
    calculatedRent: calculatedRent,
    initialDiscount: initialDiscount,
    extraDiscount: extraDiscount,
    totalDiscounts: totalDiscounts,
    initialInsurance: initialInsurance,
    retainedInsurance: retainedInsurance,
    refundedInsurance: refundedInsurance,
    extraFees: extraFees,
    extraFeesReason: extraFeesReason,
    latePenalty: latePenalty,
    finalTenantBill: finalTenantBill,
    subtotalBeforeVat: subtotalBeforeVat,
    vatAmount: vatAmount,
    paidSoFar: paidSoFar,
    netDue: netDue,
    payMethod: payMethod,
    adjustmentReason: adjustmentReason,
    zatcaQrData: generateZatcaQrTlv(
      company?.name || 'مجموعة المازن الفندقية والوحدات المفروشة',
      company?.vat_number || '',
      new Date().toISOString(),
      finalTenantBill,
      vatAmount
    )
  }

  const printPreviewDraft = () => {
    printElement(
      <SettlementPrintArea 
        doneInvoice={livePreviewInvoice} 
        initialDownPayment={initialDownPayment} 
        paidSoFar={paidSoFar} 
        companyLogo={company?.logo || ''}
      />, 
      {
        title: invoiceType === 'simplified' ? 'مسودة فاتورة ضريبية مبسطة'
             : invoiceType === 'corporate' ? 'مسودة فاتورة ضريبية للشركات'
             : 'مسودة سند تصفية ومغادرة',
        // المسودة لا تُختم: الختم يمنح رقماً تسلسلياً ورمز تحقق، ومنحه
        // لورقة معاينة يجعل رقماً رسمياً يُصرف على مستند لم يصدر بعد.
        stamp: false,
      }
    )
  }
  
  if (doneInvoice) {
    return (
      <div className="animate-in fade-in" id="done-invoice-section">
        {/* Success Alert Header */}
        <div style={{ background: 'rgba(5, 150, 105, 0.1)', border: '1px solid #10b981', padding: '16px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <h4 style={{ color: '#059669', margin: '0 0 4px', fontWeight: 'bold', fontSize: '16px' }}>🎉 تم التصفية وإقفال السكن بنجاح!</h4>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)' }}>تم ترحيل السندات للقسم المالي ومزامنة التغييرات فورياً مع شجرة الحسابات.</p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-green btn-sm" onClick={printSettlementInvoice} style={{ fontSize: '13px', padding: '8px 16px' }}>🖨 طباعة المستند الفاخر</button>
            <button className="btn btn-ghost btn-sm" onClick={() => onClose(true)} style={{ fontSize: '13px', padding: '8px 16px' }}>إغلاق وتحديث القوائم</button>
          </div>
        </div>

        {/* Dynamic Formatting Selector Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', background: 'var(--card)', padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--border)' }}>
          <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--gold-l)' }}>📄 تنسيق نمط المطبوع النشط:</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[
              ['simplified', '🧾 فاتورة مبسطة B2C'],
              ['corporate', '🏢 فاتورة شركات B2B'],
              ['standard', '📄 سند تصفية عام']
            ].map(([type, label]) => (
              <button
                key={type}
                type="button"
                onClick={() => setDoneInvoice(current => current ? { ...current, invoiceType: type } : current)}
                style={{
                  padding: '6px 14px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  border: doneInvoice.invoiceType === type ? '2px solid var(--gold-l)' : '1px solid var(--border)',
                  background: doneInvoice.invoiceType === type ? 'var(--soft)' : 'transparent',
                  color: doneInvoice.invoiceType === type ? 'var(--gold-l)' : 'var(--muted)',
                  transition: 'all 0.2s ease'
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Interactive Live Luxury Preview (Identical to Printout Output) */}
        <div style={{ border: '2px solid var(--border)', borderRadius: '16px', padding: '4px', background: '#f8fafc' }}>
          <div style={{ padding: '8px', background: 'var(--card)', borderBottom: '1px solid var(--border)', borderTopLeftRadius: '12px', borderTopRightRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: 'bold' }}>👁️ معاينة حية للمستند المطبوع (المقاس الفعلي A4)</span>
            <span style={{ fontSize: '11px', color: 'var(--gold-l)', background: 'var(--soft)', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
              النمط المالي: {doneInvoice.invoiceType === 'simplified' ? 'ضريبة مبسطة B2C' : doneInvoice.invoiceType === 'corporate' ? 'فاتورة معتمدة B2B' : 'سند عام مصفى'}
            </span>
          </div>
          <div style={{ background: '#ffffff', padding: '30px', borderRadius: '12px', overflowX: 'auto' }}>
            <SettlementPrintArea
              doneInvoice={doneInvoice}
              initialDownPayment={initialDownPayment}
              paidSoFar={paidSoFar}
              companyLogo={unit?.companies?.logo_url || ''}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', direction: 'rtl' }}>
      <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '24px' }}>
      
      {/* العمود الأيمن: معطيات التصفية والبيانات */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* بيانات الساكن بالكامل قابلة للتحديث */}
        <div className="card" style={{ padding: '20px', borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--card)' }}>
          <h4 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--gold-l)' }}>
            👤 مراجعة وتحديث بيانات الساكن والمنشأة للفاتورة
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>اسم الساكن بالكامل</label>
              <input type="text" value={tenantName} onChange={e => setTenantName(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>رقم الهوية / الإقامة</label>
              <input type="text" value={tenantIdNum} onChange={e => setTenantIdNum(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>رقم الجوال</label>
              <input type="text" value={tenantPhone} onChange={e => setTenantPhone(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>الجنسية</label>
              <input type="text" value={tenantNationality} onChange={e => setTenantNationality(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' }} />
            </div>

            {invoiceType === 'corporate' && (
              <>
                <div style={{ gridColumn: '1 / -1', borderTop: '1px dashed var(--border)', paddingTop: '10px', marginTop: '4px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--blue-2)' }}>🏢 بيانات الشركة / المؤسسة للفوترة</span>
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>اسم الشركة</label>
                  <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="مجموعة المازن..." style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' }} />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>الرقم الضريبي للشركة</label>
                  <input type="text" value={companyTaxNo} onChange={e => setCompanyTaxNo(e.target.value)} placeholder="3100..." style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' }} />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>السجل التجاري للشركة</label>
                  <input type="text" value={companyCr} onChange={e => setCompanyCr(e.target.value)} placeholder="1010..." style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' }} />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>العنوان الوطني للشركة</label>
                  <input type="text" value={companyAddress} onChange={e => setCompanyAddress(e.target.value)} placeholder="الرياض، السليمانية..." style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' }} />
                </div>
              </>
            )}
          </div>
        </div>

        {/* التحكم بالخروج والمدة والأسعار والرسوم */}
        <div className="card" style={{ padding: '20px', borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--card)' }}>
          <h4 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--gold-l)' }}>
            📅 الإقامة وتاريخ الخروج الفعلي والتسويات
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>تاريخ الخروج الفعلي والرحيل</label>
              <input type="date" value={outDate} onChange={e => setOutDate(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' }} />
              <div style={{ fontSize: '11px', color: 'var(--blue-2)', marginTop: '4px' }}>
                📅 إجمالي الأيام المحتسبة: <b>{daysCount} ليلة</b> (السعر اليومي: {SAR(dailyRate)})
              </div>
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>خصم تسوية إضافي (إن وجد)</label>
              <input type="number" value={extraDiscount} onChange={e => setExtraDiscount(Number(e.target.value))} placeholder="0.00" style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' }} />
            </div>
          </div>

          <div style={{ borderTop: '1px dashed var(--border)', paddingTop: '14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>رسوم خدمات وطلبات إضافية</label>
              <input type="number" value={extraFees} onChange={e => setExtraFees(Number(e.target.value))} placeholder="0.00" style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>سبب الرسوم الإضافية</label>
              <input type="text" value={extraFeesReason} onChange={e => setExtraFeesReason(e.target.value)} placeholder="مثال: تلف مفتاح الغرفة، ميني بار..." style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' }} />
            </div>
          </div>
          <div style={{ borderTop: '1px dashed var(--border)', paddingTop: '14px', display: 'grid', gridTemplateColumns: '1fr', gap: '14px', marginBottom: '16px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>التأخير في التسليم (غرامات تأخير / رسوم تأخير خروج)</label>
              <input type="number" value={latePenalty} onChange={e => setLatePenalty(Number(e.target.value))} placeholder="0.00" style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' }} />
            </div>
          </div>

          {/* معالجة التأمين وتلفيات المستأجرين */}
          {initialInsurance > 0 && (
            <div style={{ borderTop: '1px dashed var(--border)', paddingTop: '14px', marginBottom: '14px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '8px', color: 'var(--gold-l)' }}>🛡️ تسوية أمانة التأمين المدفوع عند الدخول ({SAR(initialInsurance)})</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  ['refund_full', '🟢 إرجاع كامل'],
                  ['keep_damages', '🔴 استقطاع كامل للشركة'],
                  ['deduct_part', '🟡 استقطاع جزء للتلفيات']
                ].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setInsuranceAction(k)} style={{
                    padding: '8px 12px', fontSize: '11px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer',
                    border: insuranceAction === k ? '2px solid var(--gold-l)' : '1px solid var(--border)',
                    background: insuranceAction === k ? 'var(--soft)' : 'transparent',
                    color: insuranceAction === k ? 'var(--gold-l)' : 'var(--muted)',
                  }}>{l}</button>
                ))}
              </div>
              {(insuranceAction === 'deduct_part' || insuranceAction === 'keep_damages') && (
                <div style={{ marginTop: '10px' }}>
                  {insuranceAction === 'deduct_part' && (
                    <div style={{ marginBottom: '8px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>المبلغ المستقطع للتلفيات والخصم من التأمين</label>
                      <input type="number" max={initialInsurance} value={deductedInsurance} onChange={e => setDeductedInsurance(Number(e.target.value))} placeholder="ادخل المبلغ" style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' }} />
                      <div style={{ fontSize: '11px', color: 'var(--green)', marginTop: '4px' }}>
                        💵 المتبقي المرتجع للعميل: <b>{SAR(Math.max(0, initialInsurance - deductedInsurance))}</b>
                      </div>
                    </div>
                  )}
                  <div>
                    <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>الخصم من التأمين وسبب الخصم (تفاصيل)</label>
                    <input type="text" value={insuranceDeductionReason} onChange={e => setInsuranceDeductionReason(e.target.value)} placeholder="مثال: خصم لتعويض أضرار الباب..." style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' }} />
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ borderTop: '1px dashed var(--border)', paddingTop: '14px' }}>
            <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>سبب التسوية وتعديل الحساب (مطلوب للمحاسبة والمراجعة)</label>
            <textarea value={adjustmentReason} onChange={e => setAdjustmentReason(e.target.value)} placeholder="اكتب مبرر التسوية والخصم المالي، مثال: خروج مبكر للنزيل أو احتساب رسوم إضافية تالفة..." style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', minHeight: '65px', fontSize: '12px' }} />
          </div>
        </div>

        {/* تاريخ الدفعات المقبوضة بالتاريخ والقيمة */}
        <div className="card" style={{ padding: '18px', borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--card)' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 'bold', color: 'var(--gold-l)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            💵 سجل الدفعات المالية المحصلة من الساكن سابقاً
          </h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'right' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
                <th style={{ padding: '6px' }}>تاريخ الحركة</th>
                <th style={{ padding: '6px' }}>نوع الدفعة</th>
                <th style={{ padding: '6px' }}>طريقة الدفع</th>
                <th style={{ padding: '6px', textAlign: 'left' }}>المبلغ المودع</th>
              </tr>
            </thead>
            <tbody>
              {pastPaymentsList.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '12px', color: 'var(--muted)' }}>لا توجد دفعات مالية مسجلة بعد لهذا الحجز.</td>
                </tr>
              ) : (
                pastPaymentsList.map((p, idx) => (
                  <tr key={p.id || idx} style={{ borderBottom: '1px solid var(--border)', opacity: 0.9 }}>
                    <td style={{ padding: '6px' }}>{p.payment_date || p.created_at?.slice(0, 10) || today()}</td>
                    <td style={{ padding: '6px' }}>
                      <span className="chip" style={{ fontSize: '10px', background: p.payment_type === 'insurance' ? 'var(--blue-2)' : p.payment_type === 'down_payment' ? 'var(--gold-l)' : 'var(--green)', color: '#fff' }}>
                        {{ down_payment: 'عربون حجز', insurance: 'أمانة تأمين', rent: 'إيجار سكن', settlement: 'تسوية سداد', refund: 'مسترد للعميل' }[p.payment_type] || p.payment_type}
                      </span>
                    </td>
                    <td style={{ padding: '6px' }}>{{ cash: 'نقدي', card: 'شبكة مدى', bank_transfer: 'تحويل بنكي' }[p.method] || p.method}</td>
                    <td style={{ padding: '6px', textAlign: 'left', fontWeight: 'bold', color: 'var(--green)' }}>{SAR(p.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ padding: '6px', textAlign: 'right', color: 'var(--muted)' }}>العربون والدفعات الإيجارية (تُخصم من الفاتورة):</td>
                <td style={{ padding: '6px', textAlign: 'left', fontWeight: 'bold', color: 'var(--green)' }}>{SAR(paidSoFar)}</td>
              </tr>
              <tr>
                <td colSpan={3} style={{ padding: '6px', textAlign: 'right', color: 'var(--muted)' }}>أمانة التأمين المستلمة (تُسوّى على حدة):</td>
                <td style={{ padding: '6px', textAlign: 'left', fontWeight: 'bold', color: 'var(--blue-2)' }}>{SAR(initialInsurance)}</td>
              </tr>
              {paySummary.refunds > 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: '6px', textAlign: 'right', color: 'var(--muted)' }}>مبالغ سبق ردّها للعميل:</td>
                  <td style={{ padding: '6px', textAlign: 'left', fontWeight: 'bold', color: '#dc2626' }}>- {SAR(paySummary.refunds)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={3} style={{ padding: '8px', fontWeight: 'bold', textAlign: 'right' }}>إجمالي المقبوضات والضمانات المستلمة سابقاً:</td>
                <td style={{ padding: '8px', textAlign: 'left', fontWeight: '900', color: 'var(--green)', fontSize: '12px', borderTop: '2px solid var(--border)' }}>{SAR(paySummary.totalReceived)}</td>
              </tr>
            </tfoot>

          </table>
        </div>
      </div>

      {/* العمود الأيسر: كشف الحساب التلقائي والتسوية النهائية والترحيل */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* شجرة الحسابات المصغرة لتفاصيل الساكن والوحدة (Ledger) */}
        <div className="card" style={{ padding: '20px', borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--card)' }}>
          <h4 style={{ margin: '0 0 15px', fontSize: '14px', fontWeight: 'bold', color: 'var(--gold-l)' }}>📊 كشف الحساب وشجرة محاسبة الساكن والوحدة</h4>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
              <span>إيجار السكن الفعلي ({daysCount} ليلة):</span>
              <span style={{ fontWeight: 'bold' }}>{SAR(calculatedRent)}</span>
            </div>
            {totalDiscounts > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px', color: 'var(--green)' }}>
                <span>الخصومات والتسويات الدائنة:</span>
                <span style={{ fontWeight: 'bold' }}>- {SAR(totalDiscounts)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px', color: 'var(--blue-2)' }}>
              <span>أمانة التأمين المستلمة (تُسوّى منفصلة):</span>
              <span style={{ fontWeight: 'bold' }}>{SAR(initialInsurance)}</span>
            </div>

            {retainedInsurance > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px', color: '#ec4899' }}>
                <span>استقطاع التلفيات من التأمين (إيراد):</span>
                <span style={{ fontWeight: 'bold' }}>+ {SAR(retainedInsurance)}</span>
              </div>
            )}
            {extraFees > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px', color: '#ec4899' }}>
                <span>رسوم خدمات وضيافة إضافية:</span>
                <span style={{ fontWeight: 'bold' }}>+ {SAR(extraFees)}</span>
              </div>
            )}
            {latePenalty > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px', color: '#dc2626' }}>
                <span>غرامات تأخير ورسوم خروج متأخر:</span>
                <span style={{ fontWeight: 'bold' }}>+ {SAR(latePenalty)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px', color: 'var(--green)' }}>
              <span>العربون والدفعات الإيجارية المسددة سابقاً:</span>
              <span style={{ fontWeight: 'bold' }}>- {SAR(paidSoFar)}</span>
            </div>
            {refundedInsurance > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '6px', color: 'var(--blue-2)' }}>
                <span>مبلغ التأمين المُعاد للعميل عند الخروج:</span>
                <span style={{ fontWeight: 'bold' }}>{SAR(refundedInsurance)}</span>
              </div>
            )}


            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '11px', color: 'var(--muted)' }}>
              <span>المجموع الفرعي (شامل السكن والخدمات):</span>
              <span>{SAR(subtotalBeforeVat)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '10px', fontSize: '11px', color: 'var(--muted)' }}>
              <span>ضريبة القيمة المضافة المحتسبة (15%):</span>
              <span>{SAR(vatAmount)}</span>
            </div>
          </div>

          {/* المربع المحاسبي المحتسب ذو الألوان الصارخة للتوجيه المحاسبي */}
          <div style={{
            background: netDue > 0 ? '#450a0a' : netDue < 0 ? '#064e3b' : 'var(--soft)',
            border: netDue > 0 ? '1px solid #7f1d1d' : netDue < 0 ? '1px solid #065f46' : '1px solid var(--border)',
            padding: '16px', borderRadius: '10px', textAlign: 'center', margin: '15px 0'
          }}>
            <div style={{ fontSize: '13px', color: netDue !== 0 ? '#ffffff' : 'var(--muted)' }}>🎯 الرصيد والمستحق النهائي للتسوية</div>
            <div style={{ fontSize: '30px', fontWeight: '900', margin: '8px 0', color: netDue !== 0 ? '#ffffff' : 'var(--fg)' }}>
              {SAR(Math.abs(netDue))}
            </div>
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: netDue !== 0 ? '#ffffff' : 'var(--muted)' }}>
              {netDue > 0 ? '🔴 تنبيه هام للموظف: يجب تحصيل هذا المبلغ المستحق من الساكن' : netDue < 0 ? '🟢 رصيد دائن مستحق مسترد للعميل' : '🤝 الحساب متوازن ومصفى بالكامل'}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>طريقة دفع تصفية المغادرة</label>
              <select value={payMethod} onChange={e => setPayMethod(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)' }}>
                <option value="cash">💵 نقدي (الصندوق)</option>
                <option value="card">💳 شبكة / مدى (البنك)</option>
                <option value="bank_transfer">🏛️ تحويل بنكي (البنك)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>حالة الوحدة الايجارية بعد الخروج والرحيل</label>
              <select value={nextUnitStatus} onChange={e => setNextUnitStatus(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)' }}>
                <option value="cleaning">🧹 قيد التنظيف والتعقيم (أصفر)</option>
                <option value="available">✨ متاح فوراً للتأجير (أخضر)</option>
                <option value="maintenance">🔧 صيانة وتجهيز فني (أزرق غامق)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>نوع الفاتورة القانونية المصدرة</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                {[
                  ['simplified', '🧾 فاتورة مبسطة B2C'],
                  ['corporate', '🏢 فاتورة شركات B2B'],
                  ['standard', '📄 سند تصفية عام']
                ].map(([t, l]) => (
                  <button key={t} type="button" onClick={() => setInvoiceType(t)} style={{
                    flex: 1, padding: '8px 4px', fontSize: '10px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer',
                    border: invoiceType === t ? '2px solid var(--gold-l)' : '1px solid var(--border)',
                    background: invoiceType === t ? 'var(--soft)' : 'transparent',
                    color: invoiceType === t ? 'var(--gold-l)' : 'var(--muted)',
                  }}>{l}</button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <button
          className="btn btn-green"
          onClick={handleSettleAndHandover}
          disabled={busy}
          style={{
            padding: '16px', fontWeight: 'bold', fontSize: '14px', borderRadius: '12px',
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: '#fff',
            boxShadow: '0 4px 15px rgba(16,185,129,0.3)', width: '100%', border: 'none', cursor: 'pointer'
          }}
        >
          {busy ? '🔄 جاري معالجة القيود وإقفال الغرفة...' : '🔐 اعتماد تصفية الحساب وإغلاق السكن فورياً'}
        </button>

        <ReconciliationPanel
          reconciliation={reconciliation}
          expectedLines={expectedLines}
          postedLines={postedLines}
          postedEntry={postedEntry}
          loadingPosted={loadingPosted}
          reconError={reconError}
          missingAccounts={missingAccounts}
          onRefresh={loadPostedEntry}
          onExportPdf={onExportPdf}
          onExportExcel={onExportExcel}
        />
      </div>


    </div>

    <div style={{ border: '2px solid var(--border)', borderRadius: '16px', padding: '4px', background: '#f8fafc', marginTop: '10px' }}>
      <div style={{ padding: '12px 16px', background: 'var(--card)', borderBottom: '1px solid var(--border)', borderTopLeftRadius: '12px', borderTopRightRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <span style={{ fontSize: '13px', color: 'var(--fg)', fontWeight: 'bold', display: 'block' }}>👁️ معاينة حية وتصميم الفاتورة النشطة قبل الاعتماد (الفواتير الثلاثية)</span>
          <span style={{ fontSize: '11px', color: 'var(--muted)' }}>تتطابق تماماً مع المستند الورقي المطبوع وتتحدث فورياً أثناء تعديل البيانات.</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-green btn-sm"
            onClick={printPreviewDraft}
            style={{ fontSize: '12px', padding: '6px 14px', background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)', border: 'none', color: '#fff', fontWeight: 'bold', borderRadius: '8px', cursor: 'pointer' }}
          >
            🖨️ طباعة مسودة الفاتورة
          </button>
        </div>
      </div>
      <div style={{ background: '#ffffff', padding: '30px', borderRadius: '12px', overflowX: 'auto' }}>
        <SettlementPrintArea
          doneInvoice={livePreviewInvoice}
          initialDownPayment={initialDownPayment}
          paidSoFar={paidSoFar}
          companyLogo={company?.logo || ''}
        />
      </div>
    </div>

  </div>
  )
}

function SettlementPrintArea({ doneInvoice, initialDownPayment, paidSoFar, companyLogo }) {
  const isCorporate = doneInvoice.invoiceType === 'corporate'
  const isSimplified = doneInvoice.invoiceType === 'simplified'
  const isStandard = doneInvoice.invoiceType === 'standard'

  // Determine title
  const title = isSimplified
    ? 'فاتورة ضريبية مبسطة (B2C)'
    : isCorporate
    ? 'فاتورة ضريبية (B2B)'
    : 'سند تصفية حساب ومغادرة عام'

  const titleEn = isSimplified
    ? 'Simplified Tax Invoice (B2C)'
    : isCorporate
    ? 'Tax Invoice (B2B)'
    : 'General Settlement & Check-out Voucher'

  const totalDiscounts = doneInvoice.totalDiscounts || 0

  return (
    <div className="lux-inv" style={{ fontFamily: 'Cairo, Tajawal, sans-serif', direction: 'rtl', background: '#ffffff', color: '#000000', padding: '0px' }}>
      {/* Luxury Header */}
      <div className="lux-inv-head">
        <div className="lux-inv-brand">
          {companyLogo ? (
            <img src={companyLogo} alt="Logo" />
          ) : (
            <div className="lux-inv-logo-fallback">🏨</div>
          )}
          <div>
            <h2>{doneInvoice.sellerName}</h2>
            <div className="lux-inv-meta">
              <span>📍 {doneInvoice.sellerAddress}</span>
              <br />
              <span>📋 الرقم الضريبي للمنشأة: <b dir="ltr">{doneInvoice.sellerVat}</b></span>
            </div>
          </div>
        </div>
        <div className="lux-inv-title">
          <div className="lux-inv-title-ar">{title}</div>
          <div className="lux-inv-title-en">{titleEn}</div>
          <div className="lux-inv-no">رقم المستند: {doneInvoice.invoiceNo}</div>
        </div>
      </div>

      {/* Guest & Entity Information Card */}
      <div className="lux-inv-info">
        <div>
          <span>اسم العميل / المستأجر</span>
          <b>{doneInvoice.tenantName}</b>
        </div>
        <div>
          <span>الهوية الوطنية / الإقامة</span>
          <b>{doneInvoice.tenantIdNum || '—'}</b>
        </div>
        <div>
          <span>رقم الجوال</span>
          <b dir="ltr">{doneInvoice.tenantPhone || '—'}</b>
        </div>
        <div>
          <span>الجنسية</span>
          <b>{doneInvoice.tenantNationality || '—'}</b>
        </div>
        {isCorporate && (
          <>
            <div>
              <span>اسم الشركة / المؤسسة</span>
              <b>{doneInvoice.companyName || '—'}</b>
            </div>
            <div>
              <span>الرقم الضريبي للشركة (VAT)</span>
              <b>{doneInvoice.companyTaxNo || '—'}</b>
            </div>
          </>
        )}
      </div>

      {/* Period Details */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: '1px solid #E2E9F2', padding: '12px 20px', background: '#fafbfc', fontSize: '12.5px', textAlign: 'center' }}>
        <div>
          <span style={{ display: 'block', color: '#5B6B7C', fontSize: '11px', fontWeight: 'bold', marginBottom: '3px' }}>رقم الوحدة السكنية</span>
          <b style={{ color: '#1A3A63' }}>{doneInvoice.unitNumber} ({doneInvoice.unitCategory})</b>
        </div>
        <div>
          <span style={{ display: 'block', color: '#5B6B7C', fontSize: '11px', fontWeight: 'bold', marginBottom: '3px' }}>تاريخ الدخول</span>
          <b style={{ color: '#1A3A63' }}>{doneInvoice.checkIn}</b>
        </div>
        <div>
          <span style={{ display: 'block', color: '#5B6B7C', fontSize: '11px', fontWeight: 'bold', marginBottom: '3px' }}>تاريخ الخروج الفعلي</span>
          <b style={{ color: '#1A3A63' }}>{doneInvoice.checkOut}</b>
        </div>
        <div>
          <span style={{ display: 'block', color: '#5B6B7C', fontSize: '11px', fontWeight: 'bold', marginBottom: '3px' }}>المدة الإيجارية الفعالة</span>
          <b style={{ color: '#1A3A63' }}>{doneInvoice.daysCount} ليلة × {SAR(doneInvoice.dailyRate)}</b>
        </div>
      </div>

      {/* Detailed Ledger Table */}
      <div style={{ padding: '20px' }}>
        <table className="lux-inv-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: '50%', textAlign: 'right' }}>بيان البند والوصف بالتفصيل</th>
              <th style={{ width: '16%', textAlign: 'center' }}>مدين (+)</th>
              <th style={{ width: '16%', textAlign: 'center' }}>دائن (-)</th>
              <th style={{ width: '18%', textAlign: 'left' }}>الإجمالي الصافي</th>
            </tr>
          </thead>
          <tbody>
            {/* 1. الإقامة */}
            <tr>
              <td style={{ fontWeight: 'bold', color: '#1e293b' }}>
                قيمة إيجار السكن الفعلي للوحدة {doneInvoice.unitNumber} ({doneInvoice.daysCount} ليلة)
              </td>
              <td style={{ textAlign: 'center', color: '#b91c1c', fontWeight: 'bold' }}>{SAR(doneInvoice.calculatedRent)}</td>
              <td style={{ textAlign: 'center', color: '#64748b' }}>—</td>
              <td style={{ textAlign: 'left', fontWeight: 'bold' }}>{SAR(doneInvoice.calculatedRent)}</td>
            </tr>

            {/* 2. الخصومات المعتمدة */}
            {totalDiscounts > 0 && (
              <tr style={{ background: '#fef2f2' }}>
                <td style={{ color: '#15803d' }}>
                  إجمالي الخصومات والتخفيضات الممنوحة للعميل
                </td>
                <td style={{ textAlign: 'center', color: '#64748b' }}>—</td>
                <td style={{ textAlign: 'center', color: '#15803d', fontWeight: 'bold' }}>{SAR(totalDiscounts)}</td>
                <td style={{ textAlign: 'left', color: '#15803d', fontWeight: 'bold' }}>- {SAR(totalDiscounts)}</td>
              </tr>
            )}

            {/* 3. العربون والدفعة المسبقة عند الدخول */}
            {initialDownPayment > 0 && (
              <tr>
                <td style={{ color: '#1e293b' }}>عربون الحجز والدفعة المقدمة المستلمة سابقاً</td>
                <td style={{ textAlign: 'center', color: '#64748b' }}>—</td>
                <td style={{ textAlign: 'center', color: '#15803d', fontWeight: 'bold' }}>{SAR(initialDownPayment)}</td>
                <td style={{ textAlign: 'left', color: '#475569' }}>- {SAR(initialDownPayment)}</td>
              </tr>
            )}

            {/* 4. التأمين المدفوع وتفصيل تسويته */}
            {doneInvoice.initialInsurance > 0 && (
              <>
                <tr>
                  <td style={{ color: '#475569' }}>أمانة مبلغ التأمين المستلم عند حجز الدخول</td>
                  <td style={{ textAlign: 'center', color: '#64748b' }}>—</td>
                  <td style={{ textAlign: 'center', color: '#15803d', fontWeight: 'bold' }}>{SAR(doneInvoice.initialInsurance)}</td>
                  <td style={{ textAlign: 'left', color: '#475569' }}>- {SAR(doneInvoice.initialInsurance)}</td>
                </tr>
                {doneInvoice.retainedInsurance > 0 && (
                  <tr style={{ background: '#fffbeb' }}>
                    <td style={{ color: '#b45309', fontWeight: 'bold' }}>
                      ⚙️ استقطاع تعويض عن تلفيات بالوحدة (مخصوم من التأمين)
                      {doneInvoice.insuranceDeductionReason ? <div style={{ fontSize: '11px', marginTop: '2px', color: '#92400e' }}>السبب: {doneInvoice.insuranceDeductionReason}</div> : null}
                    </td>
                    <td style={{ textAlign: 'center', color: '#b45309', fontWeight: 'bold' }}>{SAR(doneInvoice.retainedInsurance)}</td>
                    <td style={{ textAlign: 'center', color: '#64748b' }}>—</td>
                    <td style={{ textAlign: 'left', color: '#b45309', fontWeight: 'bold' }}>+ {SAR(doneInvoice.retainedInsurance)}</td>
                  </tr>
                )}
                {doneInvoice.refundedInsurance > 0 && (
                  <tr style={{ background: '#f0fdf4' }}>
                    <td style={{ color: '#15803d' }}>
                      💸 مرتجع التأمين المسترد المتبقي والمصروف نقداً للساكن
                    </td>
                    <td style={{ textAlign: 'center', color: '#64748b' }}>—</td>
                    <td style={{ textAlign: 'center', color: '#15803d', fontWeight: 'bold' }}>{SAR(doneInvoice.refundedInsurance)}</td>
                    <td style={{ textAlign: 'left', color: '#15803d', fontWeight: 'bold' }}>- {SAR(doneInvoice.refundedInsurance)}</td>
                  </tr>
                )}
              </>
            )}

            {/* 5. الخدمات والرسوم الإضافية */}
            {doneInvoice.extraFees > 0 && (
              <tr>
                <td style={{ color: '#1e293b' }}>
                  ⚙️ {doneInvoice.extraFeesReason || 'رسوم خدمات وضيافة إضافية أثناء المغادرة'}
                </td>
                <td style={{ textAlign: 'center', color: '#b91c1c', fontWeight: 'bold' }}>{SAR(doneInvoice.extraFees)}</td>
                <td style={{ textAlign: 'center', color: '#64748b' }}>—</td>
                <td style={{ textAlign: 'left', fontWeight: 'bold' }}>+ {SAR(doneInvoice.extraFees)}</td>
              </tr>
            )}
            {doneInvoice.latePenalty > 0 && (
              <tr>
                <td style={{ color: '#1e293b' }}>
                  ⏳ غرامات ورسوم تأخير في تسليم الوحدة
                </td>
                <td style={{ textAlign: 'center', color: '#b91c1c', fontWeight: 'bold' }}>{SAR(doneInvoice.latePenalty)}</td>
                <td style={{ textAlign: 'center', color: '#64748b' }}>—</td>
                <td style={{ textAlign: 'left', fontWeight: 'bold' }}>+ {SAR(doneInvoice.latePenalty)}</td>
              </tr>
            )}

            {/* 6. دفعات مالية أخرى */}
            {(paidSoFar - initialDownPayment) > 0 && (
              <tr>
                <td style={{ color: '#475569' }}>دفعات إيجارية ومستندات قبض أخرى مسددة ومرحلة مسبقاً</td>
                <td style={{ textAlign: 'center', color: '#64748b' }}>—</td>
                <td style={{ textAlign: 'center', color: '#15803d', fontWeight: 'bold' }}>{SAR((paidSoFar - initialDownPayment))}</td>
                <td style={{ textAlign: 'left', color: '#475569' }}>- {SAR((paidSoFar - initialDownPayment))}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Summary Footer & QR */}
      <div className="lux-inv-foot">
        <div className="lux-inv-qr">
          <QRCodeSVG value={doneInvoice.zatcaQrData} size={110} />
          <div>مسح للتحقق الرقمي من الفاتورة لدى هيئة الزكاة والضريبة والجمارك (فاتورة)</div>
        </div>

        <div className="lux-inv-totals">
          <div>
            <span>المجموع الفرعي (قبل الضريبة):</span>
            <b>{SAR(doneInvoice.subtotalBeforeVat)}</b>
          </div>
          <div>
            <span>ضريبة القيمة المضافة (15%):</span>
            <b>{SAR(doneInvoice.vatAmount)}</b>
          </div>
          <div>
            <span>الإجمالي الإيجاري والخدمي (شامل الضريبة):</span>
            <b>{SAR(doneInvoice.finalTenantBill)}</b>
          </div>
          <div>
            <span>إجمالي المقبوضات المسبقة بالكامل:</span>
            <b>{SAR(doneInvoice.paidSoFar)}</b>
          </div>

          <div className="grand">
            <span>
              {doneInvoice.netDue > 0
                ? 'المبلغ المستحق المطلوب سداده من المستأجر:'
                : doneInvoice.netDue < 0
                ? 'المبلغ الصافي المسترد والمسترجع للمستأجر:'
                : 'الرصيد المالي مصفى بالكامل:'}
            </span>
            <span>{SAR(Math.abs(doneInvoice.netDue))}</span>
          </div>
          
          <div style={{ fontSize: '11px', color: '#5B6B7C', textAlign: 'left', marginTop: '4px' }}>
            طريقة الدفع للتسوية: {doneInvoice.payMethod === 'cash' ? 'نقدي (الصندوق)' : doneInvoice.payMethod === 'card' ? 'شبكة / مدى' : 'تحويل بنكي الكتروني'}
          </div>
        </div>
      </div>

      {/* Reception signatures / stamp area */}
      <div className="lux-inv-terms">
        <p style={{ margin: '0 0 16px', fontSize: '11px', color: '#64748b' }}>
          نشهد نحن الطرفين بصحة كامل الحسابات والتسويات المذكورة أعلاه ومطابقتها التامة للواقع واستلام كافة المبالغ والمرتجعات المستحقة قانونياً.
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px', padding: '0 20px' }}>
          <span style={{ fontSize: '12px', fontWeight: 'bold' }}>توقيع موظف الاستقبال: _________________</span>
          <span style={{ fontSize: '12px', fontWeight: 'bold' }}>توقيع الساكن / المستأجر: _________________</span>
        </div>
      </div>
    </div>
  )
}

/* ============ لوحة التحقق والمطابقة المحاسبية للتصفية ============ */
function ReconciliationPanel({ reconciliation, expectedLines = [], postedLines = [], postedEntry, loadingPosted, onRefresh, onExportPdf, onExportExcel, reconError = '', missingAccounts = [] }) {
  const rec = reconciliation || { rows: [], mismatches: [], ok: false, hasPostedEntry: false }
  const money = (v) => SAR(Number(v) || 0)
  const statusColor = reconError ? '#b91c1c' : rec.ok ? '#15803d' : rec.hasPostedEntry ? '#b91c1c' : '#b45309'
  const statusText = reconError
    ? `⛔ تعذّر قراءة القيد المُرحَّل: ${reconError}`
    : rec.ok
      ? '✅ مطابقة تامة: القيود المحققة تطابق التسويات المتوقعة والقيد متوازن'
      : rec.hasPostedEntry
        ? `⚠️ يوجد ${rec.mismatches.length} فرق بين التسويات المتوقعة والقيود المحققة`
        : 'ℹ️ لم يُرحَّل قيد التصفية بعد — سيظهر التطابق فور اعتماد التصفية'

  const alerts = []
  if (!rec.expectedBalanced && expectedLines.length > 0)
    alerts.push(`قيد التصفية المتوقع غير متوازن (مدين ${money(rec.expectedDebit)} مقابل دائن ${money(rec.expectedCredit)}) — الترحيل سيُمنع تلقائياً.`)
  if (rec.hasPostedEntry && !rec.postedBalanced)
    alerts.push(`القيد المُرحَّل في اليومية غير متوازن (مدين ${money(rec.postedDebit)} مقابل دائن ${money(rec.postedCredit)}).`)
  if (missingAccounts.length > 0)
    alerts.push(`حسابات مطلوبة وغير موجودة في شجرة الحسابات وسيتم إنشاؤها تلقائياً عند الترحيل: ${missingAccounts.map(a => `${a.code} ${a.name}`).join(' · ')}`)
  for (const m of rec.mismatches || [])
    alerts.push(`الحساب ${m.code} ${m.accountName}: فرق مدين ${money(m.debitDiff)} وفرق دائن ${money(m.creditDiff)} (أقصى فرق ${money(m.netDiff)}).`)

  return (
    <div style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--card)', overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 'bold', fontSize: 13 }}>🧮 لوحة التحقق والمطابقة — التسويات المتوقعة مقابل القيود المحققة</div>
          <div style={{ fontSize: 11, color: statusColor, fontWeight: 'bold', marginTop: 3 }}>{statusText}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            رقم القيد: <b>{postedEntry?.entry_number || 'غير مُرحَّل'}</b>
            {' · '}مدين متوقع {money(rec.expectedDebit)} / دائن متوقع {money(rec.expectedCredit)}
            {' · '}مدين مُرحَّل {money(rec.postedDebit)} / دائن مُرحَّل {money(rec.postedCredit)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm" onClick={onRefresh} disabled={loadingPosted} style={{ fontSize: 11, padding: '6px 12px', borderRadius: 8 }}>
            {loadingPosted ? '⏳ تحديث...' : '🔄 تحديث المطابقة'}
          </button>
          <button type="button" className="btn btn-sm" onClick={onExportPdf} style={{ fontSize: 11, padding: '6px 12px', borderRadius: 8, background: '#0f172a', color: '#fff', border: 'none' }}>📄 تصدير PDF</button>
          <button type="button" className="btn btn-sm" onClick={onExportExcel} style={{ fontSize: 11, padding: '6px 12px', borderRadius: 8, background: '#15803d', color: '#fff', border: 'none' }}>📊 تصدير Excel</button>
        </div>
      </div>

      {alerts.length > 0 && (
        <ul style={{ margin: 0, padding: '10px 26px 10px 14px', background: 'rgba(239,68,68,0.06)', borderBottom: '1px solid var(--border)', fontSize: 11, color: '#b91c1c', lineHeight: 1.8 }}>
          {alerts.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: 'var(--soft)' }}>
              {['رمز الحساب', 'اسم الحساب', 'مدين متوقع', 'مدين مُرحَّل', 'دائن متوقع', 'دائن مُرحَّل', 'الحالة'].map(h => (
                <th key={h} style={{ padding: '7px 8px', textAlign: 'right', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rec.rows.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 14, textAlign: 'center', color: 'var(--muted)' }}>لا توجد حركات مالية تتطلب قيداً محاسبياً في هذه التصفية</td></tr>
            )}
            {rec.rows.map(r => (
              <tr key={r.code} style={{ background: r.matched ? 'transparent' : 'rgba(239,68,68,0.08)' }}>
                <td style={{ padding: '6px 8px', fontWeight: 'bold' }}>{r.code}</td>
                <td style={{ padding: '6px 8px' }}>{r.accountName}</td>
                <td style={{ padding: '6px 8px' }}>{money(r.expectedDebit)}</td>
                <td style={{ padding: '6px 8px' }}>{money(r.postedDebit)}</td>
                <td style={{ padding: '6px 8px' }}>{money(r.expectedCredit)}</td>
                <td style={{ padding: '6px 8px' }}>{money(r.postedCredit)}</td>
                <td style={{ padding: '6px 8px', fontWeight: 'bold', color: r.matched ? '#15803d' : '#b91c1c' }}>{r.matched ? 'مطابق' : `فرق ${money(r.netDiff)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
