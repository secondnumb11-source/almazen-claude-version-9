import React, { useState, useEffect } from 'react'
import { X, Check, Paintbrush, Maximize2, LayoutGrid, ShieldCheck } from 'lucide-react'

const THEMES = [
  { id: 'default', label: 'افتراضي (فاتح)', desc: 'خلفية بيضاء أنيقة مع حدود ذهبية خفيفة', bg: 'linear-gradient(145deg, #ffffff 0%, #fbf7ec 100%)', border: '#C9A84C', textColor: '#0A192F' },
  { id: 'dark', label: 'داكن فاخر', desc: 'خلفية كحلية فاخرة تناسب البيئة الليلية', bg: 'linear-gradient(145deg, #0E2340 0%, #1A3A63 100%)', border: 'rgba(255,255,255,0.2)', textColor: '#ffffff' },
  { id: 'green', label: 'أخضر زمردي', desc: 'تنسيق أخضر للنتائج الإيجابية والإيرادات', bg: 'linear-gradient(145deg, #1B9E5A 0%, #137742 100%)', border: 'rgba(255,255,255,0.2)', textColor: '#ffffff' },
  { id: 'gold', label: 'ذهبي المازن', desc: 'تنسيق برّاق يعكس الهوية الملكية للمنصة', bg: 'linear-gradient(145deg, #C6A24B 0%, #9A7B2E 100%)', border: 'rgba(255,255,255,0.3)', textColor: '#ffffff' },
]

const SIZES = [
  { id: '1', label: '1x (قياسي)', desc: 'يشغل عموداً واحداً في شبكة العرض', widthPct: '33%' },
  { id: '2', label: '2x (مزدوج)', desc: 'يشغل عمودين للتركيز على الأرقام الهامة', widthPct: '66%' },
  { id: '3', label: '3x (عريض)', desc: 'يشغل عرض السطر بالكامل في الواجهة', widthPct: '100%' },
]

export default function KpiCardConfigModal({ isOpen, onClose, card, onSave }) {
  const [selectedTheme, setSelectedTheme] = useState('default')
  const [selectedSize, setSelectedSize] = useState('1')

  useEffect(() => {
    if (card) {
      setSelectedTheme(card.color || 'default')
      setSelectedSize(card.size || '1')
    }
  }, [card])

  if (!isOpen || !card) return null

  const handleApply = () => {
    onSave({
      ...card,
      color: selectedTheme,
      size: selectedSize
    })
    onClose()
  }

  const currentThemeObj = THEMES.find(t => t.id === selectedTheme) || THEMES[0]

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'rgba(10, 25, 47, 0.75)',
      backdropFilter: 'blur(6px)',
      display: 'grid',
      placeItems: 'center',
      padding: '16px',
      animation: 'fadeIn 0.2s ease-out'
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: '20px',
        maxWidth: '540px',
        width: '100%',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(201, 168, 76, 0.3)',
        overflow: 'hidden',
        direction: 'rtl'
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '18px 24px',
          background: 'linear-gradient(135deg, #0A192F 0%, #1E3A8A 100%)',
          color: '#ffffff',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '2px solid #C9A84C'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              background: 'rgba(201, 168, 76, 0.2)',
              padding: '8px',
              borderRadius: '10px',
              color: '#F5D97E',
              display: 'grid',
              placeItems: 'center'
            }}>
              <Paintbrush size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: '800' }}>تخصيص بطاقة المؤشر</h3>
              <span style={{ fontSize: '12px', color: '#93C5FD' }}>{card.title}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: '#ffffff',
              borderRadius: '8px',
              width: '32px',
              height: '32px',
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center'
            }}
            title="إغلاق"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '20px 24px', maxHeight: '78vh', overflowY: 'auto' }}>

          {/* Live Preview Section */}
          <div style={{ marginBottom: '22px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '800', color: '#0A192F', marginBottom: '8px' }}>
              👁️ معاينة شكل البطاقة الحقيقي
            </label>
            <div style={{
              background: '#F8FAFC',
              padding: '16px',
              borderRadius: '14px',
              border: '1px dashed #CBD5E1',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center'
            }}>
              <div
                className={`kpi size-${selectedSize} color-${selectedTheme}`}
                style={{
                  width: selectedSize === '1' ? '100%' : selectedSize === '2' ? '100%' : '100%',
                  maxWidth: '100%',
                  margin: 0,
                  boxShadow: '0 8px 20px rgba(0,0,0,0.1)'
                }}
              >
                <div className="v" style={{ direction: 'ltr', textAlign: 'right' }}>1,250.00 ر.س</div>
                <div className="l">{card.title}</div>
                <div style={{ marginTop: '8px', fontSize: '10px', opacity: 0.7, display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <ShieldCheck size={12} /> معاينة مباشرة
                </div>
              </div>
            </div>
          </div>

          {/* Theme Selection */}
          <div style={{ marginBottom: '22px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '800', color: '#0A192F', marginBottom: '10px' }}>
              <Paintbrush size={16} color="#C9A84C" /> اختار النمط واللون (Theme)
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {THEMES.map(t => {
                const isSelected = selectedTheme === t.id
                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTheme(t.id)}
                    style={{
                      padding: '12px',
                      borderRadius: '12px',
                      border: isSelected ? '2px solid #C9A84C' : '1px solid #E2E8F0',
                      background: isSelected ? '#FEFCE8' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      position: 'relative'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <div style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '6px',
                        background: t.bg,
                        border: '1px solid ' + t.border,
                        flexShrink: 0
                      }} />
                      <strong style={{ fontSize: '13px', color: '#0A192F' }}>{t.label}</strong>
                      {isSelected && <Check size={16} color="#C9A84C" style={{ marginRight: 'auto' }} />}
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748B', lineHeight: '1.4' }}>{t.desc}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Span Size Selection */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '800', color: '#0A192F', marginBottom: '10px' }}>
              <Maximize2 size={16} color="#C9A84C" /> العرض وحجم البطاقة (Span Size)
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
              {SIZES.map(s => {
                const isSelected = selectedSize === s.id
                return (
                  <div
                    key={s.id}
                    onClick={() => setSelectedSize(s.id)}
                    style={{
                      padding: '12px 8px',
                      borderRadius: '12px',
                      border: isSelected ? '2px solid #C9A84C' : '1px solid #E2E8F0',
                      background: isSelected ? '#FEFCE8' : '#ffffff',
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div style={{ fontWeight: '800', fontSize: '14px', color: isSelected ? '#8B6F2C' : '#0A192F', marginBottom: '2px' }}>
                      {s.label}
                    </div>
                    <div style={{ fontSize: '10px', color: '#64748B' }}>{s.desc}</div>
                  </div>
                )
              })}
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div style={{
          padding: '16px 24px',
          background: '#F8FAFC',
          borderTop: '1px solid #E2E8F0',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '10px'
        }}>
          <button
            onClick={onClose}
            className="btn btn-ghost"
            style={{ borderRadius: '10px', padding: '8px 18px' }}
          >
            إلغاء
          </button>
          <button
            onClick={handleApply}
            className="btn btn-gold"
            style={{ borderRadius: '10px', padding: '8px 22px', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Check size={16} /> حفظ التغييرات
          </button>
        </div>
      </div>
    </div>
  )
}
