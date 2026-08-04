import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, CornerDownLeft, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { searchNav, makeVisibility } from '../lib/navTree'

/*
  البحث الموحّد: يبحث في بيانات النظام الفعلية (فواتير، قيود، عقود،
  سندات، عملاء، وحدات، حسابات، خدمات، مستندات) وفي أقسام النظام معاً.
  النقر على نتيجة يفتح الصفحة التي تحوي السجل ويمرّر معرّفه إليها.

  العزل: دالة global_search تتحقق من المنشأة بنفسها وترفض أي طلب
  لمنشأة أخرى — أُثبت ذلك باختبار حيّ، ولا تُعتمد الواجهة كحاجز أمني.
*/

const KIND_ICON = {
  'فاتورة': '🧾', 'قيد محاسبي': '📝', 'سند قبض': '📥', 'سند صرف': '📤',
  'عقد / حجز': '📑', 'عميل': '👤', 'وحدة': '🏢', 'مصروف': '💸',
  'دفعة': '💰', 'حساب': '🌳', 'خدمة': '🧰', 'مركز تكلفة': '🎯',
  'طلب صيانة': '🛠️', 'مستند رقمي': '🔏',
}

/**
 * @param onOpen (page, record) — تنقل إلى الصفحة مع تمرير السجل المطلوب فتحه
 * @param variant 'sidebar' | 'header'
 */
export default function DataSearch({ onOpen, variant = 'header', collapsed, onExpandRequest }) {
  const auth = useAuth()
  const { profile, isSuperAdmin, canFinance, isOwner } = auth
  const cid = profile?.company_id

  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(0)
  const [err, setErr] = useState('')
  const boxRef = useRef(null)
  const inputRef = useRef(null)

  const isVisible = useMemo(() => makeVisibility({
    isSuperAdmin, canFinance, isOwner,
    isAccountant: profile?.role === 'accountant',
    isEmployee: profile?.role === 'employee',
  }), [isSuperAdmin, canFinance, isOwner, profile?.role])

  /* أقسام النظام — بحث فوري محلي بلا انتظار الشبكة */
  const navHits = useMemo(() => searchNav(q, isVisible).slice(0, 6), [q, isVisible])

  /* بيانات النظام — بحث في القاعدة بعد توقّف الكتابة */
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2 || !cid) { setRows([]); setErr(''); return }
    let cancelled = false
    setBusy(true)
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('global_search', {
        p_query: term, p_company: cid, p_limit: 40,
      })
      if (cancelled) return
      setBusy(false)
      if (error) { setErr(error.message); setRows([]); return }
      setErr(''); setRows(data || [])
    }, 280)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, cid])

  useEffect(() => { setIdx(0) }, [q])

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); onExpandRequest?.(); setOpen(true)
        setTimeout(() => inputRef.current?.focus(), 60)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExpandRequest])

  /* قائمة موحّدة: الأقسام أولاً ثم السجلات مجمّعة بالنوع */
  const flat = useMemo(() => [
    ...navHits.map(n => ({ type: 'nav', key: 'nav:' + n.k, page: n.k, icon: n.icon, title: n.label, sub: n.groupLabel })),
    ...rows.map(r => ({
      type: 'rec', key: 'rec:' + r.o_kind + ':' + r.o_id, page: r.o_page, id: r.o_id,
      icon: KIND_ICON[r.o_kind] || '📄', title: r.o_title, sub: r.o_subtitle,
      kind: r.o_kind, badge: r.o_badge, date: r.o_date,
    })),
  ], [navHits, rows])

  const pick = useCallback((item) => {
    if (!item) return
    onOpen(item.page, item.type === 'rec' ? { id: item.id, kind: item.kind, title: item.title } : null)
    setQ(''); setOpen(false); setRows([])
  }, [onOpen])

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(flat[idx]) }
    else if (e.key === 'Escape') { setQ(''); setOpen(false) }
  }

  if (variant === 'sidebar' && collapsed) {
    return (
      <button className="sb-search-mini" title="بحث في النظام (Ctrl+K)"
        onClick={() => { onExpandRequest?.(); setOpen(true); setTimeout(() => inputRef.current?.focus(), 80) }}>
        <Search size={15} />
      </button>
    )
  }

  const wrapCls = variant === 'sidebar' ? 'sb-search' : 'ds-header'
  const boxCls = variant === 'sidebar' ? 'sb-search-box' : 'ds-header-box'

  return (
    <div className={wrapCls} ref={boxRef}>
      <div className={boxCls}>
        <Search size={variant === 'sidebar' ? 12 : 14} />
        <input
          ref={inputRef}
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="ابحث برقم الفاتورة أو العقد أو القيد أو الاسم…"
          aria-label="بحث في بيانات النظام وأقسامه"
        />
        {busy ? <Loader2 size={12} className="spin" />
          : q ? <button className="sb-search-x" onClick={() => { setQ(''); inputRef.current?.focus() }} aria-label="مسح"><X size={13} /></button>
          : <kbd className="sb-search-kbd">Ctrl K</kbd>}
      </div>

      {open && q.trim().length >= 2 && (
        <div className={variant === 'sidebar' ? 'sb-search-res' : 'ds-res'} role="listbox">
          {err && <div className="sb-search-empty">تعذّر البحث: {err}</div>}
          {!err && !busy && !flat.length && (
            <div className="sb-search-empty">لا توجد نتائج لـ «{q}» — جرّب رقم الفاتورة أو العقد أو اسم العميل</div>
          )}

          {navHits.length > 0 && <div className="ds-group-lbl">أقسام النظام</div>}
          {flat.map((it, i) => {
            const first = it.type === 'rec' && flat[i - 1]?.type !== 'rec'
            return (
              <React.Fragment key={it.key}>
                {first && <div className="ds-group-lbl">سجلات البيانات ({rows.length})</div>}
                <button
                  role="option" aria-selected={i === idx}
                  className={'sb-search-item' + (i === idx ? ' on' : '')}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => pick(it)}
                >
                  <span className="sb-search-ico">{it.icon}</span>
                  <span className="sb-search-txt">
                    <b>{it.title}</b>
                    <small>{it.sub}{it.date ? ` · ${it.date}` : ''}</small>
                  </span>
                  {it.kind && <span className="ds-kind">{it.kind}</span>}
                  {i === idx && <CornerDownLeft size={12} />}
                </button>
              </React.Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}
