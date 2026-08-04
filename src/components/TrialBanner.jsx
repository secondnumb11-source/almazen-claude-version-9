import React, { useEffect, useState } from 'react'

/*
  TrialBanner — شريط علوي رفيع يظهر داخل النظام:
   • أثناء فترة التجربة (عدّاد تنازلي حتى انتهائها)
   • وأيضاً قبل انتهاء الاشتراك المدفوع بـ 7 أيام أو أقل (تنبيه تجديد)
  يختفي تماماً بعد التجديد أو التمديد لأن المدة المتبقية تتجاوز 7 أيام.
*/
const DAY = 86400
const WARN_WINDOW = 7 * DAY

export default function TrialBanner({ plan, secondsLeft, onUpgrade }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30 * 1000)
    return () => clearInterval(t)
  }, [])

  const remain = Math.max(0, Number(secondsLeft) || 0)
  const isTrial = plan === 'trial'
  const isExpiring = plan === 'active' && remain > 0 && remain <= WARN_WINDOW

  if (secondsLeft == null || remain <= 0) return null
  if (!isTrial && !isExpiring) return null

  const days = Math.floor(remain / DAY)
  const hours = Math.floor((remain % DAY) / 3600)
  const mins = Math.floor((remain % 3600) / 60)
  const urgent = remain < 2 * DAY

  return (
    <div className={'trial-banner' + (urgent ? ' urgent' : '')}>
      <span className="tb-dot" />
      <span className="tb-txt">
        {isTrial ? (
          <>أنت الآن في <b>النسخة التجريبية المجانية</b> — الوقت المتبقّي:</>
        ) : (
          <>⏳ <b>اشتراكك يقترب من الانتهاء</b> — المتبقّي على انتهاء الاشتراك:</>
        )}
        <b className="tb-count"> {days}ي : {String(hours).padStart(2, '0')}س : {String(mins).padStart(2, '0')}د </b>
      </span>
      <button className="tb-cta" onClick={onUpgrade}>
        {isTrial ? 'تفعيل الاشتراك ✦' : 'تجديد الاشتراك ✦'}
      </button>
    </div>
  )
}
