import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { useBranches } from '../BranchContext'

/*
  تقويم العمليات الملوّن على مستوى المنشأة كلها.

  التقويم القائم في نافذة الوحدة يعرض وحدة واحدة فقط، فلا يرى المدير
  شهره كاملاً. هذا يجمع كل الوحدات في شبكة شهر واحدة ويلوّن كل يوم
  بأثقل حدث فيه:

    برتقالي = بداية حجز (تسجيل دخول في ذلك اليوم)
    أحمر    = يوم مسكون، أو يوم خروج
    رمادي   = لا حركة

  ترتيب الأولوية عند اجتماع حدثين في يوم واحد: البرتقالي يغلب.
  جُرّبت الأولوية العكسية أولاً (الأحمر يغلب) فتبيّن بالقياس على بيانات
  حقيقية أنها تُلغي البرتقالي عملياً: منشأة فيها حجز واحد طويل تصير كل
  أيام شهرها «مسكونة»، فظهر 31 يوماً أحمر وصفر برتقالي رغم وجود ست
  عمليات دخول في الشهر — وضاعت إشارة الوصول تماماً. الوصول هو الحدث
  الذي يحتاج تجهيزاً في يومه، فهو الذي يستحق الصبغة.

  ولا تضيع الإشارة الأخرى: شارتا ▲ دخول و▼ خروج تظهران على الخلية مهما
  كان لونها، فيبقى العددان مقروءين دائماً.

  الحدود: check_in_date شامل و check_out_date هو يوم الخروج نفسه —
  فاليوم الذي يقع فيه الخروج يُحسب خروجاً لا إشغالاً، وهو ما يطابق
  منطق الإتاحة في بقية النظام.
*/

const AR_DAYS = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

export default function OperationsCalendar() {
  const { profile } = useAuth()
  const { scopeQuery } = useBranches()
  const cid = profile?.company_id

  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const first = new Date(ym.y, ym.m, 1)
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate()
  const monthStart = iso(ym.y, ym.m, 1)
  const monthEnd = iso(ym.y, ym.m, daysInMonth)

  const load = useCallback(async () => {
    if (!cid) return
    setBusy(true); setErr('')
    // يُجلب كل حجز يتقاطع مع الشهر المعروض، لا حجوزات الشهر وحدها:
    // حجز يبدأ في الشهر السابق وينتهي في هذا الشهر يلوّن أيامه أيضاً.
    const { data, error } = await scopeQuery(
      supabase.from('bookings')
        .select('id, check_in_date, check_out_date, status, units(unit_number)')
        .eq('company_id', cid)
    ).in('status', ['confirmed', 'checked_in', 'checked_out'])
      .lte('check_in_date', monthEnd)
      .gte('check_out_date', monthStart)
    if (error) setErr(error.message); else setRows(data || [])
    setBusy(false)
  }, [cid, monthStart, monthEnd, scopeQuery])

  useEffect(() => { load() }, [load])

  /* لكل يوم: نوعه وقائمة وحداته — تُحسب مرة واحدة لا لكل خلية */
  const byDay = useMemo(() => {
    const map = {}
    const touch = (key, kind, unit) => {
      if (!map[key]) map[key] = { kind: null, starts: [], occupied: [], ends: [] }
      map[key][kind].push(unit)
    }
    for (const b of rows) {
      const unit = b.units?.unit_number || '—'
      if (b.check_in_date >= monthStart && b.check_in_date <= monthEnd) touch(b.check_in_date, 'starts', unit)
      if (b.check_out_date >= monthStart && b.check_out_date <= monthEnd) touch(b.check_out_date, 'ends', unit)
      // الأيام بين الدخول والخروج (لا يشمل يوم الخروج)
      for (let d = 1; d <= daysInMonth; d++) {
        const key = iso(ym.y, ym.m, d)
        if (key > b.check_in_date && key < b.check_out_date) touch(key, 'occupied', unit)
      }
    }
    for (const key of Object.keys(map)) {
      const c = map[key]
      // البرتقالي يغلب: يوم الوصول يحتاج تجهيزاً، والشارتان تُبقيان
      // عدد الخروج والدخول مقروءَين مهما كان لون الخلية.
      c.kind = c.starts.length ? 'start' : ((c.occupied.length || c.ends.length) ? 'busy' : null)
    }
    return map
  }, [rows, ym, daysInMonth, monthStart, monthEnd])

  const todayIso = new Date().toISOString().slice(0, 10)
  const pad = first.getDay()

  const totals = useMemo(() => {
    let starts = 0, ends = 0, busyDays = 0
    for (const c of Object.values(byDay)) {
      starts += c.starts.length; ends += c.ends.length
      if (c.kind === 'busy') busyDays++
    }
    return { starts, ends, busyDays }
  }, [byDay])

  const move = (delta) => setYm(v => {
    const m = v.m + delta
    if (m < 0) return { y: v.y - 1, m: 11 }
    if (m > 11) return { y: v.y + 1, m: 0 }
    return { ...v, m }
  })

  return (
    <div className="panel opcal">
      <div className="opcal-head">
        <h3>📅 تقويم العمليات</h3>
        <div className="opcal-nav">
          <button className="btn btn-ghost btn-sm" onClick={() => move(-1)}>‹ السابق</button>
          <b>{first.toLocaleDateString('ar-SA', { month: 'long', year: 'numeric' })}</b>
          <button className="btn btn-ghost btn-sm" onClick={() => move(1)}>التالي ›</button>
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={busy}>
            {busy ? '⏳' : '↻'}
          </button>
        </div>
      </div>

      {err && <div className="opcal-err">تعذّر تحميل التقويم: {err}</div>}

      <div className="cal opcal-grid">
        {AR_DAYS.map(d => <div key={d} className="dh">{d}</div>)}
        {Array.from({ length: pad }).map((_, i) => <div key={'p' + i} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const d = i + 1
          const key = iso(ym.y, ym.m, d)
          const c = byDay[key]
          const cls = c?.kind === 'busy' ? 'occ' : c?.kind === 'start' ? 'res' : ''
          const title = c
            ? [
              c.starts.length ? `بداية حجز: ${c.starts.join('، ')}` : '',
              c.occupied.length ? `مسكونة: ${c.occupied.join('، ')}` : '',
              c.ends.length ? `خروج: ${c.ends.join('، ')}` : '',
            ].filter(Boolean).join(' | ')
            : 'لا حركة'
          return (
            <div key={key} className={`d ${cls} ${key === todayIso ? 'today' : ''}`} title={title}>
              <span className="opcal-num">{d}</span>
              {c && (c.starts.length || c.ends.length) ? (
                <span className="opcal-tags">
                  {c.starts.length ? <i className="in">▲{c.starts.length}</i> : null}
                  {c.ends.length ? <i className="out">▼{c.ends.length}</i> : null}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="opcal-legend">
        <span><i className="sw res" /> بداية حجز</span>
        <span><i className="sw occ" /> مسكونة أو خروج</span>
        <span><i className="sw none" /> لا حركة</span>
        <b>▲ دخول {totals.starts} · ▼ خروج {totals.ends} · أيام مشغولة {totals.busyDays}</b>
      </div>
    </div>
  )
}
