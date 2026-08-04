/*
  تعريف واحد لخريطة التنقّل يستخدمه: لوحة البيانات الجانبية، أداة البحث،
  وإعدادات الترتيب والإخفاء. مصدر واحد للحقيقة يمنع اختلاف القوائم عن الصفحات.

  roles: all | finance | owner | accountant | employee | superadmin
  group.items[] قد يحتوي عناصر مباشرة أو مجموعات فرعية عبر children.
*/

export const NAV_GROUPS = [
  {
    id: 'main', category: 'الرئيسية والعمليات', icon: '⚡',
    items: [
      { k: 'home', label: 'الرئيسية', icon: '🏠', roles: 'all', keywords: 'لوحة البيانات مؤشرات' },
      { k: 'dash', label: 'إدارة الوحدات والحجوزات', icon: '🏢', roles: 'all', keywords: 'وحدات غرف حجز شقق' },
      { k: 'customers', label: 'إدارة العملاء والمستأجرين', icon: '👥', roles: 'all', keywords: 'عملاء نزلاء مستأجر' },
      { k: 'ops', label: 'العمليات اليومية', icon: '🧰', roles: 'employee', keywords: 'تشغيل يومي' },
    ],
  },
  {
    id: 'ops', category: 'التشغيل والصيانة', icon: '🔧',
    items: [
      { k: 'maintenance', label: 'إدارة الصيانة', icon: '🛠️', roles: 'all', keywords: 'أعطال بلاغات صيانة' },
      { k: 'staff', label: 'إدارة الموظفين', icon: '🧑‍💼', roles: 'finance', keywords: 'موظفين رواتب صلاحيات' },
    ],
  },

  /* ============ المحاسبة: قوائم منسدلة متتالية ============ */
  {
    id: 'acct-journals', category: 'القيود المحاسبية', icon: '📝', accordion: true, roles: 'finance',
    items: [
      { k: 'je-new', label: 'إضافة قيد جديد', icon: '➕', roles: 'finance', keywords: 'قيد يومية إضافة جديد' },
      { k: 'je-list', label: 'ملخص القيود المسجلة', icon: '📋', roles: 'finance', keywords: 'قيود ملخص مسجلة يومية' },
      { k: 'je-report', label: 'تقرير القيود المحاسبية', icon: '🧾', roles: 'finance', keywords: 'تقرير قيود' },
    ],
  },
  {
    id: 'acct-ledger', category: 'دفتر الأستاذ', icon: '📖', accordion: true, roles: 'finance',
    items: [
      { k: 'gl', label: 'كشف حساب الأستاذ', icon: '📖', roles: 'finance', keywords: 'أستاذ دفتر كشف حساب رصيد' },
      { k: 'coa', label: 'شجرة الحسابات', icon: '🌳', roles: 'finance', keywords: 'شجرة حسابات دليل أصل فروع' },
      { k: 'cost-centers', label: 'مراكز التكلفة', icon: '🎯', roles: 'finance', keywords: 'مركز تكلفة إدارة بند فرع' },
    ],
  },
  {
    id: 'acct-tb', category: 'ميزان المراجعة', icon: '⚖️', accordion: true, roles: 'finance',
    items: [
      { k: 'tb', label: 'ميزان المراجعة الكامل', icon: '⚖️', roles: 'finance', keywords: 'ميزان مراجعة رصيد أول المدة حركة' },
      { k: 'tb-check', label: 'فحص صحة الميزان والإصلاح', icon: '🛡️', roles: 'finance', keywords: 'فحص ميزان إصلاح توازن' },
    ],
  },
  {
    id: 'acct-deferred', category: 'الإيرادات والنفقات المؤجلة', icon: '⏳', accordion: true, roles: 'finance',
    items: [
      { k: 'deferred-rev', label: 'قيود الإيرادات المؤجلة', icon: '📥', roles: 'finance', keywords: 'إيراد مؤجل استحقاق' },
      { k: 'deferred-exp', label: 'قيود النفقات المؤجلة', icon: '📤', roles: 'finance', keywords: 'مصروف مؤجل مدفوع مقدما' },
      { k: 'acct-settings', label: 'الحسابات الافتراضية والفترة المالية', icon: '⚙️', roles: 'finance', keywords: 'حسابات افتراضية فترة مالية إقفال' },
    ],
  },
  {
    id: 'acct-tax', category: 'الضريبة', icon: '％', accordion: true, roles: 'finance',
    items: [
      { k: 'vat', label: 'ضريبة القيمة المضافة', icon: '％', roles: 'finance', keywords: 'ضريبة قيمة مضافة vat مخرجات مدخلات' },
    ],
  },
  {
    id: 'acct-services', category: 'الخدمات', icon: '🧾', accordion: true, roles: 'finance',
    items: [
      { k: 'services', label: 'كل الخدمات', icon: '🧾', roles: 'finance', keywords: 'خدمات بنود كتالوج' },
      { k: 'services:الإيرادات', label: '— الإيرادات', icon: '📥', roles: 'finance', keywords: 'إيرادات مبيعات فوائد' },
      { k: 'srv:SRV-R01', label: 'الفوائد المستلمة', icon: '💹', roles: 'finance', keywords: 'فوائد بنكية مستلمة إيراد' },
      { k: 'srv:SRV-R02', label: 'المبيعات', icon: '🛒', roles: 'finance', keywords: 'مبيعات إيراد' },
      { k: 'srv:SRV-R03', label: 'إيرادات تأجير الوحدات', icon: '🏠', roles: 'finance', keywords: 'إيجار تأجير وحدات إيراد' },
      { k: 'srv:SRV-R04', label: 'إيرادات الخدمات الفندقية', icon: '🛎️', roles: 'finance', keywords: 'فندقية خدمات إيراد' },
      { k: 'services:مصاريف المشروعات', label: '— مصاريف المشروعات', icon: '🏗️', roles: 'finance', keywords: 'مشروعات' },
      { k: 'srv:SRV-P01', label: 'مصاريف المشروعات', icon: '🏗️', roles: 'finance', keywords: 'مشروعات مصاريف' },
      { k: 'srv:SRV-P02', label: 'عدد وأدوات للمجموعات', icon: '🧰', roles: 'finance', keywords: 'عدد أدوات مجموعات' },
      { k: 'srv:SRV-P03', label: 'ملابس سفتي للعاملين', icon: '🦺', roles: 'finance', keywords: 'ملابس سفتي سلامة عاملين' },
      { k: 'services:المصروفات', label: '— المصروفات', icon: '📤', roles: 'finance', keywords: 'مصروفات' },
      { k: 'srv:SRV-E01', label: 'أجهزة الحاسب الآلي', icon: '💻', roles: 'finance', keywords: 'حاسب كمبيوتر أجهزة' },
      { k: 'srv:SRV-E02', label: 'الأتعاب المحاسبية', icon: '🧮', roles: 'finance', keywords: 'أتعاب محاسبية مراجع' },
      { k: 'srv:SRV-E03', label: 'الإصلاحات والصيانة', icon: '🔧', roles: 'finance', keywords: 'إصلاح صيانة' },
      { k: 'srv:SRV-E04', label: 'الإعلانات والترويج', icon: '📣', roles: 'finance', keywords: 'إعلان ترويج تسويق' },
      { k: 'srv:SRV-E05', label: 'التأجير', icon: '🔑', roles: 'finance', keywords: 'تأجير إيجار مصروف' },
      { k: 'srv:SRV-E06', label: 'التبرعات', icon: '🎗️', roles: 'finance', keywords: 'تبرعات' },
      { k: 'srv:SRV-E07', label: 'الترفيه', icon: '🎭', roles: 'finance', keywords: 'ترفيه ضيافة' },
      { k: 'srv:SRV-E08', label: 'الرسوم القانونية', icon: '⚖️', roles: 'finance', keywords: 'رسوم قانونية محاماة' },
      { k: 'srv:SRV-E09', label: 'الطباعة والقرطاسية', icon: '🖨️', roles: 'finance', keywords: 'طباعة قرطاسية' },
      { k: 'srv:SRV-E10', label: 'الكهرباء', icon: '💡', roles: 'finance', keywords: 'كهرباء فاتورة' },
      { k: 'srv:SRV-E11', label: 'المصاريف البنكية', icon: '🏦', roles: 'finance', keywords: 'بنكية رسوم بنك' },
      { k: 'srv:SRV-E12', label: 'المياه', icon: '🚰', roles: 'finance', keywords: 'مياه فاتورة' },
      { k: 'srv:SRV-E13', label: 'الاتصالات والإنترنت', icon: '📶', roles: 'finance', keywords: 'اتصالات إنترنت' },
      { k: 'srv:SRV-E14', label: 'النظافة والتشغيل', icon: '🧹', roles: 'finance', keywords: 'نظافة تشغيل' },
      { k: 'srv:SRV-E15', label: 'الرواتب والأجور', icon: '💵', roles: 'finance', keywords: 'رواتب أجور موظفين' },
      { k: 'srv:SRV-E16', label: 'التأمينات الاجتماعية', icon: '🛡️', roles: 'finance', keywords: 'تأمينات اجتماعية gosi' },
      { k: 'srv:SRV-E17', label: 'الوقود والمحروقات', icon: '⛽', roles: 'finance', keywords: 'وقود بنزين محروقات' },
      { k: 'srv:SRV-E18', label: 'الاشتراكات والتراخيص', icon: '📜', roles: 'finance', keywords: 'اشتراكات تراخيص رخص' },
    ],
  },
  {
    id: 'acct-reports', category: 'التقارير المحاسبية', icon: '📊', accordion: true, roles: 'finance',
    items: [
      { k: 'reports-hub', label: 'مركز التقارير المحاسبية', icon: '📊', roles: 'finance', keywords: 'تقارير قائمة الدخل مركز مالي تدفقات' },
      { k: 'digital-docs', label: 'سجل المستندات الرقمية', icon: '🔏', roles: 'finance', keywords: 'رقمنة مستند ختم تسلسلي رمز تحقق بصمة' },
      { k: 'reports', label: 'المحاسبة والتقارير التشغيلية', icon: '💼', roles: 'finance', keywords: 'محاسبة تقارير مدفوعات' },
      { k: 'settlements', label: 'سجل التسويات المحاسبية', icon: '📚', roles: 'finance', keywords: 'تسوية تصفية حساب' },
      { k: 'audit', label: 'تقرير التدقيق المحاسبي', icon: '🔍', roles: 'finance', keywords: 'تدقيق مراجعة' },
      { k: 'center', label: 'مركز التقارير والمراقبة', icon: '🛰️', roles: 'finance', keywords: 'مراقبة تقارير مركز' },
    ],
  },
  {
    id: 'acct-tests', category: 'اختبارات ذكية لسلامة النظام', icon: '🧪', accordion: true, roles: 'finance',
    items: [
      { k: 'tests-hub', label: 'مركز الاختبارات الذكية', icon: '🧪', roles: 'finance', keywords: 'اختبار فحص سلامة إصلاح' },
    ],
  },

  {
    id: 'ai', category: 'الذكاء والتحليل', icon: '🤖',
    items: [
      { k: 'assistant', label: 'المساعد الذكي AI', icon: '🤖', roles: 'finance', keywords: 'مساعد ذكاء اصطناعي' },
    ],
  },
  {
    id: 'integrations', category: 'الربط والتكاملات', icon: '🌐', accordion: true,
    items: [
      { k: 'channels', label: 'ربط منصات الحجز (Booking/Airbnb)', icon: '🌐', roles: 'finance', keywords: 'بوكنق ايربنب قنوات' },
      { k: 'odoo', label: 'الربط مع أودو (Odoo)', icon: '🟣', roles: 'finance', keywords: 'أودو odoo ربط محاسبي خارجي' },
      { k: 'shomoos', label: 'الربط مع شموس ووزارة السياحة', icon: '🛡️', roles: 'finance', keywords: 'شموس وزارة الداخلية السياحة نزلاء تسجيل رخصة' },
      { k: 'ejar', label: 'التكامل مع منصة إيجار', icon: '🏛️', roles: 'finance', soon: true, keywords: 'إيجار عقود' },
    ],
  },
  {
    id: 'referral', category: 'نظام الترشيح', icon: '🎁', accordion: true,
    items: [
      { k: 'referral', label: 'الترشيح والمكافآت', icon: '🎁', roles: 'all', keywords: 'ترشيح مكافأة كود' },
      { k: 'referral-track', label: 'تتبّع حالة الترشيح', icon: '🚦', roles: 'all', keywords: 'تتبع ترشيح حالة' },
    ],
  },
  {
    id: 'system', category: 'النظام والإعدادات', icon: '⚙️',
    items: [
      { k: 'settings', label: 'الإعدادات', icon: '⚙️', roles: 'finance', keywords: 'إعدادات شركة مستخدمين' },
    ],
  },
  {
    id: 'platform', category: 'إدارة المنصة', icon: '👑', accordion: true,
    items: [
      { k: 'superadmin', label: 'لوحة التحكم الشاملة', icon: '🛠️', roles: 'superadmin' },
      { k: 'admin-referrals', label: 'إدارة الترشيحات', icon: '🎯', roles: 'superadmin' },
      { k: 'activity-log', label: 'سجل نشاط المنصة', icon: '🗂️', roles: 'superadmin' },
    ],
  },
]

