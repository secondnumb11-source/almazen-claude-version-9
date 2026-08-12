import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { SAR, PAY_METHODS } from '../lib/helpers'
import RentalContract from '../components/RentalContract'
import PaymentGatewayModal from '../components/PaymentGatewayModal'

const REQ_TYPES = { extension: 'تمديد الإيجار', extra_service: 'خدمة إضافية', maintenance: 'صيانة', complaint: 'شكوى / ملاحظة' }
const REQ_STATUS = { new: 'جديد', in_progress: 'قيد المعالجة', done: 'مكتمل', rejected: 'مرفوض' }
const INS_STATUS = { paid: 'مدفوع', held: 'محجوز', deducted: 'تم الخصم منه', refunded: 'تم إرجاعه' }

/*
  بوابة المستأجر (المستأجر) — صفحة عامة بالكامل، بدون تسجيل دخول Supabase Auth.
  الوصول برمز سري وحيد ضمن الرابط (/portal/:token) يُرسل تلقائياً عبر
  واتساب لحظة تسليم الوحدة. كل القراءة والكتابة هنا تمر عبر دوال
  portal_* الآمنة في قاعدة البيانات (RPC)، ولا صلاحية مباشرة لأي جدول.
*/
export default function TenantPortal({ token }) {
  const [status, setStatus] = useState('loading')
  const [ctx, setCtx] = useState(null)
  const [tab, setTab] = useState('overview')
  const [toast, setToastMsg] = useState(null)
  const [payModalOpen, setPayModalOpen] = useState(false)

  const notify = (msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(null), 4000) }

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('portal_get_context', { p_token: token })
    if (error || !data) { setStatus('invalid'); return }
    setCtx(data); setStatus('ready')
  }, [token])

  useEffect(() => { load() }, [load])

  if (status === 'loading') return <div className="tp-loading">بوابة المازن — جارٍ التحقق من الرابط…</div>
  if (status === 'invalid') return (
    <div className="tp-invalid">
      <div className="tp-invalid-card">
        <div className="tp-invalid-ico">⚠️</div>
        <h2>الرابط غير صالح</h2>
        <p>هذا الرابط منتهي أو غير صحيح. تواصل مع المنشأة التي استأجرت منها للحصول على رابط بوابتك الصحيح.</p>
      </div>
    </div>
  )

  const b = ctx.current_booking
  const daysLeft = b ? Math.ceil((new Date(b.check_out_date) - new Date()) / 86400000) : null

  const TABS = [
    ['overview', '🏠 نظرة عامة'],
    ['statement', '💳 كشف الحساب'],
    ['docs', '🧾 المستندات'],
    ['requests', '📝 الطلبات'],
    ['handover', '📋 التسليم والاستلام'],
    ['loyalty', '⭐ الولاء والتقييم'],
    ['history', '🕓 سجل الإقامات'],
    ['companions', '👥 المرافقون'],
  ]

  return (
    <div className="tp-page" dir="rtl">
      <header className="tp-head">
        <div className="tp-head-brand">
          {ctx.company?.logo_url ? <img src={ctx.company.logo_url} alt="" /> : <span className="tp-head-mark">م</span>}
          <div>
            <h1>{ctx.company?.name || 'المازن'}</h1>
            <span>بوابة المستأجر الخاصة بك</span>
          </div>
        </div>
        <div className="tp-head-user">
          <b>{ctx.customer?.full_name}</b>
          {ctx.customer?.is_vip && <span className="chip chip-gold">VIP</span>}
        </div>
      </header>

      {b && (
        <div className="tp-hero">
          <div className="tp-hero-main">
            <span className="tp-hero-badge">
              {{ pending: 'بانتظار التأكيد', confirmed: 'محجوزة', checked_in: 'إقامتك الحالية', checked_out: 'انتهت الإقامة', cancelled: 'ملغاة' }[b.status]}
            </span>
            <h2>الوحدة {b.unit?.unit_number} {b.unit?.category ? `— ${b.unit.category}` : ''}</h2>
            <p>{b.check_in_date} ← {b.check_out_date}</p>
            {b.status === 'checked_in' && daysLeft !== null && (
              <div className="tp-countdown">
                {daysLeft > 0 ? <><b>{daysLeft}</b> يوم متبقٍ على انتهاء إقامتك</> : daysLeft === 0 ? 'اليوم هو آخر يوم في إقامتك' : 'انتهت مدة إقامتك'}
              </div>
            )}
            {b.ejar_status === 'registered' && (
              <div className="tp-ejar-badge">✅ عقدك موثّق رسمياً على منصة إيجار — رقم العقد: <b dir="ltr">{b.ejar_contract_number}</b></div>
            )}
          </div>
          {b.media?.[0] && (
            b.media[0].media_type === 'video'
              ? <video className="tp-hero-media" src={b.media[0].url} controls />
              : <img className="tp-hero-media" src={b.media[0].url} alt="" />
          )}
        </div>
      )}

      <nav className="tp-tabs">
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </nav>

      <main className="tp-body">
        {tab === 'overview' && <Overview b={b} company={ctx.company} availableUnits={ctx.available_units} />}
        {tab === 'statement' && <Statement b={b} onPay={() => setPayModalOpen(true)} />}
        {tab === 'docs' && <Docs b={b} company={ctx.company} customer={ctx.customer} />}
        {tab === 'requests' && <Requests b={b} token={token} notify={notify} reload={load} />}
        {tab === 'handover' && <HandoverTab b={b} token={token} notify={notify} reload={load} />}
        {tab === 'loyalty' && <LoyaltyTab customer={ctx.customer} history={ctx.loyalty_history} b={b} token={token} notify={notify} reload={load} />}
        {tab === 'history' && <HistoryTab past={ctx.past_bookings} />}
        {tab === 'companions' && <CompanionsTab b={b} token={token} notify={notify} reload={load} />}
      </main>

      {toast && <div className="tp-toast">{toast}</div>}
      <footer className="tp-foot">بوابة المازن الآمنة — هذا الرابط خاص بك، لا تشاركه مع أحد</footer>
      {payModalOpen && (
        <PaymentGatewayModal
          booking={b}
          token={token}
          amount={Math.max(0, (b.total_amount || 0) - (b.paid || 0))}
          onClose={() => setPayModalOpen(false)}
          onSuccess={() => { setPayModalOpen(false); load(); notify('تم الدفع بنجاح ومزامنة الحسابات'); }}
        />

      )}
    </div>
  )
}

