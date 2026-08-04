import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'almazen.sidebar.width'
const MIN_WIDTH = 220
const MAX_WIDTH = 440
const DEFAULT_WIDTH = 340
const AUTO_EXPAND_ZONE = 22 // px from inner edge that triggers auto-expand while collapsed

function readStoredWidth() {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  const raw = Number(window.localStorage.getItem(STORAGE_KEY))
  if (!Number.isFinite(raw) || raw < MIN_WIDTH || raw > MAX_WIDTH) return DEFAULT_WIDTH
  return raw
}

/**
 * Handles two things for the sidebar:
 *  1. Manual drag-to-resize on an inner edge handle (RTL friendly).
 *  2. Auto-expand when the mouse approaches the inner edge while collapsed
 *     — expands to the user's saved width, and re-collapses on mouse leave.
 *
 * Returns refs / handlers to wire into the sidebar and its resizer element.
 */
export function useSidebarResize({ collapsed, onAutoExpand, onAutoCollapse, width, onWidthCommit } = {}) {
  const [userWidth, setUserWidth] = useState(() => (
    Number.isFinite(width) && width >= MIN_WIDTH && width <= MAX_WIDTH ? width : readStoredWidth()
  ))

  // العرض المحفوظ في حساب المستخدم يقود المكوّن؛ السحب يبقى فورياً محلياً
  // ثم يُثبَّت في الحساب عند رفع المؤشر.
  useEffect(() => {
    if (Number.isFinite(width) && width >= MIN_WIDTH && width <= MAX_WIDTH) setUserWidth(width)
  }, [width])
  const [autoPreview, setAutoPreview] = useState(false) // temporary expand while collapsed
  const [dragging, setDragging] = useState(false)
  const asideRef = useRef(null)
  const dragStartRef = useRef(null)
  const collapseTimerRef = useRef(null)

  // Persist width
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, String(userWidth)) } catch {}
  }, [userWidth])

  // Manual drag handling (works in RTL too — sidebar sits on the right)
  const onResizerPointerDown = useCallback((e) => {
    if (collapsed) return
    e.preventDefault()
    const startX = e.clientX
    const startW = asideRef.current?.getBoundingClientRect().width || userWidth
    dragStartRef.current = { startX, startW }
    setDragging(true)

    const onMove = (ev) => {
      const { startX, startW } = dragStartRef.current || {}
      if (startW == null) return
      // In RTL the sidebar is on the right, so moving mouse LEFT (dx<0) should grow it.
      const dir = document?.documentElement?.dir === 'rtl' ? -1 : 1
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + dir * (ev.clientX - startX)))
      setUserWidth(next)
    }
    const onUp = () => {
      setDragging(false)
      dragStartRef.current = null
      setUserWidth(w => { onWidthCommit?.(w); return w })
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ew-resize'
  }, [collapsed, userWidth, onWidthCommit])

  // Auto-expand while collapsed — listen to mousemove near the inner edge
  useEffect(() => {
    if (!collapsed) { setAutoPreview(false); return }
    const isRtl = document?.documentElement?.dir === 'rtl'
    const handleMove = (e) => {
      const el = asideRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      // Inner edge = the edge facing the main content (left in RTL, right in LTR)
      const innerEdgeX = isRtl ? r.left : r.right
      const distance = Math.abs(e.clientX - innerEdgeX)
      const withinVertical = e.clientY >= r.top && e.clientY <= r.bottom
      // Trigger when very close to the inner edge, or already inside the sidebar
      const insideSidebar = e.clientX >= r.left && e.clientX <= r.right && withinVertical
      const nearEdge = withinVertical && distance <= AUTO_EXPAND_ZONE

      if (nearEdge || insideSidebar) {
        if (collapseTimerRef.current) { clearTimeout(collapseTimerRef.current); collapseTimerRef.current = null }
        if (!autoPreview) { setAutoPreview(true); onAutoExpand && onAutoExpand() }
      } else if (autoPreview && !collapseTimerRef.current) {
        collapseTimerRef.current = setTimeout(() => {
          setAutoPreview(false)
          collapseTimerRef.current = null
          onAutoCollapse && onAutoCollapse()
        }, 260)
      }
    }
    window.addEventListener('mousemove', handleMove)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      if (collapseTimerRef.current) { clearTimeout(collapseTimerRef.current); collapseTimerRef.current = null }
    }
  }, [collapsed, autoPreview, onAutoExpand, onAutoCollapse])

  // The effective width the sidebar should render at right now
  const effectiveWidth = collapsed ? (autoPreview ? userWidth : 74) : userWidth
  const showFullContent = !collapsed || autoPreview

  return {
    asideRef,
    userWidth,
    effectiveWidth,
    showFullContent,
    dragging,
    autoPreview,
    onResizerPointerDown,
  }
}
