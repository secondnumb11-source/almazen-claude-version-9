import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

export default function OccupancyForecastChart() {
  const { profile } = useAuth()
  const [data, setData] = useState([])
  
  useEffect(() => {
    // Generate some mock historical + forecast data for the next 3 months
    // In a real app, you would fetch bookings and use an ML/trend model
    const generateData = () => {
      const d = new Date()
      d.setMonth(d.getMonth() - 5)
      const res = []
      const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
      
      let base = 60
      for(let i=0; i<9; i++) {
        const isForecast = i >= 6;
        base = base + (Math.random() * 10 - 3)
        if (base > 95) base = 95
        if (base < 30) base = 30
        
        res.push({
          name: monthNames[d.getMonth()],
          actual: isForecast ? null : Math.round(base),
          forecast: isForecast ? Math.round(base) : null,
          isForecast
        })
        d.setMonth(d.getMonth() + 1)
      }
      
      // Connect the lines
      if (res[5] && res[6]) {
         res[5].forecast = res[5].actual;
      }
      setData(res)
    }
    generateData()
  }, [profile.company_id])

  return (
    <div className="panel" style={{ gridColumn: 'span 2' }}>
      <h3>📈 توقعات الإشغال (Occupancy Forecast)</h3>
      <div className="desc" style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>توقعات معدلات الإشغال للأشهر الثلاثة القادمة بناءً على البيانات التاريخية</div>
      <div style={{ height: 300, width: '100%' }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#1B9E5A" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#1B9E5A" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#C6A24B" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#C6A24B" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => v + '%'} />
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
            <Tooltip contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
            <Legend />
            <Area type="monotone" name="فعلي" dataKey="actual" stroke="#1B9E5A" fillOpacity={1} fill="url(#colorActual)" />
            <Area type="monotone" name="متوقع" dataKey="forecast" stroke="#C6A24B" strokeDasharray="5 5" fillOpacity={1} fill="url(#colorForecast)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
