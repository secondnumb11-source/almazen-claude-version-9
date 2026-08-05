import React, { useEffect, useState } from 'react'
import { supabase, staffEmailCandidates } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { translateAuthError, authErrorDetails } from '../lib/authErrors'
import { invokeAuthEmail } from '../lib/authEmail'
import { readRefFromUrl, notifyReferralStepChange } from '../lib/referral'
import { sendWithOutbox } from '../lib/outbox'

import almazenLogo from '../assets/almazen-logo.png'

const REF_STORE_KEY = 'almazen_referral_code'


// نرسل رسائل التسجيل والاستعادة عبر Edge Function تتحقق من Resend/EMAIL_FROM وقت التشغيل.

/*
  Login — تصميم فاخر مع اختيار من الأعلى:
   - عميل حالي: النموذج الأصلي (بوابة موظف / مدير) بدون تعديل.
   - تسجيل جديد لتجربة المنصة 7 أيام: نموذج جمع بيانات كاملة + signUp.
*/
export default function Login({ onBack }) {
  const { session, profile, profileLoadError, toast, reloadProfile } = useAuth()
  const [mode, setMode] = useState('existing') // 'existing' | 'trial'
  const [tab, setTab] = useState('emp')
  const [forgot, setForgot] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [f, setF] = useState({ user: '', email: '', pass: '', resetEmail: '' })
  const [tenantF, setTenantF] = useState({ user: '', token: '' })
  const [setup, setSetup] = useState({ coName: '', fullName: '', vat: '' })
  const [authError, setAuthError] = useState(null)
  const [notice, setNotice] = useState(null)

  // نموذج التسجيل الجديد
  const [trial, setTrial] = useState({
    fullName: '', companyName: '', idOrCr: '', phone: '', email: '', pass: '',
  })
  const [trialDone, setTrialDone] = useState(false)
  const [agreed, setAgreed] = useState(false)

  const [trialAutoConfirmed, setTrialAutoConfirmed] = useState(false)

  // ---- نظام الترشيح: كود من الرابط (?ref=CODE) أو إدخال يدوي ----
  const [refCode, setRefCode] = useState('')
  const [refInfo, setRefInfo] = useState(null)     // { valid, owner_name, code }
  const [refChecking, setRefChecking] = useState(false)

  const verifyRef = async (raw) => {
    const code = (raw || '').trim().toUpperCase()
    if (!code) { setRefInfo(null); return null }
    setRefChecking(true)
    const { data, error } = await supabase.rpc('referral_lookup_code', { p_code: code })
    setRefChecking(false)
    const row = Array.isArray(data) ? data[0] : data
    if (error || !row?.valid) { setRefInfo({ valid: false, code }); return null }
    setRefInfo(row)
    try { localStorage.setItem(REF_STORE_KEY, row.code) } catch { /* ignore */ }
    return row
  }

  useEffect(() => {
    const fromUrl = readRefFromUrl()
    if (!fromUrl) return
    setMode('trial')
    setRefCode(fromUrl)
    verifyRef(fromUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  const showError = (error) => {
    setNotice(null)
    setAuthError({ msg: translateAuthError(error), details: authErrorDetails(error) })
  }
  const clearFeedback = () => { setAuthError(null); setNotice(null) }

  const loginTenant = async (e) => {
    e?.preventDefault?.()
    if (!tenantF.user || !tenantF.token) return showError({ message: 'أدخل اسم المستخدم ورمز الدخول' })
    clearFeedback(); setBusy(true)
    const { data, error } = await supabase.rpc('portal_validate_login', {
      p_username: tenantF.user.trim(),
      p_token: tenantF.token.trim()
    })
    setBusy(false)
    if (error || !data) return showError({ message: 'اسم المستخدم أو رمز الدخول غير صحيح — تواصل مع المنشأة للحصول على بيانات الدخول' })
    window.location.href = `/portal/${data}`
  }

  const login = async (emails, { staff = false } = {}) => {
    const candidates = Array.isArray(emails) ? emails : [emails]
    if (!candidates[0] || !f.pass) return showError({ message: 'أدخل بيانات الدخول كاملة.' })
    clearFeedback(); setBusy(true)
    let lastError = null
    for (const email of candidates) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: f.pass })
      if (!error) { setBusy(false); return }
      lastError = error
      if (!/invalid login credentials/i.test(error.message || '')) break
    }
    setBusy(false)
    // البوابة الخطأ تُنتج نفس خطأ «بيانات غير صحيحة»، فيظن المستخدم أن كلمة
    // مروره خاطئة. بوابة الموظف تُلحق @staff.almazen.app باسم المستخدم، فحساب
    // المالك — الذي يدخل ببريده — يفشل فيها دائماً مهما كانت كلمة المرور صحيحة.
    if (lastError && staff && /invalid login credentials/i.test(lastError.message || '')) {
      return showError({ message: 'تعذّر الدخول من هذه البوابة. إن كان حسابك حساب المالك فادخل من «بوابة المالك (الرئيسية)» ببريدك الإلكتروني — لا باسم مستخدم. أما الموظف والمحاسب فيدخلان باسم المستخدم الذي أنشأته لهما المنشأة.' })
    }
    if (lastError) showError(lastError)
  }

  const registerTrial = async (e) => {
    e?.preventDefault?.()
    const { fullName, companyName, idOrCr, phone, email, pass } = trial
    if (!fullName || !companyName || !idOrCr || !phone || !email || !pass) {
      return showError({ message: 'يرجى تعبئة جميع الحقول المطلوبة.' })
    }
    if (!agreed) return showError({ message: 'يجب الاطلاع والموافقة على شروط الاستخدام وسياسة الخصوصية قبل إنشاء الحساب.' })
    if (pass.length < 8) return showError({ message: 'كلمة المرور يجب ألا تقل عن 8 أحرف.' })

    const phoneDigits = phone.replace(/\D+/g, '')
    const normalized = phoneDigits.startsWith('966') ? phoneDigits : phoneDigits.startsWith('0') ? '966' + phoneDigits.slice(1) : '966' + phoneDigits
    if (!/^9665\d{8}$/.test(normalized)) return showError({ message: 'رقم الجوال يجب أن يكون سعودياً بصيغة 05XXXXXXXX' })

    clearFeedback(); setBusy(true)
    // التحقق النهائي من كود الترشيح قبل إنشاء الحساب (إن وُجد)
    let validRef = refInfo?.valid ? refInfo : null
    if (refCode && !validRef) validRef = await verifyRef(refCode)
    if (refCode && !validRef) { setBusy(false); return showError({ message: 'كود الترشيح غير صحيح — تأكد منه أو احذفه للمتابعة.' }) }

    let result
    try {
      result = await invokeAuthEmail({
        type: 'signup',
        email: email.trim(),
        password: pass,
        redirectTo: window.location.origin,
        metadata: {
          full_name: fullName,
          company_name: companyName,
          id_or_cr: idOrCr,
          phone: '+' + normalized,
          referral_code: validRef?.code || null,
        },
      })
    } catch (error) { setBusy(false); return showError(error) }
    setBusy(false)
    setTrialAutoConfirmed(result?.autoConfirmed === true)
    if (validRef?.code) { try { localStorage.setItem(REF_STORE_KEY, validRef.code) } catch { /* ignore */ } }

    // إشعار صاحب النظام بالتسجيل الجديد (لا يوقف التدفق إن فشل)
    sendWithOutbox('new_signup', [email.trim()], {
      full_name: fullName, company_name: companyName,
      id_or_cr: idOrCr, phone: '+' + normalized, email: email.trim(),
      referral_code: validRef?.code || null,
      referrer_name: validRef?.owner_name || null,
      registered_at: new Date().toISOString(),
    }).catch(() => {})



    setTrialDone(true)
    toast('تم التسجيل ✓ راجع بريدك لتفعيل الحساب')
  }

  const resendVerification = async () => {
    const email = (trial.email || f.email || '').trim()
    if (!email) return showError({ message: 'أدخل بريدك أولاً' })
    clearFeedback(); setBusy(true)
    let error = null
    try {
      await invokeAuthEmail({ type: 'signup-resend', email, redirectTo: window.location.origin })
    } catch (e) { error = e }
    setBusy(false)
    if (error) return showError(error)
    setNotice('تم إعادة إرسال رابط التحقق إلى بريدك ✓')
  }

  const sendPasswordReset = async () => {
    const email = (f.resetEmail || f.email || '').trim()
    if (!email) return showError({ message: 'أدخل بريد حساب المدير لإرسال رابط الاستعادة.' })
    clearFeedback(); setBusy(true)
    let error = null
    try {
      await invokeAuthEmail({ type: 'recovery', email, redirectTo: `${window.location.origin}/reset-password` })
    } catch (e) { error = e }
    setBusy(false)
    if (error) return showError(error)
    setNotice('تم إرسال رابط استعادة كلمة المرور إلى بريدك.')
  }

  // شاشة تأسيس المنشأة (مالك جديد بلا profile) — تبقى كما هي
  if (session && !profile) {
    if (profileLoadError) {
      return <ConfigErrorCard onRetry={reloadProfile} error={profileLoadError} />
    }
    const createCompany = async () => {
      if (!setup.coName || !setup.fullName) return toast('أدخل اسم المنشأة واسمك', true)
      setBusy(true)
      // مسار تعافٍ للحسابات التاريخية التي لم يُنشئ trigger التسجيل ملفها تلقائياً
      const { error } = await supabase.rpc('finalize_owner_setup', {
        p_company_name: setup.coName,
        p_full_name: setup.fullName,
        p_vat_number: setup.vat || null,
        p_phone: trial.phone || null,
        p_id_or_cr: trial.idOrCr || null,
      })
      if (error) { setBusy(false); return toast('فشل تأسيس المنشأة: ' + (error.message || error), true) }

      // ربط المنشأة الجديدة بكود الترشيح (إن سُجّلت عبر رابط/كود ترشيح)
      let stored = ''
      try { stored = localStorage.getItem(REF_STORE_KEY) || '' } catch { /* ignore */ }
      const code = (refInfo?.code || refCode || stored || readRefFromUrl() || '').trim().toUpperCase()
      if (code) {
        const { data: res } = await supabase.rpc('referral_register_signup', { p_code: code })
        if (res?.ok) {
          toast(`تم تأكيد ترشيحك من ${res.referrer_name} — 3 أشهر مجانية تُضاف بعد سداد الاشتراك`)
          // بريد للمستخدم بانتقال الترشيح للخطوة الأولى — عبر Outbox (إعادة محاولة تلقائية)
          notifyReferralStepChange({
            event: 'referral_registered',
            new_status: 'registered',
            user_email: session?.user?.email || trial.email || null,
            referred_company_name: setup.coName,
            referred_owner_name: setup.fullName,
            referrer_name: res.referrer_name || null,
            referral_code: code,
          }).catch(() => {})
        }
        try { localStorage.removeItem(REF_STORE_KEY) } catch { /* ignore */ }
      }

      setBusy(false)
      toast('تم تأسيس منشأتك بنجاح — تجربة 7 أيام تبدأ الآن 🎉')
      reloadProfile()
    }

    return (
      <div className="lux-login-wrap">
        <div className="lux-bg" />
        <div className="lux-card">
          <div className="lux-side">
            <div className="lux-logo"><span className="mark">م</span> المازن</div>
            <h2>تأسيس المنشأة</h2>
            <p>هذه الخطوة تتم مرة واحدة فقط. ستبدأ فترة تجربة مجانية لمدة <b>7 أيام</b> بكامل الصلاحيات.</p>
          </div>
          <div className="lux-form">
            <div className="fld"><label>اسم المنشأة *</label>
              <input value={setup.coName} onChange={e => setSetup({ ...setup, coName: e.target.value })} placeholder="مؤسسة المازن للضيافة" /></div>
            <div className="fld"><label>اسمك الكامل *</label>
              <input value={setup.fullName} onChange={e => setSetup({ ...setup, fullName: e.target.value })} /></div>
            <div className="fld"><label>الرقم الضريبي VAT (اختياري)</label>
              <input value={setup.vat} onChange={e => setSetup({ ...setup, vat: e.target.value })} placeholder="3XXXXXXXXXXXXX3" /></div>
            <button className="btn btn-gold" style={{ width: '100%' }} disabled={busy} onClick={createCompany}>
              تأسيس المنشأة وبدء التجربة
            </button>
            <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 10 }} onClick={() => supabase.auth.signOut()}>خروج</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="lux-login-wrap">
      <div className="lux-bg" />
      <div className="lux-orb lux-orb-1" />
      <div className="lux-orb lux-orb-2" />
      <div className="lux-card lux-reveal">
        <aside className="lux-side">
          <div className="lux-logo" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <img src={almazenLogo} alt="شعار منصة المازن" style={{ width: 128, height: 128, objectFit: 'contain', filter: 'drop-shadow(0 6px 18px rgba(184,134,11,0.35))' }} />
            <span style={{ fontWeight: 800, fontSize: 20, color: '#B8860B' }}>منصة المازن</span>
          </div>
          <h2>{mode === 'trial' ? 'ابدأ تجربتك المجانية' : 'أهلاً بعودتك'}</h2>
          <p>
            {mode === 'trial'
              ? '7 أيام كاملة بجميع مميزات المنصة — بلا التزام مالي، وبلا بطاقة ائتمان.'
              : 'ادخل بحساب المدير أو حساب الموظف المُنشأ لك من قِبل المدير.'}
          </p>
          <ul className="lux-bullets">
            <li>✦ إدارة الحجوزات والعقود</li>
            <li>✦ فوترة ZATCA معتمدة</li>
            <li>✦ تكامل إيجار الرسمي</li>
            <li>✦ ذكاء اصطناعي عامل</li>
          </ul>
        </aside>

        <div className="lux-form">
          {onBack && <button className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }} onClick={onBack}>← العودة للصفحة الرئيسية</button>}

          {/* اختيار الوضع في الأعلى */}
          <div className="lux-mode">
            <button className={mode === 'existing' ? 'on' : ''} onClick={() => { setMode('existing'); clearFeedback() }}>
              🔑 تسجيل الدخول لعميل حالي
            </button>
            <button className={mode === 'trial' ? 'on gold' : 'gold'} onClick={() => { setMode('trial'); clearFeedback() }}>
              ✦ تسجيل جديد — تجربة 7 أيام مجاناً
            </button>
          </div>

          {authError && (
            <div className="auth-note err" style={{ whiteSpace: 'pre-wrap' }}>
              <b>فشل العملية:</b> {authError.msg}
              {authError.details && <div style={{ opacity: .7, fontSize: 12, marginTop: 4, direction: 'ltr' }}>{authError.details}</div>}
            </div>
          )}
          {notice && <div className="auth-note" style={{ whiteSpace: 'pre-wrap' }}>{notice}</div>}

          {mode === 'trial' ? (
            trialDone ? (
              <div className="trial-success">
                <div className="ts-icon">✓</div>
                <h3>تم إنشاء حسابك بنجاح</h3>
                {trialAutoConfirmed ? (
                  <p>
                    حسابك جاهز ومُفعّل الآن — يمكنك تسجيل الدخول مباشرة وبدء فترة التجربة (7 أيام كاملة)
                    ببريدك: <b dir="ltr">{trial.email}</b>.
                  </p>
                ) : (
                  <p>
                    أرسلنا رسالة تفعيل إلى بريدك: <b dir="ltr">{trial.email}</b>
                    <br />افتح الرسالة واضغط رابط التفعيل، ثم عد إلى هنا لتسجيل الدخول والبدء بفترة التجربة (7 أيام كاملة).
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
                  {!trialAutoConfirmed && (
                    <button className="btn btn-ghost btn-sm" onClick={resendVerification} disabled={busy}>إعادة إرسال رابط التحقق</button>
                  )}
                  <button className="btn btn-gold btn-sm" onClick={() => { setTrialDone(false); setMode('existing') }}>الانتقال لتسجيل الدخول</button>
                </div>
              </div>
            ) : (
              <form onSubmit={registerTrial} className="lux-trial-form">
                <div className="grid2">
                  <div className="fld"><label>اسم العميل *</label>
                    <input value={trial.fullName} onChange={e => setTrial({ ...trial, fullName: e.target.value })} placeholder="الاسم الكامل" /></div>
                  <div className="fld"><label>اسم الشركة أو المؤسسة *</label>
                    <input value={trial.companyName} onChange={e => setTrial({ ...trial, companyName: e.target.value })} placeholder="مؤسسة المازن للضيافة" /></div>
                  <div className="fld"><label>السجل التجاري أو الهوية الوطنية *</label>
                    <input value={trial.idOrCr} onChange={e => setTrial({ ...trial, idOrCr: e.target.value })} dir="ltr" placeholder="10 أرقام" /></div>
                  <div className="fld"><label>رقم الجوال (السعودية) *</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <span className="phone-code">+966</span>
                      <input value={trial.phone} onChange={e => setTrial({ ...trial, phone: e.target.value })} dir="ltr" placeholder="5XXXXXXXX" style={{ flex: 1 }} />
                    </div>
                  </div>
                  <div className="fld"><label>البريد الإلكتروني *</label>
                    <input type="email" value={trial.email} onChange={e => setTrial({ ...trial, email: e.target.value })} dir="ltr" placeholder="you@example.com" /></div>
                  <div className="fld"><label>كلمة السر * (8 أحرف على الأقل)</label>
                    <div style={{ position: 'relative' }}>
                      <input type={showPass ? 'text' : 'password'} value={trial.pass} onChange={e => setTrial({ ...trial, pass: e.target.value })} />
                      <button type="button" onClick={() => setShowPass(v => !v)} className="pass-eye">{showPass ? 'إخفاء' : 'إظهار'}</button>
                    </div>
                  </div>
                  <div className="fld"><label>كود الترشيح (اختياري)</label>
                    <input
                      value={refCode}
                      onChange={e => { setRefCode(e.target.value.toUpperCase()); setRefInfo(null) }}
                      onBlur={e => verifyRef(e.target.value)}
                      dir="ltr" placeholder="MZXXXXXX"
                    />
                  </div>
                </div>

                {refChecking && <div className="auth-note">جارٍ التحقق من كود الترشيح…</div>}
                {refInfo?.valid && (
                  <div className="auth-note" style={{ borderRight: '3px solid #B8860B' }}>
                    ✓ تم تأكيد ترشيحك من <b>{refInfo.owner_name}</b> (كود {refInfo.code}).
                    <br />سيتم إضافة <b>3 أشهر مجانية</b> على مدة اشتراكك بعد سداد الاشتراك واعتماد الإدارة.
                  </div>
                )}
                {refInfo && refInfo.valid === false && (
                  <div className="auth-note err">كود الترشيح غير صحيح أو غير مفعّل.</div>
                )}

                <div className="trial-terms">
                  ✦ فترة تجربة كاملة 7 أيام — لا نحتاج بطاقة ائتمان.
                  <br />✦ بعد انتهاء التجربة يتوقف الحساب تلقائياً حتى تفعيل الاشتراك السنوي (3,000 ر.س).
                </div>

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, margin: '10px 0 4px', cursor: 'pointer', lineHeight: 1.7 }}>
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={e => { setAgreed(e.target.checked); if (e.target.checked) clearFeedback() }}
                    style={{ width: 15, height: 15, marginTop: 3, flexShrink: 0, accentColor: '#B8860B' }}
                  />
                  <span>
                    تم الاطلاع والموافقة على{' '}
                    <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: '#B8860B', textDecoration: 'underline' }}>شروط الاستخدام</a>
                    {' '}و{' '}
                    <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: '#B8860B', textDecoration: 'underline' }}>سياسة الخصوصية</a>
                  </span>
                </label>

                <button type="submit" className="btn btn-gold" style={{ width: '100%' }} disabled={busy || !agreed}>
                  {busy ? '...جارٍ إنشاء الحساب' : '🚀 ابدأ التجربة المجانية الآن'}
                </button>

              </form>
            )
          ) : forgot ? (<>
            <h3 className="auth-title">استعادة كلمة المرور</h3>
            <p className="auth-help">أدخل بريد حساب المدير وسنرسل رابطاً حقيقياً لتعيين كلمة مرور جديدة.</p>
            <div className="fld"><label>البريد الإلكتروني</label>
              <input type="email" value={f.resetEmail || f.email} onChange={e => setF({ ...f, resetEmail: e.target.value })} dir="ltr" /></div>
            <button className="btn btn-blue" style={{ width: '100%' }} disabled={busy} onClick={sendPasswordReset}>إرسال رابط الاستعادة</button>
            <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 10 }} disabled={busy} onClick={() => setForgot(false)}>العودة لتسجيل الدخول</button>
          </>) : (<>
            <div className="tabs">
              <button className={tab === 'ten' ? 'on' : ''} onClick={() => setTab('ten')}>بوابة المستأجر</button>
              <button className={tab === 'emp' ? 'on' : ''} onClick={() => setTab('emp')}>بوابة موظف الاستقبال</button>
              <button className={tab === 'fin' ? 'on' : ''} onClick={() => setTab('fin')}>بوابة المحاسب</button>
              <button className={tab === 'own' ? 'on' : ''} onClick={() => setTab('own')}>بوابة المالك (الرئيسية)</button>
            </div>
            {tab === 'ten' ? (
              <form onSubmit={loginTenant}>
                <div className="auth-note" style={{ marginBottom: 12, fontSize: 13, color: '#6b6b6b' }}>
                  ادخل بيانات بوابتك الخاصة التي وصلتك من المنشأة عند استلام الوحدة.
                </div>
                <div className="fld"><label>اسم المستخدم</label>
                  <input value={tenantF.user} autoFocus autoComplete="username" onChange={e => setTenantF({ ...tenantF, user: e.target.value })} dir="ltr" /></div>
                <div className="fld"><label>رمز الدخول (كلمة المرور)</label>
                  <div style={{ position: 'relative' }}>
                    <input type={showPass ? 'text' : 'password'} autoComplete="current-password" value={tenantF.token} onChange={e => setTenantF({ ...tenantF, token: e.target.value })} dir="ltr" />
                    <button type="button" onClick={() => setShowPass(v => !v)} className="pass-eye">{showPass ? 'إخفاء' : 'إظهار'}</button>
                  </div>
                </div>
                <button type="submit" className="btn btn-gold" style={{ width: '100%' }} disabled={busy}>
                  {busy ? 'جارٍ التحقق…' : '🔑 دخول بوابة المستأجر'}
                </button>
              </form>
            ) : tab === 'own' ? (
              <form onSubmit={(e) => { e.preventDefault(); login(f.email) }}>
                <div className="fld"><label>البريد الإلكتروني</label>
                  <input type="email" autoFocus autoComplete="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} dir="ltr" /></div>
                <div className="fld"><label>كلمة المرور</label>
                  <div style={{ position: 'relative' }}>
                    <input type={showPass ? 'text' : 'password'} autoComplete="current-password" value={f.pass} onChange={e => setF({ ...f, pass: e.target.value })} />
                    <button type="button" onClick={() => setShowPass(v => !v)} className="pass-eye">{showPass ? 'إخفاء' : 'إظهار'}</button>
                  </div>
                </div>
                <button type="submit" className="btn btn-blue" style={{ width: '100%' }} disabled={busy}>
                  {busy ? 'جارٍ الدخول…' : 'دخول بوابة المالك (الرئيسية)'}
                </button>
                <button className="forgot-link" type="button" disabled={busy} onClick={() => { setForgot(true); setF({ ...f, resetEmail: f.email }) }}>نسيت كلمة السر؟</button>
              </form>
            ) : (
              <form onSubmit={(e) => {
                e.preventDefault()
                // بريد إلكتروني في حقل اسم المستخدم = بوابة خطأ. نوجّه بدل أن نفشل.
                if (f.user.includes('@')) {
                  return showError({ message: 'أدخلت بريداً إلكترونياً، وهذه البوابة تقبل اسم المستخدم فقط. حسابات البريد الإلكتروني تدخل من «بوابة المالك (الرئيسية)».' })
                }
                login(staffEmailCandidates(f.user), { staff: true })
              }}>
                <div className="fld"><label>اسم المستخدم</label>
                  <input value={f.user} autoFocus autoComplete="username" onChange={e => setF({ ...f, user: e.target.value })} placeholder="ahmad.s" dir="ltr" /></div>
                <div className="fld"><label>كلمة المرور</label>
                  <div style={{ position: 'relative' }}>
                    <input type={showPass ? 'text' : 'password'} autoComplete="current-password" value={f.pass} onChange={e => setF({ ...f, pass: e.target.value })} />
                    <button type="button" onClick={() => setShowPass(v => !v)} className="pass-eye">{showPass ? 'إخفاء' : 'إظهار'}</button>
                  </div>
                </div>
                <button type="submit" className="btn btn-green" style={{ width: '100%' }} disabled={busy}>
                  {busy ? 'جارٍ الدخول…' : tab === 'fin' ? 'دخول بوابة المحاسب' : 'دخول بوابة موظف الاستقبال'}
                </button>
              </form>
            )}
          </>)}
        </div>
      </div>
    </div>
  )
}

function ConfigErrorCard({ onRetry, error }) {
  return (
    <div className="lux-login-wrap"><div className="lux-card">
      <aside className="lux-side">
        <div className="lux-logo"><span className="mark">م</span> المازن</div>
        <h2>تعذر إكمال الدخول</h2>
        <p>ملف المستخدم لم يُحمّل بسبب إعدادات قاعدة البيانات.</p>
        {error && (
          <div style={{ marginTop: 12, padding: 10, background: 'rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11, direction: 'ltr', textAlign: 'left' }}>
            <code>Code: {error.code || 'N/A'}</code><br/>
            <code>Msg: {error.message || 'Unknown error'}</code>
          </div>
        )}
      </aside>
      <div className="lux-form">
        <div className="auth-note err">نفّذ ملف <b>supabase/POST_SETUP_FIX.sql</b> ثم أعد المحاولة.</div>
        <button className="btn btn-blue" style={{ width: '100%' }} onClick={onRetry}>إعادة المحاولة</button>
        <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 10 }} onClick={() => supabase.auth.signOut()}>خروج</button>
      </div>
    </div></div>
  )
}
