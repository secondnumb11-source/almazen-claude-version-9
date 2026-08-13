export const SAR = (n) => (Number(n) || 0).toLocaleString('ar-SA', { maximumFractionDigits: 2 }) + ' ر.س'
export const num = (n) => Number(n) || 0
export const today = () => new Date().toISOString().slice(0, 10)

/*
  تصنيفات الوحدات. المفاتيح هنا قيمٌ في نوع ENUM اسمه unit_category في
  قاعدة البيانات، لا نصوص حرة — فأي مفتاح لا يقابله label في النوع يُفشل
  الحفظ بـ 22P02. (كان furnished_room معروضاً هنا وغير موجود في النوع،
  فكان اختيار «غرفة مفروشة» يفشل؛ أُضيف إلى النوع مع التصنيفات الجديدة.)
*/
export const CATS = {
  apartment: 'شقة سكنية',
  furnished_unit: 'شقة مفروشة',
  furnished_room: 'غرفة مفروشة',
  hotel_room: 'غرفة فندقية',
  residential_villa: 'فيلا سكنية',
  furnished_villa: 'فيلا مفروشة',
  rest_house: 'استراحة',
  chalet: 'شاليه'
}
export const STATUS = {
  available:       { label: 'متاح',           cls: 'u-av' },
  reserved:        { label: 'محجوز محلياً',    cls: 'u-rs' },
  reserved_online: { label: 'حجز أونلاين',    cls: 'u-ro' },
  occupied:        { label: 'مسكونة',          cls: 'u-oc' },
  cleaning:        { label: 'قيد التنظيف',    cls: 'u-cl' },
  maintenance:     { label: 'الوحدة قيد الصيانة', cls: 'u-mn' }
}

// قائمة الأثاث الافتراضية عند اختيار "وحدة مفروشة"
export const DEFAULT_FURNITURE = [
  'سرير مفرد','سرير مزدوج','مرتبة','مخدات','بطانيات','شراشف',
  'مكيف سبليت','مروحة سقف','ثلاجة','فريزر','غسالة','مايكرويف',
  'فرن كهربائي','موقد غاز','غلاية ماء','تلفاز','ريموت TV',
  'كنب','طاولة طعام','كراسي طعام','خزانة ملابس','كومودينو',
  'ستائر','سجاد','لمبات إنارة','سخان ماء','مكواة',
  'أدوات مطبخ (صحون/ملاعق)','أواني طبخ','مكنسة','دورة مياه — مرآة','دورة مياه — رشاش'
]

// توليد رابط مشاركة للوحدة
export const shareUrl = (slug) => `${window.location.origin}/u/${slug}`
export const waShareUrl = (slug, unitNumber) =>
  `https://wa.me/?text=${encodeURIComponent(`تفضّل بالاطلاع على مواصفات الوحدة رقم ${unitNumber}:\n${shareUrl(slug)}`)}`
export const PAY_METHODS = { cash: 'كاش', bank_transfer: 'تحويل بنكي', card: 'بطاقة بنكية' }
export const ROLES = { owner: 'المدير', manager: 'مدير فرعي', accountant: 'محاسب', employee: 'موظف' }

// توليد بيانات QR للفاتورة وفق ZATCA (TLV → Base64)
export function zatcaQR({ seller, vat, isoDate, total, vatAmount }) {
  const enc = new TextEncoder()
  const tlv = (tag, value) => {
    const v = enc.encode(String(value))
    return [tag, v.length, ...v]
  }
  const bytes = new Uint8Array([
    ...tlv(1, seller), ...tlv(2, vat), ...tlv(3, isoDate),
    ...tlv(4, Number(total).toFixed(2)), ...tlv(5, Number(vatAmount).toFixed(2))
  ])
  let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b))
  return btoa(bin)
}

