import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'

/*
  HourlyPing — فحص كل ساعة (60 دقيقة) للحجوزات المرتبطة بتاريخ اليوم أو الغد
  ويطلق Toast مؤقت (لمدة ثانية) لتنبيه الموظف بـ:
  1) المغادرون اليوم / غداً (check-out)
  2) القادمون اليوم / غداً  (check-in) — قرب موعد تسليم الوحدة
  مع ذكر أرقام الوحدات.
*/
export default function HourlyPing() {
  const { profile, toast } = useAuth()

  useEffect(() => {
    if (!profile) return
    let timer

    const check = async () => {
      const today = new Date().toISOString().slice(0, 10)
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

      // المغادرون (checked_in وخروجهم اليوم/غداً)
      const { data: outs } = await supabase.from('bookings')
        .select('id, check_out_date, units(unit_number), customers(full_name)')
        .eq('company_id', profile.company_id)
        .in('status', ['checked_in', 'confirmed'])
        .in('check_out_date', [today, tomorrow])

      // القادمون (confirmed ودخولهم اليوم/غداً) — قرب موعد تسليم الوحدة
      const { data: ins } = await supabase.from('bookings')
        .select('id, check_in_date, units(unit_number), customers(full_name)')
        .eq('company_id', profile.company_id)
        .in('status', ['confirmed'])
        .in('check_in_date', [today, tomorrow])

      const dToday = (outs || []).filter(b => b.check_out_date === today)
      const dTom   = (outs || []).filter(b => b.check_out_date === tomorrow)
      const aToday = (ins  || []).filter(b => b.check_in_date  === today)
      const aTom   = (ins  || []).filter(b => b.check_in_date  === tomorrow)

      let delay = 0
      const push = (msg) => { setTimeout(() => toast(msg), delay); delay += 1200 }

      if (dToday.length) push(`🛫 مغادرة اليوم (${dToday.length}): وحدة ${dToday.map(b => b.units?.unit_number).join('، ')}`)
      if (dTom.length)   push(`⏰ خروج غداً (${dTom.length}): وحدة ${dTom.map(b => b.units?.unit_number).join('، ')}`)
      if (aToday.length) push(`🔑 تسليم اليوم (${aToday.length}): وحدة ${aToday.map(b => b.units?.unit_number).join('، ')}`)
      if (aTom.length)   push(`📅 تسليم غداً (${aTom.length}): وحدة ${aTom.map(b => b.units?.unit_number).join('، ')}`)
    }

    check()
    timer = setInterval(check, 60 * 60 * 1000) // كل ساعة فعلية

    return () => clearInterval(timer)
  }, [profile, toast])

  return null
}
