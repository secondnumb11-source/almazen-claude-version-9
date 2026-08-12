import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

  /*
    لوحة نتائج الشريط الجانبي تُعرَض عبر بوابة إلى <body>.
    السبب مُثبت بالتتبّع: legacy.css يضع `.app-sidebar > * { position: relative;
    z-index: 1 }`، فيصير `.sb-search` سياق تكديس يحبس `z-index: 60` الخاص
    باللوحة بداخله، ويصير `.sb-nav` شقيقاً لاحقاً بنفس z-index فيُطلى فوقها.
    اختبار elementFromPoint على أربع نقاط داخل اللوحة أصاب الأربعُ عناصرَ
    خارجها (sb-digit · sb-nav · sb-item) — أي أن اللوحة كانت غير قابلة للنقر
    إطلاقاً وتبدو شفافة لأن القائمة تظهر فوقها.
    و`.app-sidebar` عليه `overflow: hidden`، فأي وضع «بجانب الصندوق» داخل
    الشجرة كان سيُقصّ. البوابة تحلّ الأمرين معاً بلا مساس بأي قاعدة قائمة.
  */
  const resRef = useRef(null)
  const [pos, setPos] = useState(null)

  const place = useCallback(() => {
    if (variant !== 'sidebar' || !boxRef.current) return
    const r = boxRef.current.getBoundingClientRect()
    const gap = 8
    const spaceStart = r.left            // فراغ يسار الصندوق
    const spaceEnd = window.innerWidth - r.right
    const w = Math.min(360, Math.max(spaceStart, spaceEnd) - gap * 2)
    // بجانب الصندوق في الجهة الأوسع؛ وإن ضاقت الجهتان يعود تحته
    if (w >= 240) {
      const left = spaceStart >= spaceEnd ? r.left - w - gap : r.right + gap
      const maxTop = window.innerHeight - 340 - 12
      setPos({ side: true, top: Math.max(12, Math.min(r.top, maxTop)), left, width: w })
    } else {
      setPos({ side: false, top: r.bottom + 4, left: r.left, width: r.width })
    }
  }, [variant])

  useEffect(() => {
    if (!open) { setPos(null); return }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place, q])

  useEffect(() => {
    const onDoc = (e) => {
      const inBox = boxRef.current && boxRef.current.contains(e.target)
      const inRes = resRef.current && resRef.current.contains(e.target)
      if (!inBox && !inRes) setOpen(false)
    }
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

  // نسخة الترويسة تعمل صحيحة داخل الشجرة (مُتحقَّق منها بالتتبّع) فتبقى كما هي.
  // نسخة الشريط الجانبي وحدها تُنقل إلى <body>. الحارس للتصيير على الخادم.
  const renderRes = node =>
    (variant === 'sidebar' && typeof document !== 'undefined')
      ? createPortal(node, document.body)
      : node

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

      {/* نسخة الشريط الجانبي لا تُصيَّر قبل حساب موضعها، وإلا ومضت إطاراً في مكان خاطئ */}
      {open && q.trim().length >= 2 && (variant !== 'sidebar' || pos) && renderRes(
        <div
          ref={resRef}
          className={variant === 'sidebar' ? 'sb-search-res sb-search-res-fixed' : 'ds-res'}
          style={variant === 'sidebar' && pos
            ? { top: pos.top, left: pos.left, width: pos.width }
            : undefined}
          role="listbox"
        >
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
