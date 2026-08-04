#!/usr/bin/env node
/**
 * db:verify — فحوصات تلقائية بعد كل ترحيل إلى Supabase.
 * ينفّذ supabase/verify_migrations.sql عبر Management API ويفشل (exit 1)
 * عند أي نقص في الدوال/القيود/الحمايات.
 *
 * المتغيرات المطلوبة:
 *   SUPABASE_ACCESS_TOKEN   رمز الوصول للإدارة (sbp_...)
 *   SUPABASE_PROJECT_REF    معرّف المشروع (افتراضي من VITE_SUPABASE_URL)
 */
import { readFileSync } from 'node:fs'

const token = process.env.SUPABASE_ACCESS_TOKEN
let ref = process.env.SUPABASE_PROJECT_REF
if (!ref && process.env.VITE_SUPABASE_URL) {
  ref = new URL(process.env.VITE_SUPABASE_URL).hostname.split('.')[0]
}
if (!token || !ref) {
  console.error('✖ يلزم ضبط SUPABASE_ACCESS_TOKEN و SUPABASE_PROJECT_REF (أو VITE_SUPABASE_URL).')
  process.exit(2)
}

const query = readFileSync(new URL('../supabase/verify_migrations.sql', import.meta.url), 'utf8')

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
})
const body = await res.json().catch(() => null)

if (!res.ok || (body && body.message)) {
  console.error('✖ فشل التحقق بعد الترحيل:\n' + (body?.message || res.statusText))
  process.exit(1)
}
console.log('✔ VERIFY_OK — جميع الفحوصات بعد الترحيل ناجحة (دوال، قيود، RLS، حمايات الاشتراك والإحالات).')
