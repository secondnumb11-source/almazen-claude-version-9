import React, { useState } from 'react'
import UnitStatusPicker from './UnitStatusPicker'

/**
 * البطاقة المختصرة — نمط عرض بديل لصفحة إدارة الوحدات.
 *
 * تعرض ثلاثة عناصر فقط: رقم الوحدة بخط عريض، تصنيفها، وحالتها.
 * التفاصيل الكاملة تبقى في نافذة الوحدة بلا أي تغيير — النقر يفتحها كالمعتاد.
 * ألوان الحالات مطابقة تماماً للنمط التفصيلي (u-av / u-oc / u-rs / u-ro / u-mn / u-cl).
 */
export default function CompactUnitCard({ u, STATUS, CATS, evictSoon, onClick, onQuickStatusChange }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const st = STATUS[u.status] || { label: u.status, cls: 'u-av' }
  const isOnline = u.status === 'reserved_online'

  return (
    <div className={`ucx ${st.cls} ${evictSoon ? 'ucx-evict' : ''}`} onClick={() => onClick(u)}>
      <span className="ucx-bar" />

      <div className="ucx-num">{u.unit_number}</div>

      <div className="ucx-cat" title={CATS[u.category] || u.category}>
        {CATS[u.category] || u.category}{u.is_furnished ? ' · مفروشة' : ''}
      </div>

      <div className="ucx-foot">
        <span className="ucx-status">{isOnline ? 'محجوز أونلاين' : st.label}</span>
        <button
          type="button"
          className="ucx-btn"
          title="تغيير حالة الوحدة"
          aria-label="تغيير حالة الوحدة"
          onClick={(e) => { e.stopPropagation(); setPickerOpen(true) }}
        >
          🔄
        </button>
      </div>

      {evictSoon && <span className="ucx-flag" title="موعد الإخلاء خلال 24 ساعة">⚠</span>}

      {pickerOpen && (
        <UnitStatusPicker
          unit={u}
          currentLabel={st.label}
          onClose={() => setPickerOpen(false)}
          onPick={(key) => { setPickerOpen(false); onQuickStatusChange?.(u, key) }}
        />
      )}
    </div>
  )
}
