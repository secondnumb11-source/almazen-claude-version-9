import React from 'react'
import { Maximize2, RotateCcw } from 'lucide-react'
import { UNIT_SIZE_PRESETS, UNIT_WIDTH_MIN, UNIT_WIDTH_MAX, DEFAULT_UNIT_GRID } from '../hooks/useUnitCardSize'

/**
 * شريط التحكم بمقاس مربعات الوحدات.
 * يجمع بين مقاسات جاهزة بنقرة واحدة وشريط تمرير للضبط الدقيق،
 * ويشرح للمستخدم صراحةً أن اختياره يُحفظ في حسابه.
 */
export default function UnitCardSizer({ grid, onChange, onReset, visibleCount }) {
  const activePreset = UNIT_SIZE_PRESETS.find(p => p.width === grid.width)
  const isDefault = grid.width === DEFAULT_UNIT_GRID.width

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
      </div>
    </div>
  )
}
