import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { syncPaymentToAccounting } from '../lib/accountingSync'

/**
 * PaymentGatewayModal — الدفع الإلكتروني.
 * - داخل بوابة المستأجر (token موجود): يتم السداد عبر الدالة الآمنة
 *   portal_record_payment التي تتحقق من التوكن وتحسب المتبقي في الخادم،
 *   فلا يمكن تمرير مبلغ أكبر من المستحق ولا الدفع لحجز آخر.
 * - داخل التطبيق (مستخدم مسجّل دخول): إدراج مباشر في payments مع
 *   مزامنة القيود المحاسبية.
 */
export default function PaymentGatewayModal({ booking, token = null, amount = null, onClose, onSuccess }) {
  const [method, setMethod] = useState('mada')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const due = Number(amount ?? booking?.total_amount ?? 0)

  const processPayment = async () => {
    setBusy(true); setErr(null)
    const payMethod = method === 'tabby' ? 'bank_transfer' : 'card'

    try {
      if (token) {
        // مسار البوابة العامة — الخادم يحسب المتبقي ويتحقق من الصلاحية
        const { data, error } = await supabase.rpc('portal_record_payment', {
          p_token: token,
          p_method: payMethod,
          p_amount: due > 0 ? due : null,
          p_reference: 'PORTAL-' + Date.now(),
        })
        if (error) throw error
        if (data && data.ok === false) throw new Error(data.reason === 'nothing_due' ? 'لا يوجد مبلغ مستحق للسداد' : data.reason)
      } else {
        const { data: payData, error } = await supabase.from('payments').insert({
          booking_id: booking.id,
          company_id: booking.company_id,
          branch_id: booking.branch_id ?? null,
          payment_date: new Date().toISOString().split('T')[0],
          amount: due,
          method: payMethod,
          payment_type: 'rent',
          notes: 'دفع عبر البوابة الإلكترونية (' + (method === 'mada' ? 'مدى / فيزا' : 'تابي بالتقسيط') + ')',
        }).select('id').maybeSingle()
        if (error) throw error

        if (booking.company_id) {
          await syncPaymentToAccounting(supabase, {
            companyId: booking.company_id,
            paymentId: payData?.id || null,
            bookingId: booking.id,
            unitId: booking.unit_id,
            customerName: booking.customer_name || 'مستأجر عبر البوابة',
            amount: due,
            method: payMethod,
            paymentType: 'rent',
            description: `سداد إلكتروني عبر ${method === 'mada' ? 'مدى' : 'تابي'} — حجز #${booking.id?.slice(0, 8) || ''}`,
          })
        }
      }
      setBusy(false)
      onSuccess?.()
    } catch (e) {
      setBusy(false)
      setErr('تعذّر إتمام الدفع: ' + (e.message || e))
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 400 }}>
        <h3>💳 الدفع الإلكتروني</h3>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
          المبلغ المطلوب: <b>{due} ر.س</b>
        </p>

        {err && (
          <div style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 10px', fontSize: 13, marginBottom: 12 }}>
            {err}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>
            <input type="radio" name="pay_method" checked={method === 'mada'} onChange={() => setMethod('mada')} />
            مدى (Mada) / بطاقة ائتمانية
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>
            <input type="radio" name="pay_method" checked={method === 'tabby'} onChange={() => setMethod('tabby')} />
            تابي (Tabby) - قسّم فاتورتك
          </label>
        </div>

        <div className="modal-actions" style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-gold" style={{ flex: 1 }} disabled={busy || due <= 0} onClick={processPayment}>
            {busy ? 'جاري المعالجة...' : 'تأكيد الدفع'}
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  )
}
