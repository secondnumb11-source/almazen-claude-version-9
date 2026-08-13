/* ============================================================================
   محرك الاستيراد الذكي — منصة المازن
   منطق خالص (بدون React) قابل للاختبار: تطبيع، مطابقة أعمدة، تحويل قيم،
   تحقق، كشف تكرار، تصنيف تلقائي للأوراق، وتوليد تقرير استيراد مفصّل.
============================================================================ */

/* ----------------------------- تطبيع النصوص ------------------------------- */
const AR_CHAR_MAP = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ة': 'ه', 'ى': 'ي', 'ئ': 'ي', 'ؤ': 'و' }
const AR_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' }

export function toLatinDigits(s) {
  return String(s ?? '').replace(/[٠-٩۰-۹]/g, c => AR_DIGITS[c] || c)
}

export function normalize(s) {
  return toLatinDigits(s)
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[أإآةىئؤ]/g, c => AR_CHAR_MAP[c] || c)
    .replace(/[\s\-_/\\().:#]+/g, ' ')
    .trim()
}

export function similarity(a, b) {
  a = normalize(a); b = normalize(b)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.86
  const grams = s => new Set([...Array(Math.max(0, s.length - 1))].map((_, i) => s.slice(i, i + 2)))
  const A = grams(a), B = grams(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const g of A) if (B.has(g)) inter++
  return inter / (A.size + B.size - inter)
}

/* ----------------------------- تحويل القيم -------------------------------- */
export function parseNumber(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = toLatinDigits(v).replace(/[,\u066C\s]/g, '')
  s = s.replace(/(ر\.?س|ريال|sar|sr|usd|\$|%)/gi, '')
  s = s.replace(/[()]/g, m => (m === '(' ? '-' : ''))
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function parsePhone(v) {
  if (v === null || v === undefined || v === '') return null
  let s = toLatinDigits(v).replace(/[^\d+]/g, '')
  s = s.replace(/^00/, '+')
  if (s.startsWith('+966')) s = '0' + s.slice(4)
  else if (s.startsWith('966') && s.length >= 12) s = '0' + s.slice(3)
  if (/^5\d{8}$/.test(s)) s = '0' + s
  return s || null
}

export function isValidSaudiPhone(s) {
  return /^05\d{8}$/.test(String(s || ''))
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30)
export function parseDate(v) {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10)
  if (typeof v === 'number' && v > 20000 && v < 60000) {
    return new Date(EXCEL_EPOCH + v * 86400000).toISOString().slice(0, 10)
  }
  const s = toLatinDigits(v).trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
  if (m) {
    let [, a, b, y] = m
    // dd/mm/yyyy هو الشائع عربياً؛ نتحوّل لـ mm/dd فقط لو استحال ذلك
    let d = Number(a), mo = Number(b)
    if (d > 12 && mo <= 12) { /* dd/mm */ }
    else if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t }
    if (d > 31 || mo > 12) return null
    return `${y}-${pad(mo)}-${pad(d)}`
  }
  const t = Date.parse(s)
  if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10)
  return null
}
const pad = n => String(n).padStart(2, '0')

const TRUE_WORDS = ['1', 'true', 'yes', 'y', 'نعم', 'مفروش', 'مفروشة', 'صح', 'فعال', 'active', 'متوفر'].map(normalize)
const FALSE_WORDS = ['0', 'false', 'no', 'n', 'لا', 'غير مفروش', 'غير مفروشة', 'خطأ', 'معطل', 'inactive'].map(normalize)
export function parseBool(v) {
  const s = normalize(v)
  if (!s) return null
  if (TRUE_WORDS.includes(s)) return true
  if (FALSE_WORDS.includes(s)) return false
  return null
}

export function cleanText(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  return s || null
}

