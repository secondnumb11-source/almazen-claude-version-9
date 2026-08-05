import React, { useState } from 'react'
import { useAuth } from '../AuthContext'
import { runIsolationSuite, recordIsolationRun, autoFixIsolation } from '../lib/isolationSuite'

/**
 * اختبار عزل الحسابات المتعددة (Multi-Tenant Isolation) — واجهة يدوية.
 * ------------------------------------------------------------------
 * تستخدم نفس محرّك الاختبارات المستخدم في المراقب الخلفي الدوري
 * (src/lib/isolationSuite.js) لضمان بقاء العزل صحيحاً بعد أي تعديل
 * في الجداول أو الاستعلامات. كل تشغيل يُسجَّل في قاعدة البيانات.
 */
export default function MultiTenantIsolationTest() {
  const { profile, company, isSuperAdmin } = useAuth()
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState([])
  const [summary, setSummary] = useState(null)
  const [fixed, setFixed] = useState([])

  const cid = profile?.company_id

  const run = async () => {
    if (!cid) return
    setRunning(true)
    setFixed([])
    const { results, summary, durationMs } = await runIsolationSuite({ companyId: cid, companyName: company?.name, isSuperAdmin })
    let autoFixed = []
    if (summary.fail > 0 && isSuperAdmin) {
      const res = await autoFixIsolation()
      autoFixed = res.fixed || []
      setFixed(autoFixed)
    }
    setResults(results)
    setSummary(summary)
    await recordIsolationRun({ companyId: cid, trigger: 'manual', summary, results, durationMs, autoFixed })
    setRunning(false)
  }

  return (
    <div className="tool-card" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      <h4 style={{ margin: '0 0 6px' }}>🔐 اختبار عزل الحسابات المتعددة</h4>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        فحص شامل يتأكد أن بيانات كل منشأة معزولة تماماً — تسريب الصفوف، الاختراق المباشر، الجداول التابعة،
        انحراف المخطط (RLS/الأعمدة)، منع الكتابة عبر الحدود، وثبات الاستعلامات. يعمل أيضاً تلقائياً في الخلفية.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-blue btn-sm" onClick={run} disabled={running || !cid}>
          {running ? '⏳ جاري الفحص...' : '▶️ تشغيل اختبار العزل'}
        </button>
        {summary && (
          <span style={{ fontSize: 12, fontWeight: 700 }}>
            <span style={{ color: '#15803D' }}>✅ {summary.pass}</span>{' · '}
            <span style={{ color: '#B45309' }}>⚠️ {summary.warn}</span>{' · '}
            <span style={{ color: '#B91C1C' }}>❌ {summary.fail}</span>
          </span>
        )}
      </div>

      {fixed.length > 0 && (
        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: '#EFF6FF', color: '#1E40AF', border: '1px solid #BFDBFE' }}>
          🛠️ تم تنفيذ {fixed.length} إصلاح تلقائي: {fixed.map(f => f.table || JSON.stringify(f)).join('، ')}
        </div>
      )}

      {summary && (
        <div style={{
          marginTop: 14, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700,
          border: `1px solid ${summary.fail ? '#FECACA' : '#BBF7D0'}`,
          background: summary.fail ? '#FEF2F2' : '#F0FDF4',
          color: summary.fail ? '#991B1B' : '#166534',
        }}>
          {summary.fail
            ? '🚨 تم رصد خلل في العزل — راجع البنود الحمراء فوراً.'
            : '✅ العزل سليم: لم يظهر أي صف أو مسار يخص منشأة أخرى.'}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {results.map((r, i) => (
          <div key={i} style={{
            display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px',
            borderRadius: 10, border: '1px solid var(--border)',
            background: r.status === 'fail' ? '#FEF2F2' : r.status === 'warn' ? '#FFFBEB' : 'var(--soft, #F8FAFC)',
          }}>
            <span>{r.status === 'pass' ? '✅' : r.status === 'warn' ? '⚠️' : '❌'}</span>
            <div>
              <b style={{ fontSize: 13 }}>{r.name}</b>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
