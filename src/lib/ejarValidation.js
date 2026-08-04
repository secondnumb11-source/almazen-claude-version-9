/*
  ejarValidation.js — قواعد تحقق منصة إيجار (تُستخدم في المعاينة والحافّة)
  ------------------------------------------------------------------------
  كل دالة تُعيد { ok: boolean, reason?: string } لسهولة عرضها في جدول المعاينة.
*/

const digits = (v) => (v == null ? '' : String(v).replace(/\D+/g, ''))

export function checkVAT(vat) {
  const d = digits(vat)
  if (!d) return { ok: false, reason: 'الرقم الضريبي غير مُدخل' }
  if (d.length !== 15) return { ok: false, reason: 'يجب أن يتكوّن من 15 رقماً' }
  if (!(d.startsWith('3') && d.endsWith('3'))) return { ok: false, reason: 'يجب أن يبدأ بـ 3 وينتهي بـ 3' }
  return { ok: true }
}

export function checkCR(cr) {
  const d = digits(cr)
  if (!d) return { ok: false, reason: 'رقم السجل التجاري غير مُدخل' }
  if (d.length !== 10) return { ok: false, reason: 'يجب أن يتكوّن من 10 أرقام' }
  return { ok: true }
}

export function checkSaudiId(id) {
  const d = digits(id)
  if (!d) return { ok: false, reason: 'رقم الهوية غير مُدخل' }
  if (d.length !== 10) return { ok: false, reason: 'يجب أن يتكوّن من 10 أرقام' }
  if (!(d.startsWith('1') || d.startsWith('2'))) return { ok: false, reason: 'الهوية السعودية تبدأ بـ 1 والإقامة بـ 2' }
  return { ok: true }
}

export function checkSaudiPhone(phone) {
  const d = digits(phone)
  if (!d) return { ok: false, reason: 'الجوال غير مُدخل' }
  // نقبل: 05XXXXXXXX أو 9665XXXXXXXX أو 5XXXXXXXX
  const normalized = d.startsWith('966') ? d.slice(3) : d.startsWith('0') ? d.slice(1) : d
  if (normalized.length !== 9 || !normalized.startsWith('5'))
    return { ok: false, reason: 'الصيغة المطلوبة: +9665XXXXXXXX' }
  return { ok: true }
}

export function checkDeed(deed) {
  const s = (deed || '').toString().trim()
  if (!s) return { ok: false, reason: 'رقم الصك العقاري مطلوب' }
  if (s.length < 4) return { ok: false, reason: 'رقم صك غير مقبول' }
  return { ok: true }
}

export function checkRequiredText(v, label) {
  if (!v || !String(v).trim()) return { ok: false, reason: `${label} مطلوب` }
  return { ok: true }
}

export function checkDates(start, end) {
  if (!start || !end) return { ok: false, reason: 'تاريخا البداية والنهاية مطلوبان' }
  const s = new Date(start), e = new Date(end)
  if (isNaN(s) || isNaN(e)) return { ok: false, reason: 'صيغة تاريخ غير صالحة' }
  if (e <= s) return { ok: false, reason: 'تاريخ النهاية يجب أن يكون بعد البداية' }
  return { ok: true, days: Math.round((e - s) / 86400000) }
}

export function checkAmount(v, label) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: `${label} يجب أن يكون رقماً موجباً` }
  return { ok: true }
}

export function checkDown(total, down) {
  const t = Number(total), d = Number(down || 0)
  if (d < 0) return { ok: false, reason: 'الدفعة المقدمة لا يمكن أن تكون سالبة' }
  if (t > 0 && d > t) return { ok: false, reason: 'الدفعة المقدمة أكبر من إجمالي العقد' }
  return { ok: true }
}

/*
  buildEjarPreviewRows — يبني خريطة الحقول التي ستُرسل إلى إيجار
  مع نتيجة التحقق لكل صف. تُستخدم في مكوّن EjarContractPreview وفي الحافّة.
*/
export function buildEjarPreviewRows({ company, unit, customer, booking }) {
  const dates = checkDates(booking?.check_in_date, booking?.check_out_date)
  const total = checkAmount(booking?.total_amount, 'قيمة العقد')
  const down = checkDown(booking?.total_amount, booking?.down_payment)
  const brokerOrCR = company?.ejar_broker_license
    ? checkRequiredText(company.ejar_broker_license, 'رقم رخصة الوساطة')
    : checkCR(company?.cr_number)

  return [
    // بيانات المؤجر
    { section: 'المؤجر', label: 'اسم المنشأة', value: company?.name, check: checkRequiredText(company?.name, 'اسم المنشأة') },
    { section: 'المؤجر', label: 'السجل التجاري', value: company?.cr_number, check: company?.ejar_broker_license ? { ok: true } : checkCR(company?.cr_number) },
    { section: 'المؤجر', label: 'الرقم الضريبي VAT', value: company?.vat_number,
      check: company?.vat_number ? checkVAT(company?.vat_number) : { ok: true, reason: 'اختياري إن لم تكن مسجلاً في ZATCA' } },
    { section: 'المؤجر', label: 'رخصة الوساطة العقارية (فال)', value: company?.ejar_broker_license,
      check: brokerOrCR },
    // العقار
    { section: 'العقار', label: 'رقم الوحدة', value: unit?.unit_number, check: checkRequiredText(unit?.unit_number, 'رقم الوحدة') },
    { section: 'العقار', label: 'رقم الصك العقاري', value: unit?.deed_number, check: checkDeed(unit?.deed_number) },
    { section: 'العقار', label: 'تصنيف الوحدة', value: unit?.category, check: checkRequiredText(unit?.category, 'التصنيف') },
    // المستأجر
    { section: 'المستأجر', label: 'الاسم الكامل', value: customer?.full_name, check: checkRequiredText(customer?.full_name, 'اسم المستأجر') },
    { section: 'المستأجر', label: 'نوع الهوية', value: customer?.id_type, check: checkRequiredText(customer?.id_type, 'نوع الهوية') },
    { section: 'المستأجر', label: 'رقم الهوية / الإقامة', value: customer?.id_number, check: checkSaudiId(customer?.id_number) },
    { section: 'المستأجر', label: 'رقم الجوال', value: customer?.phone, check: checkSaudiPhone(customer?.phone) },
    // العقد
    { section: 'العقد', label: 'تاريخ البداية', value: booking?.check_in_date, check: dates.ok ? { ok: true } : dates },
    { section: 'العقد', label: 'تاريخ النهاية', value: booking?.check_out_date, check: dates },
    { section: 'العقد', label: 'مدة العقد (أيام)', value: dates.ok ? dates.days : '—', check: dates.ok ? { ok: true } : dates },
    { section: 'العقد', label: 'القيمة الإجمالية', value: booking?.total_amount, check: total },
    { section: 'العقد', label: 'الدفعة المقدمة', value: booking?.down_payment, check: down },
    { section: 'العقد', label: 'مبلغ التأمين', value: booking?.insurance_amount, check: { ok: true } },
  ]
}

export function isPreviewValid(rows) {
  return rows.every(r => r.check.ok)
}
