import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import almazenLogo from '../assets/almazen-logo.png'
import saudiTechLogo from '../assets/saudi-tech-logo.svg'
import logoBooking from '../assets/logo-booking-wordmark.svg'
import logoAirbnb from '../assets/logo-airbnb.svg'
import logoAgoda from '../assets/logo-agoda.svg'
import logoTrip from '../assets/logo-trip.svg'
import logoExpedia from '../assets/logo-expedia.svg'
import logoHotelscom from '../assets/logo-hotelscom.svg'
import logoTripadvisor from '../assets/logo-tripadvisor.svg'

/* صور فندقية مجانية الاستخدام من Unsplash — تتحرك بتأثير Ken Burns
   وعند عدم توفر الإنترنت تظهر خلفية زرقاء فاخرة بديلة */
// شركاء مزامنة الحجز العالميين — الشعارات الرسمية الحقيقية (Simple Icons/Wikimedia
// Commons بتراخيص تسمح بالاستخدام)، عدا Vrbo غير المتوفر بشعار حر فيُمثَّل برمز
const CHANNEL_LOGOS = [
  { name: 'Booking.com', img: logoBooking },
  { name: 'Airbnb',      img: logoAirbnb },
  { name: 'Expedia',     img: logoExpedia },
  { name: 'Agoda',       img: logoAgoda },
  { name: 'Hotels.com',  img: logoHotelscom },
  { name: 'Trip.com',    img: logoTrip },
  { name: 'Vrbo',        ic: '🏖️', clr: '#1E3A5F' },
]

// شعارات منصات الحجز — تظهر داخل بطاقة "ربط عالمي" في صف الإحصائيات
const MINI_HERO_LOGOS = [
  { name: 'Booking.com', img: logoBooking },
  { name: 'Airbnb',      img: logoAirbnb },
  { name: 'Agoda',       img: logoAgoda },
  { name: 'Trip.com',    img: logoTrip },
  { name: 'Expedia',     img: logoExpedia },
  { name: 'Tripadvisor', img: logoTripadvisor },
]

const HERO_IMGS = [
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1920&q=70',
  'https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=1920&q=70',
  'https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1920&q=70',
]

// إظهار العناصر تدريجياً عند التمرير + عدّاد رقمي متحرك للإحصائيات
function useLuxeEffects() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal')
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target) }
      })
    }, { threshold: 0.14 })
    els.forEach(el => io.observe(el))

    const counters = document.querySelectorAll('[data-count]')
    const co = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting) return
        const el = en.target
        const target = parseFloat(el.dataset.count); const suf = el.dataset.suffix || ''
        const dur = 1400, t0 = performance.now()
        const tick = t => {
          const p = Math.min(1, (t - t0) / dur)
          const eased = 1 - Math.pow(1 - p, 3)
          el.textContent = (target >= 100 ? Math.round(target * eased) : (target * eased).toFixed(1)) + suf
          if (p < 1) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick); co.unobserve(el)
      })
    }, { threshold: 0.5 })
    counters.forEach(el => co.observe(el))

    return () => { io.disconnect(); co.disconnect() }
  }, [])
}

