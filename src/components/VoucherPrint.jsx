import React from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { SAR, PAY_METHODS } from '../lib/helpers'
import { printElement } from '../lib/printWindow'
import { useDocumentSerial } from '../lib/documentSerial'

const PARTY_LABEL = { tenant: 'مستأجر', vendor: 'مورد', employee: 'موظف', other: 'أخرى' }

/* سند قبض/صرف بتصميم فاخر — ترويسة + QR للتحقق — قابل لإعادة الاستخدام
   في قسم الحسابات وفي العمليات اليومية للموظف.
   رقم السند: يُستخدم الرقم المحفوظ إن وُجد، وإلا يُصدر سيريال حقيقي
   من سجل المستندات (document_registry) ويُحفظ للمراجعة. */
export default function VoucherPrintModal({ voucher: v, company, onClose }) {
  const issued = useDocumentSerial(v.voucher_type === 'receipt' ? 'receipt' : 'payment', {
    table: 'vouchers', id: v.id || null,
    meta: { amount: v.amount, party: v.party_name, date: v.voucher_date },
    enabled: !v.voucher_number,
  })
  const serial = v.voucher_number || issued || '—'

  const qrValue = JSON.stringify({
    voucher: serial, type: v.voucher_type, date: v.voucher_date,
    party: v.party_name, amount: v.amount
  })


  const title = v.voucher_type === 'receipt' ? 'سند قبض' : 'سند صرف'
  const doc = (
    <div className="voucher-doc">
      <div className="voucher-head">
        {company?.logo_url && <img src={company.logo_url} alt="logo" />}
        <div className="voucher-head-info">
          <h2>{company?.name || 'المازن'}</h2>
          <div>الرقم الضريبي: {company?.vat_number || '—'} · {company?.address || ''}</div>
        </div>
        <div className={'voucher-badge ' + (v.voucher_type === 'receipt' ? 'in' : 'out')}>
          {title}
        </div>
      </div>
      <div className="voucher-grid">
        <div><b>رقم السند</b><span dir="ltr">{serial}</span></div>
        <div><b>التاريخ</b><span>{v.voucher_date}</span></div>
        <div><b>{v.voucher_type === 'receipt' ? 'استلمنا من' : 'صرفنا إلى'}</b><span>{v.party_name}</span></div>
        <div><b>التصنيف</b><span>{PARTY_LABEL[v.party_type]}</span></div>
        <div><b>طريقة الدفع</b><span>{PAY_METHODS[v.payment_method]}</span></div>
        <div><b>رقم المرجع</b><span dir="ltr">{v.reference_number || '—'}</span></div>
      </div>
      <div className="voucher-amount">
        <span>وذلك مبلغ وقدره</span>
        <b className="money">{SAR(v.amount)}</b>
      </div>
      <div className="voucher-desc"><b>البيان:</b> {v.description || '—'}</div>
      <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 18px' }}>
        <QRCodeSVG value={qrValue} size={72} />
      </div>
      <div className="voucher-sign">
        <div><span>توقيع المُسلِّم</span><i /></div>
        <div><span>توقيع المستلم</span><i /></div>
      </div>
    </div>
  )

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(680px,100%)' }}>
        <div className="modal-h no-print">
          <h3>{title}</h3>
          <button className="x" onClick={onClose}>✕</button>
        </div>
        <div className="modal-b">
          {doc}
        </div>
        <div className="modal-f no-print">
          <button className="btn btn-gold" onClick={() => printElement(doc, { title })}>🖨 طباعة</button>
        </div>
      </div>
    </div>
  )
}
