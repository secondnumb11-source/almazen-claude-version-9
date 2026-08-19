import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { SAR } from '../lib/helpers'
import { DOC_KINDS } from '../lib/documentSerial'
import almazenLogo from '../assets/almazen-logo.png'

/*
  صفحة التحقق العامة من مستند — الوجهة التي يفتحها رمز QR على المطبوعات.

  عامة بالكامل بلا تسجيل دخول: من يمسك ورقة مطبوعة يمسح رمزها فيرى فوراً
  هل هي صادرة عن المنشأة فعلاً، أم ملغاة، أم محرَّفة.

  كل البيانات تأتي من doc_verify وهي دالة SECURITY DEFINER تعيد حقولاً
  آمنة فقط: رقم المستند ونوعه وعنوانه وتاريخه وقيمته والجهة المُصدِرة.
  لا اسم مستأجر ولا رقم هوية ولا جوال — فمسح الرمز لا يكشف بيانات أحد.
  وتكشف الدالة حالتين إضافيتين: مستند ملغى (revoked_at)، ومستند لا يطابق
  بصمة محتواه المسجّلة (content_hash) أي يُشتبه في تحريفه.
*/
export default function DocVerify({ code }) {
  const [state, setState] = useState('loading')
  const [res, setRes] = useState(null)

  useEffect(() => {
    let alive = true
    if (!code) { setState('bad'); return }
    supabase.rpc('doc_verify', { p_code: code })
      .then(({ data, error }) => {
        if (!alive) return
        if (error || !data) { setState('bad'); return }
        setRes(data); setState('done')
      })
      .catch(() => { if (alive) setState('bad') })
    return () => { alive = false }
  }, [code])

  const kindLabel = res?.kind ? (DOC_KINDS[res.kind] || res.kind) : ''
  const fmtDate = (v) => {
    if (!v) return '—'
    try { return new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) }
    catch { return String(v).slice(0, 10) }
  }

  return (
    <div className="dv-page" dir="rtl">
      <div className="dv-card">
        <img className="dv-logo" src={almazenLogo} alt="منصة المازن" />
        <h1>التحقق من صحة مستند</h1>

        {state === 'loading' && <p className="dv-muted">جارٍ التحقق…</p>}

        {state === 'bad' && (
          <div className="dv-result dv-bad">
            <div className="dv-ico">⚠️</div>
            <b>تعذّر التحقق</b>
            <span>الرمز غير صحيح أو الرابط ناقص. تأكد من مسح الرمز كاملاً من المستند الأصلي.</span>
          </div>
        )}

        {state === 'done' && res && !res.valid && (
          <div className="dv-result dv-bad">
            <div className="dv-ico">⛔</div>
            <b>مستند غير صالح</b>
            <span>{res.reason || 'لم يُعثر على مستند بهذا الرمز.'}</span>
            {res.revoked_at && <span className="dv-muted">تاريخ الإلغاء: {fmtDate(res.revoked_at)}</span>}
          </div>
        )}

        {state === 'done' && res?.valid && (
          <>
            <div className="dv-result dv-ok">
              <div className="dv-ico">✓</div>
              <b>مستند صحيح وصادر عن جهة مسجّلة</b>
              <span>هذا المستند مقيَّد في سجل المستندات ولم يُلغَ.</span>
            </div>
            <dl className="dv-grid">
              <div><dt>الجهة المُصدِرة</dt><dd>{res.issuer}</dd></div>
              <div><dt>نوع المستند</dt><dd>{kindLabel || '—'}</dd></div>
              <div><dt>رقم المستند</dt><dd dir="ltr">{res.serial || '—'}</dd></div>
              {res.title && <div><dt>العنوان</dt><dd>{res.title}</dd></div>}
              <div><dt>تاريخ المستند</dt><dd>{fmtDate(res.doc_date || res.issued_at)}</dd></div>
              {res.total != null && <div><dt>القيمة</dt><dd>{SAR(res.total)}</dd></div>}
            </dl>
          </>
        )}

        <p className="dv-note">
          التحقق لا يكشف أي بيانات شخصية — لا اسم مستأجر ولا رقم هوية ولا جوال.
        </p>
      </div>
    </div>
  )
}
