import { useEffect, useRef } from 'react'
import { useAuth } from '../AuthContext'
import {
  runIsolationSuite,
  recordIsolationRun,
  autoFixIsolation,
  loadMonitorSettings,
} from '../lib/isolationSuite'

/**
 * مراقب عزل الحسابات — يعمل في الخلفية بالكامل ولا يعرض أي واجهة.
 * ------------------------------------------------------------------
 *  • يشغّل حزمة اختبارات العزل دورياً حسب الإعداد المحفوظ في قاعدة البيانات.
 *  • يحاول التصحيح التلقائي (إعادة تفعيل RLS) عند رصد فشل — لحسابات Super Admin.
 *  • يسجّل كل تشغيل في جدول tenant_isolation_runs.
 *  • يتحكم بتشغيله/إيقافه/دوريته Super Admin فقط من لوحة التحكم الشاملة.
 */
export default function BackgroundIsolationMonitor() {
  const { profile, company, isSuperAdmin, session } = useAuth()
  const busyRef = useRef(false)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!session || !profile?.company_id) return
    let cancelled = false

    const cycle = async (trigger) => {
      if (busyRef.current || cancelled || document.hidden) return
      busyRef.current = true
      try {
        const settings = await loadMonitorSettings()
        if (!settings.enabled) return
        if (trigger === 'login' && !settings.run_on_login) return

        const { results, summary, durationMs } = await runIsolationSuite({
          companyId: profile.company_id,
          companyName: company?.name,
        })

        let autoFixed = []
        if (summary.fail > 0 && settings.auto_fix && isSuperAdmin) {
          const { fixed } = await autoFixIsolation()
          autoFixed = fixed || []
          if (autoFixed.length) {
            // إعادة الفحص بعد الإصلاح لتسجيل الحالة النهائية
            const after = await runIsolationSuite({
              companyId: profile.company_id,
              companyName: company?.name,
            })
            await recordIsolationRun({
              companyId: profile.company_id,
              trigger,
              summary: after.summary,
              results: after.results,
              durationMs: durationMs + after.durationMs,
              autoFixed,
            })
            return
          }
        }

        await recordIsolationRun({
          companyId: profile.company_id,
          trigger,
          summary,
          results,
          durationMs,
          autoFixed,
        })
      } catch {
        /* صامت تماماً — المراقب لا يزعج المستخدم أبداً */
      } finally {
        busyRef.current = false
      }
    }

    const schedule = async () => {
      const settings = await loadMonitorSettings()
      if (cancelled) return
      if (timerRef.current) clearInterval(timerRef.current)
      if (!settings.enabled) return
      const ms = Math.max(1, Number(settings.interval_minutes) || 30) * 60 * 1000
      timerRef.current = setInterval(() => cycle('auto'), ms)
    }

    // تشغيلة أولى بعد 20 ثانية من الدخول ثم دورياً
    const kickoff = setTimeout(() => cycle('login'), 20000)
    schedule()
    // إعادة قراءة الإعدادات كل 10 دقائق ليسري أي تغيير من السوبر أدمن
    const settingsPoll = setInterval(schedule, 10 * 60 * 1000)

    return () => {
      cancelled = true
      clearTimeout(kickoff)
      clearInterval(settingsPoll)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [session, profile?.company_id, company?.name, isSuperAdmin])

  return null
}
