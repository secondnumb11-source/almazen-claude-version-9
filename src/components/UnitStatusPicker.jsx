import React from 'react'

/**
 * نافذة تغيير حالة الوحدة — مشتركة بين البطاقة التفصيلية والمختصرة
 * حتى لا يتكرر المنطق ولا تتباعد الخيارات بينهما.
 */
export const UNIT_STATUS_OPTIONS = [
  { key: 'available',       lbl: 'متاح 🟢',                desc: 'جاهزة لاستقبال وحجز النزلاء',        bg: 'rgba(16,185,129,0.18)', border: '#10B981', text: '#34D399' },
  { key: 'occupied',        lbl: 'مسكونة 🔴',              desc: 'الوحدة بها نزيل حالياً',              bg: 'rgba(239,68,68,0.18)',  border: '#EF4444', text: '#FCA5A5' },
  { key: 'reserved',        lbl: 'محجوز محلياً 🟠',        desc: 'يوجد حجز مؤكد ينتظر الوصول',          bg: 'rgba(249,115,22,0.18)', border: '#F97316', text: '#FFEDD5' },
  { key: 'reserved_online', lbl: 'محجوز أونلاين 💗',       desc: 'حجز قادم عبر منصات الحجز الإلكتروني', bg: 'rgba(236,72,153,0.18)', border: '#EC4899', text: '#FBCFE8' },
  { key: 'cleaning',        lbl: 'قيد التنظيف 🟡',         desc: 'تحت تجهيز وتغيير البياضات',           bg: 'rgba(234,179,8,0.18)',  border: '#EAB308', text: '#FDE047' },
  { key: 'maintenance',     lbl: 'الوحدة قيد الصيانة 🔧',  desc: 'خارج الخدمة لأعمال الصيانة والإصلاح', bg: 'rgba(250,204,21,0.22)', border: '#FACC15', text: '#FEF08A' },
]

export default function UnitStatusPicker({ unit, currentLabel, onClose, onPick }) {
  return (
    <div
      className="overlay"
      onClick={(e) => { e.stopPropagation(); onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(6px)', zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0F172A', color: '#fff', borderRadius: 20, padding: 24,
          width: 'min(380px, 100%)', border: '1.5px solid #C9A84C',
          boxShadow: '0 25px 50px rgba(0,0,0,0.6)', animation: 'slideUp 0.2s ease-out',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid rgba(201,168,76,0.2)', paddingBottom: 10 }}>
          <h4 style={{ margin: 0, fontSize: 16, color: '#F5D97E', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Cairo, sans-serif', fontWeight: 800 }}>
            🔄 تغيير حالة الوحدة {unit.unit_number}
          </h4>
          <button type="button" style={{ color: '#94A3B8', fontSize: 18, cursor: 'pointer', background: 'none', border: 'none', padding: 4 }} onClick={onClose}>✕</button>
        </div>

        <p style={{ fontSize: 12.5, color: '#CBD5E1', marginTop: 0, marginBottom: 18, lineHeight: 1.5 }}>
          الحالة الحالية: <b style={{ color: '#F5D97E' }}>{currentLabel}</b>.
          اختر الحالة الجديدة للوحدة لتحديثها فوراً بالنظام:
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {UNIT_STATUS_OPTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', borderRadius: 12, background: s.bg,
                border: `1.5px solid ${unit.status === s.key ? '#C9A84C' : s.border}`,
                color: s.text, cursor: 'pointer', textAlign: 'right',
                boxShadow: unit.status === s.key ? '0 0 12px rgba(201,168,76,0.4)' : 'none',
              }}
              onClick={() => onPick(s.key)}
            >
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 800 }}>{s.lbl}</div>
                <div style={{ fontSize: 10.5, opacity: 0.8, marginTop: 2, color: '#e2e8f0' }}>{s.desc}</div>
              </div>
              {unit.status === s.key && (
                <span style={{ fontSize: 11, background: '#C9A84C', color: '#0A192F', padding: '2px 8px', borderRadius: 6, fontWeight: 800 }}>
                  ✓ الحالة الحالية
                </span>
              )}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-ghost"
          style={{ width: '100%', marginTop: 18, color: '#94A3B8', fontSize: 13, border: '1px solid rgba(255,255,255,0.15)' }}
          onClick={onClose}
        >
          إلغاء
        </button>
      </div>
    </div>
  )
}
