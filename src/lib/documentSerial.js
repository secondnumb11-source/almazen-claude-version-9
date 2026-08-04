import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * documentSerial — أرقام سيريال حقيقية للمطبوعات
 * -------------------------------------------------
 * كل رقم يصدر من قاعدة البيانات (issue_document_serial) ويُحفظ في
 * جدول document_registry للمراجعة. إصدار نفس المستند مرتين يُعيد
 * نفس الرقم (idempotent) فلا تتكرر الأرقام ولا تتضارب.
 */

export const DOC_KINDS = {
  invoice: 'فاتورة', contract: 'عقد', receipt: 'سند قبض', payment: 'سند صرف',
  voucher: 'سند', expense: 'مصروف', handover: 'محضر تسليم', settlement: 'تسوية',
  statement: 'كشف حساب', report: 'تقرير', unit: 'وحدة', employee: 'موظف', customer: 'عميل',
}

const memo = new Map()

/** إصدار (أو استرجاع) رقم سيريال محفوظ */
export async function issueSerial(kind, { table = null, id = null, meta = {} } = {}) {
  const cacheKey = `${kind}:${table || '-'}:${id || '-'}`
  if (id && memo.has(cacheKey)) return memo.get(cacheKey)
  try {
    const { data, error } = await supabase.rpc('issue_document_serial', {
      p_kind: kind, p_entity_table: table, p_entity_id: id, p_meta: meta,
    })
    if (error || !data) throw error || new Error('no serial')
    if (id) memo.set(cacheKey, data)
    return data
  } catch (e) {
    // بديل محلي مؤقت لا يُحفظ — لا يجب أن تفشل الطباعة أبداً
    return null
  }
}

/** هوك جاهز للاستخدام داخل مكوّنات الطباعة */
export function useDocumentSerial(kind, { table = null, id = null, meta = null, enabled = true, fallback = '' } = {}) {
  const [serial, setSerial] = useState(fallback || '')
  const metaKey = meta ? JSON.stringify(meta) : ''
  useEffect(() => {
    let alive = true
    if (!enabled || !kind) return
    issueSerial(kind, { table, id, meta: meta || {} }).then(s => {
      if (alive && s) setSerial(s)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, table, id, metaKey, enabled])
  return serial || fallback || ''
}

/**
 * تسجيل رقم مستند مُولَّد مسبقاً (مثل رقم الفاتورة أو رقم العقد) في
 * document_registry حتى تبقى كل المطبوعات مسجّلة في مكان واحد.
 * فشل التسجيل لا يعطّل الطباعة إطلاقاً.
 */
export async function registerSerial(kind, serial, { table = null, id = null, meta = {} } = {}) {
  if (!serial) return null
  const cacheKey = `reg:${kind}:${table || '-'}:${id || '-'}:${serial}`
  if (memo.has(cacheKey)) return memo.get(cacheKey)
  memo.set(cacheKey, serial)
  try {
    await supabase.rpc('register_document_serial', {
      p_kind: kind, p_serial: String(serial), p_entity_table: table, p_entity_id: id, p_meta: meta,
    })
  } catch { /* التسجيل اختياري — لا يجب أن يفشل المستند بسببه */ }
  return serial
}

/**
 * يعيد رقم المستند النهائي: يستخدم الرقم الموجود (ويسجّله) أو يصدر
 * رقماً حقيقياً جديداً من قاعدة البيانات عند عدم وجوده.
 */
export function useRegisteredSerial(kind, { table = null, id = null, existing = '', meta = null } = {}) {
  const issued = useDocumentSerial(kind, { table, id, meta, enabled: !existing })
  const metaKey = meta ? JSON.stringify(meta) : ''
  useEffect(() => {
    if (existing) registerSerial(kind, existing, { table, id, meta: meta || {} })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, table, id, existing, metaKey])
  return existing || issued || ''
}