/* ================= نظرة عامة ================= */
function Overview({ b, company, availableUnits }) {
  if (!b) return <EmptyState text="لا توجد إقامة حالية مرتبطة بحسابك." />
  
  const remaining = (b.total_amount || 0) - (b.paid || 0)
  const daysLeft = b.check_out_date ? Math.ceil((new Date(b.check_out_date) - new Date()) / 86400000) : null
  const isDueSoon = remaining > 0 || (daysLeft !== null && daysLeft <= 3)

  return (
    <div>
      {/* Automatic Rent Payment Due Reminder Banner */}
      {isDueSoon && (
        <div className="card animate-fade" style={{ background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(245, 158, 11, 0.1))', border: '1.5px solid #F59E0B', padding: 14, borderRadius: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h4 style={{ margin: 0, color: '#D97706', fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
                ⏰ تنبيه تذكيري: موعد استحقاق الدفعة القادمة ({b.check_out_date})
              </h4>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text)' }}>
                عزيزي المستأجر، يرجى المبادرة بسداد المبلغ المتبقي (<b>{SAR(remaining)}</b>) قبل موعد الاستحقاق لضمان استمرارية إقامتك وسرعة تجديد العقد.
              </p>
            </div>
            <a href="#statement" onClick={() => window.location.hash = 'statement'} className="btn btn-gold btn-sm" style={{ whiteSpace: 'nowrap' }}>
              💳 الدفع الإلكتروني الآن
            </a>
          </div>
        </div>
      )}

      <div className="grid2">
        <div className="panel">
          <h3>تفاصيل الوحدة</h3>
          <table className="tbl"><tbody>
            <tr><td>رقم الوحدة</td><td><b>{b.unit?.unit_number}</b></td></tr>
            <tr><td>التصنيف</td><td>{b.unit?.category}</td></tr>
            <tr><td>غرف / حمّامات</td><td>{b.unit?.bedrooms ?? '—'} / {b.unit?.bathrooms ?? '—'}</td></tr>
            <tr><td>الوصف</td><td>{b.unit?.description || '—'}</td></tr>
          </tbody></table>
          {b.media?.length > 1 && (
            <div className="tp-gallery">
              {b.media.slice(1, 5).map((m, i) => m.media_type === 'video'
                ? <video key={i} src={m.url} muted />
                : <img key={i} src={m.url} alt="" />)}
            </div>
          )}
        </div>
        <div className="panel">
          <h3>تواصل مع المنشأة</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13.5, marginBottom: 12 }}>
            لأي استفسار عاجل تواصل مباشرة، أو استخدم تبويب «الطلبات» لتوثيق طلبك رسمياً.
          </p>
          {company?.phone && (
            <a className="btn btn-green" href={`https://wa.me/${company.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">💬 واتساب المنشأة</a>
          )}
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>{company?.address}</div>
        </div>
      </div>

      {availableUnits?.length > 0 && (
        <div className="panel">
          <h3>وحدات أخرى متاحة الآن لدى {company?.name} (لتجديد أو تغيير)</h3>
          <div className="tp-units-mini">
            {availableUnits.map((u, i) => (
              <div key={i} className="tp-unit-mini">
                <b>{u.unit_number}</b><span>{u.category}</span>
                <span className="money">{u.daily_price ? SAR(u.daily_price) + '/يوم' : u.monthly_price ? SAR(u.monthly_price) + '/شهر' : '—'}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>للحجز تواصل مع المنشأة أو استخدم طلب «تمديد / حجز جديد» من تبويب الطلبات.</p>
        </div>
      )}
    </div>
  )
}

/* ================= كشف الحساب ================= */
function Statement({ b, onPay }) {
  if (!b) return <EmptyState text="لا يوجد كشف حساب متاح حالياً." />
  const remaining = b.total_amount - b.paid
  return (
    <div>
      <div className="kpis">
        <div className="kpi"><div className="v">{SAR(b.total_amount)}</div><div className="l">إجمالي العقد</div></div>
        <div className="kpi"><div className="v">{SAR(b.paid)}</div><div className="l">المدفوع</div></div>
        <div className="kpi"><div className="v" style={{ color: remaining > 0 ? 'var(--st-oc)' : 'var(--green)' }}>{SAR(remaining)}</div><div className="l">المتبقي</div></div>
        <div className="kpi"><div className="v">{b.discount_percent || 0}%</div><div className="l">نسبة الخصم</div></div>
      </div>
      {remaining > 0 && onPay && (
        <div style={{ margin: '10px 0' }}>
          <button className="btn btn-gold btn-sm" onClick={onPay}>💳 دفع المتبقي إلكترونياً</button>
        </div>
      )}
      <div className="grid2">
        <div className="panel">
          <h3>سجل الدفعات ({b.payments?.length || 0})</h3>
          <table className="tbl">
            <thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>الطريقة</th><th>مرجع</th></tr></thead>
            <tbody>
              {(!b.payments || b.payments.length === 0) && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا توجد دفعات مسجلة</td></tr>}
              {b.payments?.map((p, i) => (
                <tr key={i}>
                  <td>{p.payment_date}</td>
                  <td>{{ down_payment: 'عربون', insurance: 'تأمين', rent: 'إيجار', penalty: 'غرامة', other: 'أخرى' }[p.payment_type] || p.payment_type}</td>
                  <td className="money">{SAR(p.amount)}</td>
                  <td>{PAY_METHODS[p.method] || p.method}</td>
                  <td dir="ltr">{p.reference_number || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h3>العربون والتأمين</h3>
          <table className="tbl"><tbody>
            <tr><td>قيمة العربون</td><td className="money">{SAR(b.down_payment)}</td></tr>
            <tr><td>قيمة التأمين</td><td className="money">{SAR(b.insurance_amount)}</td></tr>
          </tbody></table>
          {b.insurance?.length > 0 && (
            <>
              <h4 style={{ margin: '14px 0 8px', fontSize: 14, color: 'var(--green)' }}>دورة حياة التأمين</h4>
              {b.insurance.map((ins, i) => (
                <div key={i} className="tp-ins-card">
                  <span className={'chip ' + (ins.status === 'refunded' ? 'chip-ok' : ins.status === 'deducted' ? 'chip-danger' : 'chip-warn')}>
                    {INS_STATUS[ins.status] || ins.status}
                  </span>
                  {ins.deduction_amount > 0 && <div>مبلغ الخصم: <b className="neg">{SAR(ins.deduction_amount)}</b> — {ins.deduction_reason}</div>}
                  {ins.refunded_at && <div style={{ fontSize: 12, color: 'var(--muted)' }}>أُرجع بتاريخ {new Date(ins.refunded_at).toLocaleDateString('ar-SA')}</div>}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ================= المستندات ================= */
function Docs({ b, company, customer }) {
  const [showContract, setShowContract] = useState(false)
  if (!b) return <EmptyState text="لا توجد مستندات بعد." />
  return (
    <div className="grid2">
      <div className="panel">
        <h3>الفواتير الضريبية ({b.invoices?.length || 0})</h3>
        {(!b.invoices || b.invoices.length === 0)
          ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>لم تُصدر أي فاتورة بعد.</p>
          : b.invoices.map((inv, i) => (
            <div key={i} className="tp-doc-row">
              <div><b dir="ltr">{inv.invoice_number}</b><span>{new Date(inv.issued_at).toLocaleDateString('ar-SA')}</span></div>
              <div className="money">{SAR(inv.total)}</div>
            </div>
          ))}
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>لطلب نسخة مطبوعة تواصل مع المنشأة من تبويب الطلبات.</p>
      </div>
      <div className="panel">
        <h3>عقد الإيجار</h3>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
          عقد إيجارك الإلكتروني الكامل — الوحدة، المدة، القيمة، بيان السداد، والموظف المسؤول عن العقد.
        </p>
        <button className="btn btn-gold btn-sm" onClick={() => setShowContract(true)}>🖨 عرض وطباعة عقد الإيجار</button>
      </div>
      {showContract && (
        <RentalContract
          onClose={() => setShowContract(false)}
          company={company}
          employeeName={b.employee_name}
          customer={customer}
          unit={b.unit}
          booking={b}
        />
      )}
    </div>
  )
}

function EmptyState({ text }) {
  return <div className="panel" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>{text}</div>
}

/* ================= الطلبات (تمديد / خدمة / صيانة بصورة / شكوى) ================= */
function Requests({ b, token, notify, reload }) {
  const [type, setType] = useState('extension')
  const [details, setDetails] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!details.trim()) return notify('اكتب تفاصيل طلبك أولاً')
    setBusy(true)
    try {
      let photoUrl = null
      if (file) {
        try {
          const path = `${token}/${Date.now()}_${file.name.replace(/[^\w.-]/g, '_')}`
          const { error: upErr } = await supabase.storage.from('portal-uploads').upload(path, file)
          if (upErr) throw upErr
          // سطل portal-uploads صار خاصاً: صور طلبات الصيانة بيانات شخصية للمستأجر،
          // وكان الرابط العام يفتحها لأي شخص يملكه بلا تسجيل دخول. الرابط الموقّع
          // يحمل صلاحية محدودة المدة بدل الإتاحة الدائمة للعموم.
          const { data: signed, error: signErr } = await supabase.storage
            .from('portal-uploads')
            .createSignedUrl(path, 60 * 60 * 24 * 365)
          if (signErr) throw signErr
          photoUrl = signed.signedUrl
        } catch (e) {
          notify('تم إرسال الطلب بدون الصورة (تعذّر رفعها): ' + e.message)
        }
      }
      const { error } = await supabase.rpc('portal_create_service_request', {
        p_token: token, p_type: type, p_details: details.trim(), p_photo_url: photoUrl
      })
      if (error) throw error
      notify('✓ أُرسل طلبك وسيتواصل معك فريق المنشأة قريباً')
      setDetails(''); setFile(null)
      reload()
    } catch (e) { notify('خطأ: ' + e.message) } finally { setBusy(false) }
  }

  return (
    <div className="grid2">
      <div className="panel">
        <h3>إرسال طلب جديد</h3>
        <div className="fld"><label>نوع الطلب</label>
          <select value={type} onChange={e => setType(e.target.value)}>
            {Object.entries(REQ_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div className="fld"><label>التفاصيل</label>
          <textarea rows={4} value={details} onChange={e => setDetails(e.target.value)}
            placeholder={type === 'extension' ? 'كم يوماً/شهراً ترغب بالتمديد؟' : type === 'maintenance' ? 'صف العطل بالتفصيل…' : 'اكتب تفاصيل طلبك…'} /></div>
        {type === 'maintenance' && (
          <div className="fld"><label>صورة العطل (اختياري)</label>
            <input type="file" accept="image/*" onChange={e => setFile(e.target.files[0])} /></div>
        )}
        <button className="btn btn-gold" disabled={busy || !b} onClick={submit}>إرسال الطلب</button>
        {!b && <p style={{ fontSize: 12, color: 'var(--st-oc)', marginTop: 8 }}>لا توجد إقامة نشطة مرتبطة بحسابك حالياً.</p>}
      </div>
      <div className="panel">
        <h3>طلباتي السابقة ({b?.service_requests?.length || 0})</h3>
        {(!b?.service_requests || b.service_requests.length === 0)
          ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>لا توجد طلبات بعد.</p>
          : b.service_requests.map(r => (
            <div key={r.id} className="tp-req-row">
              <div><b>{REQ_TYPES[r.request_type] || r.request_type}</b><span>{new Date(r.created_at).toLocaleDateString('ar-SA')}</span></div>
              <p>{r.details}</p>
              <span className={'chip ' + (r.status === 'done' ? 'chip-ok' : r.status === 'rejected' ? 'chip-danger' : 'chip-warn')}>
                {REQ_STATUS[r.status] || r.status}
              </span>
            </div>
          ))}
      </div>
    </div>
  )
}

/* ================= التسليم والاستلام ================= */
function HandoverTab({ b, token, notify, reload }) {
  const [signing, setSigning] = useState(null)
  const [sig, setSig] = useState('')
  const [busy, setBusy] = useState(false)

  const confirm = async (h) => {
    if (!sig.trim()) return notify('اكتب اسمك للتوقيع')
    setBusy(true)
    const { error } = await supabase.rpc('portal_confirm_handover', { p_token: token, p_handover_id: h.id, p_signature: sig.trim() })
    setBusy(false)
    if (error) return notify('خطأ: ' + error.message)
    notify('✓ تم تسجيل تأكيدك'); setSigning(null); setSig(''); reload()
  }

  if (!b?.handovers?.length) return <EmptyState text="لا توجد نماذج تسليم أو استلام موثّقة بعد." />
  return (
    <div>
      {b.handovers.map(h => (
        <div key={h.id} className="panel">
          <h3>{h.kind === 'check_in' ? '🔑 نموذج تسليم الوحدة' : '📥 نموذج استلام الوحدة'} — {new Date(h.created_at).toLocaleString('ar-SA')}</h3>
          {Array.isArray(h.checklist) && h.checklist.length > 0 && (
            <div className="tp-checklist">
              {h.checklist.map((it, i) => (
                <div key={i} className={'tp-check-item ' + (it.condition === 'ok' ? 'ok' : it.condition === 'missing' ? 'miss' : 'dmg')}>
                  <b>{it.name}</b><span>{it.condition === 'ok' ? 'سليم' : it.condition === 'missing' ? 'مفقود' : 'متضرر'}</span>
                  {it.note && <em>{it.note}</em>}
                </div>
              ))}
            </div>
          )}
          {h.notes && <p style={{ marginTop: 10, fontSize: 13.5 }}>ملاحظات: {h.notes}</p>}
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6 }}>وثّقه الموظف: {h.signed_by}</p>

          {h.tenant_confirmed_at ? (
            <div className="chip chip-ok" style={{ marginTop: 10 }}>✓ أكّدتَ هذا النموذج بتاريخ {new Date(h.tenant_confirmed_at).toLocaleDateString('ar-SA')}</div>
          ) : signing === h.id ? (
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <input value={sig} onChange={e => setSig(e.target.value)} placeholder="اكتب اسمك الكامل كتوقيع" />
              <button className="btn btn-green btn-sm" disabled={busy} onClick={() => confirm(h)}>تأكيد</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSigning(null)}>إلغاء</button>
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setSigning(h.id)}>✍️ توقيع وتأكيد اطلاعي على النموذج</button>
          )}
        </div>
      ))}
    </div>
  )
}

/* ================= الولاء والتقييم ================= */
function LoyaltyTab({ customer, history, b, token, notify, reload }) {
  const [rating, setRating] = useState(customer?.rating || 0)
  const [comment, setComment] = useState(customer?.review_comment || '')
  const [busy, setBusy] = useState(false)
  const canReview = b?.status === 'checked_out' || b?.status === 'checked_in'

  const submit = async () => {
    if (!rating) return notify('اختر عدد النجوم أولاً')
    setBusy(true)
    const { error } = await supabase.rpc('portal_submit_rating', { p_token: token, p_rating: rating, p_comment: comment || null })
    setBusy(false)
    if (error) return notify('خطأ: ' + error.message)
    notify('✓ شكراً لتقييمك!'); reload()
  }

  return (
    <div className="grid2">
      <div className="panel">
        <h3>نقاط الولاء</h3>
        <div className="tp-loyalty-points">{customer?.loyalty_points || 0}<span>نقطة</span></div>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '10px 0' }}>تكسب 10 نقاط عن كل إقامة جديدة. بعد 10 حجوزات تحصل على خصم خاص.</p>
        {history?.length > 0 && (
          <table className="tbl"><tbody>
            {history.slice(0, 8).map((h, i) => (
              <tr key={i}><td>{new Date(h.created_at).toLocaleDateString('ar-SA')}</td><td>{h.reason}</td>
                <td className={h.points > 0 ? 'money' : 'neg'}>{h.points > 0 ? '+' : ''}{h.points}</td></tr>
            ))}
          </tbody></table>
        )}
      </div>
      <div className="panel">
        <h3>قيّم تجربتك</h3>
        {!canReview
          ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>يمكنك التقييم بعد بدء إقامتك.</p>
          : <>
            <div className="tp-stars">
              {[1, 2, 3, 4, 5].map(n => (
                <span key={n} className={n <= rating ? 'on' : ''} onClick={() => setRating(n)}>★</span>
              ))}
            </div>
            <textarea rows={4} value={comment} onChange={e => setComment(e.target.value)} placeholder="شاركنا رأيك (اختياري)…" style={{ marginTop: 10 }} />
            <button className="btn btn-gold btn-sm" style={{ marginTop: 10 }} disabled={busy} onClick={submit}>
              {customer?.review_submitted_at ? 'تحديث التقييم' : 'إرسال التقييم'}
            </button>
          </>}
      </div>
    </div>
  )
}

/* ================= سجل الإقامات السابقة ================= */
function HistoryTab({ past }) {
  if (!past?.length) return <EmptyState text="لا توجد إقامات سابقة أخرى مسجّلة." />
  return (
    <div className="panel">
      <h3>سجل إقاماتك ({past.length})</h3>
      <table className="tbl">
        <thead><tr><th>الوحدة</th><th>من</th><th>إلى</th><th>الحالة</th><th>القيمة</th></tr></thead>
        <tbody>
          {past.map((p, i) => (
            <tr key={i}><td>{p.unit_number}</td><td>{p.check_in_date}</td><td>{p.check_out_date}</td>
              <td>{{ pending: 'معلق', confirmed: 'محجوز', checked_in: 'ساكن', checked_out: 'منتهي' }[p.status] || p.status}</td>
              <td className="money">{SAR(p.total_amount)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ================= المرافقون ================= */
function CompanionsTab({ b, token, notify, reload }) {
  const [name, setName] = useState('')
  const [idNum, setIdNum] = useState('')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!name.trim()) return notify('اكتب اسم المرافق')
    setBusy(true)
    const { error } = await supabase.rpc('portal_add_companion', { p_token: token, p_full_name: name.trim(), p_id_type: null, p_id_number: idNum || null })
    setBusy(false)
    if (error) return notify('خطأ: ' + error.message)
    notify('✓ أُضيف المرافق'); setName(''); setIdNum(''); reload()
  }

  return (
    <div className="grid2">
      <div className="panel">
        <h3>المرافقون الحاليون ({b?.companions?.length || 0})</h3>
        {(!b?.companions || b.companions.length === 0)
          ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>لا يوجد مرافقون مسجّلون.</p>
          : <ul style={{ listStyle: 'none', padding: 0 }}>
            {b.companions.map((c, i) => <li key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>{c.full_name}</li>)}
          </ul>}
      </div>
      {b && (
        <div className="panel">
          <h3>إضافة مرافق</h3>
          <div className="fld"><label>الاسم الكامل</label><input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="fld"><label>رقم الهوية (اختياري)</label><input value={idNum} onChange={e => setIdNum(e.target.value)} dir="ltr" /></div>
          <button className="btn btn-gold btn-sm" disabled={busy} onClick={add}>إضافة</button>
        </div>
      )}
    </div>
  )
}
