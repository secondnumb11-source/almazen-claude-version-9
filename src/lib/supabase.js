import { createClient } from '@supabase/supabase-js'

// مشروع قاعدة البيانات الرسمي للمنصة — مثبّت صراحةً حتى لا تُبدّله أي متغيرات
// بيئة تُحقن تلقائياً من منصات الاستضافة/التطوير وتوجّه التطبيق لقاعدة فارغة خاطئة.
const PRIMARY_PROJECT_REF = 'drowmezlcrvowuhqmfef'
const FALLBACK_SUPABASE_URL = `https://${PRIMARY_PROJECT_REF}.supabase.co`
const FALLBACK_SUPABASE_PUBLISHABLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyb3dtZXpsY3J2b3d1aHFtZmVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4Mjg3OTAsImV4cCI6MjA5OTQwNDc5MH0.VaIHdWtXZH_z9tdhFqO82IL1hTCUQdT3VzBtJQjsXkY'

const envUrl = import.meta.env.VITE_SUPABASE_URL
const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
// نقبل متغيرات البيئة فقط إذا كانت تخص نفس مشروع المنصة، وإلا نستخدم القيم الرسمية.
const envMatchesPrimary = typeof envUrl === 'string' && envUrl.includes(PRIMARY_PROJECT_REF)

const rawUrl = envMatchesPrimary ? envUrl : FALLBACK_SUPABASE_URL
const rawKey = (envMatchesPrimary && envKey) ? envKey : FALLBACK_SUPABASE_PUBLISHABLE_KEY


const url = typeof rawUrl === 'string' ? rawUrl.trim() : ''
const key = typeof rawKey === 'string' ? rawKey.trim() : ''

// تحقق تفصيلي من صحة الإعدادات — يُستخدم في شاشة التنبيه بدل رسالة عامة
const PLACEHOLDER_URL = /YOUR-?PROJECT-?REF|example\.supabase\.co/i
const PLACEHOLDER_KEY = /YOUR-?ANON|placeholder|paste.?here/i
const URL_SHAPE = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i
// المفاتيح القديمة JWT (تبدأ بـ eyJ) أو الجديدة sb_publishable_
const KEY_SHAPE = /^(eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_publishable_[A-Za-z0-9_-]+)$/

export const supabaseConfigIssues = (() => {
  const issues = []
  if (!url) issues.push({ field: 'VITE_SUPABASE_URL', reason: 'غير موجود في ملف .env' })
  else if (PLACEHOLDER_URL.test(url)) issues.push({ field: 'VITE_SUPABASE_URL', reason: 'يحتوي قيمة placeholder — استبدله برابط مشروعك الحقيقي' })
  else if (!URL_SHAPE.test(url)) issues.push({ field: 'VITE_SUPABASE_URL', reason: 'الصيغة غير صحيحة — يجب أن يكون مثل https://xxxxx.supabase.co' })

  if (!key) issues.push({ field: 'VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY', reason: 'غير موجود في متغيرات البيئة' })
  else if (PLACEHOLDER_KEY.test(key)) issues.push({ field: 'VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY', reason: 'يحتوي قيمة placeholder — استبدله بالمفتاح العام الحقيقي من إعدادات API' })
  else if (!KEY_SHAPE.test(key)) issues.push({ field: 'VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY', reason: 'الصيغة لا تشبه مفتاح Supabase العام (يبدأ عادةً بـ eyJ أو sb_publishable_)' })

  return issues
})()

export const hasSupabaseConfig = supabaseConfigIssues.length === 0
const missingConfigMessage = 'إعدادات الاتصال بـ Supabase غير مكتملة أو غير صحيحة. راجع ملف .env.'
const missingConfigError = () => ({ message: missingConfigMessage })

const noOpQuery = {
  select: () => noOpQuery,
  insert: () => noOpQuery,
  update: () => noOpQuery,
  delete: () => noOpQuery,
  upsert: () => noOpQuery,
  eq: () => noOpQuery,
  neq: () => noOpQuery,
  in: () => noOpQuery,
  gte: () => noOpQuery,
  lte: () => noOpQuery,
  order: () => noOpQuery,
  limit: () => noOpQuery,
  maybeSingle: async () => ({ data: null, error: missingConfigError() }),
  single: async () => ({ data: null, error: missingConfigError() }),
  then: (resolve) => Promise.resolve({ data: [], error: missingConfigError() }).then(resolve),
}

const offlineClient = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signInWithPassword: async () => ({ data: null, error: missingConfigError() }),
    signUp: async () => ({ data: null, error: missingConfigError() }),
    resetPasswordForEmail: async () => ({ data: null, error: missingConfigError() }),
    updateUser: async () => ({ data: null, error: missingConfigError() }),
    exchangeCodeForSession: async () => ({ data: null, error: missingConfigError() }),
    setSession: async () => ({ data: null, error: missingConfigError() }),
    signOut: async () => ({ error: null }),
  },
  from: () => noOpQuery,
  rpc: async () => ({ data: null, error: missingConfigError() }),
  functions: {
    invoke: async () => ({ data: null, error: missingConfigError() }),
  },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
  removeChannel: () => {},
}

if (!hasSupabaseConfig) {
  console.warn('⚠ إعدادات Supabase غير صحيحة:', supabaseConfigIssues)
}

export const supabase = hasSupabaseConfig ? createClient(url, key) : offlineClient

// عنوان مشروع Supabase — يُستخدم لبناء رابط الـ Edge Functions (مثل webhook مدير القنوات)
export const SUPABASE_URL = url || FALLBACK_SUPABASE_URL

// مستأجر ثانوي لإنشاء حسابات الموظفين دون فقدان جلسة المدير
export const adminSignupClient = hasSupabaseConfig ? createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: 'sb-admin-signup-auth-token',
    storage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    }
  }
}) : offlineClient

// تحويل اسم مستخدم الموظف إلى بريد داخلي
export const normalizeStaffUsername = (username) => username.trim().toLowerCase()
export const staffEmail = (username) => `${normalizeStaffUsername(username)}@staff.almazen.app`
export const staffEmailCandidates = (username) => {
  const base = normalizeStaffUsername(username)
  return [...new Set([
    base,
    base.replaceAll('.', '_'),
    base.replaceAll('_', '.'),
  ].filter(Boolean).map(name => `${name}@staff.almazen.app`))]
}
