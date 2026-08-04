import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../AuthContext'
import { runCiSuite, applyFixToAllUsers } from '../../lib/ciSuite'
import SystemRepairLog from '../SystemRepairLog'

const box = { border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 14 }
const cell = { padding: '6px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }
const STATUS_COLOR = { pass: '#15803D', fail: '#B91C1C', warn: '#B45309', skip: '#64748B' }
const STATUS_ICON  = { pass: '✅', fail: '❌', warn: '⚠️', skip: '⏭️' }

function StatChip({ label, value, color }) {
  return (
    <div style={{
      background: '#F8FAFC', border: '1px solid var(--border)',
      borderRadius: 10, padding: '10px 14px', minWidth: 110, textAlign: 'center',
    }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || 'var(--text)' }}>{value}</div>
    </div>
  )
}

function RunsTable({ runs, onOpen }) {
  if (!runs.length) return <div style={{ color: 'var(--muted)', padding: 12 }}>لا توجد تشغيلات بعد.</div>
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead style={{ background: '#F8FAFC' }}>
        <tr>
          <th style={cell}>بدأ</th>
          <th style={cell}>المصدر</th>
          <th style={cell}>الحالة</th>
          <th style={cell}>نجاح / تحذير / فشل</th>
          <th style={cell}>المدة</th>
          <th style={cell}></th>
        </tr>
      </thead>
      <tbody>
        {runs.map(r => {
          const totals = r.totals || {}
          const dur = r.finished_at ? Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 100) / 10 : null
          return (
            <tr key={r.id}>
              <td style={cell}>{new Date(r.started_at).toLocaleString('ar-SA')}</td>
              <td style={cell}>{r.trigger_kind}</td>
              <td style={{ ...cell, color: STATUS_COLOR[r.status === 'passed' ? 'pass' : r.status === 'warned' ? 'warn' : 'fail'], fontWeight: 700 }}>
                {r.status}
              </td>
              <td style={cell}>{totals.passed || 0} / {totals.warned || 0} / {totals.failed || 0}</td>
              <td style={cell}>{dur !== null ? `${dur}s` : '—'}</td>
              <td style={cell}><button className="btn btn-ghost btn-sm" onClick={() => onOpen(r)}>تفاصيل</button></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function RunDetails({ run, onFix }) {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    (async () => {
      setLoading(true)
      const { data } = await supabase.from('ci_test_results').select('*').eq('run_id', run.id).order('created_at')
      setResults(data || []); setLoading(false)
    })()
  }, [run.id])
  if (loading) return <div style={{ padding: 12 }}>… تحميل النتائج</div>
  return (
    <div style={{ marginTop: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead style={{ background: '#F8FAFC' }}>
          <tr>
            <th style={cell}>الحالة</th>
            <th style={cell}>الفئة</th>
            <th style={cell}>الاختبار</th>
            <th style={cell}>المدة</th>
            <th style={cell}>الرسالة</th>
            <th style={cell}></th>
          </tr>
        </thead>
        <tbody>
          {results.map(r => (
            <tr key={r.id}>
              <td style={{ ...cell, color: STATUS_COLOR[r.status], fontWeight: 700 }}>{STATUS_ICON[r.status]} {r.status}</td>
              <td style={cell}>{r.category}</td>
              <td style={cell}>{r.name}</td>
              <td style={cell}>{r.duration_ms} ms</td>
              <td style={cell}>{r.message}</td>
              <td style={cell}>
                {r.fix_check_id ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => onFix(r.fix_check_id)}>🛠️ إصلاح للكل</button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Schedules() {
  const [items, setItems] = useState([])
  const [name, setName] = useState('daily full suite')
  const [cron, setCron] = useState('0 3 * * *')
  const load = async () => {
    const { data } = await supabase.from('ci_schedules').select('*').order('created_at', { ascending: false })
    setItems(data || [])
  }
  useEffect(() => { load() }, [])
  const add = async () => {
    const { error } = await supabase.from('ci_schedules').insert({ name, cron, enabled: true })
    if (!error) { setName('daily full suite'); setCron('0 3 * * *'); load() }
    else alert(error.message)
  }
  const toggle = async (s) => {
    await supabase.from('ci_schedules').update({ enabled: !s.enabled }).eq('id', s.id); load()
  }
  const del = async (s) => {
    if (confirm(`حذف الجدولة "${s.name}"?`)) { await supabase.from('ci_schedules').delete().eq('id', s.id); load() }
  }
  return (
    <div style={box}>
      <h4 style={{ margin: '0 0 10px' }}>⏱️ جدولة تشغيل الحزمة</h4>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <input placeholder="اسم الجدولة" value={name} onChange={e => setName(e.target.value)} />
        <input placeholder="cron (min hour dom mon dow)" value={cron} onChange={e => setCron(e.target.value)} dir="ltr" />
        <button className="btn btn-gold btn-sm" onClick={add}>➕ إضافة</button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead style={{ background: '#F8FAFC' }}>
          <tr>
            <th style={cell}>الاسم</th>
            <th style={cell}>Cron</th>
            <th style={cell}>مفعّل</th>
            <th style={cell}>آخر تشغيل</th>
            <th style={cell}></th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && <tr><td colSpan={5} style={{ ...cell, textAlign: 'center', color: 'var(--muted)' }}>لا توجد جدولات</td></tr>}
          {items.map(s => (
            <tr key={s.id}>
              <td style={cell}>{s.name}</td>
              <td style={cell} dir="ltr">{s.cron}</td>
              <td style={cell}>{s.enabled ? '✅' : '⏸️'}</td>
              <td style={cell}>{s.last_run_at ? new Date(s.last_run_at).toLocaleString('ar-SA') : '—'}</td>
              <td style={cell}>
                <button className="btn btn-ghost btn-sm" onClick={() => toggle(s)}>{s.enabled ? 'إيقاف' : 'تشغيل'}</button>{' '}
                <button className="btn btn-ghost btn-sm" onClick={() => del(s)}>حذف</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
        التنفيذ التلقائي مفعّل: مهمة pg_cron تستدعي ci-schedule-tick كل ١٥ دقيقة وتشغّل الجدولات المستحقة.
      </p>
    </div>
  )
}

export default function CiSuitePanel() {
  const { isSuperAdmin } = useAuth()
  const [runs, setRuns] = useState([])
  const [running, setRunning] = useState(false)
  const [openRun, setOpenRun] = useState(null)
  const [msg, setMsg] = useState('')
  const [logKey, setLogKey] = useState(0)

  const load = async () => {
    const { data } = await supabase.from('ci_test_runs').select('*').order('started_at', { ascending: false }).limit(25)
    setRuns(data || [])
  }
  useEffect(() => { if (isSuperAdmin) load() }, [isSuperAdmin])

  const summary = useMemo(() => {
    const last = runs[0]
    return {
      lastStatus: last?.status || '—',
      lastPerf: last?.perf || {},
      lastTotals: last?.totals || {},
    }
  }, [runs])

  const run = async () => {
    setRunning(true); setMsg('')
    try {
      const res = await runCiSuite({ triggerKind: 'manual' })
      const t = res?.totals || {}
      const fixes = res?.fixes?.length ? ` — إصلاحات مطبّقة: ${res.fixes.length}` : ''
      setMsg(`اكتملت الحزمة — ${res.status} (${t.passed ?? 0} نجاح, ${t.warned ?? 0} تحذير, ${t.failed ?? 0} فشل)${fixes}`)
      await load()
      setLogKey(k => k + 1)
    } catch (e) {
      setMsg(`فشل تشغيل الحزمة: ${e.message}`)
    } finally { setRunning(false) }
  }


  const doFix = async (checkId) => {
    if (!confirm(`تطبيق إصلاح "${checkId}" على جميع المستخدمين؟`)) return
    try {
      const res = await applyFixToAllUsers(checkId)
      setMsg(`✅ تم — job ${res.job_id}`)
      setLogKey(k => k + 1)
    } catch (e) { setMsg(`❌ ${e.message}`) }
  }

  if (!isSuperAdmin) {
    return <div className="panel" style={{ padding: 20, color: 'var(--muted)' }}>هذه اللوحة متاحة لحسابات super admin فقط.</div>
  }

  return (
    <div>
      <div style={box}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>🧪 حزمة اختبارات CI</h3>
          <button className="btn btn-gold btn-sm" onClick={run} disabled={running}>
            {running ? '⏳ يعمل…' : '▶️ تشغيل الحزمة الكاملة الآن'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={load}>🔄 تحديث</button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => doFix('full_repair')}
            title="إعادة تطبيق كل الإصلاحات المعروفة على جميع المستخدمين والشركات">
            🛠️ إصلاح شامل لجميع المستخدمين
          </button>
        </div>
        {msg && <div style={{ fontSize: 13, marginBottom: 8 }}>{msg}</div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <StatChip label="آخر تشغيل" value={summary.lastStatus} color={
            summary.lastStatus === 'passed' ? '#15803D' :
            summary.lastStatus === 'warned' ? '#B45309' : '#B91C1C'
          } />
          <StatChip label="نجاح" value={summary.lastTotals.passed || 0} color="#15803D" />
          <StatChip label="تحذير" value={summary.lastTotals.warned || 0} color="#B45309" />
          <StatChip label="فشل" value={summary.lastTotals.failed || 0} color="#B91C1C" />
          {Object.entries(summary.lastPerf || {}).slice(0, 3).map(([k, v]) => (
            <StatChip key={k} label={k} value={`${v} ms`} />
          ))}
        </div>
      </div>

      <div style={box}>
        <h4 style={{ margin: '0 0 10px' }}>📊 سجل التشغيلات</h4>
        <RunsTable runs={runs} onOpen={setOpenRun} />
        {openRun && (
          <div style={{ marginTop: 10, padding: 10, background: '#F9FAFB', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>تفاصيل التشغيل — {new Date(openRun.started_at).toLocaleString('ar-SA')}</strong>
              <button className="btn btn-ghost btn-sm" onClick={() => setOpenRun(null)}>إغلاق</button>
            </div>
            <RunDetails run={openRun} onFix={doFix} />
          </div>
        )}
      </div>

      <Schedules />

      <div style={box}>
        <SystemRepairLog embedded refreshKey={logKey} />
      </div>
    </div>
  )
}
