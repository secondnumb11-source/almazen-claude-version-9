import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { REF_STATUS_LABEL } from '../lib/referral'

const fmt = (d) => d ? new Date(d).toLocaleDateString('ar-SA') : '—'

/**
 * لافتة تُعرض في "إدارة الحساب" للمنشآت التي سجّلت عبر رابط/كود ترشيح،
 * توضح صاحب الترشيح وحالة مكافأة الـ 3 أشهر المجانية ومزامنتها مع الاشتراك.
 */
export default function ReferralAccountNotice() {
  const [state, setState] = useState(null)

  const load = React.useCallback(() => {
    supabase.rpc('referral_my_bonus_status').then(({ data, error }) => {
      if (error || !data?.has_referral) return setState(null)
      setState(data)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    const t = setInterval(load, 30000)
    // مزامنة فورية: أي تغيّر على الترشيحات أو الاشتراك ينعكس مباشرة
    const ch = supabase
      .channel('referral-bonus-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'referrals' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'companies' }, () => load())
      .subscribe()
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(t)
      try { supabase.removeChannel(ch) } catch { /* ignore */ }
    }
  }, [load])

  if (!state) return null

  const r = state.referral || {}
  const applied = !!r.bonus_applied
  const months = r.bonus_months ?? 3

  return (
    <div className="panel" style={{ marginBottom: 16, borderRight: `3px solid ${applied ? '#2e9e5b' : '#B8860B'}` }}>
      <h4 style={{ margin: '0 0 6px' }}>
        {applied ? '✅ تمت إضافة المكافأة على اشتراكك' : '🎁 ترشيح مؤكَّد على حسابك'}
      </h4>
      <div style={{ fontSize: 13, lineHeight: 2 }}>
        تم تأكيد ترشيحك من <b>{r.referrer_name || 'صاحب الرابط'}</b> (كود <b>{r.code}</b>).
        <br />
        {applied ? (
          <>
            تمت إضافة <b>{months} أشهر مجانية</b> على مدة اشتراكك بتاريخ <b>{fmt(r.bonus_applied_at)}</b>.
            <br />نهاية الاشتراك بعد المكافأة: <b>{fmt(state.subscription_ends_at || r.bonus_new_ends_at)}</b>
          </>
        ) : (
          <>
            ستتم إضافة <b>{months} أشهر مجانية</b> تلقائياً على مدة اشتراكك فور سداد الاشتراك وتفعيله.
            <br />نهاية الاشتراك الحالية: <b>{fmt(state.subscription_ends_at || state.trial_ends_at)}</b>
          </>
        )}
        <br />حالة الترشيح: <b>{REF_STATUS_LABEL[r.status] || r.status}</b>
      </div>
    </div>
  )
}
