import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../AuthContext'
import { ROLES } from '../lib/helpers'
import { useSidebarResize } from './sidebar/useSidebarResize'
import { useSidebarRailSettings, railCssVars } from '../hooks/useSidebarRailSettings'
import { useLuxuryScrollbar } from '../hooks/useLuxuryScrollbar'
import { useSidebarPrefs, sidebarPrefsVars } from '../hooks/useSidebarPrefs'
import { NAV_GROUPS, makeVisibility, applyPrefs } from '../lib/navTree'
import DataSearch from './DataSearch'
import SidebarSettings from './sidebar/SidebarSettings'

function pad(n) { return String(n).padStart(2, '0') }

function SidebarClock({ collapsed }) {
  const [now, setNow] = useState(new Date())
  const [hijri, setHijri] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const h24 = now.getHours()
  const h12 = pad(h24 % 12 || 12)
  const mm = pad(now.getMinutes())
  const ss = pad(now.getSeconds())
  const ampm = h24 < 12 ? 'ص' : 'م'

  const dateStr = hijri
    ? now.toLocaleDateString('ar-SA-u-ca-islamic', { year: 'numeric', month: 'short', day: 'numeric' })
    : now.toLocaleDateString('ar-SA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

  if (collapsed) return (
    <div className="sb-clock-mini" title={`${h12}:${mm} ${ampm} - ${dateStr}`}>
      <span className="sb-clock-pulse" />
      <span className="sb-clock-mini-time">{h12}:{mm}</span>
    </div>
  )

  return (
    <div className="sb-clock">
      <div className="sb-clock-top">
        <div className="sb-clock-time-wrapper">
          <span className="sb-clock-pulse" />
          <div className="sb-clock-time" dir="ltr">
            <span className="sb-ampm">{ampm}</span>
            <span className="sb-digit">{h12}</span>
            <span className="sb-colon">:</span>
            <span className="sb-digit">{mm}</span>
            <span className="sb-sec-colon">:</span>
            <span className="sb-sec">{ss}</span>
          </div>
        </div>
        <button
          className="sb-cal-toggle"
          onClick={() => setHijri(h => !h)}
          title={hijri ? 'التحويل للميلادي' : 'التحويل للهجري'}
        >
          {hijri ? '🗓️ م' : '🌙 هـ'}
        </button>
      </div>
      <div className="sb-clock-date">
        <span className="sb-date-badge">{hijri ? 'هجري' : 'ميلادي'}</span>
        <span>{dateStr}</span>
      </div>
    </div>
  )
}

export default function AppSidebar({ page, setPage, collapsed, onToggle, onOpenRecord }) {
  const { profile, company, session, isOwner, canFinance, isSuperAdmin, signOut } = useAuth()
  const isAccountant = profile?.role === 'accountant'
  const isEmployee = profile?.role === 'employee'

  // تفضيلات اللوحة لكل مستخدم: العرض، حجم الخط، الترتيب، الإخفاء، الألوان
  const {
    prefs, save: savePrefs, reset: resetPrefs, toggleHidden, toggleFavorite, moveGroup,
  } = useSidebarPrefs(session?.user?.id)

  const { asideRef, effectiveWidth, showFullContent, dragging, autoPreview, onResizerPointerDown } =
    useSidebarResize({
      collapsed,
      width: prefs.width,
      onWidthCommit: (w) => savePrefs({ width: w }),
    })

  // إعدادات مسطرة الحركة الطولية — محفوظة في قاعدة البيانات لكل مستخدم
  const { rail } = useSidebarRailSettings(session?.user?.id)

  const [settingsOpen, setSettingsOpen] = useState(false)
  // قائمة منسدلة واحدة مفتوحة فقط في أي لحظة — كما طُلب صراحةً
  const [openGroup, setOpenGroup] = useState(null)

  // When auto-preview kicks in we want to render full-width content even though the parent
  // still considers the sidebar "collapsed". This keeps the toggle button behaviour intact.
  const contentCollapsed = !showFullContent

  // السوبر أدمن يرى كل الأقسام (منها صفحة الاختبارات الذكية للنظام) حتى لو لم يطابق دوره الشرط
  const roleFlags = { isSuperAdmin, canFinance, isOwner, isAccountant, isEmployee }
  const isVisible = useMemo(() => makeVisibility(roleFlags),
    [isSuperAdmin, canFinance, isOwner, isAccountant, isEmployee])

  const visibleGroups = useMemo(() => applyPrefs(
    NAV_GROUPS.map(g => ({ ...g, items: g.items.filter(isVisible) })).filter(g => g.items.length > 0),
    prefs,
  ), [isVisible, prefs])

  /* المجموعة التي تحوي الصفحة النشطة تُفتح تلقائياً عند التنقّل */
  useEffect(() => {
    const g = visibleGroups.find(x => x.accordion && x.items.some(i => i.k === page))
    if (g) setOpenGroup(g.id)
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (k) => {
    setPage(k)
    if (window.innerWidth <= 768) onToggle()
  }

  /* ---------------- مؤشر المسطرة: يتتبّع القسم النشط والمُحوَّم عليه ---------------- */
  const navRef = useRef(null)
  const itemRefs = useRef({})
  const [hoverKey, setHoverKey] = useState(null)
  const [marker, setMarker] = useState({ top: 0, height: 0, ready: false })
  const [ghost, setGhost] = useState({ top: 0, height: 0, visible: false })

  const measure = (key) => {
    const nav = navRef.current
    const el = itemRefs.current[key]
    if (!nav || !el) return null
    return { top: el.offsetTop - nav.scrollTop, height: el.offsetHeight }
  }

  useLayoutEffect(() => {
    const m = measure(page)
    if (m) setMarker({ ...m, ready: true })
  }, [page, contentCollapsed, effectiveWidth, visibleGroups.length])

  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const sync = () => {
      const m = measure(page)
      if (m) setMarker({ ...m, ready: true })
      if (hoverKey) {
        const h = measure(hoverKey)
        if (h) setGhost({ ...h, visible: true })
      }
    }
    nav.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('resize', sync)
    return () => { nav.removeEventListener('scroll', sync); window.removeEventListener('resize', sync) }
  }, [page, hoverKey])

  const onItemEnter = (key) => {
    setHoverKey(key)
    const m = measure(key)
    if (m) setGhost({ ...m, visible: true })
  }
  const onItemLeave = () => { setHoverKey(null); setGhost(g => ({ ...g, visible: false })) }

  /* مسطرة التمرير الفاخرة — تحل محل شريط تمرير المتصفح المخفي */
  const {
    geo: sbar, awake: sbarAwake, dragging: sbarDragging,
    onThumbPointerDown, onThumbPointerMove, endDrag, onTrackPointerDown,
  } = useLuxuryScrollbar(navRef)

  return (
    <aside
      ref={asideRef}
      className={'app-sidebar luxury-scroll rail-' + (rail.style || 'gem')
        + (contentCollapsed ? ' collapsed' : '')
        + (autoPreview ? ' auto-preview' : '')
        + (dragging ? ' resizing' : '')}
      style={{ width: `${effectiveWidth}px`, ...railCssVars(rail), ...sidebarPrefsVars(prefs) }}
    >
      {/* Resizer handle — sits on the inner edge, invisible until hover */}
      <div className="sb-resizer" onPointerDown={onResizerPointerDown} title="اسحب لتغيير العرض">
        <span className="sb-resizer-grip" />
      </div>

      {/* Sidebar Header */}
      <div className="sb-head">
        <div className="sb-brand" title={company?.name || 'المازن'}>
          <div className="sb-mark-wrapper">
            {company?.logo_url
              ? <img src={company.logo_url} alt="logo" className="sb-logo" />
              : <span className="sb-mark">م</span>}
            <span className="sb-mark-glow" />
          </div>
          {!contentCollapsed && (
            <div className="sb-brand-txt">
              <b>{company?.name || 'منصة المازن'}</b>
              <span className="sb-subtitle">
                <span className="sb-crown">👑</span> النظام العقاري الموحد
              </span>
            </div>
          )}
        </div>

        <button className="sb-toggle" onClick={onToggle} title={collapsed ? 'توسيع القائمة' : 'طي القائمة'}>
          <span className={'sb-toggle-arrow' + (collapsed ? ' rot' : '')}>‹</span>
        </button>
      </div>

      {/* البحث — في أقسام النظام وفي بياناته الفعلية معاً */}
      <DataSearch
        variant="sidebar"
        onOpen={(page, record) => onOpenRecord ? onOpenRecord(page, record) : go(page)}
        collapsed={contentCollapsed}
        onExpandRequest={() => { if (collapsed) onToggle() }}
      />

      {/* Clock Widget */}
      <SidebarClock collapsed={contentCollapsed} />

      {/* Collapsed Expand Prompt */}
      {contentCollapsed && (
        <button className="sb-expand-prompt" onClick={onToggle} title="فتح القائمة الجانبية">
          <span className="sb-expand-icon">«</span>
          <span className="sb-expand-lbl">توسيع</span>
        </button>
      )}

      {/* Navigation Sections */}
      <nav className="sb-nav" ref={navRef} onMouseLeave={onItemLeave}>
        {/* مسطرة التمرير الفاخرة — بديل شريط المتصفح المخفي.
            مثبّتة بصرياً على حافة اللوحة عبر تعويض scrollTop، وتختفي عند
            السكون وتظهر عند التحويم أو أثناء التمرير. */}
        {sbar.scrollable && (
          <div
            className={'sb-sbar' + (sbarAwake ? ' awake' : '') + (sbarDragging ? ' dragging' : '')}
            style={{ transform: `translateY(${sbar.scrollTop}px)`, height: `${sbar.viewport}px` }}
            onPointerDown={onTrackPointerDown}
          >
            <span className="sb-sbar-track" />
            <span
              className="sb-sbar-thumb"
              style={{ transform: `translateY(${sbar.thumbTop}px)`, height: `${sbar.thumbHeight}px` }}
              onPointerDown={onThumbPointerDown}
              onPointerMove={onThumbPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              role="scrollbar"
              aria-orientation="vertical"
              aria-label="مسطرة التمرير"
            />
          </div>
        )}

        {/* مسطرة الحركة الطولية — قضيب فاخر مع مؤشر نشط ومؤشر تحويم */}
        <div className="sb-rail" aria-hidden="true">
          <span className="sb-rail-track" />
          <span
            className={'sb-rail-ghost' + (ghost.visible && hoverKey !== page ? ' show' : '')}
            style={{ transform: `translateY(${ghost.top}px)`, height: `${ghost.height}px` }}
          />
          <span
            className={'sb-rail-marker' + (marker.ready ? ' show' : '')}
            style={{ transform: `translateY(${marker.top}px)`, height: `${marker.height}px` }}
          >
            <span className="sb-rail-marker-core" />
            <span className="sb-rail-marker-halo" />
          </span>
        </div>

        {/* Categorized Menu Groups — المجموعات المعلَّمة accordion تُعرض كقوائم منسدلة،
            ولا تبقى غير واحدة مفتوحة في أي لحظة. */}
        {visibleGroups.map((group) => {
          const isAccordion = !!group.accordion && !contentCollapsed
          const hasActive = group.items.some(i => i.k === page)
          const expanded = !isAccordion || openGroup === group.id

          return (
            <div
              key={group.id}
              className={'sb-group'
                + (isAccordion ? ' sb-group-acc' : '')
                + (isAccordion && expanded ? ' open' : '')
                + (hasActive ? ' has-active' : '')}
            >
              {!contentCollapsed && (
                isAccordion ? (
                  <button
                    type="button"
                    className={'sb-group-header sb-acc-btn' + (hasActive ? ' has-active' : '')}
                    onClick={() => setOpenGroup(g => (g === group.id ? null : group.id))}
                    aria-expanded={expanded}
                    title={expanded ? 'طي القائمة' : 'فتح القائمة'}
                  >
                    <span className="sb-acc-edge" aria-hidden="true" />
                    <span className="sb-group-icon">{group.icon}</span>
                    <span className="sb-group-title">{group.category}</span>
                    <span className="sb-acc-count">{group.items.length}</span>
                    <span className="sb-acc-arrow" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
                        stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 15 12 9 18 15" />
                      </svg>
                    </span>
                  </button>
                ) : (
                  <div className="sb-group-header">
                    <span className="sb-group-icon">{group.icon}</span>
                    <span className="sb-group-title">{group.category}</span>
                    <span className="sb-group-line" />
                  </div>
                )
              )}

              {expanded && (
                <div className="sb-group-items">
                  {group.items.map(it => {
                    const isActive = page === it.k
                    return (
                      <button
                        key={it.k}
                        ref={el => { itemRefs.current[it.k] = el }}
                        onMouseEnter={() => onItemEnter(it.k)}
                        onFocus={() => onItemEnter(it.k)}
                        className={'sb-item' + (isActive ? ' on' : '')}
                        onClick={() => go(it.k)}
                        title={it.label}
                      >
                        <span className="sb-ico-container">
                          <span className="sb-ico">{it.icon}</span>
                        </span>
                        {!contentCollapsed && (
                          <span className="sb-label">
                            <span>{it.label}</span>
                            {it.soon && <small className="sb-soon">قريباً</small>}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Sidebar Footer User Info */}
      <div className="sb-foot">
        {!contentCollapsed && (
          <div className="sb-user">
            <div className="sb-avatar-wrap">
              <div className="sb-avatar">{(profile?.full_name || '?').charAt(0)}</div>
              <span className="sb-user-online" title="متصل الآن" />
            </div>
            <div className="sb-user-info">
              <b>{profile?.full_name || 'مستخدم النظام'}</b>
              <span className="sb-role-badge">{ROLES[profile?.role] || profile?.role || 'مستخدم'}</span>
            </div>
          </div>
        )}
        <div className="sb-foot-row">
          <button
            className="sb-gear"
            onClick={() => setSettingsOpen(true)}
            title="إعدادات اللوحة الجانبية — الترتيب والإخفاء والحجم والألوان"
            aria-label="إعدادات اللوحة الجانبية"
          >
            <span className="sb-gear-ico">⚙️</span>
            {!contentCollapsed && <span>إعدادات اللوحة</span>}
          </button>
          <button className="sb-signout" onClick={signOut} title="تسجيل الخروج من الحساب">
            {contentCollapsed ? '⎋' : <><span className="sb-signout-ico">⎋</span><span>خروج</span></>}
          </button>
        </div>
      </div>

      {settingsOpen && (
        <SidebarSettings
          prefs={prefs}
          save={savePrefs}
          reset={resetPrefs}
          toggleHidden={toggleHidden}
          toggleFavorite={toggleFavorite}
          moveGroup={moveGroup}
          roles={roleFlags}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </aside>
  )
}
