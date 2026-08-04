import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function ChannexUnitDetailsModal({ unit, profile, toast, onClose, onSaved }) {
  const [f, setF] = useState({
    daily_price: unit.daily_price || '',
    monthly_price: unit.monthly_price || '',
    description: unit.description || '',
    features: Array.isArray(unit.features) ? unit.features : [],
  })
  const [media, setMedia] = useState([])
  const [busy, setBusy] = useState(false)
  const [loadingMedia, setLoadingMedia] = useState(true)
  
  // Basic features checklist based on global OTA requirements
  const otaFeatures = [
    'تكييف', 'واي فاي مجاني', 'مطبخ صغير', 'شاشة مسطحة', 'مكتب عمل', 'شرفة', 'حمام خاص', 'مستلزمات استحمام مجانية', 'ماكينة قهوة'
  ]

  const [activeBooking, setActiveBooking] = useState(null)

  useEffect(() => {
    // Load full unit data in case some are missing in the prop
    const loadDetails = async () => {
      const { data } = await supabase.from('units').select('description, features').eq('id', unit.id).single()
      if (data) {
        setF(x => ({
          ...x,
          description: data.description || '',
          features: Array.isArray(data.features) ? data.features : [],
        }))
      }
      
      const { data: mediaData } = await supabase.from('unit_media')
        .select('*').eq('unit_id', unit.id).order('sort_order')
      setMedia(mediaData || [])
      setLoadingMedia(false)

      // Fetch active booking if available
      const { data: bks } = await supabase.from('bookings')
        .select('*, customers(full_name, phone)')
        .eq('unit_id', unit.id)
        .order('check_in_date', { ascending: false })
        .limit(1)
      if (bks && bks.length > 0) setActiveBooking(bks[0])
    }
    loadDetails()
  }, [unit.id])

  const toggleFeature = (feat) => {
    setF(x => {
      const isThere = x.features.includes(feat)
      return {
        ...x,
        features: isThere ? x.features.filter(f => f !== feat) : [...x.features, feat]
      }
    })
  }

  const handleUploadPhoto = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    const ext = file.name.split('.').pop()
    const path = `unit_${unit.id}_${Date.now()}.${ext}`
    
    // upload to 'unit-media' bucket
    const { error: upErr } = await supabase.storage.from('unit-media').upload(path, file)
    if (upErr) {
      setBusy(false)
      return toast('تعذّر رفع الصورة: ' + upErr.message, true)
    }
    
    const { data: pubData } = supabase.storage.from('unit-media').getPublicUrl(path)
    const url = pubData.publicUrl
    
    const { data: inserted, error: dbErr } = await supabase.from('unit_media').insert({
      company_id: profile.company_id,
      unit_id: unit.id,
      media_type: 'image',
      url: url,
      sort_order: media.length,
    }).select().single()
    
    setBusy(false)
    if (dbErr) return toast('خطأ في حفظ الصورة: ' + dbErr.message, true)
    
    setMedia(m => [...m, inserted])
    toast('تمت إضافة الصورة بنجاح')
  }

  const handleDeletePhoto = async (id, url) => {
    setBusy(true)
    await supabase.from('unit_media').delete().eq('id', id)
    // Optionally delete from storage but fine for now
    setMedia(m => m.filter(x => x.id !== id))
    setBusy(false)
    toast('تم حذف الصورة')
  }

  const save = async () => {
    setBusy(true)
    const row = {
      daily_price: f.daily_price || null,
      monthly_price: f.monthly_price || null,
      description: f.description || null,
      features: f.features,
    }
    const { error } = await supabase.from('units').update(row).eq('id', unit.id)
    setBusy(false)
    if (error) return toast('خطأ في الحفظ: ' + error.message, true)
    toast('✓ تم حفظ تفاصيل الوحدة')
    onSaved()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target.className === 'modal-overlay' && onClose()}>
      <div className="modal" style={{ maxWidth: 600 }}>
        <h3>تعديل تفاصيل الوحدة للمنصات (الوحدة {unit.unit_number})</h3>
        
        <div className="grid2" style={{ marginTop: 16 }}>
          <div className="fld">
            <label>السعر اليومي (ر.س)</label>
            <input type="number" value={f.daily_price} onChange={e => setF({...f, daily_price: e.target.value})} />
          </div>
          <div className="fld">
            <label>السعر الشهري (ر.س)</label>
            <input type="number" value={f.monthly_price} onChange={e => setF({...f, monthly_price: e.target.value})} />
          </div>
        </div>
        
        <div className="fld">
          <label>وصف الوحدة (يظهر في Booking وغيرها)</label>
          <textarea rows={3} value={f.description} onChange={e => setF({...f, description: e.target.value})} placeholder="وصف جذاب وتفصيلي للوحدة..."></textarea>
        </div>

        <div className="fld">
          <label>المزايا والأثاث (Features & Amenities)</label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {otaFeatures.map(feat => (
              <label key={feat} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', background: 'var(--soft)', padding: '6px 12px', borderRadius: 20, fontSize: 13 }}>
                <input type="checkbox" checked={f.features.includes(feat)} onChange={() => toggleFeature(feat)} style={{ margin: 0, width: 'auto' }} />
                {feat}
              </label>
            ))}
          </div>
        </div>

        <div className="fld">
          <label>صور الغرفة (ضرورية لمنصات الحجز)</label>
          {loadingMedia ? (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>جارٍ التحميل...</div>
          ) : (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {media.map(m => (
                <div key={m.id} style={{ position: 'relative', width: 80, height: 80, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <button type="button" onClick={() => handleDeletePhoto(m.id, m.url)} style={{ position: 'absolute', top: 2, left: 2, background: 'rgba(255,0,0,0.8)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
              ))}
              <label style={{ width: 80, height: 80, borderRadius: 8, border: '2px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 24, color: 'var(--muted)' }}>+</span>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUploadPhoto} disabled={busy} />
              </label>
            </div>
          )}
        </div>

        {activeBooking && (
          <div style={{ background: 'linear-gradient(135deg, rgba(236,72,153,0.08), rgba(219,39,119,0.05))', borderRadius: 12, padding: 12, marginTop: 14, border: '1px solid rgba(236,72,153,0.3)' }}>
            <div style={{ fontWeight: 'bold', fontSize: 13, color: '#db2777', marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>🌐 آخر حجز إلكتروني مسجّل على هذه الوحدة</span>
              <span className="chip" style={{ background: '#ec4899', color: '#fff', fontSize: 11 }}>
                {activeBooking.booking_source || 'Booking.com (Channex)'}
              </span>
            </div>
            <div style={{ fontSize: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div><b>الضيف:</b> {activeBooking.customers?.full_name || '—'}</div>
              <div><b>الهاتف:</b> {activeBooking.customers?.phone || '—'}</div>
              <div><b>تاريخ الوصول:</b> {activeBooking.check_in_date}</div>
              <div><b>تاريخ المغادرة:</b> {activeBooking.check_out_date}</div>
              <div><b>السعر الأساسي:</b> {activeBooking.base_price ? `${activeBooking.base_price} ر.س` : `${activeBooking.total_amount} ر.س`}</div>
              <div><b>نسبة الخصم المحاسبية:</b> <span style={{ color: '#db2777', fontWeight: 'bold' }}>{activeBooking.discount_percent || 0}% ({activeBooking.discount_amount || 0} ر.س)</span></div>
              <div style={{ gridColumn: '1 / -1', fontWeight: 'bold', color: 'var(--green)', borderTop: '1px dashed rgba(236,72,153,0.3)', paddingTop: 4, marginTop: 4 }}>
                💰 صافي الإيراد المحول للحسابات: {activeBooking.total_amount} ر.س
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>إلغاء</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? '...جاري الحفظ' : 'حفظ التعديلات'}
          </button>
        </div>
      </div>
    </div>
  )
}
