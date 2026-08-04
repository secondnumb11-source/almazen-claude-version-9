import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, CornerDownLeft } from 'lucide-react'
import { searchNav } from '../../lib/navTree'

/**
 * مفتاح البحث في أعلى لوحة البيانات الجانبية.
 * يبحث في كل الأقسام والصفحات والقوائم؛ والنقر على نتيجة ينقل مباشرةً.
 * يدعم الأسهم و Enter حتى لا يضطر المستخدم لالتقاط النتيجة بالفأرة.
 */
export default function SidebarSearch({ isVisible, onPick, collapsed, onExpandRequest }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(0)
  const boxRef = useRef(null)
  const inputRef = useRef(null)

  const results = useMemo(() => searchNav(q, isVisible), [q, isVisible])

  useEffect(() => { setIdx(0) }, [q])

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // اختصار عام: Ctrl/Cmd + K يفتح البحث من أي مكان
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onExpandRequest?.()
        setOpen(true)
        setTimeout(() => inputRef.current?.focus(), 60)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExpandRequest])

  const pick = (item) => {
    if (!item) return
    onPick(item.k)
    setQ(''); setOpen(false)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[idx]) }
    else if (e.key === 'Escape') { setQ(''); setOpen(false) }
  }

  if (collapsed) {
    return (
      <button className="sb-search-mini" title="بحث في الأقسام (Ctrl+K)"
        onClick={() => { onExpandRequest?.(); setOpen(true); setTimeout(() => inputRef.current?.focus(), 80) }}>
        <Search size={15} />
      </button>
    )
  }

  return (
    <div className="sb-search" ref={boxRef}>
      <div className="sb-search-box">
        <Search size={14} />
        <input
          ref={inputRef}
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="ابحث في الأقسام والصفحات…"
          aria-label="بحث في أقسام النظام"
        />
        {q
          ? <button className="sb-search-x" onClick={() => { setQ(''); inputRef.current?.focus() }} aria-label="مسح"><X size={13} /></button>
          : <kbd className="sb-search-kbd">Ctrl K</kbd>}
      </div>

      {open && q && (
        <div className="sb-search-res" role="listbox">
          {!results.length && <div className="sb-search-empty">لا توجد نتائج مطابقة لـ «{q}»</div>}
          {results.map((r, i) => (
            <button
              key={r.k}
              role="option"
              aria-selected={i === idx}
              className={'sb-search-item' + (i === idx ? ' on' : '')}
              onMouseEnter={() => setIdx(i)}
              onClick={() => pick(r)}
            >
              <span className="sb-search-ico">{r.icon}</span>
              <span className="sb-search-txt">
                <b>{r.label}</b>
                <small>{r.groupIcon} {r.groupLabel}</small>
              </span>
              {i === idx && <CornerDownLeft size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
