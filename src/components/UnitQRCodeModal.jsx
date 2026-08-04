import React from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { printElement } from '../lib/printWindow'

export default function UnitQRCodeModal({ unit, companyName, onClose }) {
  if (!unit) return null

  // URL for maintenance technician direct scan
  const scanUrl = `${window.location.origin}/?unit_id=${unit.id}&action=maintenance`

  const handlePrint = () => {
    printElement('unit-qr-sticker-printable')
  }

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 450, textAlign: 'center' }}>
        <div className="modal-h">
          <h3>📱 رمز QR للصيانة — وحدة {unit.unit_number}</h3>
          <button className="x" onClick={onClose}>✕</button>
        </div>

        <div className="modal-b" style={{ padding: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
            عند مسح الكود من قِبل فني الصيانة عبر الجوال، سيتم فتح نموذج تقديم بلاغ صيانة جديد مجهز ومربوط برقم الوحدة مباشرة.
          </p>

          {/* Printable Sticker Frame */}
          <div
            id="unit-qr-sticker-printable"
            style={{
              background: '#ffffff',
              color: '#000000',
              padding: '24px 20px',
              borderRadius: 16,
              border: '2px dashed #000000',
              display: 'inline-block',
              margin: '0 auto',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 4, color: '#1f2937' }}>
              {companyName || 'نظام إدارة الوحدات'}
            </div>
            <div style={{ fontSize: 22, fontWeight: '900', color: '#111827', marginBottom: 12 }}>
              وحدة رقم {unit.unit_number}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0' }}>
              <QRCodeSVG
                value={scanUrl}
                size={180}
                level="H"
                includeMargin={true}
              />
            </div>

            <div style={{ fontSize: 12, color: '#4b5563', marginTop: 8, fontWeight: '600' }}>
              🔧 امسح الكود لرفع طلب صيانة طارئ
            </div>
            <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>
              رابط الصيانة السريع للفنيين والموظفين
            </div>
          </div>

          <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button className="btn btn-gold" onClick={handlePrint}>
              🖨️ طباعة ملصق QR الوحدة
            </button>
            <button className="btn btn-ghost" onClick={onClose}>
              إغلاق
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
