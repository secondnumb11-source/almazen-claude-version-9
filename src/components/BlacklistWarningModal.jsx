import React from 'react'
import { AlertTriangle, ShieldAlert, DollarSign, UserX, ExternalLink, CheckCircle2, ShieldOff } from 'lucide-react'
import { SAR } from '../lib/helpers'

export default function BlacklistWarningModal({ customer, warningType = 'blacklisted', isOpen, onClose, onView360, onOverride }) {
  if (!isOpen || !customer) return null

  const isBlacklisted = warningType === 'blacklisted' || customer.is_blacklisted || customer.rating === 1
  const debtAmount = Number(customer.outstanding_amount || customer.pending_debt || 0)

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'rgba(15, 23, 42, 0.85)',
      backdropFilter: 'blur(8px)',
      display: 'grid',
      placeItems: 'center',
      padding: '16px',
      animation: 'fadeIn 0.2s ease-out'
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: '24px',
        maxWidth: '520px',
        width: '100%',
        boxShadow: '0 25px 60px -15px rgba(220, 38, 38, 0.4), 0 0 0 2px #EF4444',
        overflow: 'hidden',
        direction: 'rtl',
        position: 'relative'
      }}>
        {/* Animated Warning Banner Header */}
        <div style={{
          padding: '24px 20px',
          background: 'linear-gradient(135deg, #7F1D1D 0%, #991B1B 100%)',
          color: '#ffffff',
          textAlign: 'center',
          position: 'relative'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.15)',
            border: '2px solid rgba(255,255,255,0.3)',
            display: 'grid',
            placeItems: 'center',
            margin: '0 auto 12px',
            boxShadow: '0 0 20px rgba(239, 68, 68, 0.6)'
          }}>
            <ShieldAlert size={36} color="#FCA5A5" />
          </div>

          <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '900', letterSpacing: '-0.3px' }}>
            ⛔ تنبيه حظر آلي: العميل مدرج بالقائمة السوداء!
          </h3>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#FECACA' }}>
            نظام الحماية والرقابة الآلية لمنع التأجير للعملاء المخالفين
          </p>
        </div>

        {/* Warning Body */}
        <div style={{ padding: '20px 24px' }}>
          {/* Customer Info Box */}
          <div style={{
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            borderRadius: '14px',
            padding: '14px 16px',
            marginBottom: '16px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', color: '#991B1B', fontWeight: '700' }}>بيانات المستأجر المحدد:</span>
              <span className="chip chip-danger" style={{ fontWeight: '800' }}>
                محظور / القائمة السوداء
              </span>
            </div>

            <div style={{ fontSize: '16px', fontWeight: '900', color: '#7F1D1D', marginBottom: '4px' }}>
              👤 {customer.full_name}
            </div>

            <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#991B1B' }}>
              <div>رقم الإثبات: <span dir="ltr" style={{ fontWeight: '700' }}>{customer.id_number}</span></div>
              <div>الجوال: <span dir="ltr" style={{ fontWeight: '700' }}>{customer.phone}</span></div>
            </div>
          </div>

          {/* Details / Reason */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '800', color: '#334155', marginBottom: '4px' }}>
              سبب الإدراج في القائمة السوداء:
            </label>
            <div style={{
              padding: '10px 12px',
              background: '#F8FAFC',
              border: '1px solid #CBD5E1',
              borderRadius: '10px',
              fontSize: '13px',
              color: '#1E293B',
              lineHeight: '1.5'
            }}>
              {customer.blacklist_reason || customer.rating_notes || 'توجد مشاكل سابقة في الإقامة أو شكاوى عدم التزام بالعقد.'}
            </div>
          </div>

          <div style={{
            fontSize: '12px',
            color: '#64748B',
            background: '#F1F5F9',
            padding: '10px 12px',
            borderRadius: '10px',
            textAlign: 'center',
            lineHeight: '1.5'
          }}>
            🔒 يوصى بعدم إتمام الحجز أو تسليم الوحدة إلا بعد مراجعة الإدارة وسداد المستحقات السابقة.
          </div>
        </div>

        {/* Modal Actions */}
        <div style={{
          padding: '16px 24px',
          background: '#F8FAFC',
          borderTop: '1px solid #E2E8F0',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {onView360 && (
              <button
                className="btn btn-blue btn-sm"
                onClick={() => { onClose(); onView360(customer) }}
                style={{ flex: 1, padding: '10px', fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
              >
                <ExternalLink size={16} /> فتح الملف الموحد للعميل (360)
              </button>
            )}

            <button
              className="btn btn-ghost btn-sm"
              onClick={onClose}
              style={{ padding: '10px 20px', borderRadius: '10px', background: '#E2E8F0', color: '#1E293B', fontWeight: '700' }}
            >
              إلغاء الحجز / العودة
            </button>
          </div>

          {onOverride && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={onOverride}
              style={{
                fontSize: '11px',
                color: '#DC2626',
                border: '1px dashed #FCA5A5',
                padding: '6px',
                width: '100%',
                borderRadius: '8px',
                marginTop: '4px'
              }}
            >
              ⚠️ تجاوز الحظر وإكمال التسكين تحت مسئولية مدير الفرع
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
