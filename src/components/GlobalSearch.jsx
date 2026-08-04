import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { CATS, STATUS } from '../lib/helpers'

const COMMON_QUERIES = ['شاغرة', 'صيانة', 'مؤجرة', 'تنظيف', 'متأخرات', 'عقد إلكتروني']

export default function GlobalSearch({ setPage }) {
  const { profile } = useAuth()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const wrapperRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [wrapperRef])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setSuggestions(COMMON_QUERIES)
      return
    }
    
    // Auto-complete predictive queries logic
    const predictive = COMMON_QUERIES.filter(q => q.startsWith(query) && q !== query);
    setSuggestions(predictive)

    const timer = setTimeout(async () => {
      setLoading(true)
      const { data: units } = await supabase
        .from('units')
        .select('*, bookings!left(*, customers(full_name))')
        .eq('company_id', profile.company_id)
      
      if (units) {
        const filtered = units.filter(u => {
          const q = query.toLowerCase()
          if (u.unit_number?.toLowerCase().includes(q)) return true
          const statusLabel = STATUS[u.status]?.label || u.status
          if (statusLabel.toLowerCase().includes(q)) return true
          
          const activeBk = u.bookings?.find(b => ['confirmed', 'checked_in', 'reserved_online'].includes(b.status))
          if (activeBk && activeBk.customers?.full_name?.toLowerCase().includes(q)) return true
          if (activeBk && activeBk.guest_name?.toLowerCase().includes(q)) return true
          
          return false
        }).slice(0, 5) 
        
        setResults(filtered)
      }
      setLoading(false)
      setIsOpen(true)
    }, 300)
    return () => clearTimeout(timer)
  }, [query, profile.company_id])

  return (
    <div ref={wrapperRef} className="glob-search-wrap" style={{ position: 'relative' }}>
      <input 
        type="text" 
        className="inp glob-search-input" 
        placeholder="🔍 ابحث عن وحدة، ساكن، أو حالة..." 
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setIsOpen(true)}
      />
      
      {isOpen && (
        <div className="glob-search-popover">
          
          {query.trim().length === 0 && (
            <div style={{ padding: '8px 16px' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 'bold' }}>اقتراحات شائعة</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {COMMON_QUERIES.map(q => (
                  <button 
                    key={q} 
                    className="chip" 
                    style={{ background: 'var(--soft)', border: 'none', cursor: 'pointer', color: 'var(--blue)' }}
                    onClick={() => setQuery(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {query.trim().length > 0 && suggestions.length > 0 && (
            <div style={{ padding: '4px 16px', background: 'var(--soft)' }}>
              {suggestions.map(s => (
                <div 
                  key={s} 
                  style={{ fontSize: 13, color: 'var(--blue-2)', cursor: 'pointer', padding: '4px 0' }}
                  onClick={() => setQuery(s)}
                >
                  <span style={{ color: 'var(--muted)' }}>هل تقصد: </span> <b>{s}</b>
                </div>
              ))}
            </div>
          )}

          {query.trim().length > 0 && loading ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>جارٍ البحث...</div>
          ) : query.trim().length > 0 && results.length > 0 ? (
            results.map(u => {
              const activeBk = u.bookings?.find(b => ['confirmed', 'checked_in', 'reserved_online'].includes(b.status))
              const occupant = activeBk ? (activeBk.customers?.full_name || activeBk.guest_name) : null
              return (
                <div key={u.id} style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', cursor: 'pointer', transition: 'background 0.2s' }}
                     onClick={() => {
                        setIsOpen(false)
                        setQuery('')
                        window.location.href = `/?unit_id=${u.id}`
                     }}
                     onMouseEnter={(e) => e.currentTarget.style.background = '#f9fafb'}
                     onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <b style={{ color: 'var(--blue)' }}>وحدة {u.unit_number}</b>
                    <span className="chip" style={{ fontSize: 10, background: STATUS[u.status]?.bg || '#eee', color: STATUS[u.status]?.color || '#000' }}>
                      {STATUS[u.status]?.label || u.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', gap: 8 }}>
                    <span>{CATS[u.category] || u.category}</span>
                    {occupant && <span>• 👤 {occupant}</span>}
                  </div>
                </div>
              )
            })
          ) : (query.trim().length > 0 && !loading && (
             <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>لا توجد نتائج مطابقة</div>
          ))}
        </div>
      )}
    </div>
  )
}
