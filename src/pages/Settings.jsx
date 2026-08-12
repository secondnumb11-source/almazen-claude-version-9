import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { uploadFile } from '../lib/helpers'
import DataImport from '../components/DataImport'
import AccountSettings from '../components/AccountSettings'
import SidebarRailDesigner from '../components/SidebarRailDesigner'
import SuperAdminAccounts from '../components/SuperAdminAccounts'
import SystemDiagnostics from '../components/SystemDiagnostics'
import CiSuitePanel from '../components/admin/CiSuitePanel'
import PerfPanel from '../components/admin/PerfPanel'
import UniversalCrud from '../components/admin/UniversalCrud'
import BranchesManager from '../components/BranchesManager'
import BranchFeatureAdmin from '../components/admin/BranchFeatureAdmin'

import { runDailyNotificationChecks } from '../lib/notifications'

/** حالات اعتماد ZATCA كما تعيدها zatca_credentials.onboarding_status. */
const ZATCA_STATUS = {
  not_started: 'لم يبدأ الاعتماد بعد',
  csr_generated: 'تم توليد طلب الشهادة — التالي: إدخال رمز OTP',
  compliance_passed: 'اجتاز الامتثال — التالي: الترقية إلى شهادة الإنتاج',
  production_ready: '✅ جاهز للإرسال الفعلي للهيئة',
  failed: '⚠️ فشل — راجع الخطأ أدناه وأعد المحاولة',
}

/** ترجمة رموز أخطاء دالة الربط إلى رسائل تُفهم دون تخمين. */
const ZATCA_ERR = {
  VAT_NUMBER_REQUIRED: 'الرقم الضريبي للمنشأة مطلوب — أدخله في تبويب «بيانات المنشأة» أولاً',
  NO_CREDENTIALS_GENERATE_CSR_FIRST: 'ولّد طلب الشهادة (CSR) أولاً',
  OTP_REQUIRED: 'رمز OTP من بوابة Fatoora مطلوب',
  NOT_PRODUCTION_READY: 'لم تكتمل شهادة الإنتاج لهذه الجهة بعد',
  FORBIDDEN_ROLE: 'إدارة الربط الضريبي متاحة للمالك أو المدير فقط',
  COMPANY_MISMATCH: 'لا صلاحية لك على هذه المنشأة',
  AUTH_REQUIRED: 'انتهت الجلسة — سجّل الدخول مرة أخرى',
}

const CRUD_TABLES = [
  { table: 'units', title: '🏢 الوحدات', fields: [
    { key: 'name', label: 'الاسم', type: 'text', required: true },
    { key: 'code', label: 'الرمز', type: 'text' },
    { key: 'status', label: 'الحالة', type: 'select', options: ['available','rented','maintenance','reserved'] },
    { key: 'notes', label: 'ملاحظات', type: 'textarea' },
  ]},
  { table: 'tenants', title: '👥 المستأجرون', fields: [
    { key: 'name', label: 'الاسم', type: 'text', required: true },
    { key: 'phone', label: 'الجوال', type: 'text' },
    { key: 'email', label: 'البريد', type: 'text' },
    { key: 'id_number', label: 'رقم الهوية', type: 'text' },
    { key: 'notes', label: 'ملاحظات', type: 'textarea' },
  ]},
  { table: 'maintenance_requests', title: '🛠️ طلبات الصيانة', fields: [
    { key: 'title', label: 'العنوان', type: 'text', required: true },
    { key: 'status', label: 'الحالة', type: 'select', options: ['open','in_progress','resolved','cancelled'] },
    { key: 'priority', label: 'الأولوية', type: 'select', options: ['low','normal','high','urgent'] },
    { key: 'description', label: 'الوصف', type: 'textarea' },
  ]},
]

