import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useAuth } from '../AuthContext'

export default function BookingTrendsChart() {
  const { profile } = useAuth()
  const [data, setData] = useState([])

  useEffect(() => {
    async function loadTrends() {
      if (!profile?.company_id) return
      const cid = profile.company_id
      const now = new Date()
      // Let's get the last 6 months
      const months = []
      const monthNames = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"]
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        months.push({
          date: d,
          monthStr: d.toISOString().slice(0, 7), // YYYY-MM
          name: monthNames[d.getMonth()] + ' ' + d.getFullYear(),
          bookings: 0
        })
      }

      const firstMonth = months[0].monthStr + '-01'

      const { data: bks } = await supabase.from('bookings')
        .select('created_at')
        .eq('company_id', cid)
        .gte('created_at', firstMonth)

      if (bks) {
        bks.forEach(b => {
          const mStr = b.created_at.slice(0, 7)
          const m = months.find(x => x.monthStr === mStr)
          if (m) m.bookings++
        })
      }
      
      setData(months)
    }
    loadTrends()
  }, [profile])

  return (
    <div className="panel" style={{ marginTop: 20 }}>
      <h3>اتجاهات الحجوزات الشهرية</h3>
      <div style={{ height: 300, width: '100%', marginTop: 20 }}>
        <ResponsiveContainer>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
            <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip 
              contentStyle={{ background: '#0F172A', border: '1px solid rgba(231,200,115,0.3)', borderRadius: 8, color: '#fff' }} 
              itemStyle={{ color: '#E7C873' }} 
              labelStyle={{ color: '#94a3b8', marginBottom: 4 }} 
            />
            <Bar dataKey="bookings" name="عدد الحجوزات" fill="#E7C873" radius={[4, 4, 0, 0]} barSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