/* ------------------------- قواميس القيم المعدودة --------------------------- */
export const ENUMS = {
  id_document_type: {
    values: ['national_id', 'iqama', 'passport'],
    syn: {
      national_id: ['هويه وطنيه', 'هويه', 'وطني', 'سعودي', 'national id', 'nid', 'id'],
      iqama: ['اقامه', 'مقيم', 'iqama', 'residence', 'resident'],
      passport: ['جواز', 'جواز سفر', 'passport', 'pp'],
    },
    default: 'national_id',
  },
  customer_type_enum: {
    values: ['individual', 'company'],
    syn: {
      individual: ['فرد', 'افراد', 'شخص', 'individual', 'person', 'retail'],
      company: ['شركه', 'شركات', 'مؤسسه', 'مؤسسة', 'company', 'corporate', 'business', 'b2b'],
    },
    default: 'individual',
  },
  unit_category: {
    // كانت القيم أربعاً فقط، و«فيلا» و«استراحة» تُسقَطان على chalet لغياب
    // تصنيف يقابلهما. بعد إضافتها إلى نوع unit_category صارت لكلٍّ وجهته
    // الصحيحة. «شاليه» يبقى شاليه، والاختبار القائم عليه لم يتغيّر.
    values: [
      'apartment', 'chalet', 'furnished_unit', 'furnished_room', 'hotel_room',
      'residential_villa', 'furnished_villa', 'rest_house',
    ],
    syn: {
      apartment: ['شقه', 'شقق', 'apartment', 'flat', 'apt', 'وحده سكنيه'],
      chalet: ['شاليه', 'شاليهات', 'chalet'],
      furnished_unit: ['مفروشه', 'وحده مفروشه', 'furnished', 'furnished unit', 'studio', 'استوديو'],
      furnished_room: ['غرفه مفروشه', 'غرفة مفروشة', 'furnished room'],
      hotel_room: ['غرفه', 'غرفه فندقيه', 'hotel', 'room', 'hotel room', 'suite', 'جناح'],
      residential_villa: ['فيلا', 'فلل', 'villa', 'فيلا سكنيه', 'فيلا سكنية', 'residential villa'],
      furnished_villa: ['فيلا مفروشه', 'فيلا مفروشة', 'furnished villa'],
      rest_house: ['استراحه', 'استراحة', 'استراحات', 'rest house', 'resthouse'],
    },
    default: 'apartment',
  },
  unit_status: {
    values: ['available', 'reserved', 'occupied', 'cleaning', 'maintenance', 'reserved_online'],
    syn: {
      available: ['متاح', 'متاحه', 'شاغر', 'شاغره', 'فارغ', 'available', 'vacant', 'free'],
      reserved: ['محجوز', 'محجوزه', 'reserved', 'booked', 'hold'],
      occupied: ['مشغول', 'مؤجر', 'مؤجره', 'occupied', 'rented', 'busy'],
      cleaning: ['تنظيف', 'نظافه', 'cleaning', 'housekeeping'],
      maintenance: ['صيانه', 'maintenance', 'repair', 'out of order'],
      reserved_online: ['حجز الكتروني', 'online', 'reserved online', 'ota'],
    },
    default: 'available',
  },
  account_type: {
    values: ['asset', 'liability', 'equity', 'revenue', 'expense'],
    syn: {
      asset: ['اصول', 'الاصول', 'اصل', 'asset', 'assets', 'مدين'],
      liability: ['خصوم', 'التزامات', 'مطلوبات', 'liability', 'liabilities', 'دائن'],
      equity: ['حقوق ملكيه', 'حقوق الملكيه', 'راس المال', 'equity', 'capital'],
      revenue: ['ايرادات', 'ايراد', 'مبيعات', 'revenue', 'income', 'sales'],
      expense: ['مصروفات', 'مصروف', 'تكاليف', 'expense', 'expenses', 'cost'],
    },
    default: 'expense',
  },
  expense_category: {
    values: ['electricity', 'water', 'maintenance', 'salaries', 'cleaning', 'internet', 'other'],
    syn: {
      electricity: ['كهرباء', 'فاتوره كهرباء', 'electricity', 'power', 'elec'],
      water: ['مياه', 'ماء', 'فاتوره مياه', 'water'],
      maintenance: ['صيانه', 'اصلاح', 'maintenance', 'repair'],
      salaries: ['رواتب', 'راتب', 'اجور', 'salaries', 'salary', 'payroll'],
      cleaning: ['نظافه', 'تنظيف', 'cleaning'],
      internet: ['انترنت', 'اتصالات', 'internet', 'telecom'],
      other: ['اخرى', 'اخري', 'متنوعه', 'other', 'misc'],
    },
    default: 'other',
  },
  payment_method: {
    values: ['cash', 'bank_transfer', 'card'],
    syn: {
      cash: ['نقدا', 'نقدي', 'كاش', 'cash'],
      bank_transfer: ['تحويل', 'تحويل بنكي', 'بنك', 'bank', 'transfer', 'iban'],
      card: ['شبكه', 'بطاقه', 'مدى', 'فيزا', 'card', 'mada', 'visa', 'pos'],
    },
    default: 'cash',
  },
  rent_period: {
    values: ['daily', 'monthly', 'yearly'],
    syn: {
      daily: ['يومي', 'يوميه', 'ليله', 'ليالي', 'daily', 'nightly', 'per night', 'night'],
      monthly: ['شهري', 'شهريه', 'شهر', 'monthly', 'per month', 'month'],
      yearly: ['سنوي', 'سنويه', 'سنه', 'حولي', 'yearly', 'annual', 'annually', 'year'],
    },
    default: 'daily',
  },
  booking_status: {
    values: ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'pending_approval', 'reserved_online'],
    syn: {
      pending: ['معلق', 'معلقه', 'قيد الانتظار', 'انتظار', 'pending', 'new', 'inquiry', 'tentative'],
      confirmed: ['مؤكد', 'مؤكده', 'تم التاكيد', 'confirmed', 'accepted', 'ok', 'active', 'booked'],
      checked_in: ['تم الدخول', 'دخول', 'ساكن', 'checked in', 'checkedin', 'check in', 'in house', 'inhouse', 'arrived'],
      checked_out: ['تم الخروج', 'خروج', 'مغادر', 'checked out', 'checkedout', 'check out', 'departed', 'completed', 'past'],
      cancelled: ['ملغي', 'ملغى', 'ملغيه', 'الغاء', 'cancelled', 'canceled', 'declined', 'rejected', 'no show', 'noshow'],
      pending_approval: ['بانتظار الموافقه', 'قيد الموافقه', 'pending approval', 'awaiting approval'],
      reserved_online: ['حجز الكتروني', 'اونلاين', 'online', 'reserved online', 'ota', 'channel'],
    },
    default: 'confirmed',
  },
  invoice_type: {
    values: ['simplified', 'standard'],
    syn: {
      simplified: ['مبسطه', 'مبسطة', 'فاتوره مبسطه', 'simplified', 'b2c', 'simple'],
      standard: ['ضريبيه', 'معتمده', 'فاتوره ضريبيه', 'standard', 'tax invoice', 'b2b'],
    },
    default: 'simplified',
  },
  invoice_status: {
    values: ['draft', 'issued', 'reported_to_zatca', 'cancelled'],
    syn: {
      draft: ['مسوده', 'مسودة', 'draft', 'unpaid', 'غير مدفوعه', 'open'],
      issued: ['صادره', 'مصدره', 'issued', 'sent', 'paid', 'مدفوعه', 'posted'],
      reported_to_zatca: ['مرسله لهيئه الزكاه', 'zatca', 'reported', 'reported to zatca'],
      cancelled: ['ملغيه', 'ملغاه', 'cancelled', 'canceled', 'void'],
    },
    default: 'issued',
  },
  contract_status_txt: {
    values: ['draft', 'active', 'expired', 'terminated'],
    syn: {
      draft: ['مسوده', 'جديد', 'draft', 'new', 'pending'],
      active: ['ساري', 'ساريه', 'نشط', 'فعال', 'active', 'running', 'current', 'signed'],
      expired: ['منتهي', 'منتهيه', 'expired', 'ended', 'closed', 'completed'],
      terminated: ['مفسوخ', 'ملغي', 'terminated', 'cancelled', 'canceled'],
    },
    default: 'active',
  },
  user_role: {
    values: ['owner', 'manager', 'accountant', 'employee'],
    syn: {
      owner: ['مالك', 'صاحب', 'owner'],
      manager: ['مدير', 'مشرف', 'manager', 'supervisor', 'admin'],
      accountant: ['محاسب', 'محاسبه', 'accountant', 'finance'],
      employee: ['موظف', 'موظفه', 'employee', 'staff', 'agent'],
    },
    default: 'employee',
  },
}

