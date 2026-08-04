import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { useBranches } from '../BranchContext'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
                'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

/**
 * توقعات الإشغال — مبنية على بيانات حقيقية.
 *
 * كانت النسخة السابقة تُولّد أرقاماً عشوائية بـ Math.random() وتعرضها
 * كأنها إشغال فعلي وتوقّع — رقم مختلف في كل تحميل، وقرار إداري مبني
 * على وهم. أُعيدت كتابتها لتقيس الإشغال الفعلي من الحجوزات.
 *
 * الطريقة: لكل شهر، نسبة الإشغال = مجموع ليالي الحجوزات المتقاطعة مع
 * الشهر ÷ (عدد الوحدات × أيام الشهر). الأشهر الماضية "فعلي"، والقادمة
 * "محجوز مسبقاً" — وهي حجوزات مؤكدة لا تنبؤ إحصائي، ويُصرَّح بذلك للمستخدم.
 */
export default function OccupancyForecastChart() {
  const { profile } = useAuth()
  const { activeBranch, scopeQuery } = useBranches()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const companyId = profile?.company_id
    if (!companyId) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      const now = new Date()
      const from = new Date(now.getFullYear(), now.getMonth() - 5, 1)
      const to = new Date(now.getFullYear(), now.getMonth() + 4, 0)

      const [{ count: unitCount }, { data: bookings }] = await Promise.all([
        scopeQuery(
          supabase.from('units').select('id', { count: 'exact', head: true })
            .eq('company_id', companyId).eq('is_active', true)
        ),
        scopeQuery(
          supabase.from('bookings')
            .select('check_in_date, check_out_date, status')
            .eq('company_id', companyId)
        )
          .neq('status', 'cancelled')
          .lte('check_in_date', to.toISOString().slice(0, 10))
          .gte('check_out_date', from.toISOString().slice(0, 10)),
      ])

      if (cancelled) return
      const units = unitCount || 0
      const rows = []

      for (let i = 0; i < 9; i++) {
        const mStart = new Date(from.getFullYear(), from.getMonth() + i, 1)
        const mEnd = new Date(from.getFullYear(), from.getMonth() + i + 1, 0)
        const daysInMonth = mEnd.getDate()
        const isFuture = mStart > now

        let nights = 0
        for (const b of bookings || []) {
          if (!b.check_in_date || !b.check_out_date) continue
          const s = new Date(b.check_in_date) > mStart ? new Date(b.check_in_date) : mStart
          const e = new Date(b.check_out_date) < mEnd ? new Date(b.check_out_date) : mEnd
          const d = Math.floor((e - s) / 86400000) + 1
          if (d > 0) nights += d
        }

        const capacity = units * daysInMonth
        const pct = capacity > 0 ? Math.min(100, Math.round((nights / capacity) * 100)) : 0

        rows.push({
          name: MONTHS[mStart.getMonth()],
          actual: isFuture ? null : pct,
          booked: isFuture ? pct : null,
        })
      }

      // وصل الخط بين الفعلي والمحجوز حتى لا تظهر فجوة
      const lastActual = [...rows].reverse().find(r => r.actual !== null)
      const firstFutureIdx = rows.findIndex(r => r.booked !== null)
      if (lastActual && firstFutureIdx > 0) rows[firstFutureIdx - 1].booked = rows[firstFutureIdx - 1].actual

      setData(rows)
      setLoading(false)
    }

    load().catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [profile?.company_id, activeBranch, scopeQuery])

  return (
    <div className="panel" style={{ gridColumn: 'span 2' }}>
      <h3>📈 الإشغال الفعلي والمحجوز مسبقاً</h3>
      <div className="desc" style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
        محسوب من حجوزاتك الفعلية: ليالي الإشغال ÷ (عدد الوحدات × أيام الشهر).
        الأشهر القادمة تعرض <b>الحجوزات المؤكدة مسبقاً</b> لا تنبؤاً إحصائياً.
      </div>
      <div style={{ height: 300, width: '100%' }}>
        {loading ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--muted)', fontSize: 13 }}>
            جارٍ حساب الإشغال…
          </div>
        ) : (
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1B9E5A" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#1B9E5A" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#C6A24B" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#C6A24B" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => v + '%'} domain={[0, 100]} />
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
              <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                       formatter={v => v === null ? '—' : v + '%'} />
              <Legend />
              <Area type="monotone" name="فعلي" dataKey="actual" stroke="#1B9E5A" fillOpacity={1} fill="url(#colorActual)" />
              <Area type="monotone" name="محجوز مسبقاً" dataKey="booked" stroke="#C6A24B" strokeDasharray="5 5" fillOpacity={1} fill="url(#colorForecast)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
