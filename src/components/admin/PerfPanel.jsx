import React, { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../AuthContext'
import { Gauge, Zap, Search, AlertTriangle } from 'lucide-react'

const SEV = {
  high:   { label: 'حرج',  bg: '#FEF2F2', bd: '#FCA5A5', fg: '#991B1B' },
  medium: { label: 'متوسط', bg: '#FFFBEB', bd: '#FCD34D', fg: '#92400E' },
  low:    { label: 'خفيف', bg: '#F8FAFC', bd: '#E2E8F0', fg: '#475569' },
}

const KIND_AR = {
  missing_index: 'فهرس ناقص على عمود ربط',
  seq_scan: 'مسح تسلسلي متكرر',
  bloat: 'صفوف ميتة تُبطئ المسح',
  log_growth: 'جدول سجلات متضخّم',
  realtime_publication: 'جدول منشور في Realtime',
}

/**
 * أدوات تسريع النظام — للسوبر أدمن حصراً.
 * الفحص يقيس أسباب البطء الفعلية (فهارس ناقصة، مسح تسلسلي، تضخّم، سجلات).
 * الإصلاح يُطبَّق على مستوى النظام كله: كل المنشآت الحالية والجديدة.
 */
export default function PerfPanel() {
  const { isSuperAdmin, toast } = useAuth()
  const [rows, setRows] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState('')

  if (!isSuperAdmin) return null

  const scan = async () => {
    setBusy('scan')
    const { data, error } = await supabase.rpc('ci_perf_scan')
    setBusy('')
    if (error) return toast('تعذّر الفحص: ' + error.message, true)
    setRows(data || [])
    setPreview(null)
  }

  const optimize = async (dryRun) => {
    if (!dryRun && !window.confirm('سيُنشئ الفهارس الناقصة ويقلّم السجلات القديمة (أقدم من 90 يوماً) لكل المنشآت. متابعة؟')) return
    setBusy(dryRun ? 'dry' : 'run')
    const { data, error } = await supabase.rpc('ci_perf_optimize', { p_dry_run: dryRun, p_prune_days: 90 })
    setBusy('')
    if (error) return toast('تعذّر التنفيذ: ' + error.message, true)
    setPreview(data)
    if (!dryRun) {
      toast(`✓ أُنشئ ${data?.indexes_created ?? 0} فهرساً وقُلّم ${data?.rows_pruned ?? 0} صفاً`)
      scan()
    }
  }

  const counts = (rows || []).reduce((a, r) => { a[r.o_severity] = (a[r.o_severity] || 0) + 1; return a }, {})

  return (
    <div className="panel" style={{ borderInlineStart: '3px solid var(--gold)' }}>
      <h4 style={{ margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Gauge size={17} /> تسريع النظام
      </h4>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
        يقيس أسباب البطء الفعلية ويُصلحها. الإصلاح يسري على <b>كل المنشآت الحالية والجديدة</b>،
        ويعمل تلقائياً كل أحد الساعة 4 فجراً.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={scan} disabled={!!busy}>
          <Search size={14} /> {busy === 'scan' ? 'جارٍ الفحص…' : 'فحص الأداء'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => optimize(true)} disabled={!!busy}>
          {busy === 'dry' ? '…' : '🔍 معاينة الإصلاح'}
        </button>
        <button className="btn btn-gold btn-sm" onClick={() => optimize(false)} disabled={!!busy}>
          <Zap size={14} /> {busy === 'run' ? 'جارٍ التسريع…' : 'تسريع الآن'}
        </button>

        {rows && (
          <span style={{ fontSize: 12.5, fontWeight: 700, marginInlineStart: 'auto' }}>
            {counts.high ? <span style={{ color: '#991B1B' }}>{counts.high} حرج · </span> : null}
            {counts.medium ? <span style={{ color: '#92400E' }}>{counts.medium} متوسط · </span> : null}
            <span style={{ color: '#475569' }}>{rows.length} ملاحظة</span>
          </span>
        )}
      </div>

      {preview && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12.5 }}>
          {preview.status === 'dry_run' ? 'معاينة: ' : 'نُفِّذ: '}
          <b>{preview.indexes_created}</b> فهرساً · <b>{preview.rows_pruned}</b> صفاً للتقليم
        </div>
      )}

      {rows && rows.length === 0 && (
        <div style={{ marginTop: 10, color: '#15803d', fontWeight: 700, fontSize: 13 }}>✓ لا ملاحظات — الأداء سليم</div>
      )}

      {rows && rows.length > 0 && (
        <div style={{ marginTop: 12, maxHeight: 320, overflowY: 'auto' }}>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>الشدة</th><th>النوع</th><th>الهدف</th><th>القياس</th><th>التفصيل</th></tr></thead>
            <tbody>
              {rows.slice().sort((a, b) => {
                const o = { high: 0, medium: 1, low: 2 }
                return (o[a.o_severity] ?? 3) - (o[b.o_severity] ?? 3)
              }).map((r, i) => {
                const s = SEV[r.o_severity] || SEV.low
                return (
                  <tr key={i}>
                    <td><span style={{ background: s.bg, border: `1px solid ${s.bd}`, color: s.fg, padding: '1px 7px', borderRadius: 6, fontSize: 11, fontWeight: 800 }}>{s.label}</span></td>
                    <td>{KIND_AR[r.o_kind] || r.o_kind}</td>
                    <td dir="ltr" style={{ fontSize: 11.5 }}>{r.o_target}</td>
                    <td>{r.o_metric}</td>
                    <td className="muted" style={{ fontSize: 11.5 }}>{r.o_detail}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {counts.high > 0 && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#991B1B' }}>
          <AlertTriangle size={14} /> توجد ملاحظات حرجة — اضغط «تسريع الآن» لمعالجتها على مستوى النظام.
        </div>
      )}
    </div>
  )
}