export function coerceEnum(value, enumName) {
  const def = ENUMS[enumName]
  if (!def) return { value: null, matched: false }
  const raw = normalize(value)
  if (!raw) return { value: def.default, matched: false, usedDefault: true }
  if (def.values.includes(raw)) return { value: raw, matched: true }
  let best = null, bestScore = 0
  for (const [key, syns] of Object.entries(def.syn)) {
    for (const syn of [key, ...syns]) {
      const s = similarity(raw, syn)
      if (s > bestScore) { bestScore = s; best = key }
    }
  }
  if (best && bestScore >= 0.6) return { value: best, matched: true, score: bestScore }
  return { value: def.default, matched: false, usedDefault: true }
}

/* --------------------------- تعريف أقسام النظام ---------------------------- */
/** كل هدف = جدول حقيقي في قاعدة البيانات + حقوله + مرادفاته العربية/الإنجليزية */
export const TARGETS = {
  customers: {
    table: 'customers',
    icon: '👥',
    label: 'العملاء',
    section: 'قسم العملاء',
    hint: 'الاسم الكامل + نوع ورقم الهوية + الجوال.',
    dedupeKey: 'id_number',
    fields: {
      full_name: { label: 'الاسم الكامل', type: 'text', required: true, syn: ['name', 'الاسم', 'الاسم الكامل', 'اسم العميل', 'اسم المستاجر', 'customer', 'client', 'guest name', 'full name', 'اسم'] },
      id_type: { label: 'نوع الهوية', type: 'enum', enum: 'id_document_type', syn: ['نوع الهويه', 'نوع الاثبات', 'id type', 'document type'] },
      id_number: { label: 'رقم الهوية', type: 'text', required: true, syn: ['id', 'الهويه', 'رقم الهويه', 'iqama', 'الاقامه', 'national id', 'identity', 'رقم الاثبات', 'سجل مدني'] },
      phone: { label: 'الجوال', type: 'phone', required: true, syn: ['phone', 'mobile', 'الجوال', 'رقم الجوال', 'الهاتف', 'tel', 'contact'] },
      email: { label: 'البريد', type: 'email', syn: ['email', 'e-mail', 'البريد', 'البريد الالكتروني', 'الايميل'] },
      nationality: { label: 'الجنسية', type: 'text', syn: ['nationality', 'الجنسيه', 'country'] },
      customer_type: { label: 'نوع العميل', type: 'enum', enum: 'customer_type_enum', syn: ['نوع العميل', 'customer type', 'التصنيف', 'category'] },
      company_name: { label: 'اسم الشركة', type: 'text', syn: ['company', 'اسم الشركه', 'المنشاه', 'organization'] },
      vat_number: { label: 'الرقم الضريبي', type: 'text', syn: ['vat', 'الرقم الضريبي', 'tax number', 'الضريبه'] },
      cr_number: { label: 'السجل التجاري', type: 'text', syn: ['cr', 'السجل التجاري', 'commercial register'] },
      birth_date: { label: 'تاريخ الميلاد', type: 'date', syn: ['birth', 'تاريخ الميلاد', 'الميلاد', 'dob', 'date of birth'] },
      national_address: { label: 'العنوان الوطني', type: 'text', syn: ['العنوان الوطني', 'national address', 'العنوان'] },
      gender: { label: 'الجنس', type: 'text', syn: ['الجنس', 'gender', 'sex'] },
      notes: { label: 'ملاحظات', type: 'text', syn: ['notes', 'ملاحظات', 'remark', 'comment', 'البيان'] },
    },
  },
  tenants: {
    table: 'tenants',
    icon: '🏘️',
    label: 'المستأجرون',
    section: 'قسم المستأجرين',
    hint: 'الاسم الكامل + الجوال. باقي الحقول اختيارية.',
    dedupeKey: 'id_number',
    fields: {
      full_name: { label: 'الاسم الكامل', type: 'text', required: true, syn: ['name', 'الاسم', 'اسم المستاجر', 'tenant', 'tenant name', 'full name'] },
      phone: { label: 'الجوال', type: 'phone', syn: ['phone', 'mobile', 'الجوال', 'رقم الجوال', 'الهاتف'] },
      email: { label: 'البريد', type: 'email', syn: ['email', 'البريد', 'الايميل'] },
      id_type: { label: 'نوع الهوية', type: 'enum', enum: 'id_document_type', syn: ['نوع الهويه', 'id type'] },
      id_number: { label: 'رقم الهوية', type: 'text', syn: ['id', 'رقم الهويه', 'الهويه', 'iqama', 'national id'] },
      id_expiry: { label: 'انتهاء الهوية', type: 'date', syn: ['انتهاء الهويه', 'id expiry', 'expiry'] },
      date_of_birth: { label: 'تاريخ الميلاد', type: 'date', syn: ['تاريخ الميلاد', 'dob', 'birth date'] },
      nationality: { label: 'الجنسية', type: 'text', syn: ['الجنسيه', 'nationality'] },
      address: { label: 'العنوان', type: 'text', syn: ['العنوان', 'address', 'street'] },
      city: { label: 'المدينة', type: 'text', syn: ['المدينه', 'city', 'town'] },
    },
  },
  properties: {
    table: 'properties',
    icon: '🏢',
    label: 'العقارات / المباني',
    section: 'قسم العقارات',
    hint: 'اسم المبنى + المدينة.',
    dedupeKey: 'name',
    fields: {
      name: { label: 'اسم العقار', type: 'text', required: true, syn: ['اسم العقار', 'العماره', 'المبنى', 'building', 'property', 'property name', 'compound', 'برج'] },
      city: { label: 'المدينة', type: 'text', syn: ['المدينه', 'city'] },
      address: { label: 'العنوان', type: 'text', syn: ['العنوان', 'address', 'الموقع', 'location'] },
      notes: { label: 'ملاحظات', type: 'text', syn: ['ملاحظات', 'notes'] },
    },
  },
  units: {
    table: 'units',
    icon: '🏠',
    label: 'الوحدات العقارية',
    section: 'قسم الوحدات',
    hint: 'رقم/اسم الوحدة + التصنيف + الأسعار.',
    dedupeKey: 'unit_number',
    fields: {
      unit_number: { label: 'رقم الوحدة', type: 'text', required: true, syn: ['unit', 'الوحده', 'رقم الوحده', 'اسم الوحده', 'unit no', 'unit number', 'room', 'رقم الشقه', 'الشقه'] },
      category: { label: 'التصنيف', type: 'enum', enum: 'unit_category', syn: ['نوع الوحده', 'التصنيف', 'النوع', 'unit type', 'type', 'category'] },
      status: { label: 'الحالة', type: 'enum', enum: 'unit_status', syn: ['الحاله', 'status', 'state', 'availability'] },
      daily_price: { label: 'السعر اليومي', type: 'number', syn: ['السعر اليومي', 'يومي', 'daily', 'daily rate', 'nightly', 'price per night'] },
      monthly_price: { label: 'السعر الشهري', type: 'number', syn: ['الايجار الشهري', 'شهري', 'monthly', 'monthly rent', 'rent'] },
      yearly_price: { label: 'السعر السنوي', type: 'number', syn: ['الايجار السنوي', 'سنوي', 'yearly', 'annual rent'] },
      floor_no: { label: 'الدور', type: 'text', syn: ['الدور', 'الطابق', 'floor', 'level'] },
      bedrooms: { label: 'غرف النوم', type: 'int', syn: ['غرف', 'عدد الغرف', 'غرف النوم', 'bedrooms', 'beds', 'rooms'] },
      bathrooms: { label: 'دورات المياه', type: 'int', syn: ['دورات المياه', 'حمامات', 'bathrooms', 'baths', 'wc'] },
      area_sqm: { label: 'المساحة (م²)', type: 'number', syn: ['المساحه', 'area', 'size', 'sqm', 'م2'] },
      is_furnished: { label: 'مفروشة', type: 'bool', syn: ['مفروشه', 'مفروش', 'furnished', 'furnishing'] },
      deed_number: { label: 'رقم الصك', type: 'text', syn: ['الصك', 'رقم الصك', 'deed', 'title deed'] },
      property_name: { label: 'العقار/المبنى (ربط تلقائي)', type: 'text', virtual: true, lookup: 'properties', syn: ['العقار', 'العماره', 'المبنى', 'building', 'property', 'compound', 'برج'] },
      description: { label: 'الوصف', type: 'text', syn: ['الوصف', 'description', 'تفاصيل', 'notes'] },
    },
  },
  chart_of_accounts: {
    table: 'chart_of_accounts',
    icon: '📊',
    label: 'شجرة الحسابات',
    section: 'قسم المحاسبة',
    hint: 'كود الحساب + الاسم + النوع.',
    dedupeKey: 'code',
    fields: {
      code: { label: 'كود الحساب', type: 'text', required: true, syn: ['code', 'كود', 'رمز', 'رقم الحساب', 'account code', 'acc code'] },
      name: { label: 'اسم الحساب', type: 'text', required: true, syn: ['name', 'اسم الحساب', 'البيان', 'account name', 'title'] },
      account_type: { label: 'نوع الحساب', type: 'enum', enum: 'account_type', required: true, syn: ['type', 'نوع الحساب', 'التصنيف', 'account type', 'nature'] },
      opening_balance: { label: 'الرصيد الافتتاحي', type: 'number', syn: ['الرصيد', 'الرصيد الافتتاحي', 'opening balance', 'balance'] },
      is_group: { label: 'حساب رئيسي', type: 'bool', syn: ['رئيسي', 'مجموعه', 'is group', 'parent', 'header'] },
    },
  },
  expenses: {
    table: 'expenses',
    icon: '💸',
    label: 'المصروفات',
    section: 'قسم المصروفات',
    hint: 'المبلغ + التاريخ + التصنيف.',
    dedupeKey: null,
    fields: {
      amount: { label: 'المبلغ', type: 'number', required: true, syn: ['amount', 'المبلغ', 'القيمه', 'الاجمالي', 'total', 'value', 'debit'] },
      category: { label: 'التصنيف', type: 'enum', enum: 'expense_category', syn: ['التصنيف', 'نوع المصروف', 'البند', 'category', 'type'] },
      expense_date: { label: 'التاريخ', type: 'date', syn: ['التاريخ', 'تاريخ', 'date', 'expense date', 'تاريخ الصرف'] },
      description: { label: 'الوصف', type: 'text', syn: ['الوصف', 'البيان', 'description', 'notes', 'details'] },
      vendor_name: { label: 'المورد', type: 'text', syn: ['المورد', 'البائع', 'vendor', 'supplier', 'payee'] },
      payment_method: { label: 'طريقة الدفع', type: 'enum', enum: 'payment_method', syn: ['طريقه الدفع', 'الدفع', 'payment method', 'method'] },
    },
  },
  employees: {
    table: 'users',
    icon: '👔',
    label: 'الموظفون',
    section: 'قسم الموظفين',
    hint: 'البريد الإلكتروني + الاسم. الدور اختياري.',
    dedupeKey: 'email',
    fields: {
      email: { label: 'البريد', type: 'email', required: true, syn: ['email', 'البريد', 'الايميل', 'البريد الالكتروني', 'user email'] },
      first_name: { label: 'الاسم الأول', type: 'text', syn: ['الاسم الاول', 'first name', 'given name', 'الاسم'] },
      last_name: { label: 'اسم العائلة', type: 'text', syn: ['العائله', 'اسم العائله', 'last name', 'surname', 'family name'] },
      phone: { label: 'الجوال', type: 'phone', syn: ['phone', 'الجوال', 'mobile', 'رقم الجوال'] },
      role: { label: 'الدور', type: 'enum', enum: 'user_role', syn: ['الدور', 'الوظيفه', 'المسمى', 'role', 'position', 'job title'] },
    },
  },
  contracts: {
    table: 'contracts',
    icon: '📜',
    label: 'العقود',
    section: 'قسم العقود والإيجارات',
    hint: 'رقم العقد + الحجز/العميل/الوحدة + تواريخ البداية والنهاية. العقد يُربط بحجز قائم أو يُنشأ له حجز مطابق.',
    dedupeKey: 'contract_number',
    relations: ['booking'],
    fields: {
      contract_number: { label: 'رقم العقد', type: 'text', required: true, syn: ['contract', 'contract no', 'contract number', 'رقم العقد', 'contract id', 'agreement no', 'رقم الاتفاقيه'] },
      booking_reference: { label: 'رقم الحجز المرتبط (ربط تلقائي)', type: 'text', virtual: true, lookup: 'bookings', syn: ['booking', 'booking id', 'reservation', 'reservation id', 'رقم الحجز', 'confirmation code'] },
      customer_name: { label: 'العميل (ربط تلقائي)', type: 'text', virtual: true, lookup: 'customers', syn: ['customer', 'client', 'العميل', 'اسم العميل', 'اسم المستاجر', 'tenant', 'guest name'] },
      customer_id_number: { label: 'هوية العميل (ربط تلقائي)', type: 'text', virtual: true, lookup: 'customers', syn: ['id number', 'رقم الهويه', 'هويه المستاجر', 'iqama', 'national id'] },
      unit_number: { label: 'رقم الوحدة (ربط تلقائي)', type: 'text', virtual: true, lookup: 'units', syn: ['unit', 'unit no', 'رقم الوحده', 'الوحده', 'apartment', 'الشقه'] },
      contract_type: { label: 'نوع العقد', type: 'text', syn: ['contract type', 'نوع العقد', 'type', 'التصنيف'] },
      start_date: { label: 'تاريخ البداية', type: 'date', required: true, syn: ['start', 'start date', 'from', 'تاريخ البدايه', 'من تاريخ', 'contract start', 'بدايه العقد'] },
      end_date: { label: 'تاريخ النهاية', type: 'date', required: true, syn: ['end', 'end date', 'to', 'تاريخ النهايه', 'الى تاريخ', 'contract end', 'نهايه العقد'] },
      status: { label: 'الحالة', type: 'enum', enum: 'contract_status_txt', syn: ['status', 'الحاله', 'state', 'active/expired'] },
      terms_and_conditions: { label: 'الشروط والأحكام', type: 'text', syn: ['terms', 'الشروط', 'الشروط والاحكام', 'conditions', 'notes', 'ملاحظات'] },
      pdf_url: { label: 'رابط ملف العقد', type: 'text', syn: ['pdf', 'رابط العقد', 'document', 'file url', 'attachment'] },
      contract_value: { label: 'قيمة العقد (للتقرير فقط)', type: 'number', virtual: true, syn: ['value', 'قيمه العقد', 'contract value', 'amount', 'الاجمالي'] },
    },
  },
  bookings: {
    table: 'bookings',
    icon: '📅',
    label: 'الحجوزات',
    section: 'قسم الحجوزات',
    hint: 'العميل + الوحدة + تاريخ الدخول/الخروج + المبالغ. يتم كشف تعارض التواريخ على نفس الوحدة قبل الاستيراد.',
    dedupeKey: 'contract_number',
    relations: ['customer', 'unit'],
    fields: {
      contract_number: { label: 'رقم الحجز / المرجع', type: 'text', required: true, syn: ['booking', 'booking id', 'booking number', 'reservation', 'reservation id', 'confirmation code', 'reservation number', 'رقم الحجز', 'كود الحجز', 'رقم العقد'] },
      customer_name: { label: 'العميل (ربط تلقائي)', type: 'text', virtual: true, lookup: 'customers', required: true, syn: ['guest', 'guest name', 'guest full name', 'customer', 'booker name', 'العميل', 'اسم النزيل', 'اسم الضيف', 'اسم المستاجر'] },
      customer_id_number: { label: 'هوية العميل (ربط تلقائي)', type: 'text', virtual: true, lookup: 'customers', syn: ['id number', 'رقم الهويه', 'iqama', 'national id', 'الهويه'] },
      customer_phone: { label: 'جوال العميل (ربط تلقائي)', type: 'phone', virtual: true, lookup: 'customers', syn: ['guest phone', 'phone', 'mobile', 'الجوال', 'رقم الجوال'] },
      unit_number: { label: 'الوحدة (ربط تلقائي)', type: 'text', virtual: true, lookup: 'units', required: true, syn: ['unit', 'listing', 'listing name', 'listing nickname', 'room', 'room name', 'الوحده', 'رقم الوحده'] },
      check_in_date: { label: 'تاريخ الدخول', type: 'date', required: true, syn: ['check in', 'check-in', 'checkin', 'arrival', 'from', 'الدخول', 'تاريخ الدخول', 'وصول'] },
      check_out_date: { label: 'تاريخ الخروج', type: 'date', required: true, syn: ['check out', 'check-out', 'checkout', 'departure', 'to', 'الخروج', 'تاريخ الخروج', 'مغادره'] },
      rent_period: { label: 'نوع الإيجار', type: 'enum', enum: 'rent_period', syn: ['period', 'rent period', 'نوع الايجار', 'الدوره', 'يومي/شهري'] },
      status: { label: 'الحالة', type: 'enum', enum: 'booking_status', syn: ['status', 'reservation status', 'الحاله', 'booking status'] },
      base_price: { label: 'السعر الأساسي', type: 'number', syn: ['base price', 'rate', 'price', 'السعر', 'السعر الاساسي', 'accommodation'] },
      total_amount: { label: 'الإجمالي', type: 'number', required: true, syn: ['total', 'amount', 'earnings', 'total amount', 'payout', 'الاجمالي', 'المبلغ', 'اجمالي الحجز'] },
      discount_percent: { label: 'نسبة الخصم %', type: 'number', syn: ['discount', 'discount percent', 'الخصم', 'نسبه الخصم'] },
      down_payment: { label: 'العربون', type: 'number', syn: ['deposit', 'down payment', 'العربون', 'الدفعه المقدمه'] },
      insurance_amount: { label: 'التأمين', type: 'number', syn: ['insurance', 'security deposit', 'التامين', 'مبلغ التامين'] },
      booking_source: { label: 'مصدر الحجز', type: 'text', syn: ['channel', 'source', 'channel name', 'platform', 'قناه الحجز', 'المصدر', 'المنصه'] },
      ota_reservation_id: { label: 'رقم الحجز في المنصة', type: 'text', syn: ['ota id', 'external id', 'channel reservation id', 'رقم الحجز الخارجي'] },
      notes: { label: 'ملاحظات', type: 'text', syn: ['notes', 'ملاحظات', 'special requests', 'remark', 'comment'] },
    },
  },
  invoices: {
    table: 'invoices',
    icon: '🧾',
    label: 'الفواتير',
    section: 'قسم الفواتير',
    hint: 'رقم الفاتورة + اسم العميل + المبالغ (قبل الضريبة/الضريبة/الإجمالي) + ربط اختياري بالحجز.',
    dedupeKey: 'invoice_number',
    relations: ['booking'],
    fields: {
      invoice_number: { label: 'رقم الفاتورة', type: 'text', required: true, syn: ['invoice', 'invoice no', 'invoice number', 'رقم الفاتوره', 'bill number', 'inv#'] },
      customer_name: { label: 'اسم العميل', type: 'text', required: true, syn: ['customer', 'client', 'bill to', 'العميل', 'اسم العميل', 'اسم المستاجر'] },
      booking_reference: { label: 'رقم الحجز (ربط تلقائي)', type: 'text', virtual: true, lookup: 'bookings', syn: ['booking', 'reservation', 'رقم الحجز', 'رقم العقد', 'contract no'] },
      invoice_type: { label: 'نوع الفاتورة', type: 'enum', enum: 'invoice_type', syn: ['invoice type', 'نوع الفاتوره', 'type'] },
      status: { label: 'الحالة', type: 'enum', enum: 'invoice_status', syn: ['status', 'الحاله', 'paid/unpaid'] },
      customer_type: { label: 'نوع العميل', type: 'enum', enum: 'customer_type_enum', syn: ['customer type', 'نوع العميل'] },
      customer_vat: { label: 'الرقم الضريبي للعميل', type: 'text', syn: ['vat', 'vat number', 'الرقم الضريبي', 'tax number'] },
      customer_cr: { label: 'السجل التجاري للعميل', type: 'text', syn: ['cr', 'السجل التجاري', 'commercial register'] },
      customer_address: { label: 'عنوان العميل', type: 'text', syn: ['address', 'العنوان', 'bill address'] },
      subtotal: { label: 'الإجمالي قبل الضريبة', type: 'number', required: true, syn: ['subtotal', 'net', 'قبل الضريبه', 'الصافي', 'net amount'] },
      vat_rate: { label: 'نسبة الضريبة %', type: 'number', syn: ['vat rate', 'tax rate', 'نسبه الضريبه'] },
      vat_amount: { label: 'قيمة الضريبة', type: 'number', syn: ['vat', 'tax', 'الضريبه', 'قيمه الضريبه', 'vat amount'] },
      total: { label: 'الإجمالي شامل الضريبة', type: 'number', required: true, syn: ['total', 'amount', 'grand total', 'الاجمالي', 'الاجمالي مع الضريبه', 'المبلغ الكلي'] },
      issued_at: { label: 'تاريخ الإصدار', type: 'date', syn: ['invoice date', 'date', 'التاريخ', 'تاريخ الفاتوره', 'issue date', 'issued at'] },
      paid_amount: { label: 'المبلغ المدفوع (للتقرير فقط)', type: 'number', virtual: true, syn: ['paid', 'paid amount', 'المدفوع', 'amount paid'] },
    },
  },
}

