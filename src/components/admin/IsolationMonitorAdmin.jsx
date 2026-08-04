import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../AuthContext'
import {
  runIsolationSuite, recordIsolationRun, autoFixIsolation,
  loadMonitorSettings, saveMonitorSettings, DEFAULT_MONITOR_SETTINGS,
} from '../../lib/isolationSuite'

/**
 * لوحة تحكم مراقب عزل الحسابات — Super Admin فقط.
 * تتحكم في: التفعيل، الدورية، التصحيح التلقائي، وتعرض سجل التشغيلات الخلفية.
 */
export default function IsolationMonitorAdmin() {
  const { isSuperAdmin, profile, company, toast } = useAuth()
  const [settings, setSettings] = useState(DEFAULT_MONITOR_SETTINGS)
  const [runs, setRuns] = useState([])
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)

  const loadRuns = useCallback(async () => {
    const { data } = await supabase
      .from('tenant_isolation_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
    setRuns(data || [])
  }, [])

  useEffect(() => {
    if (!isSuperAdmin) return
    loadMonitorSettings().then(setSettings)
    loadRuns()
  }, [isSuperAdmin, loadRuns])

  if (!isSuperAdmin) return null

  const patch = async (p) => {
    const next = { ...settings, ...p }
    setSettings(next)
    setBusy(true)
    const err = await saveMonitorSettings({
      enabled: next.enabled,
      interval_minutes: next.interval_minutes,
      auto_fix: next.auto_fix,
      run_on_login: next.run_on_login,
      keep_runs: next.keep_runs,
      updated_by: profile?.id || null,
    })
    setBusy(false)
    if (err) toast('تعذّر حفظ الإعدادات: ' + err.message, true)
    else toast('تم حفظ إعدادات المراقب')
  }

  const runNow = async () => {
    setTesting(true)
    const { results, summary, durationMs } = await runIsolationSuite({
      companyId: profile?.company_id, companyName: company?.name,
    })
    let autoFixed = []
    if (summary.fail > 0 && settings.auto_fix) {
      const { fixed } = await autoFixIsolation()
      autoFixed = fixed || []
    }
    await recordIsolationRun({
      companyId: profile?.company_id, trigger: 'manual', summary, results, durationMs, autoFixed,
    })
    await loadRuns()
    setTesting(false)
    toast(summary.fail
      ? `⚠️ ${summary.fail} فحص فاشل${autoFixed.length ? ` — تم تنفيذ ${autoFixed.length} إصلاح تلقائي` : ''}`
      : `✅ العزل سليم (${summary.pass} فحص ناجح)`, summary.fail > 0)
  }

  return (
    <div className="tool-card" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginTop: 18 }}>
      <h4 style={{ margin: '0 0 4px' }}>🛡️ مراقب عزل الحسابات (خلفي وتلقائي)</h4>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
        يعمل صامتاً في الخلفية لكل جلسة، ويعيد فحص العزل بعد أي تعديل في الجداول أو الاستعلامات،
        مع تصحيح تلقائي لسياسات RLS عند رصد خلل. هذه اللوحة مرئية لحسابات Super Admin فقط.
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))' }}>
        <label className="iso-field">
          <input type="checkbox" checked={!!settings.enabled} disabled={busy}
            onChange={e => patch({ enabled: e.target.checked })} />
          <span>تفعيل المراقبة الدورية</span>
        </label>
        <label className="iso-field">
          <input type="checkbox" checked={!!settings.auto_fix} disabled={busy}
            onChange={e => patch({ auto_fix: e.target.checked })} />
          <span>التصحيح التلقائي لـ RLS</span>
        </label>
        <label className="iso-field">
          <input type="checkbox" checked={!!settings.run_on_login} disabled={busy}
            onChange={e => patch({ run_on_login: e.target.checked })} />
          <span>فحص عند كل تسجيل دخول</span>
        </label>
        <label className="iso-field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <span>الدورية (دقائق): <b>{settings.interval_minutes}</b></span>
          <input type="range" min={5} max={240} step={5} value={settings.interval_minutes} disabled={busy}
            onChange={e => setSettings(s => ({ ...s, interval_minutes: Number(e.target.value) }))}
            onMouseUp={e => patch({ interval_minutes: Number(e.target.value) })}
            onTouchEnd={e => patch({ interval_minutes: Number(e.target.value) })} />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn btn-blue btn-sm" onClick={runNow} disabled={testing}>
          {testing ? '⏳ جاري الفحص...' : '▶️ تشغيل فحص فوري'}
        </button>
        <button className="btn btn-sm" onClick={loadRuns}>🔄 تحديث السجل</button>
      </div>

      <div style={{ marginTop: 16 }}>
        <b style={{ fontSize: 13 }}>آخر التشغيلات الخلفية</b>
        {runs.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>لا توجد تشغيلات مسجّلة بعد.</div>}
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {runs.map(r => (
            <div key={r.id} style={{
              display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
              fontSize: 12, padding: '8px 12px', borderRadius: 10,
              border: '1px solid var(--border)',
              background: r.failed > 0 ? '#FEF2F2' : 'var(--soft, #F8FAFC)',
            }}>
              <span>{new Date(r.created_at).toLocaleString('ar-SA')} · <b>{r.trigger}</b></span>
              <span>
                <span style={{ color: '#15803D' }}>✅ {r.passed}</span>{' · '}
                <span style={{ color: '#B45309' }}>⚠️ {r.warned}</span>{' · '}
                <span style={{ color: '#B91C1C' }}>❌ {r.failed}</span>
                {Array.isArray(r.auto_fixed) && r.auto_fixed.length > 0 && <b style={{ color: '#1D4ED8' }}>{' · '}🛠️ {r.auto_fixed.length} إصلاح</b>}
                {r.duration_ms ? <span style={{ color: 'var(--muted)' }}>{' · '}{r.duration_ms}ms</span> : null}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
