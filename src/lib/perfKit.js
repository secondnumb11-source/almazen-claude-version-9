import { supabase } from './supabase'

/*
  عُدّة الأداء — تعالج السببين الفعليين لبطء التنقّل بين الأقسام:

  (1) كل انتقال يُنزّل حزمة الصفحة من جديد (Settings وحدها 635 كيلوبايت).
      الحل: تحميل مسبق عند التحويم على القسم في اللوحة الجانبية، فتصل
      الحزمة قبل النقر بلحظات.

  (2) كل انتقال يُعيد جلب البيانات نفسها من الصفر بلا تخزين مؤقت،
      واستعلامات الصفحة متسلسلة لا متوازية.
      الحل: ذاكرة قصيرة العمر مع دمج الطلبات المتطابقة الجارية.

  ولأن ما لا يُقاس لا يُدار، تُسجَّل أزمنة الصفحات في ci_perf_samples
  فتظهر في لوحة السوبر أدمن كأرقام حقيقية بدل انطباعات.
*/

/* ------------------------- (1) التحميل المسبق ------------------------- */

// خرائط الاستيراد الكسول: نفس المسارات المستخدمة في App.jsx.
// Vite يحتاج مسارات ساكنة، لذلك تُكتب صراحةً ولا تُبنى ديناميكياً.
const LOADERS = {
  dash: () => import('../pages/Dashboard'),
  customers: () => import('../pages/CustomersManagement'),
  maintenance: () => import('../pages/Maintenance.jsx'),
  staff: () => import('../pages/EmployeeManagement'),
  ops: () => import('../pages/EmployeeOps'),
  reports: () => import('../pages/Reports'),
  settlements: () => import('../pages/SettlementHistory'),
  audit: () => import('../pages/AuditReport'),
  center: () => import('../pages/ReportCenter'),
  assistant: () => import('../pages/Assistant'),
  settings: () => import('../pages/Settings'),
  channels: () => import('../pages/ChannelManagerPanel'),
  ejar: () => import('../pages/EjarPanel'),
  gl: () => import('../pages/accounting/GeneralLedgerPage'),
  tb: () => import('../pages/accounting/TrialBalancePage'),
  'tb-check': () => import('../pages/accounting/TrialBalancePage'),
  'je-list': () => import('../pages/accounting/JournalListPage'),
  'je-new': () => import('../pages/accounting/JournalListPage'),
  'je-report': () => import('../pages/accounting/JournalListPage'),
  coa: () => import('../pages/accounting/ChartOfAccountsPage'),
  'cost-centers': () => import('../pages/accounting/CostCentersPage'),
  vat: () => import('../pages/accounting/TaxCenterPage'),
  services: () => import('../pages/accounting/ServicesPage'),
  'deferred-rev': () => import('../pages/accounting/DeferredPage'),
  'deferred-exp': () => import('../pages/accounting/DeferredPage'),
  'acct-settings': () => import('../pages/accounting/AccountingSettingsPage'),
  'reports-hub': () => import('../pages/accounting/ReportsHubPage'),
  'tests-hub': () => import('../pages/accounting/TestsHubPage'),
  'digital-docs': () => import('../pages/accounting/DigitalDocsPage'),
  odoo: () => import('../pages/accounting/OdooPage'),
  shomoos: () => import('../pages/accounting/ShomoosPage'),
}

const prefetched = new Set()

/** يُنزّل حزمة القسم قبل النقر عليه. آمن: الفشل يُتجاهل والنقر يعمل كالعادة. */
export function prefetchPage(key) {
  const k = String(key || '').split(':')[0]
  if (!k || prefetched.has(k)) return
  const load = LOADERS[k]
  if (!load) return
  prefetched.add(k)
  load().catch(() => prefetched.delete(k))
}

/** يُنزّل أثقل الحزم في وقت الخمول بعد الإقلاع، فلا ينتظرها المستخدم لاحقاً. */
export function warmHeavyChunks() {
  if (typeof window === 'undefined') return
  const run = () => ['dash', 'reports', 'settings', 'customers'].forEach(prefetchPage)
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 })
  else setTimeout(run, 2500)
}

/* --------------------- (2) الذاكرة المؤقتة ودمج الطلبات --------------------- */

const cache = new Map()      // key → { at, data }
const inflight = new Map()   // key → Promise
const DEFAULT_TTL = 30_000

/**
 * ينفّذ الاستعلام مرة واحدة لكل مفتاح خلال مدة الصلاحية.
 * الطلبات المتطابقة المتزامنة تتشارك نفس الوعد بدل أن تتضاعف —
 * وهو ما كان يحدث حين تفتح صفحة عدة مكوّنات تطلب البيانات نفسها.
 */
export async function cachedQuery(key, fetcher, ttl = DEFAULT_TTL) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.data
  if (inflight.has(key)) return inflight.get(key)

  const p = (async () => {
    try {
      const data = await fetcher()
      cache.set(key, { at: Date.now(), data })
      return data
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)
  return p
}

/** يُبطل الذاكرة بعد أي كتابة حتى لا يرى المستخدم بيانات قديمة. */
export function invalidateCache(prefix) {
  if (!prefix) { cache.clear(); return }
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k)
}

export const cacheStats = () => ({ entries: cache.size, inflight: inflight.size })

/* ---------------------------- (3) القياس ---------------------------- */

const marks = new Map()
let pending = []
let flushTimer = null

/** يبدأ قياس زمن فتح صفحة. */
export function markPageStart(page) {
  marks.set(page, performance.now())
}

/**
 * ينهي القياس ويجدوله للإرسال.
 * الإرسال مُجمَّع كل خمس ثوانٍ: القياس نفسه يجب ألا يصير سبباً للبطء.
 */
export function markPageEnd(page, meta = {}) {
  const t0 = marks.get(page)
  if (t0 == null) return
  marks.delete(page)
  const ms = Math.round(performance.now() - t0)
  pending.push({ scope: 'page', name: page, duration_ms: ms, meta })
  if (!flushTimer) flushTimer = setTimeout(flushSamples, 5000)
  return ms
}

async function flushSamples() {
  flushTimer = null
  const batch = pending
  pending = []
  if (!batch.length) return
  try {
    const { data: u } = await supabase.auth.getUser()
    await supabase.from('ci_perf_samples').insert(
      batch.map(b => ({ ...b, user_id: u?.user?.id || null })),
    )
  } catch {
    /* القياس خدمة مساعدة — فشل تسجيله لا يُبلّغ المستخدم ولا يُعاد */
  }
}

/** يقيس زمن أي عملية غير متزامنة ويسجّلها تحت نطاق محدّد. */
export async function measure(scope, name, fn) {
  const t0 = performance.now()
  try {
    return await fn()
  } finally {
    pending.push({ scope, name, duration_ms: Math.round(performance.now() - t0) })
    if (!flushTimer) flushTimer = setTimeout(flushSamples, 5000)
  }
}
