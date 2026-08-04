import React, { useState } from 'react'
import { X, RotateCcw, ChevronUp, ChevronDown, Eye, EyeOff, Star } from 'lucide-react'
import { NAV_GROUPS, makeVisibility } from '../../lib/navTree'
import { DEFAULT_SIDEBAR_PREFS } from '../../hooks/useSidebarPrefs'

/**
 * إعدادات لوحة البيانات الجانبية — تخص اللوحة وحدها لا النظام.
 * المستخدم يرتّب المجموعات، يخفي ما لا يحتاجه، يضيف مفضّلة تظهر أولاً،
 * ويضبط حجم الخط والعرض والألوان. كل ذلك محفوظ في حسابه.
 */
export default function SidebarSettings({ prefs, save, reset, toggleHidden, toggleFavorite, moveGroup, roles, onClose }) {
  const [tab, setTab] = useState('layout')
  const isVisible = makeVisibility(roles)

  const groups = NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(isVisible) }))
    .filter(g => g.items.length)

  const ordered = prefs.order.length
    ? [...groups].sort((a, b) => {
        const r = new Map(prefs.order.map((id, i) => [id, i]))
        return (r.get(a.id) ?? 999) - (r.get(b.id) ?? 999)
      })
    : groups

  const groupIds = ordered.map(g => g.id)
  const hidden = new Set(prefs.hidden)
  const favs = new Set(prefs.favorites)

  return (
    <div className="sbset-back" onClick={onClose}>
      <div className="sbset" onClick={e => e.stopPropagation()} role="dialog" aria-label="إعدادات لوحة البيانات الجانبية">
        <div className="sbset-head">
          <b>⚙️ إعدادات اللوحة الجانبية</b>
          <span>تُحفظ في حسابك وتعود كما تركتها عند تسجيل الدخول</span>
          <button onClick={onClose} aria-label="إغلاق"><X size={16} /></button>
        </div>

        <div className="sbset-tabs">
          <button className={tab === 'layout' ? 'on' : ''} onClick={() => setTab('layout')}>المظهر والحجم</button>
          <button className={tab === 'order' ? 'on' : ''} onClick={() => setTab('order')}>الترتيب والإخفاء</button>
          <button className={tab === 'colors' ? 'on' : ''} onClick={() => setTab('colors')}>الألوان</button>
        </div>

        <div className="sbset-body">
          {tab === 'layout' && (
            <>
              <label className="sbset-row">
                <span>حجم النصوص</span>
                <input type="range" min={0.82} max={1.25} step={0.01} value={prefs.fontScale}
                  onChange={e => save({ fontScale: Number(e.target.value) })} />
                <b>{Math.round(prefs.fontScale * 100)}%</b>
              </label>
              <label className="sbset-row">
                <span>العرض الأفقي</span>
                <input type="range" min={200} max={420} step={4} value={prefs.width}
                  onChange={e => save({ width: Number(e.target.value) })} />
                <b>{prefs.width}px</b>
              </label>
              <div className="sbset-row">
                <span>التباعد</span>
                <div className="sbset-seg">
                  {[['compact', 'مضغوط'], ['normal', 'عادي'], ['roomy', 'مريح']].map(([k, l]) => (
                    <button key={k} className={prefs.density === k ? 'on' : ''} onClick={() => save({ density: k })}>{l}</button>
                  ))}
                </div>
              </div>
              <p className="sbset-hint">
                يمكنك أيضاً سحب حافة اللوحة مباشرةً لتغيير العرض — والنتيجة تُحفظ هنا نفسها.
              </p>
            </>
          )}

          {tab === 'order' && (
            <div className="sbset-groups">
              {ordered.map((g, i) => (
                <div key={g.id} className={'sbset-group' + (hidden.has('group:' + g.id) ? ' off' : '')}>
                  <div className="sbset-group-head">
                    <span className="sbset-gico">{g.icon}</span>
                    <b>{g.category}</b>
                    <button title="أعلى" disabled={i === 0} onClick={() => moveGroup(groupIds, g.id, -1)}><ChevronUp size={13} /></button>
                    <button title="أسفل" disabled={i === ordered.length - 1} onClick={() => moveGroup(groupIds, g.id, 1)}><ChevronDown size={13} /></button>
                    <button title={hidden.has('group:' + g.id) ? 'إظهار المجموعة' : 'إخفاء المجموعة'}
                      onClick={() => toggleHidden('group:' + g.id)}>
                      {hidden.has('group:' + g.id) ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  <div className="sbset-items">
                    {g.items.map(it => (
                      <div key={it.k} className={'sbset-item' + (hidden.has(it.k) ? ' off' : '')}>
                        <span>{it.icon} {it.label}</span>
                        <button title={favs.has(it.k) ? 'إزالة من المفضّلة' : 'إضافة للمفضّلة'}
                          className={favs.has(it.k) ? 'fav' : ''}
                          onClick={() => toggleFavorite(it.k)}><Star size={12} /></button>
                        <button title={hidden.has(it.k) ? 'إظهار' : 'إخفاء'} onClick={() => toggleHidden(it.k)}>
                          {hidden.has(it.k) ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'colors' && (
            <>
              {[
                ['textColor', 'لون النصوص'],
                ['accentColor', 'لون التمييز والقسم النشط'],
                ['bgColor', 'خلفية اللوحة'],
              ].map(([k, label]) => (
                <label key={k} className="sbset-row">
                  <span>{label}</span>
                  <input type="color" value={prefs[k] || defaultColor(k)} onChange={e => save({ [k]: e.target.value })} />
                  {prefs[k] && <button className="sbset-clear" onClick={() => save({ [k]: '' })}>لون النظام</button>}
                </label>
              ))}
              <p className="sbset-hint">اترك أي لون على «لون النظام» ليتبع تصميم المنصة الأصلي.</p>
            </>
          )}
        </div>

        <div className="sbset-foot">
          <button className="btn btn-ghost btn-sm" onClick={reset}>
            <RotateCcw size={13} /> استعادة الافتراضي
          </button>
          <button className="btn btn-gold btn-sm" onClick={onClose}>تم</button>
        </div>
      </div>
    </div>
  )
}

function defaultColor(k) {
  return { textColor: '#E8EEF7', accentColor: '#C6A24B', bgColor: '#0E2340' }[k] || '#ffffff'
}

export { DEFAULT_SIDEBAR_PREFS }
