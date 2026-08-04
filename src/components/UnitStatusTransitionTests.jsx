import React, { useState } from 'react'
import { useAuth } from '../AuthContext'
import { runUnitStatusSuite, UNIT_STATUSES } from '../lib/unitStatusTests'

/**
 * لوحة اختبارات انتقالات حالة الوحدة — تتحقق أن التسليم/التسكين وتغيير الحالة
 * لا يُنتج خطأ enum (invalid input value for enum unit_status: "") لأي مستخدم.
 */
export default function UnitStatusTransitionTests() {
  const { profile, company, isSuperAdmin } = useAuth()
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState([])
  const [summary, setSummary] = useState(null)


  const run = async () => {
    if (!profile?.company_id) return
    setRunning(true)
    const { results, summary } = await runUnitStatusSuite({ companyId: profile.company_id })
    setResults(results)
    setSummary(summary)
    setRunning(false)
  }

  // مقصور على السوبر أدمن فقط
  if (!isSuperAdmin) return null

  return (

    <div className="tool-card" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      <h4 style={{ margin: '0 0 6px' }}>🔁 اختبارات انتقالات حالة الوحدة</h4>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        يمرّ الاختبار على جميع الحالات ({UNIT_STATUSES.join('، ')}) وعلى سيناريو التسليم/الإخلاء
        للتأكد من عدم عودة خطأ <code>invalid input value for enum unit_status</code>.
        الاختبار غير مُتلف — يستخدم وحدة شاغرة بدون حجوزات نشطة ويعيدها لحالتها الأصلية.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-blue btn-sm" onClick={run} disabled={running || !profile?.company_id}>
          {running ? '⏳ جاري تنفيذ الاختبارات...' : '▶️ تشغيل اختبارات الحالة'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>النطاق: {company?.name || 'حسابك الحالي'}</span>
        {summary && (
          <span style={{ fontSize: 12, fontWeight: 700 }}>
            <span style={{ color: '#15803D' }}>✅ {summary.pass}</span>{' · '}
            <span style={{ color: '#B45309' }}>⚠️ {summary.warn}</span>{' · '}
            <span style={{ color: '#B91C1C' }}>❌ {summary.fail}</span>
          </span>
        )}
      </div>

      {summary && (
        <div style={{
          marginTop: 14, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700,
          border: `1px solid ${summary.fail ? '#FECACA' : '#BBF7D0'}`,
          background: summary.fail ? '#FEF2F2' : '#F0FDF4',
          color: summary.fail ? '#991B1B' : '#166534',
        }}>
          {summary.fail
            ? '🚨 ظهر خطأ في أحد الانتقالات — راجع البنود الحمراء.'
            : '✅ جميع انتقالات حالة الوحدة تعمل بدون أخطاء.'}
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
              {r.detail && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
