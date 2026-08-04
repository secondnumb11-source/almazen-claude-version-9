import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { SAR, logActivity } from '../lib/helpers'

/* لوحة موافقات الخصم للمدير/المحاسب — تُدرج في Reports وفي Home */
export default function DiscountApprovals() {
  const { profile, canFinance, toast } = useAuth()
  const [rows, setRows] = useState([])

  const load = useCallback(async () => {
    const { data } = await supabase.from('discount_requests')
      .select('*, bookings(check_in_date,check_out_date,total_amount, units(unit_number), customers(full_name,phone)), profiles!discount_requests_requested_by_fkey(full_name)')
      .eq('company_id', profile.company_id).order('created_at', { ascending: false }).limit(50)
    setRows(data || [])
  }, [profile])

  useEffect(() => { load() }, [load])

  const decide = async (r, status) => {
    const note = status === 'approved' ? '' : prompt('سبب الرفض (اختياري):', '') || ''
    const { error } = await supabase.rpc('decide_discount_request', {
      p_request_id: r.id, p_approve: status === 'approved', p_note: note
    })
    if (error) return toast('خطأ: ' + error.message, true)
    await logActivity(supabase, profile, {
      action: 'discount', entity: 'discount_requests', entity_id: r.id,
      summary: `${status === 'approved' ? 'موافقة على' : 'رفض'} خصم ${r.reason_type === 'points' ? r.points_used + ' نقطة' : r.percent + '%'} (${r.amount || 0} ر.س) للوحدة ${r.bookings?.units?.unit_number || '—'}`,
      sensitive: true
    })
    toast(status === 'approved' ? '✓ تمت الموافقة — تحدّثت الحسابات تلقائياً' : 'تم رفض الطلب')
    load()
  }

  if (!canFinance) return null
  const pending = rows.filter(r => r.status === 'pending')

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <h3>موافقات الخصم (طلبات الموظفين على خصم &gt; 20%) {pending.length > 0 && <span className="chip" style={{ background:'#FDECEC', color:'var(--st-oc)' }}>{pending.length} معلّق</span>}</h3>
      {rows.length === 0 ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>لا توجد طلبات خصم بعد</p> :
        <table className="tbl">
          <thead><tr><th>التاريخ</th><th>الوحدة</th><th>المستأجر</th><th>مقدّم الطلب</th><th>%</th><th>القيمة</th><th>السبب</th><th>الحالة</th><th></th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{new Date(r.created_at).toLocaleString('ar-SA', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</td>
                <td>{r.bookings?.units?.unit_number || '—'}</td>
                <td>{r.bookings?.customers?.full_name || '—'}</td>
                <td>{r.profiles?.full_name || '—'}</td>
                <td><b>{r.percent}%</b></td>
                <td className="neg">{SAR(r.amount || 0)}</td>
                <td style={{ fontSize: 12 }}>{r.reason || '—'}</td>
                <td>
                  {r.status === 'pending' && <span className="chip" style={{ background:'#FFF4E3', color:'var(--st-rs)' }}>معلّق</span>}
                  {r.status === 'approved' && <span className="chip" style={{ background:'#E7F5EC', color:'var(--green)' }}>موافَق</span>}
                  {r.status === 'rejected' && <span className="chip" style={{ background:'#FDECEC', color:'var(--st-oc)' }}>مرفوض</span>}
                </td>
                <td>
                  {r.status === 'pending' && (
                    <div style={{ display:'flex', gap:6 }}>
                      <button className="btn btn-green btn-sm" onClick={()=>decide(r,'approved')}>موافقة</button>
                      <button className="btn btn-ghost btn-sm" onClick={()=>decide(r,'rejected')}>رفض</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>}
    </div>
  )
}
