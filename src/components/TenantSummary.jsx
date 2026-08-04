import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { SAR, PAY_METHODS } from '../lib/helpers'
import { printElement } from '../lib/printWindow'

const PORTAL_BASE = 'https://al-mazen-platform.vercel.app'

/* ملخص إيجار مطبوع لتقديمه للمستأجر عند نهاية المدة أو مع الفاتورة */
export default function TenantSummary({ booking, unit, onClose, autoSend }) {
  const { company, profile, toast } = useAuth()
  const [payments, setPayments] = useState([])
  const [handovers, setHandovers] = useState([])
  const [invoices, setInvoices] = useState([])
  const [loadError, setLoadError] = useState('')
  const [portalUser, setPortalUser] = useState('')
  const [portalToken, setPortalToken] = useState('')
  const [portalLoaded, setPortalLoaded] = useState(false)
  const [editingCreds, setEditingCreds] = useState(false)
  const [savingCreds, setSavingCreds] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const sentRef = useRef(false)

  const loadPortalAccount = async () => {
    const { data: acct } = await supabase.from('tenant_portal_accounts')
      .select('username, access_token').eq('booking_id', booking.id).maybeSingle()
    setPortalUser(acct?.username || '')
    setPortalToken(acct?.access_token || '')
    setPortalLoaded(true)
  }

  useEffect(() => {
    if (!booking?.id) return
    ;(async () => {
      setLoadError('')
      const [paymentsResult, handoversResult, invoicesResult] = await Promise.all([
        supabase.from('payments').select('*').eq('booking_id', booking.id).order('payment_date'),
        supabase.from('handovers').select('*').eq('booking_id', booking.id).order('created_at'),
        supabase.from('invoices').select('id, invoice_number, invoice_type, subtotal, vat_rate, vat_amount, total, created_at').eq('booking_id', booking.id).order('created_at', { ascending: false }),
      ])
      const firstError = paymentsResult.error || handoversResult.error || invoicesResult.error
      if (firstError) setLoadError('تعذّر تحميل بعض تفاصيل التقرير: ' + firstError.message)
      setPayments(paymentsResult.data || [])
      setHandovers(handoversResult.data || [])
      setInvoices(invoicesResult.data || [])
      await loadPortalAccount()
    })()
  }, [booking?.id])

  const paid = payments.filter(p => p.payment_type !== 'insurance' && p.payment_type !== 'refund').reduce((s, p) => s + Number(p.amount), 0)
  const refunded = payments.filter(p => p.payment_type === 'refund').reduce((s, p) => s + Number(p.amount), 0)
  const insurance = payments.filter(p => p.payment_type === 'insurance').reduce((s, p) => s + Number(p.amount), 0)
  const remaining = Number(booking.total_amount || 0) - paid + refunded
  const latestInvoice = invoices[0] || null

  const baseUrl = company?.public_base_url || PORTAL_BASE
  const portalUrl = portalToken ? `${baseUrl}/portal/${portalToken}` : ''
  const welcomeMessage = `مرحبًا ${booking.customers?.full_name || 'عزيزنا المستأجر'} 🌸

يسعدنا استقبالك في ${company?.name || 'المازن'}، ونتمنى لك إقامة ممتعة ومريحة في وحدتك رقم ${unit?.unit_number}.

📅 مدة الإيجار: ${booking.check_in_date} → ${booking.check_out_date}

من خلال بوابتك الخاصة يمكنك:
✓ متابعة الدفعات والفواتير والمتبقي
✓ طلب صيانة أو خدمة إضافية
✓ تمديد الإيجار أو حجز مبكر
✓ الاطلاع على ملخص إقامتك ورقم التواصل المباشر

🔐 بيانات دخول بوابتك الخاصة:
• الرابط: ${portalUrl || '(سيتوفر فور تسليم الوحدة)'}
• اسم المستخدم: ${portalUser || '—'}
• كلمة المرور: ${portalToken || '—'}

فريقنا في خدمتك على مدار الساعة. أهلًا بك 🌟
— ${company?.name || 'المازن'}`

  useEffect(() => {
    if (!autoSend || sentRef.current || !booking.customers?.phone || !portalLoaded) return
    sentRef.current = true
    const t = setTimeout(() => waSend(), 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, portalLoaded, portalToken])

  const copyWelcome = async () => {
    try { await navigator.clipboard.writeText(welcomeMessage); toast('✓ تم نسخ الرسالة الترحيبية') }
    catch { toast('تعذر النسخ — انسخ يدوياً', true) }
  }

  const waSend = () => {
    const phone = (booking.customers?.phone || '').replace(/\D/g, '').replace(/^0/, '966')
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(welcomeMessage)}`, '_blank')
  }

  const saveCreds = async () => {
    if (!portalUser.trim()) return toast('اسم المستخدم مطلوب', true)
    setSavingCreds(true)
    const { error } = await supabase.from('tenant_portal_accounts')
      .update({ username: portalUser.trim() })
      .eq('booking_id', booking.id)
    setSavingCreds(false)
    if (error) return toast('خطأ: ' + error.message, true)
    toast('✓ تم تحديث بيانات دخول المستأجر')
    setEditingCreds(false)
  }

  const regenerateToken = async () => {
    setRegenerating(true)
    const { data, error } = await supabase.rpc('portal_regenerate_token', { p_booking_id: booking.id })
    setRegenerating(false)
    if (error) return toast('تعذّر توليد كلمة مرور جديدة: ' + error.message, true)
    setPortalToken(data)
    toast('✓ تم توليد كلمة مرور جديدة للبوابة — أرسلها للمستأجر')
  }

  const printDoc = (
    <div>
      <div className="ts-header">
        {company?.logo_url && <img src={company.logo_url} alt="logo" />}
        <div>
          <h2>{company?.name || 'المازن'}</h2>
          <div className="ts-sub">الرقم الضريبي: {company?.vat_number || '—'} · {company?.address || ''}</div>
        </div>
        <div className="ts-badge">ملخص إيجار</div>
      </div>

      <div className="ts-grid">
        <div><b>المستأجر</b><span>{booking.customers?.full_name || '—'}</span></div>
        <div><b>الجوال</b><span dir="ltr">{booking.customers?.phone || '—'}</span></div>
        <div><b>رقم الهوية</b><span dir="ltr">{booking.customers?.id_number || '—'}</span></div>
        <div><b>الوحدة</b><span>{unit?.unit_number} — {unit?.category}</span></div>
        <div><b>تاريخ الدخول</b><span>{booking.check_in_date}</span></div>
        <div><b>تاريخ الخروج</b><span>{booking.check_out_date}</span></div>
        <div><b>الإجمالي</b><span className="money">{SAR(booking.total_amount)}</span></div>
        <div><b>العربون</b><span>{SAR(booking.down_payment)}</span></div>
        <div><b>التأمين المدفوع</b><span>{SAR(insurance)}</span></div>
        <div><b>إجمالي المدفوع</b><span className="money">{SAR(paid)}</span></div>
        <div><b>إجمالي المسترد</b><span>{SAR(refunded)}</span></div>
        <div><b>المتبقي</b><span className={remaining > 0 ? 'neg' : 'money'}>{SAR(remaining)}</span></div>
        <div><b>الخصم</b><span>{booking.discount_percent || 0}%</span></div>
      </div>

      <h4 className="ts-h4">سجل الدفعات ({payments.length})</h4>
      <table className="tbl">
        <thead><tr><th>#</th><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>طريقة الدفع</th><th>مرجع</th></tr></thead>
        <tbody>
          {payments.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا توجد دفعات</td></tr>}
          {payments.map((p, i) => (
            <tr key={p.id}>
              <td>{i + 1}</td>
              <td>{p.payment_date?.slice(0, 10)}</td>
              <td>{{ down_payment: 'عربون', insurance: 'تأمين', rent: 'إيجار', refund: 'استرداد' }[p.payment_type] || p.payment_type}</td>
              <td className="money">{SAR(p.amount)}</td>
              <td>{PAY_METHODS[p.method] || p.method}</td>
              <td dir="ltr">{p.reference_number || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 className="ts-h4">الفاتورة المرتبطة بالحجز</h4>
      {latestInvoice ? (
        <>
          <div className="ts-grid" style={{ marginBottom: 12 }}>
            <div><b>رقم الفاتورة</b><span dir="ltr">{latestInvoice.invoice_number}</span></div>
            <div><b>نوع الفاتورة</b><span>{latestInvoice.invoice_type === 'standard' ? 'ضريبية' : 'ضريبية مبسطة'}</span></div>
            <div><b>الإجمالي قبل الضريبة</b><span>{SAR(latestInvoice.subtotal)}</span></div>
            <div><b>ضريبة القيمة المضافة</b><span>{SAR(latestInvoice.vat_amount)} ({latestInvoice.vat_rate || 15}%)</span></div>
            <div><b>إجمالي الفاتورة</b><span className="money">{SAR(latestInvoice.total)}</span></div>
            <div><b>الرصيد النهائي</b><span className={remaining > 0 ? 'neg' : 'money'}>{SAR(remaining)}</span></div>
          </div>
          <table className="tbl">
            <thead><tr><th>البند</th><th>المطلوب</th><th>المدفوع</th><th>المسترد</th><th>الرصيد</th></tr></thead>
            <tbody><tr>
              <td>الإقامة والخدمات حسب الفاتورة {latestInvoice.invoice_number}</td>
              <td>{SAR(latestInvoice.total)}</td><td>{SAR(paid)}</td><td>{SAR(refunded)}</td><td>{SAR(remaining)}</td>
            </tr></tbody>
          </table>
        </>
      ) : <div style={{ padding: 12, color: 'var(--muted)', background: 'var(--soft)', borderRadius: 6 }}>لا توجد فاتورة محفوظة مرتبطة بهذا الحجز بعد.</div>}

      {handovers.length > 0 && (
        <>
          <h4 className="ts-h4">سجل التسليم والاستلام</h4>
          <table className="tbl">
            <thead><tr><th>النوع</th><th>التاريخ</th><th>وُقّع بواسطة</th><th>ملاحظات</th></tr></thead>
            <tbody>
              {handovers.map(h => (
                <tr key={h.id}>
                  <td>{h.kind === 'check_in' ? '🔑 تسليم' : '📥 استلام'}</td>
                  <td>{new Date(h.created_at).toLocaleString('ar-SA')}</td>
                  <td>{h.signed_by}</td>
                  <td>{h.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {unit?.is_furnished && Array.isArray(unit.furniture_checklist) && unit.furniture_checklist.length > 0 && (
        <>
          <h4 className="ts-h4">قائمة الأثاث الموثّقة ({unit.furniture_checklist.length})</h4>
          <ul className="ts-furn">
            {unit.furniture_checklist.map((it, i) => (
              <li key={i}>{it.present ? '✓' : '✕'} {it.name}{it.note ? ` — ${it.note}` : ''}</li>
            ))}
          </ul>
        </>
      )}

      <div className="ts-sign">
        <div><b>توقيع المستأجر</b><span>___________________</span></div>
        <div><b>توقيع المنشأة</b><span>___________________</span></div>
      </div>
    </div>
  )

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(820px,100%)' }}>
        <div className="modal-h">
          <h3>ملخص الإيجار للمستأجر — الوحدة {unit?.unit_number}</h3>
          <button className="x" onClick={onClose}>✕</button>
        </div>
        <div className="modal-b">
          {loadError && <div role="alert" style={{ padding: 10, marginBottom: 12, color: 'var(--st-oc)', background: 'var(--danger-soft)', borderRadius: 6 }}>{loadError}</div>}
          {/* كارت رسالة الترحيب الثابتة */}
          <div className="ts-welcome no-print" style={{
            background: 'linear-gradient(135deg, #fff9e8, #fef3d3)',
            border: '1px solid #d4b563',
            borderRadius: 12,
            padding: 16,
            marginBottom: 18,
            boxShadow: '0 4px 12px rgba(184,134,47,.15)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <b style={{ color: '#8b6f2c', fontSize: 15 }}>💌 رسالة الترحيب الرسمية للمستأجر</b>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn btn-sm btn-gold" onClick={copyWelcome}>📋 نسخ</button>
                <button className="btn btn-sm btn-green" onClick={waSend}>💬 إرسال واتساب</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditingCreds(v => !v)}>
                  {editingCreds ? '✕ إلغاء' : '⚙ تعديل بيانات الدخول'}
                </button>
              </div>
            </div>
            {editingCreds && (
              <div className="grid2" style={{ marginBottom: 10, gap: 8 }}>
                <div className="fld">
                  <label>اسم المستخدم للبوابة</label>
                  <input value={portalUser} onChange={e => setPortalUser(e.target.value)} dir="ltr" />
                </div>
                <div className="fld">
                  <label>كلمة المرور (رمز الدخول)</label>
                  <input value={portalToken} readOnly dir="ltr" style={{ opacity: .75 }} />
                </div>
                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-gold btn-sm" disabled={savingCreds} onClick={saveCreds}>
                    {savingCreds ? '…' : 'حفظ اسم المستخدم'}
                  </button>
                  <button className="btn btn-ghost btn-sm" disabled={regenerating} onClick={regenerateToken}>
                    {regenerating ? '…' : '🔄 توليد كلمة مرور جديدة'}
                  </button>
                </div>
              </div>
            )}
            <pre style={{
              whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13,
              background: '#fff', padding: 12, borderRadius: 8, border: '1px solid #e6d9a8',
              margin: 0, maxHeight: 220, overflow: 'auto'
            }}>{welcomeMessage}</pre>
          </div>

          {printDoc}

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }} className="no-print">
            <button className="btn btn-gold" onClick={() => printElement(printDoc, { title: 'ملخص إيجار — وحدة ' + (unit?.unit_number || '') })}>🖨 طباعة / PDF</button>
            <button className="btn btn-ghost" onClick={onClose}>إغلاق</button>
          </div>
        </div>
      </div>
    </div>
  )
}