export default function Landing({ onLogin }) {
  /*
    تثبيت التطبيق (PWA).
    كان الزر مشروطاً بـ deferredPrompt وحده، وهو حدث `beforeinstallprompt`
    غير المدعوم في Safari على iOS إطلاقاً — فمستخدمو الآيفون والآيباد لم
    يكن يظهر لهم أي سبيل للتثبيت. وعلى iOS يتم التثبيت يدوياً من قائمة
    «مشاركة ← إضافة إلى الشاشة الرئيسية»، فتُعرض لهم الخطوات بدل الزر.
    كذلك كان مستمع الحدث يُسجَّل بلا إزالة، فيتراكم عند إعادة التركيب.
  */
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  /*
    فيديو التعريف: مصدره platform_branding.intro_video_url لا ملف في الحزمة —
    الملف 14 ميغابايت، وإدراجه في المستودع يضخّمه إلى الأبد ويُبطئ كل بناء.
    القراءة متاحة للزائر غير المسجَّل (سياسة pb_select بشرط true)، والتعديل
    لسوبر أدمن وحده. وإن كانت القيمة NULL لا يُعرض القسم إطلاقاً، فلا يظهر
    مشغّل فارغ.
  */
  const [introVideo, setIntroVideo] = useState(null);
  useEffect(() => {
    let cancelled = false
    supabase.from('platform_branding')
      .select('intro_video_url, intro_video_poster')
      .eq('id', true)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled && data?.intro_video_url) setIntroVideo(data) })
    return () => { cancelled = true }
  }, []);

  const isIOS = typeof navigator !== 'undefined'
    && /iphone|ipad|ipod/i.test(navigator.userAgent || '')
    && !/crios|fxios/i.test(navigator.userAgent || '')

  useEffect(() => {
    const isStandalone = () =>
      window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true
    setInstalled(isStandalone())

    const onPrompt = (e) => { e.preventDefault(); setDeferredPrompt(e) }
    const onInstalled = () => { setDeferredPrompt(null); setInstalled(true); setShowIosSteps(false) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, []);

  // يظهر الزر متى كان التثبيت ممكناً فعلاً: إمّا بحدث المتصفح، أو على iOS
  // حيث التثبيت متاح دائماً يدوياً. ويختفي إن كان التطبيق مثبَّتاً أصلاً.
  const canInstall = !installed && (!!deferredPrompt || isIOS)

  const handleInstallClick = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => setDeferredPrompt(null));
      return;
    }
    if (isIOS) setShowIosSteps(true);
  };
  useLuxeEffects()
  return (
    <div className="landing">

      {/* ===== شريط التحدي — أول ما يراه الزائر قبل تسجيل الدخول ===== */}
      <aside className="ld-challenge">
        <div className="ld-challenge-inner">
          <span className="ld-challenge-tag">تحدٍّ مفتوح</span>
          <p className="ld-challenge-text">
            جرّبها <strong>مرة واحدة</strong> — وستعرف الفرق.
            <span className="ld-challenge-sub">من جرّب المازن لم يستغنِ عنها</span>
          </p>
          <button className="ld-challenge-cta" onClick={onLogin}>
            ابدأ التحدي
            <span aria-hidden="true">←</span>
          </button>
        </div>
      </aside>

      {/* ===== الواجهة العليا مع الخلفية المتحركة ===== */}
      <section className="ld-hero">
        <div className="ld-bg">
          {HERO_IMGS.map(src => <img key={src} src={src} alt="" loading="eager" />)}
        </div>
        <div className="ld-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="brand-3d" tabIndex={0}
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                const x = ((e.clientX - r.left) / r.width - 0.5) * 2
                const y = ((e.clientY - r.top) / r.height - 0.5) * 2
                e.currentTarget.style.setProperty('--rx', (y * -8) + 'deg')
                e.currentTarget.style.setProperty('--ry', (x * 12) + 'deg')
                e.currentTarget.style.setProperty('--mx', ((x + 1) * 50) + '%')
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.setProperty('--rx', '0deg')
                e.currentTarget.style.setProperty('--ry', '0deg')
              }}>
              <span className="brand-logo-wrap" aria-hidden="false">
                <img src={almazenLogo} alt="شعار منصة المازن" className="brand-logo-img" />
              </span>
              <span className="brand-text" data-text="منصة المازن">منصة المازن</span>
              <span className="brand-glow" aria-hidden="true"></span>
            </div>
            <div className="ld-saudi-tech-badge" title="تقنية سعودية">
              <img src={saudiTechLogo} alt="تقنية سعودية" />
            </div>
          </div>
          <button className="btn btn-gold btn-sm ld-login-btn" onClick={onLogin}>تسجيل الدخول</button>
          {canInstall && (
            <button className="btn btn-ghost btn-sm ld-install-btn" onClick={handleInstallClick}>
              تثبيت التطبيق 📱
            </button>
          )}
        </div>
        <div className="ld-hero-content">
          <span className="ld-badge">✦ منصة سعودية احترافية لإدارة الضيافة والتأجير</span>
          <h1>المازن — إدارة ذكية لإيجارات الشقق المفروشة والشاليهات والوحدات العقارية</h1>
          <p className="lead">
            منصة متكاملة تعتمد عليها منشآت التأجير لإدارة الحجوزات والعقود والدفعات والفواتير
            الضريبية بأتمتة كاملة — من لحظة الحجز حتى الإخلاء، بدون أوراق وبدون أخطاء.
          </p>
          <div className="ld-cta">
            <button className="btn btn-gold" onClick={onLogin}>تسجيل الدخول أو التسجيل لتجربة المنصة 7 أيام مجاناً</button>
            <button className="btn btn-ghost" style={{ background: 'rgba(255,255,255,.1)', color: '#fff', borderColor: 'rgba(255,255,255,.35)' }}
              onClick={() => document.getElementById('trial').scrollIntoView({ behavior: 'smooth' })}>ابدأ تجربتك المجانية ✦</button>
          </div>
          <div className="ld-stats-breakout">
          <div className="ld-stats reveal d3">
            <div className="ld-stats-row">
              <div><b><span data-count="120" data-suffix="+">0</span></b><span>منشأة تعتمد علينا</span></div>
              <div><b><span data-count="8500" data-suffix="+">0</span></b><span>وحدة تُدار يومياً</span></div>
              <div><b><span data-count="99.9" data-suffix="%">0</span></b><span>دقة الحسابات</span></div>
              <div><b>ZATCA</b><span>فوترة متوافقة</span></div>
              <div className="ld-ejar-badge"><b>🏛️ إيجار</b><span>قريباً</span></div>
            </div>

            <div className="ld-hero-channels" onClick={() => document.getElementById('channels').scrollIntoView({ behavior: 'smooth' })}>
              <div className="ld-hero-channels-label">
                <b>🌐 ربط فوري مع منصات الحجز العالمية</b>
                <span>مزامنة لحظية للأسعار والإتاحة والحجوزات — بلا لمسة يدوية</span>
              </div>
              <div className="ld-mini-logos">
                {MINI_HERO_LOGOS.map(m => (
                  <span key={m.name} className="ld-mini-logo" title={m.name}>
                    <img src={m.img} alt={m.name} />
                  </span>
                ))}
              </div>
            </div>

            <div className="ld-saudi-tech-inline">
              <img src={saudiTechLogo} alt="تقنية سعودية" />
              <span>مبنية بالكامل بتقنية سعودية 100%</span>
            </div>
          </div>
          </div>
        </div>
      </section>

      {/* ===== فيديو التعريف — لا يُعرض إن لم يكن هناك مصدر ===== */}
      {introVideo?.intro_video_url && (
        <section className="ld-sec ld-video-sec" id="intro-video">
          <div className="ld-video-head">
            <span className="ld-badge-inline">▶ شاهد المنصة</span>
            <h2>المازن في دقائق</h2>
            <div className="ld-rule" />
          </div>
          <div className="ld-video-frame">
            <video
              className="ld-video"
              src={introVideo.intro_video_url}
              poster={introVideo.intro_video_poster || undefined}
              controls
              playsInline
              preload="metadata"
            >
              متصفحك لا يدعم تشغيل الفيديو.
            </video>
          </div>
        </section>
      )}

      {/* ===== نبذة ومميزات المنصة ===== */}
      <section className="ld-sec" id="about">
        <div className="ld-sec-head">
          <h2>لماذا يعتمد عليها الكثير من منشآت التأجير؟</h2>
          <div className="ld-rule" />
          <p>
            المازن ليست مجرد برنامج حجوزات — إنها منظومة عمل كاملة تسهّل على الموظفين مهامهم اليومية،
            وتمنح المدير تحكماً كاملاً، وتحوّل عمل المحاسب من ساعات بحث يدوي إلى ضغطة زر واحدة.
          </p>
        </div>
        <div className="ld-cards">
          <div className="ld-card"><div className="ic">⚡</div><h3>أتمتة كاملة بلا تدخل بشري</h3><p>واتساب ترحيبي للمستأجر، إشعار المحاسب والمدير، إنشاء الفاتورة وبوابة المستأجر — كلها تحدث تلقائياً لحظة التسليم.</p></div>
          <div className="ld-card"><div className="ic">🎨</div><h3>لوحة وحدات لحظية ملونة</h3><p>أخضر متاح، برتقالي محجوز، أحمر مسكون، أصفر تنظيف — تتحدث فورياً لدى جميع الموظفين مع منع الحجز المزدوج آلياً.</p></div>
          <div className="ld-card"><div className="ic">🧾</div><h3>فوترة ZATCA معتمدة</h3><p>فواتير ضريبية مبسطة ومعتمدة بـ QR Code وترويسة منشأتك، جاهزة للربط الرسمي مع هيئة الزكاة والضريبة.</p></div>
          <div className="ld-card"><div className="ic">🏢</div><h3>نظام متعدد المنشآت</h3><p>كل منشأة بعزل كامل لبياناتها: شعارها وموظفوها ووحداتها وفواتيرها — أمان على مستوى قاعدة البيانات نفسها.</p></div>
          <div className="ld-card"><div className="ic">🤖</div><h3>ذكاء اصطناعي عامل</h3><p>اسأل بلغة طبيعية عن المتأخرين أو الأرباح أو الإشغال، واطلب ملفات إكسيل جاهزة بالبيانات التي تحددها أنت.</p></div>
          <div className="ld-card"><div className="ic">🛡️</div><h3>حماية النزاعات</h3><p>قوائم استلام وتسليم موثقة بالصور والتوقيع والوقت، ودورة حياة كاملة للتأمين والعربون تحسم أي خلاف.</p></div>
        </div>
      </section>

      {/* ===== ميزة تكامل منصة إيجار ===== */}
      <section className="ld-sec ld-ejar-sec" id="ejar">
        <div className="ld-ejar-wrap">
          <div className="ld-ejar-logo">
            <div className="ld-ejar-crest">🏛️</div>
            <b>إيجار</b>
            <span>منصة العقود الإلكترونية — وزارة الشؤون البلدية والقروية والإسكان</span>
          </div>
          <div className="ld-ejar-body">
            <span className="ld-badge-inline">حصري ✦ ميزة فريدة</span>
            <h2>تكامل مباشر مع منصة «إيجار» الرسمية</h2>
            <div className="ld-rule" />
            <div className="ld-soon-box">
              <span className="ld-soon-shine" aria-hidden="true" />
              <span className="ld-soon-icon">⏳</span>
              <span className="ld-soon-text">قريباً</span>
            </div>
            <div className="ld-ejar-benefits">
              <div><b>👔 للمديرين</b><span>غطاء قانوني رسمي لكل عقد، وحماية كاملة لحقوق المنشأة أمام أي نزاع.</span></div>
              <div><b>📊 للمحاسبين</b><span>سجل موحّد بين النظام وإيجار — لا تناقض في الأرقام ولا مطابقات يدوية.</span></div>
              <div><b>🤝 للمستأجرين</b><span>عقد إلكتروني موثّق فوراً على جوّالهم، يستخدمونه للتأشيرات والخدمات الحكومية.</span></div>
              <div><b>⚡ للعمليات</b><span>من دقائق طويلة يدوياً إلى ثوانٍ — إصدار وتوثيق ومزامنة كلها آلية.</span></div>
            </div>
            <div className="ld-ejar-pills">
              <span className="chip">✓ توثيق فوري</span>
              <span className="chip">✓ مزامنة حالة العقد</span>
              <span className="chip">✓ استخراج رقم العقد الرسمي</span>
              <span className="chip">✓ ربط بالحساب البنكي (سداد)</span>
            </div>
          </div>
        </div>
      </section>


      {/* ===== ميزة الربط مع منصات الحجز العالمية (Channel Manager) ===== */}
      <section className="ld-sec ld-channel-sec" id="channels">
        <div className="ld-channel-wrap">
          <div className="ld-sec-head">
            <span className="ld-badge-inline">✦ ميزة عالمية حصرية</span>
            <h2>وحداتك على Booking.com وAirbnb في آنٍ واحد — بلا لمسة يدوية</h2>
            <div className="ld-rule" />
            <p>
              تُمكِّنك المازن من ربط كل وحداتك بمنصات الحجز العالمية عبر مزامنة لحظية ثنائية الاتجاه:
              فور تأجير وحدة من موظفك تُغلق تلقائياً على كل المنصات، وفور وصول حجز من أي منصة يُسجَّل
              في نظامك فوراً وتتحوّل الوحدة برتقالية مع شارة «أونلاين» مميّزة — منظومة واحدة، تحكّم كامل،
              بلا ازدواج حجز وبلا تدخل يدوي.
            </p>
          </div>

          <div className="ld-channel-benefits">
            <div className="reveal d1"><b>⚡ مزامنة لحظية</b><span>أي تغيير في السعر أو الإتاحة أو حالة الحجز ينعكس فوراً على كل المنصات المرتبطة.</span></div>
            <div className="reveal d2"><b>🛡️ صفر ازدواج حجز</b><span>حماية على مستوى قاعدة البيانات تمنع تعارض التواريخ بين حجوزاتك المباشرة وحجوزات المنصات.</span></div>
            <div className="reveal d3"><b>🌍 وصول أوسع للنزلاء</b><span>وحداتك مرئية لملايين المسافرين حول العالم دون أي جهد تسويقي إضافي منك.</span></div>
            <div className="reveal d1"><b>🎛️ لوحة تحكم واحدة</b><span>كل الحجوزات — مهما كان مصدرها — تُدار وتُحاسَب وتُوثَّق من نفس شاشة المازن.</span></div>
          </div>

          <div className="ld-channel-logowall">
            <div className="ld-channel-track">
              {[...CHANNEL_LOGOS, ...CHANNEL_LOGOS].map((c, i) => (
                <div className="ld-channel-chip" key={c.name + i} style={{ '--chip-clr': c.clr }}>
                  {c.img
                    ? <img className="ld-channel-logo-img" src={c.img} alt={c.name} />
                    : <><span className="ld-channel-ic">{c.ic}</span><span className="ld-channel-name">{c.name}</span></>}
                </div>
              ))}
            </div>
          </div>

          <div className="ld-ejar-pills" style={{ justifyContent: 'center' }}>
            <span className="chip">✓ ربط بضغطة واحدة عبر Channex</span>
            <span className="chip">✓ منع الحجوزات المزدوجة تلقائياً</span>
            <span className="chip">✓ تحديث الأسعار والإتاحة فوراً</span>
            <span className="chip">✓ شارة «أونلاين» على كل حجز خارجي</span>
          </div>
        </div>
      </section>

      {/* ===== بوابة الموظف ===== */}
      <section className="ld-sec" style={{ background: 'var(--soft)', maxWidth: 'none' }}>
        <div style={{ maxWidth: 1180, margin: 'auto' }}>
          <div className="ld-portal">
            <div>
              <span className="tag">بوابة الموظف</span>
              <h3>أسهل وأوضح واجهة يعمل عليها موظف الاستقبال</h3>
              <p className="sub">صُممت لتختصر يوم الموظف: كل شيء في شاشة واحدة — الوحدات وحالاتها ولوحة أرقام اليوم، والحجز الكامل بنقرات معدودة.</p>
              <ul>
                <li>الوحدات وحالاتها الملونة داخل لوحة البيانات الرئيسية مباشرة</li>
                <li>حجز متكامل: بيانات المستأجر والمرافقين ورفع صورة الهوية</li>
                <li>الخصم والإجمالي والمتبقي بحساب تلقائي، مع خانتي العربون والتأمين</li>
                <li>الدفعات كاش أو تحويل أو بطاقة مع رفع مستند السداد ورقم الإيصال</li>
                <li>تقويم شهري لكل وحدة للحجوزات الحالية والمسبقة</li>
                <li>عقد إلكتروني مبدئي وفاتورة ضريبية بضغطة واحدة</li>
              </ul>
            </div>
            <div className="ld-visual"><div className="inner">
              <div className="row"><span>وحدات اليوم</span><span className="gold">لوحة الموظف</span></div>
              <div className="ld-mini">
                {[['101', '#1B9E5A'], ['102', '#D93636'], ['103', '#F08C1B'], ['104', '#E4B317'],
                ['201', '#1B9E5A'], ['202', '#1B9E5A'], ['CH-1', '#F08C1B'], ['CH-2', '#D93636']].map(([n, c]) =>
                  <i key={n} style={{ background: c }}>{n}</i>)}
              </div>
              <div className="row" style={{ marginTop: 12 }}><span>القادمون اليوم</span><span className="gold">3</span></div>
              <div className="row"><span>المغادرون اليوم</span><span className="gold">2</span></div>
            </div></div>
          </div>
        </div>
      </section>

      {/* ===== بوابة المدير ===== */}
      <section className="ld-sec">
        <div className="ld-portal rev">
          <div>
            <span className="tag">بوابة المدير</span>
            <h3>تحكم كامل بمنشأتك من مكان واحد</h3>
            <p className="sub">صلاحيات حصرية لا يملكها غيرك، ورؤية مالية لا تظهر لأي موظف — لأن أرقامك ملكك وحدك.</p>
            <ul>
              <li>إضافة الوحدات وتحديد الأسعار والتعديل عليها — صلاحية حصرية لك</li>
              <li>إلغاء الحجوزات بقرارك فقط، مفروض على مستوى قاعدة البيانات</li>
              <li>الإيرادات والمصروفات وصافي الربح الفعلي لكل وحدة</li>
              <li>إنشاء حسابات الموظفين والمحاسبين وتحديد أدوارهم</li>
              <li>رفع شعار منشأتك ليستبدل شعار النظام فوراً في كل الصفحات</li>
              <li>سجل تاريخ كامل لكل وحدة: من سكنها وكم دفعت وكم ربحت</li>
            </ul>
          </div>
          <div className="ld-visual"><div className="inner">
            <div className="row"><span>إيرادات الشهر</span><span className="gold">184,500 ر.س</span></div>
            <div className="row"><span>المصروفات</span><span className="gold">42,300 ر.س</span></div>
            <div className="row"><span>صافي الربح</span><span className="gold">142,200 ر.س</span></div>
            <div className="row"><span>نسبة الإشغال</span><span className="gold">78%</span></div>
            <div className="row"><span>أعلى وحدة دخلاً</span><span className="gold">شاليه CH-1</span></div>
          </div></div>
        </div>
      </section>

      {/* ===== بوابة المحاسب — شرح مفصل ===== */}
      <section className="ld-sec" style={{ background: 'var(--soft)', maxWidth: 'none' }}>
        <div style={{ maxWidth: 1180, margin: 'auto' }}>
          <div className="ld-sec-head">
            <h2 className="ld-shine-heading">بوابة المحاسب — مكتب محاسبة كامل داخل المنصة</h2>
            <div className="ld-rule" />
            <p>أقوى ما في المازن: كل ما يحتاجه المحاسب من استخراج وتنظيم وتصدير وتحليل، بأدوات ذكاء اصطناعي تعمل على بياناتك الحقيقية.</p>
          </div>
          <div className="ld-cards">
            <div className="ld-card"><div className="ic">📑</div><h3>استخراج فوري لأي بيانات</h3><p>تاريخ إيجار أي وحدة كاملاً، بيانات أي مستأجر ودفعاته، حسابات فترة محددة — باختيار بسيط وبدون بحث يدوي.</p></div>
            <div className="ld-card"><div className="ic">📊</div><h3>ملف حسابات إكسيل تفصيلي</h3><p>تصدير شامل بعدة أوراق: الدفعات والحجوزات والمستأجرون والمصروفات وورقة ملخص، مع معادلات جمع ومتوسط جاهزة داخل الملف.</p></div>
            <div className="ld-card"><div className="ic">🤖</div><h3>إكسيل بالذكاء الاصطناعي</h3><p>اكتب: «أصدر ملف إكسيل بدفعات شهر يوليو للوحدة 101» — وتنشئ الأداة الملف المطلوب بالبيانات والحسابات التي حددتها.</p></div>
            <div className="ld-card"><div className="ic">📈</div><h3>رسومات بيانية حية</h3><p>الإيراد الشهري، توزيع حالات الوحدات، الإيراد حسب النوع — رسوم تفاعلية تقرأ من قاعدة البيانات مباشرة.</p></div>
            <div className="ld-card"><div className="ic">⏰</div><h3>أعمار الديون والتحصيل</h3><p>قائمة المتأخرين بأيام التأخير والمبالغ، مع تذكير واتساب جماعي بضغطة واحدة يُقيد تلقائياً في سجل الأتمتة.</p></div>
            <div className="ld-card"><div className="ic">🧾</div><h3>الفوترة والضريبة</h3><p>إصدار الفواتير المبسطة والمعتمدة بـ QR، وترقيم تسلسلي تلقائي، وتجهيز كامل للربط الرسمي مع ZATCA.</p></div>
          </div>
        </div>
      </section>

      {/* ===== بوابة المستأجر — قسم فاخر جديد ===== */}
      <section className="ld-sec ld-tenant" id="tenant-portal">
        <div className="ld-sec-head">
          <span className="ld-badge-inline">جديد ✦</span>
          <h2>بوابة المستأجر — تجربة راقية بلا اتصالات متكررة</h2>
          <div className="ld-rule" />
          <p>
            امنح كل مستأجر رابطاً شخصياً آمناً يفتح منه عقده وفواتيره ومدفوعاته، ويرسل طلبات الصيانة والخدمة بضغطة —
            بلا تسجيل دخول، بلا تطبيق، وبتصميم فاخر يليق بمنشأتك.
          </p>
        </div>

        <div className="ld-cards">
          <div className="ld-card"><div className="ic">🔑</div><h3>دخول برابط سري بلا كلمة مرور</h3><p>رابط مُشفَّر من 48 حرفاً عشوائياً يصل للمستأجر عبر واتساب — لا يُخمَّن، ولا يحتاج حساباً، ويمكن تعطيله فوراً.</p></div>
          <div className="ld-card"><div className="ic">📄</div><h3>عقد وفاتورة وكشف حساب</h3><p>يرى إجمالي عقده والمدفوع والمتبقّي وسجل الدفعات، ويحمّل فاتورته الضريبية بـ QR جاهزة للطباعة.</p></div>
          <div className="ld-card"><div className="ic">🛠️</div><h3>طلبات صيانة وخدمة بالصور</h3><p>يفتح تذكرة صيانة أو طلب خدمة مع صورة، وتصل فوراً كإشعار حيّ للموظف في لوحة التحكم.</p></div>
          <div className="ld-card"><div className="ic">⏳</div><h3>عدّاد إقامة تنازلي</h3><p>يعرض للمستأجر أيام إقامته المتبقية، ويستقبل تذكيرات قبل انتهاء العقد وقبل الأقساط المستحقة.</p></div>
          <div className="ld-card"><div className="ic">🌟</div><h3>نقاط ولاء وتقييم</h3><p>سجل نقاط ولاء يتراكم مع كل إقامة، وتقييم بالنجوم بعد بدء/انتهاء الإقامة لرفع جودة الخدمة.</p></div>
          <div className="ld-card"><div className="ic">🔒</div><h3>أمان على مستوى قاعدة البيانات</h3><p>الوصول يمر عبر دوال <code>portal_*</code> آمنة تتحقق من الرمز أولاً — لا يُمنح أي دور anon صلاحية مباشرة على بياناتك.</p></div>
        </div>

        <div className="ld-steps">
          <div className="ld-steps-h">
            <h3>كيف تُفعّل بوابة المستأجر في 3 خطوات</h3>
            <p>لا إعدادات معقّدة — التفعيل تلقائي لحظة تسليم الوحدة.</p>
          </div>
          <ol className="ld-timeline">
            <li>
              <span className="ld-step-n">1</span>
              <div>
                <b>سلّم الوحدة من لوحة الموظف</b>
                <p>افتح الحجز النشط ثم اضغط «تسليم الوحدة» — يُنشأ رابط بوابة المستأجر تلقائياً في اللحظة نفسها.</p>
              </div>
            </li>
            <li>
              <span className="ld-step-n">2</span>
              <div>
                <b>يصل الرابط للمستأجر عبر واتساب</b>
                <p>ضمن رسالة الترحيب التلقائية — دون تدخّل يدوي، ودون حاجة لنسخ أو إرسال.</p>
              </div>
            </li>
            <li>
              <span className="ld-step-n">3</span>
              <div>
                <b>يفتح المستأجر بوابته الفاخرة</b>
                <p>يستعرض عقده وفواتيره ومدفوعاته، ويرسل طلبات الصيانة — كل ذلك من متصفح جواله مباشرة.</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      {/* ===== مربع تجربة 7 أيام — تصميم فاخر مميّز ===== */}
      <section className="ld-trial" id="trial">
        <div className="ld-trial-card">
          <div className="ld-trial-glow" aria-hidden />
          <span className="ld-trial-badge">✦ عرض حصري للعملاء الجدد</span>
          <h2>جرّب منصة المازن 7 أيام مجاناً</h2>
          <p className="ld-trial-lead">
            سجّل حسابك خلال دقيقة واحدة واستمتع بكل مميزات المنصة الكاملة بلا قيود ولا التزام مالي —
            بدون بطاقة ائتمان، وبدون رسوم مخفية.
          </p>
          <div className="ld-trial-grid">
            <div className="ld-trial-feat"><b>⚡ تفعيل فوري</b><span>حسابك جاهز مباشرة بعد تفعيل البريد.</span></div>
            <div className="ld-trial-feat"><b>🔓 كل المميزات</b><span>حجوزات، فوترة، بوابة مستأجر، وذكاء اصطناعي.</span></div>
            <div className="ld-trial-feat"><b>💳 بدون بطاقة</b><span>لا نطلب أي بيانات بنكية للتجربة.</span></div>
            <div className="ld-trial-feat"><b>🛟 دعم مباشر</b><span>خدمة عملاء عبر واتساب طوال الفترة التجريبية.</span></div>
          </div>
          <button className="btn btn-gold ld-trial-cta" onClick={onLogin}>🚀 ابدأ التجربة المجانية الآن</button>
          <p className="ld-trial-fine">
            بعد انتهاء الـ 7 أيام يتوقف الحساب تلقائياً حتى تفعيل الاشتراك السنوي (3,000 ر.س) — بلا خصم تلقائي وبلا مفاجآت.
          </p>
        </div>
      </section>

      {/* ===== تثبيت التطبيق على الجوّال (PWA) ===== */}
      <section className="ld-sec ld-install-sec" id="install">
        <div className="ld-install-card">
          <div className="ld-install-icon" aria-hidden="true">📱</div>
          <h2>ثبّت المازن على جوّالك</h2>
          <p className="ld-install-lead">
            يعمل كتطبيق مستقل بأيقونة على شاشتك الرئيسية، ويفتح بلا شريط متصفح — بلا متجر وبلا تحديثات يدوية.
          </p>

          {installed ? (
            <div className="ld-install-done">✓ التطبيق مثبَّت على هذا الجهاز</div>
          ) : (
            <>
              {(deferredPrompt || isIOS) && (
                <button className="btn btn-gold ld-install-cta" onClick={handleInstallClick}>
                  {isIOS && !deferredPrompt ? 'كيف أثبّته على الآيفون؟' : 'تثبيت التطبيق الآن'}
                </button>
              )}

              {/* على iOS لا يوجد حدث تثبيت في المتصفح — الخطوات هي السبيل الوحيد */}
              {showIosSteps && (
                <ol className="ld-ios-steps">
                  <li>اضغط زر <b>المشاركة</b> <span aria-hidden="true">⬆️</span> في شريط Safari بالأسفل.</li>
                  <li>مرّر واختر <b>«إضافة إلى الشاشة الرئيسية»</b>.</li>
                  <li>اضغط <b>«إضافة»</b> — ستظهر أيقونة المازن مع تطبيقاتك.</li>
                </ol>
              )}

              {!deferredPrompt && !isIOS && (
                <p className="ld-install-hint">
                  افتح هذه الصفحة من متصفح جوّالك لتثبيت التطبيق، أو من قائمة المتصفح اختر «تثبيت التطبيق».
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {/* ===== الشعارات الحكومية والعلامات التجارية ===== */}
      <section className="ld-sec" style={{ background: 'var(--soft)', maxWidth: 'none', paddingTop: 40, paddingBottom: 40 }}>
        <div style={{ maxWidth: 1180, margin: 'auto', textAlign: 'center' }}>
          <h3 style={{ marginBottom: 12, fontSize: 18, fontWeight: 600 }}>✦ تقنية سعودية بنسبة 100%</h3>
          <p style={{ marginBottom: 32, color: 'var(--muted)', fontSize: 14 }}>منصة المازن متوافقة مع الجهات الحكومية السعودية</p>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 24,
            alignItems: 'center'
          }}>
            <div style={{
              padding: '20px 16px',
              background: '#fff',
              borderRadius: 12,
              border: '1px solid var(--line)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12
            }}>
              <span style={{ fontSize: 28 }}>🏛️</span>
              <span style={{ fontWeight: 600, fontSize: 14 }}>منصة إيجار</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>وزارة الشؤون البلدية والقروية والإسكان</span>
            </div>

            <div style={{
              padding: '20px 16px',
              background: '#fff',
              borderRadius: 12,
              border: '1px solid var(--line)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12
            }}>
              <span style={{ fontSize: 28 }}>📊</span>
              <span style={{ fontWeight: 600, fontSize: 14 }}>SHOMOOS</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>منصة الاستثمار والإنشاءات</span>
            </div>

            <div style={{
              padding: '20px 16px',
              background: '#fff',
              borderRadius: 12,
              border: '1px solid var(--line)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12
            }}>
              <span style={{ fontSize: 28 }}>🧾</span>
              <span style={{ fontWeight: 600, fontSize: 14 }}>ZATCA</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>هيئة الزكاة والضريبة والجمارك</span>
            </div>

            <div style={{
              padding: '20px 16px',
              background: '#fff',
              borderRadius: 12,
              border: '1px solid var(--line)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12
            }}>
              <span style={{ fontSize: 28 }}>🎫</span>
              <span style={{ fontWeight: 600, fontSize: 14 }}>وزارة السياحة</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>وزارة السياحة والآثار</span>
            </div>
          </div>

          <div style={{
            marginTop: 32,
            paddingTop: 24,
            borderTop: '1px solid var(--line)',
            color: 'var(--muted)',
            fontSize: 13,
            lineHeight: 1.6
          }}>
            <p>✓ جميع التكاملات والفوترة تتوافق مع المتطلبات السعودية</p>
            <p>✓ النظام مصمم خصيصاً لقطاع الضيافة والإيجارات في السعودية</p>
          </div>
        </div>
      </section>

      {/* ===== دعوة أخيرة ===== */}
      <section className="ld-final">
        <h2>جاهز لإدارة وحداتك باحترافية؟</h2>
        <p>بوابتان للدخول: الموظف باسم مستخدم ينشئه المدير، والمدير بالبريد الإلكتروني</p>
        <button className="btn btn-gold" style={{ fontSize: 17, padding: '15px 44px' }} onClick={onLogin}>تسجيل الدخول أو التسجيل لتجربة المنصة 7 أيام مجاناً</button>
      </section>
      <footer className="ld-footer-full">
        <div className="ld-footer-grid">
          <div className="ld-footer-col">
            <h4>🏢 المازن للعقارات</h4>
            <p>منصة إدارة الوحدات السكنية والإيجارات بذكاء وكفاءة عالية. مصممة وفق المتطلبات السعودية.</p>
          </div>
          <div className="ld-footer-col">
            <h4>روابط سريعة</h4>
            <a href="/privacy">سياسة الخصوصية</a>
            <a href="/terms">شروط الاستخدام</a>
          </div>
          <div className="ld-footer-col">
            <h4>الدعم والتواصل</h4>
            <div className="contact-row">
              <span>✉</span>
              <a href="mailto:info@adala-law.online">info@adala-law.online</a>
            </div>
            <div className="contact-row">
              <span>📞</span>
              <span>دعم 24 ساعة — الرياض</span>
            </div>
          </div>
        </div>
        <div className="ld-footer-bottom">
          <span>المازن © 2026 — منصة إدارة إيجارات الشقق المفروشة والشاليهات والوحدات العقارية</span>
          <div className="ld-footer-links">
            <a href="/privacy">سياسة الخصوصية</a>
            <a href="/terms">شروط الاستخدام</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
