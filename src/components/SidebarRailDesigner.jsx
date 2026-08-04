import React from 'react'
import { useAuth } from '../AuthContext'
import { useSidebarRailSettings, DEFAULT_RAIL, railCssVars } from '../hooks/useSidebarRailSettings'

const STYLES = [
  { k: 'gem', label: 'جوهرة (توهج فاخر)' },
  { k: 'ribbon', label: 'شريط كلاسيكي' },
  { k: 'minimal', label: 'مينيمال هادئ' },
]

const PRESETS = [
  { label: 'ذهبي ملكي', accent: '#C9A84C', accent2: '#0B1E3F' },
  { label: 'شمبانيا', accent: '#F5D97E', accent2: '#3B2F12' },
  { label: 'زمردي', accent: '#2FBF8F', accent2: '#06281F' },
  { label: 'بلاتيني', accent: '#CBD5E1', accent2: '#111827' },
]

/**
 * لوحة تصميم مسطرة الحركة الطولية — لكل مستخدم، وتُحفظ في قاعدة البيانات
 * (جدول user_ui_settings) وتُطبَّق ديناميكياً على اللوحة الجانبية فوراً.
 */
export default function SidebarRailDesigner() {
  const { session, toast } = useAuth()
  const { rail, save, reset } = useSidebarRailSettings(session?.user?.id)

  const set = async (patch) => {
    const err = await save(patch)
    if (err) toast('تعذّر الحفظ في قاعدة البيانات (تم الحفظ محلياً): ' + err.message, true)
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h4 style={{ fontSize: 15, marginBottom: 6 }}>🎚️ مسطرة الحركة الطولية للوحة الجانبية</h4>
      <p style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>
        تحكّم في لون المسطرة وسماكتها وارتفاع مؤشرها وشدة توهجها. الإعدادات تُحفظ في قاعدة البيانات
        لحسابك وتُطبَّق تلقائياً على كل أجهزتك.
      </p>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))' }}>
        <label className="iso-field" style={{ justifyContent: 'space-between' }}>
          <span>لون المسطرة</span>
          <input type="color" value={rail.accent} onChange={e => set({ accent: e.target.value })} />
        </label>
        <label className="iso-field" style={{ justifyContent: 'space-between' }}>
          <span>لون العمق</span>
          <input type="color" value={rail.accent2} onChange={e => set({ accent2: e.target.value })} />
        </label>
        <label className="iso-field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <span>السماكة: <b>{rail.thickness}px</b></span>
          <input type="range" min={2} max={12} value={rail.thickness}
            onChange={e => set({ thickness: Number(e.target.value) })} />
        </label>
        <label className="iso-field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <span>ارتفاع المؤشر: <b>{rail.height}%</b></span>
          <input type="range" min={30} max={100} value={rail.height}
            onChange={e => set({ height: Number(e.target.value) })} />
        </label>
        <label className="iso-field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <span>شدة التوهج: <b>{rail.glow}%</b></span>
          <input type="range" min={0} max={100} value={rail.glow}
            onChange={e => set({ glow: Number(e.target.value) })} />
        </label>
        <label className="iso-field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <span>النمط</span>
          <select value={rail.style} onChange={e => set({ style: e.target.value })}>
            {STYLES.map(s => <option key={s.k} value={s.k}>{s.label}</option>)}
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#64748b' }}>لوحات جاهزة:</span>
        {PRESETS.map(p => (
          <button key={p.label} className="btn btn-sm" onClick={() => set({ accent: p.accent, accent2: p.accent2 })}>
            <span style={{
              display: 'inline-block', width: 10, height: 10, borderRadius: 3,
              background: p.accent, marginInlineEnd: 6,
            }} />
            {p.label}
          </button>
        ))}
        <button className="btn btn-sm" onClick={() => reset()}>↺ استعادة الافتراضي</button>
      </div>

      {/* معاينة حيّة */}
      <div style={{
        marginTop: 16, height: 120, borderRadius: 12, position: 'relative',
        background: 'linear-gradient(180deg,#0B1E3F,#132a52)', overflow: 'hidden',
        ...railCssVars(rail),
      }}>
        <span style={{
          position: 'absolute', insetInlineEnd: 14, top: '50%', translate: '0 -50%',
          width: `${rail.thickness}px`, height: `${(rail.height / 100) * 70}px`,
          borderRadius: `${rail.radius}px`,
          background: `linear-gradient(180deg, ${rail.accent}, ${rail.accent2})`,
          boxShadow: `0 0 ${rail.glow / 4}px ${rail.accent}`,
        }} />
        <span style={{
          position: 'absolute', insetInlineEnd: 40, top: '50%', translate: '0 -50%',
          color: '#dbe6f7', fontSize: 12, fontWeight: 700,
        }}>معاينة حيّة للمسطرة</span>
      </div>

      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 10 }}>
        الافتراضي: {DEFAULT_RAIL.accent} · سماكة {DEFAULT_RAIL.thickness}px · ارتفاع {DEFAULT_RAIL.height}%
      </div>
    </div>
  )
}
