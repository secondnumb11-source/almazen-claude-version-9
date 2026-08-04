import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'

export default function RecentActivity({ collapsed }) {
  const { profile, canFinance } = useAuth()
  const [logs, setLogs] = useState([])

  useEffect(() => {
    if (!profile) return
    const load = async () => {
      let q = supabase.from('audit_logs')
        .select('*, profiles(full_name)')
        .eq('company_id', profile.company_id)
        .order('created_at', { ascending: false })
        
      if (!canFinance) {
        q = q.eq('is_sensitive', false)
      }
      
      const { data } = await q.limit(5)
      setLogs(data || [])
    }
    load()
    const ch = supabase.channel(`audit-feed:${profile.company_id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs', filter: `company_id=eq.${profile.company_id}` }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [profile, canFinance])

  if (collapsed) return null

  return (
    <div style={{ padding: '0 12px 16px' }}>
      <div style={{ fontSize: 11, fontWeight: 'bold', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, padding: '0 4px' }}>
        أحدث النشاطات
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {logs.length === 0 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', padding: '0 4px' }}>لا يوجد نشاط</div>}
        {logs.map(log => (
          <div key={log.id} style={{ fontSize: 11, background: 'rgba(255,255,255,0.05)', padding: '6px 8px', borderRadius: 6, lineHeight: 1.4 }}>
            <div style={{ color: 'var(--gold)', marginBottom: 2 }}>{log.profiles?.full_name || 'النظام'}</div>
            <div style={{ color: 'rgba(255,255,255,0.7)' }}>{log.summary}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
