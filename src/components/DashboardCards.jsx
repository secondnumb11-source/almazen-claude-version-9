import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { today, SAR } from '../lib/helpers'

export function TodayRentalsCard({ companyId }) {
  const [rentals, setRentals] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!companyId) return
    ;(async () => {
      try {
        const { data, error } = await supabase.from('bookings')
          .select(`id, check_in_date, unit_id, units(unit_number), customers(full_name), base_price`)
          .eq('company_id', companyId)
          .eq('check_in_date', today())
          .in('status', ['confirmed', 'checked_in'])
        if (error) console.error('Rentals fetch error:', error)
        setRentals(data || [])
      } catch (err) {
        console.error('Rentals load error:', err)
      }
      setLoading(false)
    })()
  }, [companyId])

  return (
    <div className="panel" style={{ flex: 1, minWidth: 300 }}>
      <h3>🛬 الوحدات المؤجرة اليوم</h3>
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>جارٍ التحميل…</div>
      ) : rentals.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>لا توجد حجوزات اليوم</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rentals.map(r => (
            <div key={r.id} style={{
              padding: 12,
              background: 'var(--bg-secondary)',
              borderRadius: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                  وحدة {r.units?.unit_number}
                </div>
                <div style={{ fontSize: 14, color: 'var(--muted)' }}>
                  {r.customers?.full_name}
                </div>
              </div>
              <div style={{ textAlign: 'left', color: 'var(--green)' }}>
                {SAR(r.base_price)}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)', textAlign: 'center', fontWeight: 'bold' }}>
        إجمالي: {rentals.length} حجز
      </div>
    </div>
  )
}

export function TodayCheckoutsCard({ companyId }) {
  const [checkouts, setCheckouts] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!companyId) return
    ;(async () => {
      try {
        const { data, error } = await supabase.from('bookings')
          .select(`id, check_out_date, unit_id, units(unit_number), customers(full_name), base_price`)
          .eq('company_id', companyId)
          .eq('check_out_date', today())
          .in('status', ['confirmed', 'checked_in'])
        if (error) console.error('Checkouts fetch error:', error)
        setCheckouts(data || [])
      } catch (err) {
        console.error('Checkouts load error:', err)
      }
      setLoading(false)
    })()
  }, [companyId])

  return (
    <div className="panel" style={{ flex: 1, minWidth: 300 }}>
      <h3>🛫 الوحدات المسلمة اليوم (المغادرون)</h3>
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>جارٍ التحميل…</div>
      ) : checkouts.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>لا توجد مغادرات اليوم</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {checkouts.map(c => (
            <div key={c.id} style={{
              padding: 12,
              background: 'var(--bg-secondary)',
              borderRadius: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                  وحدة {c.units?.unit_number}
                </div>
                <div style={{ fontSize: 14, color: 'var(--muted)' }}>
                  {c.customers?.full_name}
                </div>
              </div>
              <div style={{ textAlign: 'left', color: 'var(--orange)' }}>
                {SAR(c.base_price)}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)', textAlign: 'center', fontWeight: 'bold' }}>
        إجمالي: {checkouts.length} مغادر
      </div>
    </div>
  )
}

export function UpcomingRentDueCard({ companyId }) {
  const [dues, setDues] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!companyId) return
    ;(async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase.from('bookings')
          .select(`id, check_out_date, total_amount, paid, units(unit_number), customers(full_name, phone)`)
          .eq('company_id', companyId)
          .in('status', ['confirmed', 'checked_in'])
        
        if (!error && data) {
          const nowStr = today()
          const pending = data.filter(b => {
            const rem = (b.total_amount || 0) - (b.paid || 0)
            return rem > 0 || (b.check_out_date && b.check_out_date <= nowStr)
          })
          setDues(pending)
        }
      } catch (err) {
        console.error('Rent dues load error:', err)
      } finally {
        setLoading(false)
      }
    })()
  }, [companyId])

  return (
    <div className="panel" style={{ flex: 1, minWidth: 300, border: dues.length > 0 ? '1.5px solid #F59E0B' : '1px solid var(--border)' }}>
      <h3>⏰ إشعارات استحقاق الإيجارات والتحصيل</h3>
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>جارٍ التحميل…</div>
      ) : dues.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>جميع الحجوزات والإيجارات محدثة ومسددة بالكامل ✅</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {dues.map(d => {
            const rem = (d.total_amount || 0) - (d.paid || 0)
            return (
              <div key={d.id} style={{
                padding: 10,
                background: 'var(--bg-secondary)',
                borderRadius: 8,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderRight: '4px solid #EF4444'
              }}>
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: 13 }}>
                    وحدة {d.units?.unit_number} — {d.customers?.full_name || 'مستأجر'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    موعد الاستحقاق: {d.check_out_date} | جوال: {d.customers?.phone || '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ color: '#EF4444', fontWeight: 'bold', fontSize: 13 }}>
                    {SAR(rem)}
                  </div>
                  <span style={{ fontSize: 10, background: '#FEE2E2', color: '#991B1B', padding: '1px 6px', borderRadius: 4 }}>
                    مطلوب سدادها
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)', textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>
        إجمالي الاستحقاقات القائمة: <b>{dues.length} دفعة / وحدة</b>
      </div>
    </div>
  )
}