/* إعدادات الإيميلات والتكامل تُحفظ محلياً في هذا المتصفح لكل منشأة،
   وتُطبَّق فوراً على واجهة التطبيق (مثل رابط بوابة المستأجر ورقم الواتساب المُرسل).
   المفاتيح السرّية الفعلية تبقى في متغيرات البيئة (.env) أو أسرار الخادم.
   ملاحظة: أُزيلت تبويبات "الحسابات" و"نشاط وحدة" من هنا ونُقلت بالكامل
   إلى قسم "إدارة الموظفين" (وتظهر نسخة منها أيضاً داخل قسم الحسابات). */
const LSK = (companyId, ns) => `almazen:${companyId}:${ns}`
const loadLS = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v ? { ...fallback, ...JSON.parse(v) } : fallback }
  catch { return fallback }
}
const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }

const DEFAULT_EMAIL = {
  senderName: '',
  senderEmail: '',
  confirmEmail: true,
  welcomeSubject: 'أهلاً بك في {company}',
  welcomeBody: 'شكراً لانضمامك إلينا. رابط بوابتك: {portal}',
}
const DEFAULT_INTEG = {
  whatsappNumber: '',
  whatsappPhoneNumberId: '',
  whatsappBusinessAccountId: '',
  whatsappAccessToken: '',
  whatsappWebhookToken: '',
  ejarBaseUrl: '',
  webhookUrl: '',
}

/* بوابة الصلاحية منفصلة عن جسم الصفحة حتى تبقى كل الـ hooks تُستدعى بنفس الترتيب
   في كل عملية render — الخروج المبكر بين الـ hooks كان يكسر React عند تغيّر الصلاحية. */
export default function Settings({ dashEditMode, setDashEditMode }) {
  const { canFinance } = useAuth()

  if (!canFinance) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center', margin: '40px auto', maxWidth: 500 }}>
        <h3 style={{ color: 'var(--st-oc)', marginBottom: 12 }}>🔒 خطأ في الصلاحيات</h3>
        <p style={{ color: 'var(--muted)' }}>غير مصرح لك بالوصول لإعدادات النظام. هذه الصفحة مخصصة للمدراء والمحاسبين فقط.</p>
      </div>
    )
  }

  return <SettingsPanel dashEditMode={dashEditMode} setDashEditMode={setDashEditMode} />
}

