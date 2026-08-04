import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { SAR, CATS } from '../lib/helpers'

export default function PublicUnit({ slug }) {
  const [unit, setUnit] = useState(null)
  const [media, setMedia] = useState([])
  const [company, setCompany] = useState(null)
  const [status, setStatus] = useState('loading')
  const [hero, setHero] = useState(0)

  useEffect(() => {
    (async () => {
      // القراءة العامة تمرّ عبر دالة آمنة تأخذ الـ slug وتُرجع الوحدة
      // المطابقة فقط — لا وصول مباشر لجداول units/unit_media للزوار.
      const { data, error } = await supabase.rpc('public_unit_by_slug', { p_slug: slug })
      if (error || !data || !data.unit) { setStatus('missing'); return }
      setUnit(data.unit)
      setMedia(data.media || [])
      setCompany(data.company || null)
      setStatus('ready')
    })()
  }, [slug])

  if (status === 'loading') return <div className="pub-page"><p style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>جارٍ التحميل…</p></div>
  if (status === 'missing') return (
    <div className="pub-page">
      <div className="pub-head"><h1>الوحدة غير متاحة</h1></div>
      <div className="pub-info"><p>الرابط غير صالح أو تم إيقاف عرض هذه الوحدة.</p></div>
    </div>
  )

  const media0 = media[hero]
  const furniture = Array.isArray(unit.furniture_checklist) ? unit.furniture_checklist.filter(x => x.present) : []

  return (
    <div className="pub-page" dir="rtl">
      <div className="pub-head">
        <div>
          <h1>الوحدة {unit.unit_number} — {CATS[unit.category]}</h1>
          <div className="pub-brand">{company?.name || 'منصة المازن'} {unit.is_furnished ? ' · مفروشة بالكامل' : ' · فارغة'}</div>
        </div>
        {company?.logo_url && <img src={company.logo_url} alt="" style={{ width: 64, height: 64, borderRadius: 14, objectFit: 'cover', border: '2px solid var(--gold)' }} />}
      </div>

      {media0
        ? (media0.media_type === 'video'
          ? <video className="pub-hero" src={media0.url} controls />
          : <img className="pub-hero" src={media0.url} alt="" />)
        : <div className="pub-hero" style={{ display: 'grid', placeItems: 'center', color: 'var(--gold-l)', fontSize: 60 }}>🏠</div>}

      {media.length > 1 && (
        <div className="pub-gallery">
          {media.map((m, i) => (
            <button key={m.id} onClick={() => setHero(i)}
              style={{ padding: 0, border: i === hero ? '3px solid var(--gold)' : '3px solid transparent', borderRadius: 15, background: 'transparent', cursor: 'pointer' }}>
              {m.media_type === 'video'
                ? <video src={m.url} muted />
                : <img src={m.url} alt="" />}
            </button>
          ))}
        </div>
      )}

      <div className="pub-info">
        <h2>مواصفات الوحدة</h2>
        {unit.description && <p style={{ color: 'var(--muted)', marginBottom: 14 }}>{unit.description}</p>}

        <div className="pub-price-row">
          {unit.daily_price && <div className="pub-price"><b>{SAR(unit.daily_price)}</b><small>السعر اليومي</small></div>}
          {unit.monthly_price && <div className="pub-price"><b>{SAR(unit.monthly_price)}</b><small>السعر الشهري</small></div>}
          {unit.yearly_price && <div className="pub-price"><b>{SAR(unit.yearly_price)}</b><small>السعر السنوي</small></div>}
          {unit.bedrooms && <div className="pub-price"><b>{unit.bedrooms}</b><small>غرف نوم</small></div>}
          {unit.bathrooms && <div className="pub-price"><b>{unit.bathrooms}</b><small>حمّامات</small></div>}
        </div>

        {furniture.length > 0 && (
          <>
            <h2>الأثاث والمحتويات ({furniture.length} عنصر)</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 6, marginBottom: 16 }}>
              {furniture.map((it, i) => (
                <div key={i} style={{ padding: '7px 10px', background: 'var(--soft)', borderRadius: 8, fontSize: 13 }}>
                  ✓ <b>{it.name}</b>{it.note && <em style={{ color: 'var(--muted)', fontStyle: 'normal', fontSize: 11.5, marginInlineStart: 4 }}>({it.note})</em>}
                </div>
              ))}
            </div>
          </>
        )}

        {company?.phone && (
          <a className="pub-cta" href={`https://wa.me/${company.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">
            💬 تواصل معنا للحجز
          </a>
        )}
      </div>

      <p style={{ textAlign: 'center', marginTop: 30, color: 'var(--muted)', fontSize: 12 }}>
        هذه الصفحة مقدَّمة من منصة المازن لإدارة الوحدات السكنية
      </p>
    </div>
  )
}