/** حقول تُملأ من سياق النظام لا من الملف */
export const SYSTEM_FIELDS = ['company_id', 'branch_id', 'created_by']

/* ------------------------ بصمات أنظمة المنافسين ---------------------------- */
export const VENDOR_PROFILES = [
  { id: 'ejar', name: 'إيجار (وزارة الإسكان)', signals: ['رقم العقد', 'اسم المستاجر', 'رقم هويه المستاجر', 'قيمه العقد', 'ejar'], target: 'tenants' },
  { id: 'mazaya', name: 'أنظمة إدارة الأملاك العربية', signals: ['اسم المستاجر', 'رقم الوحده', 'الايجار الشهري', 'العماره'], target: 'units' },
  { id: 'hostaway', name: 'Hostaway', signals: ['listing name', 'guest name', 'reservation id', 'channel name'], target: 'customers' },
  { id: 'cloudbeds', name: 'Cloudbeds', signals: ['room name', 'guest first name', 'guest last name', 'reservation number'], target: 'customers' },
  { id: 'booking', name: 'Booking.com', signals: ['booker name', 'check-in', 'check-out', 'room nights', 'commission amount'], target: 'customers' },
  { id: 'airbnb', name: 'Airbnb', signals: ['confirmation code', 'guest name', 'listing', 'nights', 'earnings'], target: 'customers' },
  { id: 'guesty', name: 'Guesty', signals: ['listing nickname', 'guest full name', 'confirmation code'], target: 'customers' },
  { id: 'odoo', name: 'Odoo', signals: ['display name', 'internal reference', 'account code', 'journal entry'], target: 'chart_of_accounts' },
  { id: 'zoho', name: 'Zoho Books', signals: ['account name', 'account code', 'account type', 'parent account'], target: 'chart_of_accounts' },
  { id: 'quickbooks', name: 'QuickBooks', signals: ['account', 'detail type', 'debit', 'credit', 'memo description'], target: 'chart_of_accounts' },
  { id: 'qoyod', name: 'قيود Qoyod', signals: ['رقم الحساب', 'اسم الحساب', 'نوع الحساب', 'الرصيد الافتتاحي'], target: 'chart_of_accounts' },
  { id: 'daftra', name: 'دفترة Daftra', signals: ['اسم العميل', 'رقم العميل', 'المستحق', 'البريد الالكتروني'], target: 'customers' },
]

