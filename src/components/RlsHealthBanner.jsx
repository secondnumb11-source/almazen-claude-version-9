import React, { useEffect, useState } from 'react'
import { useAuth } from '../AuthContext'
import { checkRlsAccess } from '../lib/rlsHealth'

/**
 * لافتة تظهر أعلى التطبيق فقط عند فشل الوصول بسبب سياسات RLS.
 * تحاول الفحص عند الدخول وعند تغيّر المنشأة، وتعرض زر إعادة المحاولة.
 */
export default function RlsHealthBanner() {
  const { profile, reloadProfile } = useAuth()
  const [state, setState] = useState({ status: 'idle' })

  const run = async () => {
    if (!profile) return
    setState({ status: 'checking' })
    const r = await checkRlsAccess(profile.company_id)
    setState(r.ok ? { status: 'ok' } : { status: 'fail', ...r })
  }

  useEffect(() => { run() /* eslint-disable-next-line */ }, [profile?.company_id])

  if (!profile || state.status !== 'fail') return null

  return (
    <div className="rls-banner" role="alert">
      <span className="rls-icon" aria-hidden="true">⚠️</span>
      <div className="rls-body">
        <b>تنبيه صلاحيات قاعدة البيانات</b>
        <span>{state.message}</span>
      </div>
      <div className="rls-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => { reloadProfile?.(); run() }}>
          إعادة المحاولة
        </button>
      </div>
    </div>
  )
}
