import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const LS_KEY = 'almazen.sidebar.prefs'

export const DEFAULT_SIDEBAR_PREFS = {
  fontScale: 1,        // 0.82 – 1.25
  width: 268,          // العرض الأفقي بالبكسل
  hidden: [],          // مفاتيح الأقسام أو المجموعات المخفية
  order: [],           // ترتيب المجموعات
  favorites: [],       // الأقسام المفضّلة تظهر في الأعلى
  textColor: '',       // '' = لون النظام
  accentColor: '',
  bgColor: '',
  density: 'normal',   // compact | normal | roomy
}

function normalize(raw) {
  const p = { ...DEFAULT_SIDEBAR_PREFS, ...(raw || {}) }
  return {
    ...p,
    fontScale: Math.min(1.25, Math.max(0.82, Number(p.fontScale) || 1)),
    width: Math.min(420, Math.max(200, Number(p.width) || 268)),
    hidden: Array.isArray(p.hidden) ? p.hidden : [],
    order: Array.isArray(p.order) ? p.order : [],
    favorites: Array.isArray(p.favorites) ? p.favorites : [],
    density: ['compact', 'normal', 'roomy'].includes(p.density) ? p.density : 'normal',
  }
}

function readLocal() {
  try { return normalize(JSON.parse(localStorage.getItem(LS_KEY) || 'null')) }
  catch { return DEFAULT_SIDEBAR_PREFS }
}

/**
 * تفضيلات لوحة البيانات الجانبية لكل مستخدم.
 * تُحفظ في user_ui_settings.sidebar مع نسخة محلية للاستجابة الفورية،
 * فلا يعيد المستخدم ضبطها عند كل تسجيل دخول.
 */
export function useSidebarPrefs(userId) {
  const [prefs, setPrefs] = useState(readLocal)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase.from('user_ui_settings').select('sidebar').eq('user_id', userId).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        setLoaded(true)
        if (error || !data?.sidebar) return
        const next = normalize(data.sidebar)
        setPrefs(next)
        try { localStorage.setItem(LS_KEY, JSON.stringify(next)) } catch { /* التخزين قد يكون معطّلاً */ }
      })
    return () => { cancelled = true }
  }, [userId])

  const save = useCallback(async (patch) => {
    const next = normalize({ ...prefs, ...patch })
    setPrefs(next)
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)) } catch { /* كما سبق */ }
    if (!userId) return
    const { error } = await supabase.from('user_ui_settings')
      .upsert({ user_id: userId, sidebar: next }, { onConflict: 'user_id' })
    if (error) console.warn('sidebar prefs: حُفظت محلياً فقط —', error.message)
  }, [prefs, userId])

  const reset = useCallback(() => save(DEFAULT_SIDEBAR_PREFS), [save])

  const toggleHidden = useCallback((key) => {
    const set = new Set(prefs.hidden)
    set.has(key) ? set.delete(key) : set.add(key)
    return save({ hidden: [...set] })
  }, [prefs.hidden, save])

  const toggleFavorite = useCallback((key) => {
    const set = new Set(prefs.favorites)
    set.has(key) ? set.delete(key) : set.add(key)
    return save({ favorites: [...set] })
  }, [prefs.favorites, save])

  const moveGroup = useCallback((groupIds, id, dir) => {
    const order = prefs.order.length ? [...prefs.order] : [...groupIds]
    const i = order.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    return save({ order })
  }, [prefs.order, save])

  return { prefs, save, reset, toggleHidden, toggleFavorite, moveGroup, loaded }
}

/** متغيّرات CSS مشتقة من التفضيلات. */
export function sidebarPrefsVars(p) {
  const gap = { compact: '2px', normal: '4px', roomy: '7px' }[p.density] || '4px'
  const pad = { compact: '.42em .6em', normal: '.58em .7em', roomy: '.78em .8em' }[p.density] || '.58em .7em'
  const vars = {
    '--sb-font-scale': String(p.fontScale),
    '--sb-item-gap': gap,
    '--sb-item-pad': pad,
  }
  if (p.textColor) vars['--sb-ink-user'] = p.textColor
  if (p.accentColor) vars['--sb-accent-user'] = p.accentColor
  if (p.bgColor) vars['--sb-bg-user'] = p.bgColor
  return vars
}