export function detectVendor(headers) {
  const hs = (headers || []).map(normalize)
  let best = null, bestHits = 0
  for (const v of VENDOR_PROFILES) {
    let hits = 0
    for (const sig of v.signals) {
      if (hs.some(h => similarity(h, sig) >= 0.8)) hits++
    }
    if (hits > bestHits) { bestHits = hits; best = v }
  }
  if (best && bestHits >= 2) return { ...best, confidence: Math.min(1, bestHits / best.signals.length) }
  return null
}

/* --------------------- إشارات مستمدة من القيم نفسها ------------------------ */
function valueSignal(field, samples) {
  const vals = samples.filter(v => v !== '' && v !== null && v !== undefined).slice(0, 25).map(v => toLatinDigits(v).trim())
  if (!vals.length) return 0
  const ratio = fn => vals.filter(fn).length / vals.length
  switch (field.type) {
    case 'phone': return ratio(v => /^\+?0?(?:966)?5\d{8}$/.test(v.replace(/[\s\-()]/g, ''))) > 0.6 ? 0.3 : 0
    case 'email': return ratio(v => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v)) > 0.6 ? 0.35 : 0
    case 'date': return ratio(v => parseDate(v) !== null) > 0.7 ? 0.2 : 0
    case 'number':
    case 'int': return ratio(v => parseNumber(v) !== null) > 0.8 ? 0.12 : 0
    default: return 0
  }
}

