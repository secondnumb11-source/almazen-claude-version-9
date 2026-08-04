import React, { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { today } from '../lib/helpers'

const COLORS = ['#8b7355', '#EAB308', '#2563EB', '#10B981', '#F43F5E', '#8B5CF6'];

export default function BookingSourcePieChart() {
  const { profile } = useAuth()
  const [data, setData] = useState([])

  useEffect(() => {
    (async () => {
      if (!profile?.company_id) return
      const first = today().slice(0, 8) + '01'
      const { data: bks } = await supabase.from('bookings')
        .select('booking_source')
        .eq('company_id', profile.company_id)
        .gte('created_at', first)
      
      const counts = {}
      for (const b of bks || []) {
        const source = b.booking_source || 'direct'
        counts[source] = (counts[source] || 0) + 1
      }
      
      const chartData = Object.entries(counts).map(([name, value]) => ({
        name: name === 'direct' ? 'مباشر (Direct)' : name,
        value
      })).sort((a,b) => b.value - a.value)
      
      setData(chartData)
    })()
  }, [profile])

  if (!data.length) return null

  return (
    <div className="panel" style={{ height: 350, display: 'flex', flexDirection: 'column' }}>
      <h3 style={{ marginBottom: 16 }}>🎯 مصادر الحجوزات (هذا الشهر)</h3>
      <div style={{ flex: 1 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={5}
              dataKey="value"
              label={({name, percent}) => `${name} (${(percent * 100).toFixed(0)}%)`}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
