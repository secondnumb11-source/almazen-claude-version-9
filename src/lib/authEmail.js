import { supabase } from './supabase'

export async function invokeAuthEmail(body) {
  const { data, error } = await supabase.functions.invoke('auth-email', { body })
  if (!error) return data

  const parsed = await readFunctionError(error)
  throw {
    message: parsed?.error || parsed?.message || error.message || 'فشل إرسال البريد الإلكتروني.',
    status: parsed?.status || error.context?.status || error.status,
    code: parsed?.code,
    details: parsed?.details || parsed?.hint || parsed?.raw || '',
    name: error.name,
  }
}

async function readFunctionError(error) {
  try {
    if (error?.context && typeof error.context.text === 'function') {
      const raw = await error.context.text()
      if (!raw) return null
      try { return JSON.parse(raw) } catch { return { raw } }
    }
  } catch { /* ignore */ }

  if (/not found|404/i.test(error?.message || '')) {
    return { error: 'وظيفة إرسال بريد المصادقة غير منشورة. أعد نشر وظائف المشروع ثم جرّب مرة أخرى.', status: 404 }
  }
  return null
}