/* --------------------------- مطابقة الأعمدة الذكية -------------------------- */
/**
 * @returns {{ mapping: Record<string,string>, scores: Record<string,number>,
 *             suggestions: Record<string,Array<{column:string,score:number}>>,
 *             unmapped: string[] }}
 */
export function autoMapColumns(headers, targetKey, rows = []) {
  const target = TARGETS[targetKey]
  if (!target) throw new Error(`unknown target ${targetKey}`)
  const mapping = {}, scores = {}, suggestions = {}
  const used = new Set()

  const entries = Object.entries(target.fields).filter(([, f]) => !f.skip)
  const candidates = []
  for (const [fieldKey, field] of entries) {
    const list = []
    for (const h of headers) {
      const nameScore = Math.max(
        similarity(h, fieldKey),
        similarity(h, field.label),
        ...(field.syn || []).map(s => similarity(h, s)),
      )
      const vSignal = valueSignal(field, rows.map(r => r[h]))
      const score = Math.min(1, nameScore + (nameScore > 0.35 ? vSignal : vSignal * 0.5))
      if (score > 0.2) list.push({ column: h, score: Number(score.toFixed(3)) })
    }
    list.sort((a, b) => b.score - a.score)
    suggestions[fieldKey] = list.slice(0, 4)
    if (list.length) candidates.push({ fieldKey, required: !!field.required, best: list[0] })
  }

  // الحقول الإلزامية أولاً ثم الأعلى ثقة — لتجنّب سرقة عمود من حقل إلزامي
  candidates.sort((a, b) => (b.required - a.required) || (b.best.score - a.best.score))
  for (const { fieldKey } of candidates) {
    const pick = (suggestions[fieldKey] || []).find(c => !used.has(c.column) && c.score >= 0.55)
    if (pick) { mapping[fieldKey] = pick.column; scores[fieldKey] = pick.score; used.add(pick.column) }
  }

  return { mapping, scores, suggestions, unmapped: headers.filter(h => !used.has(h)) }
}

