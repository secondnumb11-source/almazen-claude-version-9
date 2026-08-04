import React from 'react'
import { supabaseConfigIssues } from '../lib/supabase'

export default function ConfigErrorScreen() {
  return (
    <div className="login-wrap"><div className="login-card" style={{ maxWidth: 720 }}>
      <div className="login-side">
        <div className="logo" style={{ color: '#fff' }}><span className="mark">م</span> المازن</div>
        <h2>تعذّر بدء التطبيق</h2>
        <p style={{ color: '#C9D6E2', fontSize: 14 }}>
          إعدادات الاتصال بـ Supabase غير مكتملة أو غير صحيحة. يجب إصلاحها قبل أن يعمل تسجيل الدخول.
        </p>
      </div>
      <div className="login-form">
        <h3 className="auth-title" style={{ marginTop: 0 }}>المشاكل المكتشفة</h3>
        <ul style={{ paddingInlineStart: 20, margin: '6px 0 14px', lineHeight: 1.9 }}>
          {supabaseConfigIssues.map((it, i) => (
            <li key={i}><b dir="ltr">{it.field}</b>: {it.reason}</li>
          ))}
        </ul>
        <div className="auth-note">
          <b>كيف تُصلحها:</b>
          <ol style={{ paddingInlineStart: 20, margin: '6px 0', lineHeight: 1.9 }}>
            <li>افتح لوحة Supabase → Project Settings → API.</li>
            <li>انسخ <b dir="ltr">Project URL</b> ولصقه في <code dir="ltr">VITE_SUPABASE_URL</code>.</li>
            <li>انسخ <b dir="ltr">publishable / anon public key</b> ولصقه في <code dir="ltr">VITE_SUPABASE_PUBLISHABLE_KEY</code>.</li>
            <li>احفظ الملف <code>.env</code> ثم أعد تشغيل الخادم (<code dir="ltr">npm run dev</code>).</li>
          </ol>
        </div>
        <pre dir="ltr" style={{
          background: '#0F172A', color: '#C9D6E2', padding: 12, borderRadius: 8,
          fontSize: 12, marginTop: 12, overflowX: 'auto', textAlign: 'left'
        }}>{`VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOi...`}</pre>
        <button className="btn btn-blue" style={{ width: '100%', marginTop: 10 }}
          onClick={() => window.location.reload()}>إعادة تحميل بعد الإصلاح</button>
      </div>
    </div></div>
  )
}
