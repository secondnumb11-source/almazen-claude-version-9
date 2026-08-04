import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { useAnnualPrice, formatPrice } from '../lib/pricing'

/*
  TrialExpired — شاشة انتهاء فترة التجربة + خيارات الاشتراك السنوي.
  تظهر تلقائياً من App.jsx عندما تكون حالة الوصول active === false.
  التصميم فاخر ومصمم ليعكس هوية المازن (ذهبي + كحلي).
  السعر يُقرأ من جدول subscription_plans (كود annual) — مصدر واحد للسعر.
*/
const WHATSAPP = '966557500471'
const ADMIN_EMAIL = 'shadyabdelwahab99@gmail.com'

export default function TrialExpired({ mode = 'expired' }) {
  const { company, profile, toast, signOut } = useAuth()
  const PRICE = useAnnualPrice()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ reference: '', notes: '', file: null })

  const [done, setDone] = useState(false)

  const waLink = (msg) =>
    `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`

  const submitReceipt = async (e) => {
    e.preventDefault()
    if (!form.file) return toast('أرفق صورة/ملف إيصال التحويل أولاً', true)
    if (!form.reference.trim()) return toast('اكتب رقم مرجع/مبلغ التحويل', true)
    setBusy(true)
    try {
      // 1) رفع الإيصال إلى Bucket خاص
      const ext = form.file.name.split('.').pop()
      const path = `${company.id}/${Date.now()}.${ext}`
      const up = await supabase.storage.from('subscription-receipts').upload(path, form.file, { upsert: false })
      if (up.error) throw up.error

      // 2) تسجيل الدفعة في قاعدة البيانات
      const ins = await supabase.from('subscription_payments').insert({
        company_id: company.id,
        amount: PRICE,
        method: 'bank_transfer',
        reference: form.reference.trim(),
        receipt_url: path,
        notes: form.notes || null,
      })
      if (ins.error) throw ins.error

      // 3) إشعار صاحب النظام بالإيميل (إن كانت الحافّة منشورة)
      try {
        await supabase.functions.invoke('notify-new-signup', {
          body: {
            kind: 'payment_receipt',
            admin_email: ADMIN_EMAIL,
            company_name: company?.name,
            company_id: company?.id,
            owner_email: profile?.full_name,
            amount: PRICE,
            reference: form.reference,
            receipt_path: path,
            notes: form.notes,
          }
        })
      } catch (_) { /* تجاهُل بصمت — الإيصال محفوظ في قاعدة البيانات */ }

      setDone(true)
      toast('✓ استلمنا إيصالك. سيتم تفعيل الاشتراك خلال 24 ساعة.')
    } catch (err) {
      toast('تعذّر رفع الإيصال: ' + (err.message || err), true)
    } finally { setBusy(false) }
  }

  return (
    <div className="trial-expired-wrap">
      <div className="te-glow" aria-hidden />
      <div className="te-card">
        <div className="te-hero">
          <div className="te-crest">✦</div>
          <h1>{mode === 'expired' ? 'انتهت فترة التجربة المجانية' : 'ترقية الاشتراك'}</h1>
          <p className="te-sub">
            {mode === 'expired'
              ? 'لم يعد بإمكانك استخدام النظام حتى يتم تفعيل الاشتراك السنوي. اختر إحدى طرق الدفع أدناه ليتم تفعيل حسابك فوراً.'
              : 'رقّي حسابك للاشتراك السنوي واحصل على كامل ميزات النظام بلا قيود.'}
          </p>
        </div>

        <div className="te-plan">
          <div className="te-plan-badge">الاشتراك السنوي الكامل</div>
          <div className="te-price"><b>{formatPrice(PRICE)}</b><span>ر.س / سنة</span></div>
          <ul className="te-features">
            <li>✓ جميع وحدات النظام بلا قيود</li>
            <li>✓ فوترة ZATCA متوافقة</li>
            <li>✓ بوابة المستأجر والذكاء الاصطناعي</li>
            <li>✓ تكامل إيجار جاهز للربط</li>
            <li>✓ دعم فني عبر واتساب</li>
          </ul>
        </div>

        <div className="te-methods">
          {/* طريقة 1: ميسر (معطّلة مؤقتاً) */}
          <div className="te-method disabled">
            <div className="te-method-h">
              <span className="te-icon">💳</span>
              <b>الدفع الإلكتروني عبر ميسر</b>
              <span className="chip">قريباً</span>
            </div>
            <p>الدفع الفوري ببطاقات مدى/فيزا/ماستركارد وApple Pay — يُفعَّل الحساب لحظياً.</p>
            <button className="btn btn-gold" disabled>الدفع الآن</button>
          </div>

          {/* طريقة 2: تحويل بنكي */}
          <div className="te-method">
            <div className="te-method-h">
              <span className="te-icon">🏦</span>
              <b>التحويل البنكي أو السداد</b>
              <span className="chip ok">متاح الآن</span>
            </div>
            <p>احصل على رقم الحساب البنكي/رقم السداد عن طريق التواصل مع خدمة العملاء، ثم ارفع إيصال التحويل هنا.</p>

            <a className="btn btn-green" target="_blank" rel="noopener noreferrer"
               href={waLink(`السلام عليكم — أرغب الحصول على رقم الحساب البنكي/رقم السداد لتفعيل اشتراك منصة المازن. اسم المنشأة: ${company?.name || ''}`)}>
              📱 طلب رقم الحساب عبر واتساب
            </a>

            {done ? (
              <div className="te-done">
                ✓ تم استلام إيصال التحويل. سيتم مراجعة الدفعة وتأكيد السداد وتفعيل الاشتراك خلال <b>24 ساعة</b>.
              </div>
            ) : (
              <form className="te-form" onSubmit={submitReceipt}>
                <div className="fld">
                  <label>رقم مرجع/مبلغ التحويل</label>
                  <input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })}
                    placeholder="رقم العملية أو المبلغ" dir="ltr" />
                </div>
                <div className="fld">
                  <label>ملاحظات (اختياري)</label>
                  <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                    placeholder="اسم البنك، تاريخ التحويل…" />
                </div>
                <div className="fld">
                  <label>إيصال التحويل *</label>
                  <input type="file" accept="image/*,.pdf"
                    onChange={e => setForm({ ...form, file: e.target.files?.[0] || null })} />
                </div>
                <button className="btn btn-gold" disabled={busy}>
                  {busy ? '...جارٍ الرفع' : '📤 رفع الإيصال وتأكيد السداد'}
                </button>
                <p className="te-hint">سيتم تأكيد السداد وتفعيل الاشتراك خلال 24 ساعة من مراجعة الإيصال.</p>
              </form>
            )}
          </div>
        </div>

        <div className="te-support">
          <a className="te-support-btn" target="_blank" rel="noopener noreferrer"
             href={waLink('السلام عليكم — أرغب الاستفسار عن اشتراك منصة المازن أو الحصول على خصم للشركات.')}>
            💬 التواصل مع خدمة العملاء (استفسار / خصومات الشركات)
          </a>
          <button className="te-signout" onClick={signOut}>تسجيل الخروج</button>
        </div>
      </div>
    </div>
  )
}