// رفع ملف إلى Storage وإرجاع مرجع ثابت. المستندات الخاصة تُوقّع عند العرض.
export async function uploadFile(supabase, bucket, companyId, file) {
  if (!file) return null
  const path = `${companyId}/${Date.now()}_${file.name.replace(/[^\w.-]/g, '_')}`
  const { error } = await supabase.storage.from(bucket).upload(path, file)
  if (error) throw error
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

// تسجيل إجراء في سجل النشاط (audit_logs) — يُستخدم لمراقبة نشاط الموظفين
// العمليات الحساسة تُعلَّم sensitive=true ليتم إبرازها في لوحة المراقبة
export async function logActivity(supabase, profile, { action, entity, entity_id = null, summary = '', sensitive = false } = {}) {
  if (!profile?.company_id) return
  try {
    await supabase.from('audit_logs').insert({
      company_id: profile.company_id,
      user_id: profile.id,
      action,
      entity,
      entity_id,
      new_data: { summary, sensitive, actor: profile.full_name, role: profile.role, at: new Date().toISOString() }
    })
  } catch (_) { /* التسجيل لا يجب أن يُعطّل العملية الأساسية */ }
}

export function exportCSV(filename, rows) {
  if (!rows?.length) return
  const heads = Object.keys(rows[0])
  const csv = '\uFEFF' + [heads.join(','), ...rows.map(r =>
    heads.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = filename; a.click()
}

/*
  فتح مستند مخزَّن في Supabase Storage بأمان.
  المستندات (صور الهوية مثلاً) محفوظة في حاويات خاصة، فالرابط العام يعيد
  خطأ "Bucket not found" / "Object not found". هنا نستخرج اسم الحاوية والمسار
  من الرابط المحفوظ ونصدر رابطاً موقّعاً مؤقتاً قبل الفتح، مع محاولة الحاويات
  البديلة للمستندات القديمة، وأخيراً الرجوع للرابط الأصلي.
*/
const DOC_BUCKET_FALLBACKS = ['documents', 'almazen-id-documents']

export function parseStorageUrl(url) {
  if (!url || typeof url !== 'string') return null
  const m = url.match(/\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?([^/?]+)\/(.+?)(?:\?|$)/)
  if (!m) return null
  return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]) }
}

export async function getViewableDocUrl(supabase, url) {
  const parsed = parseStorageUrl(url)
  if (!parsed) return url
  const buckets = [parsed.bucket, ...DOC_BUCKET_FALLBACKS.filter(b => b !== parsed.bucket)]
  const failures = []
  for (const bucket of buckets) {
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(parsed.path, 3600)
      if (!error && data?.signedUrl) return data.signedUrl
      failures.push({ bucket, code: error?.statusCode || error?.code || null, message: error?.message || 'تعذّر توقيع الرابط' })
    } catch (error) {
      failures.push({ bucket, code: error?.code || null, message: error?.message || 'تعذّر توقيع الرابط' })
    }
  }
  const error = new Error(failures.some(f => /bucket.*not found/i.test(f.message))
    ? 'حاوية المستندات غير موجودة. تم تسجيل المشكلة لمراجعتها.'
    : failures.some(f => /object.*not found|not found/i.test(f.message))
      ? 'الملف غير موجود في الأرشيف أو تم نقله.'
      : 'تعذّرت معاينة المستند. تحقق من صلاحية الوصول ثم أعد المحاولة.')
  error.code = 'document_signing_failed'
  error.storageContext = { bucket: parsed.bucket, path: parsed.path, failures }
  throw error
}

/** يفتح المستند في تبويب جديد باستخدام رابط موقّع */
export async function openStoredDocument(supabase, url, { onError, context = {} } = {}) {
  if (!url) {
    const error = new Error('لا يوجد ملف محفوظ للمعاينة.')
    onError?.(error.message)
    return { ok: false, error }
  }
  const tab = window.open('', '_blank')
  try {
    const finalUrl = await getViewableDocUrl(supabase, url)
    if (tab) tab.location.href = finalUrl
    else window.open(finalUrl, '_blank', 'noreferrer')
    return { ok: true, url: finalUrl }
  } catch (error) {
    if (tab) tab.close()
    try {
      const { reportIssue } = await import('./systemMonitor')
      await reportIssue('storage', error, {
        step: 'create_signed_url',
        ...context,
        ...(error.storageContext || {}),
      }, { severity: 'error', code: error.code || 'document_preview_failed' })
    } catch { /* فشل التسجيل لا يعطّل رسالة المستخدم */ }
    onError?.(error.message)
    return { ok: false, error }
  }
}