/** تصنيف ورقة/جدول: أي قسم من النظام يناسب هذه الأعمدة؟ */
export function classifySheet(headers, rows = []) {
  const ranked = Object.keys(TARGETS).map(key => {
    const { mapping, scores } = autoMapColumns(headers, key, rows)
    const target = TARGETS[key]
    const req = Object.entries(target.fields).filter(([, f]) => f.required).map(([k]) => k)
    const reqHit = req.filter(f => mapping[f]).length / (req.length || 1)
    const cover = Object.keys(mapping).length / Math.max(1, headers.length)
    const avg = Object.values(scores).reduce((a, b) => a + b, 0) / (Object.keys(scores).length || 1)
    const confidence = Number((reqHit * 0.55 + cover * 0.2 + avg * 0.25).toFixed(3))
    return { target: key, label: target.label, confidence, mappedFields: Object.keys(mapping).length, requiredHit: reqHit }
  }).sort((a, b) => b.confidence - a.confidence)
  return { best: ranked[0], ranked }
}

/* ------------------------------ التحقق والتحويل ---------------------------- */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i

/**
 * يحوّل صفاً خاماً إلى سجل جاهز للإدراج مع أخطاء/تنبيهات/إصلاحات تلقائية.
 */
export function transformRow(raw, targetKey, mapping, opts = {}) {
  const target = TARGETS[targetKey]
  const out = {}
  const errors = []
  const lookups = {}
  const warnings = []
  const fixes = []

  for (const [fieldKey, field] of Object.entries(target.fields)) {
    if (field.skip) continue
    const col = mapping[fieldKey]
    const rawVal = col ? raw[col] : undefined
    const isEmpty = rawVal === undefined || rawVal === null || String(rawVal).trim() === ''

    if (isEmpty) {
      if (field.required) {
        if (field.type === 'enum') {
          const d = ENUMS[field.enum].default
          out[fieldKey] = d
          fixes.push({ field: fieldKey, action: 'default', message: `${field.label}: فارغ — استُخدمت القيمة الافتراضية «${d}»` })
        } else {
          errors.push({ field: fieldKey, code: 'REQUIRED_MISSING', message: `${field.label}: حقل إلزامي مفقود`, suggestion: col ? 'املأ الخلية في الملف أو غيّر ربط العمود' : `اربط عموداً بحقل «${field.label}»` })
        }
      } else if (field.type === 'enum' && opts.fillEnumDefaults !== false) {
        // ندع القاعدة تطبّق قيمتها الافتراضية
      }
      continue
    }

    switch (field.type) {
      case 'number': {
        const n = parseNumber(rawVal)
        if (n === null) { errors.push({ field: fieldKey, code: 'BAD_NUMBER', message: `${field.label}: «${rawVal}» ليست قيمة رقمية`, suggestion: 'أزل الرموز/النصوص من الخلية' }) }
        else { out[fieldKey] = n; if (String(rawVal) !== String(n)) fixes.push({ field: fieldKey, action: 'parse', message: `${field.label}: «${rawVal}» ← ${n}` }) }
        break
      }
      case 'int': {
        const n = parseNumber(rawVal)
        if (n === null) errors.push({ field: fieldKey, code: 'BAD_NUMBER', message: `${field.label}: «${rawVal}» ليست رقماً`, suggestion: 'صحّح الخلية' })
        else out[fieldKey] = Math.round(n)
        break
      }
      case 'phone': {
        const p = parsePhone(rawVal)
        if (!p) { errors.push({ field: fieldKey, code: 'BAD_PHONE', message: `${field.label}: رقم غير صالح «${rawVal}»`, suggestion: 'استخدم صيغة 05XXXXXXXX' }) }
        else {
          out[fieldKey] = p
          if (p !== String(rawVal).trim()) fixes.push({ field: fieldKey, action: 'normalize', message: `${field.label}: «${rawVal}» ← ${p}` })
          if (!isValidSaudiPhone(p)) warnings.push({ field: fieldKey, code: 'PHONE_SHAPE', message: `${field.label}: «${p}» لا يطابق صيغة الجوال السعودي 05XXXXXXXX` })
        }
        break
      }
      case 'email': {
        const e = String(rawVal).trim().toLowerCase()
        if (!EMAIL_RE.test(e)) {
          if (field.required) errors.push({ field: fieldKey, code: 'BAD_EMAIL', message: `${field.label}: بريد غير صالح «${rawVal}»`, suggestion: 'صحّح البريد أو احذف الصف' })
          else warnings.push({ field: fieldKey, code: 'BAD_EMAIL', message: `${field.label}: بريد غير صالح — تم تجاهله` })
        } else out[fieldKey] = e
        break
      }
      case 'date': {
        const d = parseDate(rawVal)
        if (!d) { warnings.push({ field: fieldKey, code: 'BAD_DATE', message: `${field.label}: تعذّر فهم التاريخ «${rawVal}» — تم تجاهله` }) }
        else { out[fieldKey] = d; if (d !== String(rawVal).trim()) fixes.push({ field: fieldKey, action: 'parse', message: `${field.label}: «${rawVal}» ← ${d}` }) }
        break
      }
      case 'bool': {
        const b = parseBool(rawVal)
        if (b === null) warnings.push({ field: fieldKey, code: 'BAD_BOOL', message: `${field.label}: «${rawVal}» غير مفهومة — تم تجاهلها` })
        else out[fieldKey] = b
        break
      }
      case 'enum': {
        const r = coerceEnum(rawVal, field.enum)
        out[fieldKey] = r.value
        if (!r.matched) {
          fixes.push({ field: fieldKey, action: 'enum-default', message: `${field.label}: «${rawVal}» غير معروفة — استُخدمت «${r.value}»` })
        } else if (normalize(rawVal) !== r.value) {
          fixes.push({ field: fieldKey, action: 'enum-map', message: `${field.label}: «${rawVal}» ← ${r.value}` })
        }
        break
      }
      default: {
        const t = cleanText(rawVal)
        if (field.virtual) { if (t) lookups[fieldKey] = t; break }
        if (!t && field.required) errors.push({ field: fieldKey, code: 'REQUIRED_MISSING', message: `${field.label}: حقل إلزامي فارغ` })
        else if (t) out[fieldKey] = t
      }
    }
  }

  // قواعد ذكية خاصة بكل قسم
  if (targetKey === 'customers') {
    if (out.id_number && !out.id_type) {
      const s = toLatinDigits(out.id_number)
      out.id_type = /^1\d{9}$/.test(s) ? 'national_id' : /^2\d{9}$/.test(s) ? 'iqama' : 'national_id'
      fixes.push({ field: 'id_type', action: 'infer', message: `نوع الهوية استُنتج تلقائياً: ${out.id_type}` })
    }
    if (out.company_name && out.customer_type !== 'company') {
      out.customer_type = 'company'
      fixes.push({ field: 'customer_type', action: 'infer', message: 'وجود اسم شركة ⇒ تم ضبط نوع العميل إلى «company»' })
    }
    if (out.id_number && !/^\d{8,15}$/.test(toLatinDigits(out.id_number))) {
      warnings.push({ field: 'id_number', code: 'ID_SHAPE', message: `رقم الهوية «${out.id_number}» لا يطابق الصيغة المتوقعة (10 أرقام)` })
    }
  }
  if (targetKey === 'employees' && !out.first_name && raw && mapping.first_name === undefined) {
    const full = cleanText(raw[mapping.full_name] || '')
    if (full) {
      const parts = full.split(' ')
      out.first_name = parts[0]
      out.last_name = parts.slice(1).join(' ') || null
      fixes.push({ field: 'first_name', action: 'split', message: `تم تقسيم الاسم الكامل «${full}»` })
    }
  }
  if (targetKey === 'expenses' && !out.expense_date) {
    out.expense_date = new Date().toISOString().slice(0, 10)
    fixes.push({ field: 'expense_date', action: 'default', message: 'التاريخ فارغ — استُخدم تاريخ اليوم' })
  }
  if (targetKey === 'units') {
    const anyPrice = out.daily_price || out.monthly_price || out.yearly_price
    if (!anyPrice) warnings.push({ field: 'monthly_price', code: 'NO_PRICE', message: 'لا يوجد أي سعر للوحدة — يمكن إضافته لاحقاً' })
    if (!out.category) out.category = ENUMS.unit_category.default
  }

  return { data: out, lookups, errors, warnings, fixes, ok: errors.length === 0 }
}

