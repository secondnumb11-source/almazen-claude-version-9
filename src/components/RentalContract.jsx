import React from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { SAR, PAY_METHODS } from '../lib/helpers'
import { printElement } from '../lib/printWindow'
import { useRegisteredSerial } from '../lib/documentSerial'

const PERIOD_LABEL = { daily: 'يومي', monthly: 'شهري', yearly: 'سنوي' }
const PAY_TYPE_LABEL = { rent: 'إيجار', down_payment: 'عربون', insurance: 'تأمين', penalty: 'غرامة', other: 'أخرى' }

/* عقد الإيجار الإلكتروني المبدئي — مستند رسمي كامل بترويسة و QR للتحقق،
   قابل للطباعة في أي وقت (عند الحجز أو لاحقاً من ملف العميل/الوحدة) */
export default function RentalContract({ booking, customer, unit, company, employeeName, onClose }) {
  const paid = (booking.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0)
  const total = Number(booking.total_amount || 0)
  const remaining = total - paid
  // رقم عقد حقيقي مسجّل في سجل المستندات (يستخدم الرقم القائم إن وُجد)
  const contractSerial = useRegisteredSerial('contract', {
    table: 'bookings', id: booking.id, existing: booking.contract_number || '',
    meta: { tenant: customer?.full_name, unit: unit?.unit_number },
  })
  const qrValue = JSON.stringify({
    contract: contractSerial || booking.id?.slice(0, 8) || '—',
    tenant: customer?.full_name, unit: unit?.unit_number,
    from: booking.check_in_date, to: booking.check_out_date, total
  })

  const doc = (
          <div className="contract-doc">
            <div className="contract-head">
              {company?.logo_url && <img src={company.logo_url} alt="logo" />}
              <div className="contract-head-info">
                <h2>{company?.name || 'المازن'}</h2>
                <div>الرقم الضريبي: {company?.vat_number || '—'} · السجل التجاري: {company?.cr_number || '—'} · {company?.address || ''}</div>
              </div>
              <div className="contract-qr">
                <QRCodeSVG value={qrValue} size={84} />
                <span dir="ltr">رقم العقد: {contractSerial || booking.id?.slice(0, 8) || '—'}</span>
              </div>
            </div>

            <h3 className="contract-title">عقد إيجار وحدة سكنية — مبدئي إلكتروني</h3>

            <div className="contract-grid">
              <div><b>اسم المستأجر</b><span>{customer?.full_name || '—'}</span></div>
              <div><b>رقم الهوية/الإقامة</b><span dir="ltr">{customer?.id_number || '—'}</span></div>
              <div><b>جوال المستأجر</b><span dir="ltr">{customer?.phone || '—'}</span></div>
              <div><b>الموظف المسؤول عن العقد</b><span>{employeeName || '—'}</span></div>
            </div>

            <h4 className="contract-h4">بيانات الوحدة المؤجرة</h4>
            <div className="contract-grid">
              <div><b>رقم الوحدة</b><span>{unit?.unit_number || '—'}</span></div>
              <div><b>نوع الوحدة</b><span>{unit?.category || '—'}</span></div>
              <div><b>تفاصيل الوحدة</b><span>{unit?.description || '—'}</span></div>
              <div><b>نوع الإيجار</b><span>{PERIOD_LABEL[booking.rent_period] || booking.rent_period}</span></div>
            </div>

            <h4 className="contract-h4">مدة العقد والقيمة الإيجارية</h4>
            <div className="contract-grid">
              <div><b>تاريخ بدء الإيجار</b><span dir="ltr">{booking.check_in_date}</span></div>
              <div><b>تاريخ انتهاء الإيجار</b><span dir="ltr">{booking.check_out_date}</span></div>
              <div><b>السعر الأساسي</b><span className="money">{SAR(booking.base_price || total)}</span></div>
              <div><b>نسبة الخصم</b><span>{booking.discount_percent || 0}%</span></div>
              <div><b>قيمة الإيجار الإجمالية (بعد الخصم)</b><span className="money">{SAR(total)}</span></div>
              <div><b>مبلغ العربون</b><span>{SAR(booking.down_payment)}</span></div>
              <div><b>مبلغ التأمين</b><span>{SAR(booking.insurance_amount)}</span></div>
            </div>

            <h4 className="contract-h4">بيان السداد</h4>
            <table className="tbl" style={{ marginBottom: 14 }}>
              <thead><tr><th>التاريخ</th><th>النوع</th><th>طريقة الدفع</th><th>المبلغ</th></tr></thead>
              <tbody>
                {(booking.payments || []).length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا توجد دفعات مسجّلة بعد</td></tr>}
                {(booking.payments || []).map((p, i) => (
                  <tr key={i}>
                    <td>{p.payment_date}</td><td>{PAY_TYPE_LABEL[p.payment_type] || p.payment_type}</td>
                    <td>{PAY_METHODS[p.method] || p.method}</td><td className="money">{SAR(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="contract-grid" style={{ marginBottom: 16 }}>
              <div><b>إجمالي المدفوع</b><span className="money">{SAR(paid)}</span></div>
              <div><b>المتبقي من قيمة الإيجار</b><span className={remaining > 0 ? 'neg' : 'money'}>{SAR(remaining)}</span></div>
              <div><b>موعد استحقاق المتبقي</b><span dir="ltr">{remaining > 0 ? booking.check_out_date : '—'}</span></div>
            </div>

            <h4 className="contract-h4">الشروط والأحكام والالتزامات</h4>
            <ol className="contract-terms">
              <li>يُقر الطرفان بأهليتهما النظامية للتعاقد، ويخضع هذا العقد لأنظمة المملكة العربية السعودية ولائحة نظام إيجار الصادرة عن الهيئة العامة للعقار.</li>
              <li>تُعدّ الوحدة المؤجرة مستلمة من المستأجر بحالة جيدة وصالحة للسكن، ويلتزم المستأجر بالمحافظة عليها وإعادتها بذات الحالة عند انتهاء العقد مع مراعاة الاستهلاك المعتاد.</li>
              <li>يلتزم المستأجر بسداد القيمة الإيجارية في مواعيدها المتفق عليها، ويحق للمؤجر فرض غرامة تأخير أو إنهاء العقد عند التخلف عن السداد وفق الأنظمة المرعية.</li>
              <li>مبلغ التأمين ({SAR(booking.insurance_amount)}) مسترد للمستأجر عند انتهاء العقد بعد خصم ما قد يترتب عليه من أضرار أو مستحقات أو فواتير خدمات غير مسددة.</li>
              <li>يُستخدم العقار للغرض السكني فقط، ولا يجوز للمستأجر التنازل عنه أو تأجيره من الباطن أو تغيير نشاطه إلا بموافقة خطية من المؤجر.</li>
              <li>يلتزم المستأجر بسداد قيمة استهلاك الخدمات (كهرباء، ماء، إنترنت) خلال مدة إشغاله ما لم يُنص على خلاف ذلك كتابةً.</li>
              <li>يلتزم المستأجر بأنظمة السكن والذوق العام وعدم إحداث أي إزعاج للجيران أو مخالفة تعليمات الجهات المختصة، ويتحمل وحده مسؤولية أي مخالفة نظامية تصدر منه أو من مرافقيه.</li>
              <li>لا يحق للمستأجر إجراء أي تعديل أو تركيب أو هدم في الوحدة إلا بإذن كتابي مسبق من المؤجر.</li>
              <li>يلتزم المؤجر بإجراء الصيانة الأساسية اللازمة لبقاء الوحدة صالحة للسكن ما لم يكن العطل ناتجاً عن سوء استخدام المستأجر.</li>
              <li>في حال رغبة أي طرف بإنهاء العقد قبل مدته يلتزم بإشعار الطرف الآخر كتابياً وفق المدة النظامية، ويُسوّى ما بينهما من مستحقات مالية.</li>
              <li>يُعدّ هذا العقد المبدئي ملزماً للطرفين، ويُستكمل توثيقه رسمياً على منصة إيجار الحكومية عند الحاجة، وأي بند لم يرد فيه يُرجع فيه إلى أحكام نظام إيجار والأنظمة السعودية ذات العلاقة.</li>
            </ol>

            <p className="contract-note">
              حُرِّر هذا العقد من نسختين بيد كل طرف نسخة للعمل بموجبها، وقد اطّلع الطرفان على كامل بنوده وأقرّا بقبولها والالتزام بها.
            </p>

            <div className="voucher-sign">
              <div><span>الطرف الأول (المؤجر) — {company?.name || 'المنشأة'}<br/>الموظف: {employeeName || '—'}</span><i /></div>
              <div><span>الطرف الثاني (المستأجر)<br/>{customer?.full_name || '—'}</span><i /></div>
            </div>
          </div>
  )

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={{ width: 'min(900px,100%)' }}>
        <div className="modal-h no-print"><h3>عقد الإيجار الإلكتروني</h3><button className="x" onClick={onClose}>✕</button></div>
        <div className="modal-b">
          {doc}
        </div>
        <div className="modal-f no-print">
          <button className="btn btn-gold" onClick={() => printElement(doc, { title: 'عقد الإيجار الإلكتروني' })}>🖨 طباعة العقد</button>
        </div>
      </div>
    </div>
  )
}
