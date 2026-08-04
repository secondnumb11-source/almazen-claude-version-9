import { supabase } from './supabase'

/**
 * فحص سريع لسياسات RLS بعد الدخول.
 * يعيد { ok, code, message } — عند الفشل بسبب صلاحيات/سياسات يعيد ok=false
 * مع رسالة عربية واضحة، لتظهر بلافتة أعلى الشاشة داخل التطبيق.
 */
export async function checkRlsAccess(companyId) {
  try {
    const checks = await Promise.all([
      supabase.from('profiles').select('id').limit(1),
      companyId
        ? supabase.from('companies').select('id').eq('id', companyId).maybeSingle()
        : Promise.resolve({ error: null }),
    ])
    for (const r of checks) {
      if (r.error) return normalize(r.error)
    }
    return { ok: true }
  } catch (e) {
    return normalize(e)
  }
}

function normalize(err) {
  const code = err?.code || ''
  const msg = err?.message || ''
  const isRls =
    code === '42501' ||
    code === 'PGRST301' ||
    code === '42P17' ||
    /permission denied|row-level security|policy/i.test(msg)
  if (isRls) {
    return {
      ok: false,
      code,
      message:
        'تعذّر الوصول إلى بياناتك بسبب سياسات RLS في قاعدة البيانات. تأكّد من تنفيذ ملفات SQL بالترتيب المذكور في README (خصوصاً POST_SETUP_FIX.sql) ثم أعد المحاولة.',
    }
  }
  return { ok: false, code, message: msg || 'فشل غير متوقع أثناء فحص الصلاحيات.' }
}