function SettingsPanel({ dashEditMode, setDashEditMode }) {
  const { profile, company, toast, refreshCompany, canFinance, isSuperAdmin } = useAuth()
  const [tab, setTab] = useState('company')
  const [c, setC] = useState(company || {})
  const [zatca, setZatca] = useState({ zatca_api_key: '', zatca_environment: 'sandbox' })
  // حالة اعتماد المرحلة الثانية لهذه الجهة — تُقرأ من zatca_credentials
  const [zc, setZc] = useState(null)
  const [zBusy, setZBusy] = useState('')
  const [zOtp, setZOtp] = useState('')

  useEffect(() => setC(company || {}), [company])
  // بيانات الربط مع ZATCA تُخزَّن في جدول company_secrets المقيّد بالدور (لا على صف الشركة)
  useEffect(() => {
    if (!profile) return
    supabase.from('company_secrets').select('zatca_api_key, zatca_environment').eq('company_id', profile.company_id).maybeSingle()
      .then(({ data }) => setZatca({ zatca_api_key: data?.zatca_api_key || '', zatca_environment: data?.zatca_environment || 'sandbox' }))
  }, [profile])

  const emailKey = useMemo(() => LSK(profile?.company_id, 'email'), [profile])
  const integKey = useMemo(() => LSK(profile?.company_id, 'integration'), [profile])
  const [email, setEmail] = useState(DEFAULT_EMAIL)
  const [integ, setInteg] = useState(DEFAULT_INTEG)

  useEffect(() => {
    if (!profile) return
    setEmail(loadLS(emailKey, DEFAULT_EMAIL))
    setInteg(loadLS(integKey, { ...DEFAULT_INTEG, publicBaseUrl: company?.public_base_url || '' }))
  }, [profile, emailKey, integKey, company])

  const saveCompany = async () => {
    const { error } = await supabase.from('companies').update({
      name: c.name, vat_number: c.vat_number, cr_number: c.cr_number,
      address: c.address, city: c.city, phone: c.phone, email: c.email,
      invoice_footer: c.invoice_footer, default_vat_rate: c.default_vat_rate || 15,
      public_base_url: c.public_base_url || null,
    }).eq('id', profile.company_id)
    if (error) return toast(explain(error), true)
    toast('✓ حُفظت بيانات الترويسة والهوية'); refreshCompany()
  }

  const uploadLogo = async (file) => {
    try {
      const url = await uploadFile(supabase, 'unit-media', profile.company_id, file)
      await supabase.from('companies').update({ logo_url: url }).eq('id', profile.company_id)
      toast('✓ استُبدل شعار النظام بشعار منشأتك فوراً'); refreshCompany()
    } catch (e) { toast('فشل الرفع: ' + e.message, true) }
  }

  const saveZatca = async () => {
    const { error } = await supabase.from('company_secrets')
      .upsert({ company_id: profile.company_id, zatca_api_key: zatca.zatca_api_key || null,
        zatca_environment: zatca.zatca_environment, updated_at: new Date().toISOString() },
        { onConflict: 'company_id' })
    if (error) return toast(explain(error), true)
    toast('✓ حُفظت إعدادات الربط مع ZATCA')
  }

  // ---- اعتماد المرحلة الثانية: كل مدير يربط منشأته من حسابه ----
  const loadZc = async () => {
    if (!profile?.company_id) return
    const { data } = await supabase.from('zatca_credentials')
      .select('*').eq('company_id', profile.company_id).is('branch_id', null).maybeSingle()
    setZc(data || null)
  }
  useEffect(() => { loadZc() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [profile])

  /** يستدعي دالة الربط الرسمية. كل الأخطاء تُعرض كما وردت من الهيئة بلا تجميل. */
  const zatcaCall = async (action, extra = {}) => {
    setZBusy(action)
    try {
      const { data, error } = await supabase.functions.invoke('zatca-einvoice', {
        body: { action, company_id: profile.company_id, environment: zatca.zatca_environment, ...extra },
      })
      if (error) throw new Error(error.message || 'فشل الاستدعاء')
      if (data?.error) throw new Error(ZATCA_ERR[data.error] || data.error)
      toast(data?.note ? '✓ تم — ' + data.note : '✓ تمت العملية بنجاح')
      await loadZc()
    } catch (e) {
      toast('تعذّر: ' + e.message, true)
    } finally {
      setZBusy('')
    }
  }

  const saveEmail = () => {
    saveLS(emailKey, email)
    toast('✓ حُفظت إعدادات الإيميلات وطُبّقت فوراً')
  }
  const saveInteg = async () => {
    saveLS(integKey, integ)
    if (integ.publicBaseUrl && integ.publicBaseUrl !== company?.public_base_url) {
      await supabase.from('companies')
        .update({ public_base_url: integ.publicBaseUrl }).eq('id', profile.company_id)
      refreshCompany()
    }
    toast('✓ حُفظت إعدادات التكامل وطُبّقت فوراً')
  }

  const TABS = [
    { k: 'layout',  label: 'تخصيص اللوحة', icon: '🎨' },
    { k: 'company', label: 'المنشأة', icon: '🏛️' },
    { k: 'zatca',   label: 'ZATCA', icon: '🧾' },
    { k: 'email',   label: 'الإيميلات', icon: '✉️' },
    { k: 'integ',   label: 'التكامل', icon: '🔌' },
    { k: 'import',  label: 'استيراد بيانات', icon: '📥' },
    // إدارة الفروع تظهر للجميع، لكن محتواها مقفول لغير المصرّح لهم
    // مع رسالة «هذه الميزة من الباقة المتقدمة، للاستخدام تواصل مع الدعم».
    { k: 'branches', label: 'إدارة الفروع', icon: '🏢' },
  ]
  
  if (canFinance) {
    TABS.unshift({ k: 'account', label: 'إعدادات الحساب', icon: '👤' })
  }
  
  if (isSuperAdmin) {
    TABS.push({ k: 'superadmin', label: 'قائمة الحسابات (إدارة)', icon: '👑' })
    // التحكم بتفعيل/إيقاف ميزة الفروع لكل مستخدم — super admin فقط
    TABS.push({ k: 'features', label: 'التحكم بالميزات (الفروع)', icon: '🎛️' })
    TABS.push({ k: 'diagnostics', label: 'تشخيص وإصلاح النظام', icon: '🛠️' })
    TABS.push({ k: 'ci', label: 'CI — اختبارات وأداء وإصلاح', icon: '🧪' })
    TABS.push({ k: 'crud', label: 'CRUD — البيانات الأساسية', icon: '🗃️' })
  }


  return (
    <div>
      <div className="pg-title"><h2>الإعدادات — الهوية والفوترة والتكامل</h2></div>

      <div className="settings-tabs">
        {TABS.map(t => (
          <button key={t.k} className={tab === t.k ? 'on' : ''} onClick={() => setTab(t.k)}>
            <span>{t.icon}</span><span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'account' && <AccountSettings />}

      {tab === 'layout' && (
        <div className="panel">
          <div style={{ marginTop: '10px', paddingTop: '10px' }}>
            <h4 style={{ fontSize: '15px', marginBottom: '10px' }}>⚙️ تخصيص بطاقات لوحة البيانات الرئيسية (Dashboard Widgets)</h4>
            <p style={{ color: '#64748b', fontSize: '13px', marginBottom: '16px' }}>
              تفعيل وضع التنسيق يسمح لك بسحب البطاقات (Drag & Drop) وتغيير ألوانها وأحجامها وإخفائها من الصفحة الرئيسية مباشرة.
            </p>
            <button 
              className={`btn ${dashEditMode ? 'btn-green' : 'btn-gold'} btn-sm`}
              onClick={() => {
                setDashEditMode?.(d => !d)
                toast(dashEditMode ? 'تم إنهاء وضع تخصيص اللوحة' : 'تم تفعيل وضع تخصيص بطاقات اللوحة')
              }}
            >
              {dashEditMode ? '✓ إيقاف وضع تخصيص البطاقات' : '⚙️ تفعيل وضع تخصيص البطاقات الآن'}
            </button>
          </div>

          <SidebarRailDesigner />
        </div>
      )}

      {tab === 'company' && (
        <div className="panel">
          <h3>الشعار والترويسة (تظهر على الفاتورة والعقود والسندات)</h3>
          <div className="fld"><label>شعار المنشأة — يستبدل شعار النظام فوراً</label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {company?.logo_url && <img src={company.logo_url} alt="logo" style={{ width: 52, height: 52, borderRadius: 12, objectFit: 'cover' }} />}
              <input type="file" accept="image/*" onChange={e => e.target.files[0] && uploadLogo(e.target.files[0])} />
            </div></div>
          <div className="grid2">
            <div className="fld"><label>اسم المنشأة</label><input value={c.name || ''} onChange={e => setC({ ...c, name: e.target.value })} /></div>
            <div className="fld"><label>الرقم الضريبي VAT</label><input value={c.vat_number || ''} onChange={e => setC({ ...c, vat_number: e.target.value })} dir="ltr" /></div>
            <div className="fld"><label>السجل التجاري</label><input value={c.cr_number || ''} onChange={e => setC({ ...c, cr_number: e.target.value })} dir="ltr" /></div>
            <div className="fld"><label>نسبة الضريبة %</label><input type="number" value={c.default_vat_rate || 15} onChange={e => setC({ ...c, default_vat_rate: e.target.value })} /></div>
            <div className="fld"><label>الجوال</label><input value={c.phone || ''} onChange={e => setC({ ...c, phone: e.target.value })} dir="ltr" /></div>
            <div className="fld"><label>المدينة</label><input value={c.city || ''} onChange={e => setC({ ...c, city: e.target.value })} /></div>
          </div>
          <div className="fld"><label>العنوان</label><input value={c.address || ''} onChange={e => setC({ ...c, address: e.target.value })} /></div>
          <div className="fld"><label>رابط الموقع المنشور (لبناء رابط بوابة المستأجر في رسائل واتساب التلقائية)</label>
            <input value={c.public_base_url || ''} onChange={e => setC({ ...c, public_base_url: e.target.value })} dir="ltr" placeholder="https://your-domain.com" /></div>
          <div className="fld"><label>نص أسفل الفاتورة</label><input value={c.invoice_footer || ''} onChange={e => setC({ ...c, invoice_footer: e.target.value })} /></div>
          <button className="btn btn-gold btn-sm" onClick={saveCompany}>حفظ البيانات</button>
        </div>
      )}

      {tab === 'zatca' && (
        <div className="panel">
          <h3>الربط مع هيئة الزكاة والضريبة والجمارك (ZATCA)</h3>
          <div className="settings-hint">
            <b>المرحلة الأولى (مُفعّلة فعلياً):</b> كل فاتورة تصدر من النظام تحمل رمز QR متوافق مع مواصفة TLV الرسمية
            (اسم البائع، الرقم الضريبي، تاريخ الإصدار، الإجمالي، قيمة الضريبة) — يمكن قراءته بأي تطبيق قارئ QR متوافق مع ZATCA.
            <br /><b>المرحلة الثانية (الربط المباشر والتخليص الإلكتروني):</b> تتطلب اعتماد شهادة CSID رسمية من حساب منشأتك في
            بوابة ZATCA (Fatoora)، وتوقيعاً رقمياً (XML/UBL) لكل فاتورة، وإرسالها لحظياً لواجهة ZATCA. هذه الخطوة تحتاج بيانات
            اعتماد حقيقية من حسابك في البوابة الحكومية — أدخل مفتاح API أدناه فور توفره لدينا لنُفعّل الربط الفعلي.
          </div>
          <div className="grid2">
            <div className="fld"><label>بيئة الربط</label>
              <select value={zatca.zatca_environment} onChange={e => setZatca({ ...zatca, zatca_environment: e.target.value })}>
                <option value="sandbox">تجريبية (Sandbox)</option>
                <option value="production">إنتاجية (Production)</option>
              </select></div>
            <div className="fld"><label>مفتاح ZATCA API / CSID</label>
              <input type="password" value={zatca.zatca_api_key} onChange={e => setZatca({ ...zatca, zatca_api_key: e.target.value })} dir="ltr" /></div>
          </div>
          <button className="btn btn-green btn-sm" onClick={saveZatca}>حفظ إعدادات ZATCA</button>

          <h3 style={{ marginTop: 22 }}>اعتماد المرحلة الثانية — الربط المباشر</h3>
          <div className="settings-hint">
            الاعتماد خاص بمنشأتك وحدها: الشهادة تُحفظ باسم منشأتك ولا تُخلط بأي منشأة أخرى.
            نفّذ الخطوات بالترتيب. تحتاج رمز OTP من حسابك في بوابة ZATCA (Fatoora).
            {!company?.vat_number && (
              <div style={{ color: '#b45309', marginTop: 8 }}>
                ⚠️ الرقم الضريبي لمنشأتك غير مُدخل. أدخله في تبويب «بيانات المنشأة» أولاً —
                فبدونه لا يُقبل طلب الشهادة، ولا يحمل رمز QR هويتك الضريبية الصحيحة.
              </div>
            )}
          </div>

          <div className="settings-hint" style={{ marginTop: 8 }}>
            <b>الحالة الحالية:</b> {ZATCA_STATUS[zc?.onboarding_status] || 'لم يبدأ الاعتماد بعد'}
            {zc?.environment ? ` · البيئة: ${zc.environment}` : ''}
            {zc?.last_error ? <div style={{ color: '#b91c1c', marginTop: 6 }}>آخر خطأ: {zc.last_error}</div> : null}
          </div>

          <div className="grid2" style={{ marginTop: 10 }}>
            <div className="fld">
              <label>1) طلب توقيع الشهادة</label>
              <button
                className="btn btn-gold btn-sm"
                disabled={!!zBusy || !company?.vat_number}
                onClick={() => zatcaCall('generate_csr')}
              >
                {zBusy === 'generate_csr' ? 'جارٍ التوليد…' : 'توليد طلب الشهادة (CSR)'}
              </button>
            </div>
            <div className="fld">
              <label>2) رمز OTP من بوابة Fatoora</label>
              <input value={zOtp} onChange={e => setZOtp(e.target.value)} dir="ltr" placeholder="123456" />
              <button
                className="btn btn-gold btn-sm"
                style={{ marginTop: 6 }}
                disabled={!!zBusy || !zOtp || !zc?.csr}
                onClick={() => zatcaCall('compliance_csid', { otp: zOtp.trim() })}
              >
                {zBusy === 'compliance_csid' ? 'جارٍ الاعتماد…' : 'اعتماد شهادة الامتثال'}
              </button>
            </div>
          </div>

          <button
            className="btn btn-green btn-sm"
            style={{ marginTop: 10 }}
            disabled={!!zBusy || zc?.onboarding_status !== 'compliance_passed'}
            onClick={() => zatcaCall('production_csid')}
          >
            {zBusy === 'production_csid' ? 'جارٍ الترقية…' : '3) ترقية إلى شهادة الإنتاج'}
          </button>
        </div>
      )}

      {tab === 'email' && (
        <div className="panel">
          <h3>تكوين إيميلات المنشأة</h3>
          <div className="settings-hint">
            <b>ملاحظة:</b> هذه الإعدادات تُطبَّق فوراً على قوالب الرسائل التلقائية داخل التطبيق. أما إعدادات SMTP وتأكيد البريد لحسابات Supabase Auth فتُدار من لوحة Supabase → Authentication → Email.
          </div>
          <div className="grid2">
            <div className="fld"><label>اسم المرسل</label>
              <input value={email.senderName} onChange={e => setEmail({ ...email, senderName: e.target.value })} placeholder="مؤسسة المازن" /></div>
            <div className="fld"><label>بريد المرسل</label>
              <input type="email" dir="ltr" value={email.senderEmail} onChange={e => setEmail({ ...email, senderEmail: e.target.value })} placeholder="no-reply@your-domain.com" /></div>
          </div>
          <div className="fld"><label>عنوان رسالة الترحيب (يدعم {'{company}'} و{'{portal}'})</label>
            <input value={email.welcomeSubject} onChange={e => setEmail({ ...email, welcomeSubject: e.target.value })} /></div>
          <div className="fld"><label>نص رسالة الترحيب</label>
            <textarea rows="4" value={email.welcomeBody} onChange={e => setEmail({ ...email, welcomeBody: e.target.value })} /></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 14px', cursor: 'pointer' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={email.confirmEmail} onChange={e => setEmail({ ...email, confirmEmail: e.target.checked })} />
            <span>تفعيل تأكيد البريد الإلكتروني لحسابات المدير الجدد (يتطلب أيضاً تفعيله في Supabase Auth)</span>
          </label>
          <button className="btn btn-gold btn-sm" onClick={saveEmail}>حفظ وتطبيق</button>
        </div>
      )}

      {tab === 'integ' && (
        <div className="panel">
          <h3>تهيئة التكامل والقنوات</h3>
          <div className="settings-hint">
            <b>🔔 WhatsApp Business API:</b> لإرسال رسائل تلقائية للعملاء، أنشئ تطبيق على Meta Developer Console واحصل على بيانات الاعتماد.
            <br /><b>الخطوات:</b> (1) اذهب إلى <code style={{direction: 'ltr'}}>developers.facebook.com</code> (2) أنشئ تطبيق وفعّل WhatsApp (3) أضف رقم واتساب موثوق (4) انسخ Phone ID و Business Account ID و Access Token.
          </div>

          <h4 style={{marginTop: 16, marginBottom: 12}}>📱 بيانات اعتماد WhatsApp Business API</h4>
          <div className="grid2">
            <div className="fld"><label>رقم واتساب المنشأة الموثوق (الرقم المرسل منه)</label>
              <input dir="ltr" value={integ.whatsappNumber} onChange={e => setInteg({ ...integ, whatsappNumber: e.target.value })} placeholder="+9665XXXXXXXX" /></div>
            <div className="fld"><label>Phone Number ID (من Meta Developer Console)</label>
              <input dir="ltr" value={integ.whatsappPhoneNumberId} onChange={e => setInteg({ ...integ, whatsappPhoneNumberId: e.target.value })} placeholder="1234567890..." /></div>
            <div className="fld"><label>Business Account ID (WABA ID)</label>
              <input dir="ltr" value={integ.whatsappBusinessAccountId} onChange={e => setInteg({ ...integ, whatsappBusinessAccountId: e.target.value })} placeholder="1234567890..." /></div>
            <div className="fld"><label>Access Token (احفظه بأمان في .env على الخادم)</label>
              <input type="password" dir="ltr" value={integ.whatsappAccessToken} onChange={e => setInteg({ ...integ, whatsappAccessToken: e.target.value })} placeholder="EAAC..." /></div>
            <div className="fld"><label>Webhook Token للتحقق (استخدمه في Facebook App Settings → Webhooks)</label>
              <input dir="ltr" value={integ.whatsappWebhookToken} onChange={e => setInteg({ ...integ, whatsappWebhookToken: e.target.value })} placeholder="your-secret-token" /></div>
          </div>

          <h4 style={{marginTop: 16, marginBottom: 12}}>🔗 تكاملات أخرى</h4>
          <div className="grid2">
            <div className="fld"><label>رابط منصة إيجار (Ejar) - اختياري</label>
              <input dir="ltr" value={integ.ejarBaseUrl} onChange={e => setInteg({ ...integ, ejarBaseUrl: e.target.value })} placeholder="https://www.ejar.sa" /></div>
            <div className="fld"><label>Webhook للإشعارات الخارجية (اختياري)</label>
              <input dir="ltr" value={integ.webhookUrl} onChange={e => setInteg({ ...integ, webhookUrl: e.target.value })} placeholder="https://hooks.example.com/almazen" /></div>
          </div>
          <button className="btn btn-gold btn-sm" onClick={saveInteg}>حفظ وتطبيق</button>
        </div>
      )}

      {tab === 'import' && <DataImport />}

      {tab === 'branches' && <BranchesManager />}

      {tab === 'superadmin' && <SuperAdminAccounts />}
      {tab === 'features' && isSuperAdmin && <BranchFeatureAdmin />}
      {tab === 'diagnostics' && isSuperAdmin && <SystemDiagnostics />}
      {tab === 'ci' && isSuperAdmin && (
        <div style={{ display: 'grid', gap: 16 }}>
          <PerfPanel />
          <CiSuitePanel />
        </div>
      )}

      {tab === 'crud' && isSuperAdmin && (
        <div style={{ display: 'grid', gap: 16 }}>
          {CRUD_TABLES.map(cfg => <UniversalCrud key={cfg.table} {...cfg} />)}
        </div>
      )}

      {tab === 'test_notifs' && (
        <div className="card">
          <h3>فحص نظام الإشعارات الشامل</h3>
          <p>هذه الأداة تقوم بتشغيل الفحص التلقائي لانتهاء العقود وانتهاء تأشيرات الموظفين وإرسال إشعارات للإدارة.</p>
          <button className="btn btn-primary" onClick={async () => {
            await runDailyNotificationChecks(profile.company_id);
            toast('تم تشغيل الفحص الشامل بنجاح، يرجى التحقق من قائمة الإشعارات أعلى الشاشة 🔔');
          }}>تشغيل نظام الإشعارات الآن</button>
        </div>
      )}
    </div>
  )
}

function explain(err) {
  const code = err?.code || ''
  const msg = err?.message || 'خطأ غير متوقع'
  if (code === '42501' || /permission denied|row-level security|policy/i.test(msg))
    return 'صلاحيات قاعدة البيانات ناقصة — نفّذ ملف supabase/POST_SETUP_FIX.sql ثم أعد المحاولة.'
  return 'خطأ: ' + msg
}
