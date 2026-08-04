import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { translateAuthError, authErrorDetails } from '../lib/authErrors'

// صفحة تعيين كلمة مرور جديدة عبر رابط الاستعادة.
// تدعم الشكلين:
//  - PKCE:      /reset-password?code=...
//  - Hash flow: /reset-password#access_token=...&refresh_token=...&type=recovery
// بعد النجاح: تسجيل خروج + إعادة توجيه تلقائي للصفحة الرئيسية.
export default function ResetPassword() {
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)     // { msg, details }
  const [notice, setNotice] = useState('جاري التحقق من رابط الاستعادة...')
  const [done, setDone] = useState(false)
  const [form, setForm] = useState({ pass: '', confirm: '' })

  const showError = (err) => setError({
    msg: translateAuthError(err),
    details: authErrorDetails(err),
  })

  useEffect(() => {
    let active = true
    const prepare = async () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))

        // بعض الأخطاء تصل داخل الـ hash (مثلاً otp_expired)
        const hashError = hash.get('error') || hash.get('error_code')
        if (hashError) {
          const desc = hash.get('error_description') || hashError
          showError({ message: desc })
          setNotice('')
          return
        }

        const code = params.get('code')
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) { showError(error); setNotice(''); return }
        }

        if (hash.get('type') === 'recovery' && hash.get('access_token') && hash.get('refresh_token')) {
          const { error } = await supabase.auth.setSession({
            access_token: hash.get('access_token'),
            refresh_token: hash.get('refresh_token'),
          })
          if (error) { showError(error); setNotice(''); return }
        }

        const { data } = await supabase.auth.getSession()
        if (!active) return
        if (data.session) {
          setReady(true)
          setNotice('')
        } else {
          setReady(false)
          setNotice('')
          showError({ message: 'رابط الاستعادة غير صالح أو انتهت صلاحيته. اطلب رابطاً جديداً من صفحة تسجيل الدخول.' })
        }
      } catch (e) {
        showError(e)
        setNotice('')
      }
    }
    prepare()
    return () => { active = false }
  }, [])

  const updatePassword = async () => {
    setError(null)
    if (form.pass.length < 6) return showError({ message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.' })
    if (form.pass !== form.confirm) return showError({ message: 'كلمتا المرور غير متطابقتين.' })
    setBusy(true)
    const { error: upErr } = await supabase.auth.updateUser({ password: form.pass })
    if (upErr) { setBusy(false); return showError(upErr) }
    await supabase.auth.signOut()
    setBusy(false)
    setDone(true)
    setReady(false)
    setNotice('تم تحديث كلمة المرور بنجاح. سيتم تحويلك لصفحة تسجيل الدخول خلال ثوانٍ...')
    setTimeout(() => { window.location.replace('/') }, 2500)
  }

  return (
    <div className="login-wrap"><div className="login-card">
      <div className="login-side">
        <div className="logo" style={{ color: '#fff' }}><span className="mark">م</span> المازن</div>
        <h2>تعيين كلمة مرور جديدة</h2>
        <p style={{ color: '#C9D6E2', fontSize: 14 }}>استخدم الرابط المرسل إلى بريدك الإلكتروني لإنشاء كلمة مرور جديدة لحسابك.</p>
      </div>
      <div className="login-form">
        {error && (
          <div className="auth-note err" style={{ whiteSpace: 'pre-wrap' }}>
            <b>خطأ:</b> {error.msg}
            {error.details && <div style={{ opacity: .7, fontSize: 12, marginTop: 4, direction: 'ltr' }}>{error.details}</div>}
          </div>
        )}
        {notice && <div className={'auth-note' + (done ? '' : '')}>{notice}</div>}

        {ready ? (<>
          <div className="fld"><label>كلمة المرور الجديدة</label>
            <input type="password" value={form.pass} onChange={e => setForm({ ...form, pass: e.target.value })} /></div>
          <div className="fld"><label>تأكيد كلمة المرور</label>
            <input type="password" value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} /></div>
          <button className="btn btn-blue" style={{ width: '100%' }} disabled={busy} onClick={updatePassword}>حفظ كلمة المرور الجديدة</button>
        </>) : !done && !notice && (
          <a className="btn btn-blue" style={{ width: '100%', justifyContent: 'center', textDecoration: 'none' }} href="/">العودة لتسجيل الدخول</a>
        )}
        {done && (
          <a className="btn btn-blue" style={{ width: '100%', justifyContent: 'center', textDecoration: 'none', marginTop: 10 }} href="/">الذهاب لتسجيل الدخول الآن</a>
        )}
      </div>
    </div></div>
  )
}
