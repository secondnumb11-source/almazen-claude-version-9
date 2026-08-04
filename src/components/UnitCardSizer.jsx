import React, { useState } from 'react'
import { Maximize2, RotateCcw, EyeOff, SlidersHorizontal } from 'lucide-react'
import { UNIT_SIZE_PRESETS, UNIT_WIDTH_MIN, UNIT_WIDTH_MAX, DEFAULT_UNIT_GRID } from '../hooks/useUnitCardSize'

const HIDE_KEY = 'almazen.units.sizerHidden'

/**
 * شريط التحكم بمقاس مربعات الوحدات.
 * يجمع بين مقاسات جاهزة بنقرة واحدة وشريط تمرير للضبط الدقيق،
 * ويشرح للمستخدم صراحةً أن اختياره يُحفظ في حسابه.
 * قابل للإخفاء — وتفضيل الإخفاء يبقى محفوظاً بين الجلسات.
 */
export default function UnitCardSizer({ grid, onChange, onReset, visibleCount }) {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(HIDE_KEY) === '1' } catch { return false }
  })

  const setHiddenPersist = (v) => {
    setHidden(v)
    try { localStorage.setItem(HIDE_KEY, v ? '1' : '0') } catch { /* التخزين قد يكون معطّلاً */ }
  }

  const activePreset = UNIT_SIZE_PRESETS.find(p => p.width === grid.width)
  const isDefault = grid.width === DEFAULT_UNIT_GRID.width

  // مخفي: زر صغير فقط يعيد إظهار الشريط
  if (hidden) {
    return (
      <button
        type="button"
        className="uc-sizer-show"
        onClick={() => setHiddenPersist(false)}
        title="إظهار أدوات التحكم بمقاس مربعات الوحدات"
      >
        <SlidersHorizontal size={13} />
        <span>مقاس المربعات</span>
        <span className="uc-sizer-show-val">{grid.width}px</span>
      </button>
    )
  }

  return (
    <div className="uc-sizer" role="group" aria-label="التحكم بمقاس مربعات الوحدات">
      <div className="uc-sizer-lbl">
        <Maximize2 size={15} />
        مقاس مربعات الوحدات
      </div>

      <div className="uc-sizer-seg">
        {UNIT_SIZE_PRESETS.map(p => (
          <button
            key={p.id}
            type="button"
            className={activePreset?.id === p.id ? 'on' : ''}
            onClick={() => onChange({ preset: p.id, width: p.width })}
            title={p.hint}
            aria-pressed={activePreset?.id === p.id}
          >
            {p.label}
          </button>
        ))}
      </div>

      <span className="uc-sizer-hint">
        اسحب الشريط للضبط الدقيق — يُحفظ اختيارك في حسابك تلقائياً ويعود كما تركته عند الدخول مرة أخرى
        {typeof visibleCount === 'number' ? ` · ${visibleCount} وحدة معروضة` : ''}
      </span>

      <div className="uc-sizer-range">
        <input
          type="range"
          min={UNIT_WIDTH_MIN}
          max={UNIT_WIDTH_MAX}
          step={2}
          value={grid.width}
          onChange={e => onChange({ preset: 'custom', width: Number(e.target.value) })}
          aria-label="عرض مربع الوحدة بالبكسل"
          title="تصغير / تكبير مربع الوحدة"
        />
        <span className="uc-sizer-val">{grid.width}px</span>
        {!isDefault && (
          <button type="button" className="uc-sizer-reset" onClick={onReset} title="العودة للمقاس الافتراضي">
            <RotateCcw size={12} style={{ verticalAlign: '-1px', marginInlineEnd: 3 }} />
            الافتراضي
          </button>
        )}
        <button
          type="button"
          className="uc-sizer-hide"
          onClick={() => setHiddenPersist(true)}
          title="إخفاء شريط التحكم — يبقى مخفياً حتى تُعيده"
          aria-label="إخفاء شريط التحكم بالمقاس"
        >
          <EyeOff size={13} />
        </button>
      </div>
    </div>
  )
}
