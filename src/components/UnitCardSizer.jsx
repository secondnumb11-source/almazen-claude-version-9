import React, { useState } from 'react'
import { Maximize2, RotateCcw, EyeOff, SlidersHorizontal, LayoutGrid, Rows3 } from 'lucide-react'
import { UNIT_VIEWS, viewLimits, DEFAULT_UNIT_GRID } from '../hooks/useUnitCardSize'

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

  const view = grid.view === 'compact' ? 'compact' : 'detailed'
  const L = viewLimits(view)
  const activePreset = L.presets.find(p => p.width === grid.width)
  const isDefault = view === DEFAULT_UNIT_GRID.view && grid.width === DEFAULT_UNIT_GRID.width

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
        عرض الوحدات
      </div>

      {/* منتقي نمط العرض — يُحفظ في حساب المستخدم مثل المقاس */}
      <div className="uc-sizer-view" role="group" aria-label="نمط عرض الوحدات">
        {UNIT_VIEWS.map(v => (
          <button
            key={v.id}
            type="button"
            className={view === v.id ? 'on' : ''}
            onClick={() => onChange({ view: v.id })}
            title={v.hint}
            aria-pressed={view === v.id}
          >
            {v.id === 'compact' ? <Rows3 size={13} /> : <LayoutGrid size={13} />}
            {v.label}
          </button>
        ))}
      </div>

      <div className="uc-sizer-seg">
        {L.presets.map(p => (
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
        {view === 'compact' ? 'النمط المختصر: الرقم والتصنيف والحالة فقط.' : 'النمط التفصيلي: البطاقة الكاملة.'} اسحب الشريط للضبط الدقيق — يُحفظ اختيارك في حسابك ويعود كما تركته
        {typeof visibleCount === 'number' ? ` · ${visibleCount} وحدة معروضة` : ''}
      </span>

      <div className="uc-sizer-range">
        <input
          type="range"
          min={L.min}
          max={L.max}
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
