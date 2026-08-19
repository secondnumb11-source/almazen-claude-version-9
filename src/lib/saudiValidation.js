/*
  تحقّق محلي من الهوية والسجل التجاري والجوال — بلا أي طرف ثالث.

  حدود صريحة لما يمكن التحقق منه محلياً:

  • الهوية الوطنية والإقامة: عشرة أرقام تبدأ بـ 1 (مواطن) أو 2 (مقيم)،
    ولها بصمة تحقّق (متغيّر من لُوهن) تُحسب من الأرقام التسعة الأولى.
    هذه خوارزمية حسابية مغلقة لا تحتاج خدمة خارجية.

  • السجل التجاري: عشرة أرقام. لا توجد بصمة تحقّق منشورة علناً للسجل
    التجاري، فلا تُخترع هنا واحدة. التحقق يقتصر على الصيغة ورفض الأنماط
    الوهمية — وهذا يُقال صراحةً للمستخدم بدل الإيهام بتحقق أعمق.

  • الجوال: صيغة سعودية 9665XXXXXXXX بعد التطبيع.

  ملاحظة مقيسة لا مفترضة: البصمة وحدها تقبل «2222222222» — يجتازها
  حسابياً ويبدأ بـ 2 فلا يوقفه شرط الرقم الأول. لذلك رفض الأنماط الوهمية
  شرط مستقل لا تحسين تجميلي، وبدونه يمرّ رقم زائف صريح.
*/

/** أنماط لا يمكن أن تكون رقماً حقيقياً مهما كانت البصمة */
const isPlaceholder = (d) =>
  /^(\d)\1{9}$/.test(d) ||                       // رقم واحد مكرّر عشر مرات
  d === '1234567890' || d === '0123456789' ||    // تسلسل صريح
  d === '9876543210'

/** استخراج الأرقام العربية والهندية معاً */
export function toDigits(v) {
  if (v == null) return ''
  const ar = '٠١٢٣٤٥٦٧٨٩'
  return String(v)
    .replace(/[٠-٩]/g, ch => String(ar.indexOf(ch)))
    .replace(/\D+/g, '')
}

/**
 * بصمة التحقق للهوية الوطنية/الإقامة (متغيّر لُوهن المعتمد سعودياً):
 * تُضاعَف الأرقام في المواضع الفردية (1،3،5،7،9)، ويُطرح 9 من الناتج إن
 * تجاوز 9، ثم يُجمع الكل مع أرقام المواضع الزوجية. خانة التحقق هي
 * مكمّل المجموع إلى أقرب عشرة.
 */
function idChecksumOk(d) {
  let sum = 0
  for (let i = 0; i < 9; i++) {
    const n = Number(d[i])
    if (i % 2 === 0) { const x = n * 2; sum += x > 9 ? x - 9 : x }
    else sum += n
  }
  return ((10 - (sum % 10)) % 10) === Number(d[9])
}

/** تحقّق من الهوية الوطنية أو الإقامة */
export function validateSaudiId(value) {
  const d = toDigits(value)
  if (!d) return { ok: false, reason: 'أدخل رقم الهوية أو الإقامة.' }
  if (d.length !== 10) return { ok: false, reason: `رقم الهوية عشرة أرقام — أدخلتَ ${d.length}.` }
  if (d[0] !== '1' && d[0] !== '2')
    return { ok: false, reason: 'رقم الهوية الوطنية يبدأ بـ 1 والإقامة تبدأ بـ 2.' }
  if (isPlaceholder(d)) return { ok: false, reason: 'هذا رقم وهمي وليس رقم هوية حقيقياً.' }
  if (!idChecksumOk(d)) return { ok: false, reason: 'رقم الهوية غير صحيح — تأكد من الأرقام العشرة.' }
  return { ok: true, value: d, kind: d[0] === '1' ? 'national_id' : 'iqama' }
}

/**
 * تحقّق من السجل التجاري — صيغة فقط.
 * لا بصمة تحقّق منشورة علناً للسجل التجاري، فلا يُدّعى تحقق أعمق مما جرى.
 */
export function validateCR(value) {
  const d = toDigits(value)
  if (!d) return { ok: false, reason: 'أدخل رقم السجل التجاري.' }
  if (d.length !== 10) return { ok: false, reason: `رقم السجل التجاري عشرة أرقام — أدخلتَ ${d.length}.` }
  if (isPlaceholder(d)) return { ok: false, reason: 'هذا رقم وهمي وليس سجلاً تجارياً حقيقياً.' }
  return { ok: true, value: d, kind: 'cr' }
}

/** يطبّع الجوال السعودي إلى 9665XXXXXXXX */
export function normalizeSaudiPhone(value) {
  let d = toDigits(value)
  if (d.startsWith('00966')) d = d.slice(2)
  else if (d.startsWith('966')) { /* كما هو */ }
  else if (d.startsWith('0')) d = '966' + d.slice(1)
  else if (d.startsWith('5')) d = '966' + d
  return d
}

/** تحقّق من الجوال السعودي */
export function validateSaudiPhone(value) {
  const d = normalizeSaudiPhone(value)
  if (!/^9665\d{8}$/.test(d))
    return { ok: false, reason: 'رقم الجوال يجب أن يكون سعودياً بصيغة 05XXXXXXXX.' }
  return { ok: true, value: d, e164: '+' + d }
}

/** تحقّق موحّد حسب النوع المختار */
export function validateIdOrCr(kind, value) {
  return kind === 'cr' ? validateCR(value) : validateSaudiId(value)
}