/* ------------------------------ كشف التكرار -------------------------------- */
export function dedupe(records, targetKey, existingKeys = []) {
  const key = TARGETS[targetKey]?.dedupeKey
  if (!key) return { unique: records, duplicatesInFile: [], duplicatesInDb: [] }
  const seen = new Set()
  const existing = new Set(existingKeys.map(k => normalize(k)))
  const unique = [], duplicatesInFile = [], duplicatesInDb = []
  for (const rec of records) {
    const v = normalize(rec.data?.[key])
    if (!v) { unique.push(rec); continue }
    if (seen.has(v)) { duplicatesInFile.push({ ...rec, dupKey: v }); continue }
    if (existing.has(v)) { duplicatesInDb.push({ ...rec, dupKey: v }); seen.add(v); continue }
    seen.add(v); unique.push(rec)
  }
  return { unique, duplicatesInFile, duplicatesInDb }
}

/* ------------------------------ بناء التقرير ------------------------------- */
export function buildReport({ targetKey, rowsTotal, results, inserted, updated, skipped, failedRows, startedAt, endedAt, vendor }) {
  const reasons = {}
  for (const f of failedRows || []) {
    for (const e of f.errors || []) {
      const k = `${e.code}: ${e.message}`
      reasons[k] = (reasons[k] || 0) + 1
    }
  }
  const warnings = {}
  for (const r of results || []) {
    for (const w of r.warnings || []) {
      warnings[w.message] = (warnings[w.message] || 0) + 1
    }
  }
  const fixes = {}
  for (const r of results || []) {
    for (const f of r.fixes || []) {
      fixes[f.message] = (fixes[f.message] || 0) + 1
    }
  }
  return {
    target: targetKey,
    targetLabel: TARGETS[targetKey]?.label || targetKey,
    section: TARGETS[targetKey]?.section || '',
    table: TARGETS[targetKey]?.table || targetKey,
    vendor: vendor?.name || null,
    rowsTotal,
    inserted: inserted || 0,
    updated: updated || 0,
    skipped: skipped || 0,
    failed: (failedRows || []).length,
    successRate: rowsTotal ? Number((((inserted || 0) + (updated || 0)) / rowsTotal * 100).toFixed(1)) : 0,
    reasons: Object.entries(reasons).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    warnings: Object.entries(warnings).map(([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count),
    autoFixes: Object.entries(fixes).map(([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count),
    failedRows: (failedRows || []).slice(0, 500),
    startedAt, endedAt,
    durationMs: startedAt && endedAt ? new Date(endedAt) - new Date(startedAt) : null,
  }
}