/** يبني دالة رؤية بحسب دور المستخدم. */
export function makeVisibility({ isSuperAdmin, canFinance, isOwner, isAccountant, isEmployee }) {
  return (i) =>
    i.roles === 'all' ||
    !i.roles ||
    isSuperAdmin ||
    (i.roles === 'finance' && canFinance) ||
    (i.roles === 'owner' && isOwner) ||
    (i.roles === 'accountant' && isAccountant) ||
    (i.roles === 'employee' && isEmployee) ||
    (i.roles === 'superadmin' && isSuperAdmin)
}

/** كل العناصر مسطّحة — تُستخدم في البحث وفي إعدادات الإخفاء والترتيب. */
export function flatNavItems() {
  return NAV_GROUPS.flatMap(g => g.items.map(i => ({ ...i, groupId: g.id, groupLabel: g.category })))
}

/** يطبّق تفضيلات المستخدم: الترتيب، الإخفاء، والمفضّلة. */
export function applyPrefs(groups, prefs) {
  const hidden = new Set(prefs?.hidden || [])
  const order = prefs?.order || []
  const favs = prefs?.favorites || []

  let out = groups
    .map(g => ({ ...g, items: g.items.filter(i => !hidden.has(i.k)) }))
    .filter(g => g.items.length > 0 && !hidden.has('group:' + g.id))

  if (order.length) {
    const rank = new Map(order.map((id, i) => [id, i]))
    out = [...out].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999))
  }

  if (favs.length) {
    const all = flatNavItems()
    const favItems = favs.map(k => all.find(i => i.k === k)).filter(Boolean)
      .filter(i => !hidden.has(i.k))
    if (favItems.length) {
      out = [{ id: '__fav', category: 'المفضّلة', icon: '⭐', items: favItems }, ...out]
    }
  }
  return out
}

/** بحث نصي شامل عبر كل الأقسام والصفحات. */
export function searchNav(query, isVisible) {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return NAV_GROUPS.flatMap(g =>
    g.items
      .filter(isVisible)
      .filter(i => `${i.label} ${i.keywords || ''} ${g.category}`.toLowerCase().includes(q))
      .map(i => ({ ...i, groupLabel: g.category, groupIcon: g.icon })),
  ).slice(0, 20)
}
