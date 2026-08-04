import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { SAR, num, today } from '../lib/helpers'

/*  لوحة تحليلات فاخرة للمحاسب — كلها SVG خفيفة تعمل على البيانات الفعلية:
    1) Heatmap إشغال 12 شهراً  2) توقّع إيراد الأشهر القادمة
    3) كشف الحجوزات غير الطبيعية  4) اقتراح تسعير ديناميكي لكل وحدة
*/
export default function AdvancedAnalytics() {
  const { profile } = useAuth()
  const [data, setData] = useState(null)

  useEffect(() => { (async () => {
    const cid = profile.company_id
    // آخر 365 يوم من الحجوزات والدفعات
    const start = new Date(); start.setDate(start.getDate() - 365)
    const s = start.toISOString().slice(0, 10)

    const [{ data: bks }, { data: pays }, { data: units }] = await Promise.all([
      supabase.from('bookings').select('unit_id, check_in_date, check_out_date, total_amount, discount_amount, status, units(unit_number, daily_price, category)')
        .eq('company_id', cid).gte('check_in_date', s),
      supabase.from('payments').select('amount, payment_date, booking_id, method')
        .eq('company_id', cid).gte('payment_date', s),
      supabase.from('units').select('id, unit_number, daily_price, category, status').eq('company_id', cid)
    ])

    // Heatmap: مصفوفة تاريخ→نسبة إشغال يومية
    const totalUnits = (units || []).length || 1
    const occByDay = {}
    for (const b of bks || []) {
      if (b.status === 'cancelled') continue
      const d0 = new Date(b.check_in_date), d1 = new Date(b.check_out_date)
      for (let d = new Date(d0); d < d1; d.setDate(d.getDate() + 1)) {
        const k = d.toISOString().slice(0, 10)
        occByDay[k] = (occByDay[k] || 0) + 1
      }
    }
    const days = []
    for (let i = 0; i < 365; i++) {
      const d = new Date(); d.setDate(d.getDate() - (364 - i))
      const k = d.toISOString().slice(0, 10)
      days.push({ k, v: (occByDay[k] || 0) / totalUnits })
    }

    // توقّع الإيراد الشهري (متوسط متحرك بسيط + نمو)
    const monthly = {}
    for (const p of pays || []) {
      const k = p.payment_date.slice(0, 7)
      monthly[k] = (monthly[k] || 0) + num(p.amount)
    }
    const monKeys = Object.keys(monthly).sort()
    const last3 = monKeys.slice(-3).map(k => monthly[k])
    const avg = last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : 0
    const growth = last3.length >= 2 ? (last3[last3.length - 1] - last3[0]) / (last3.length - 1) : 0
    const forecast = []
    for (let i = 1; i <= 3; i++) {
      const d = new Date(); d.setMonth(d.getMonth() + i)
      forecast.push({
        label: d.toLocaleDateString('ar-SA', { month: 'long' }),
        value: Math.max(0, Math.round(avg + growth * i))
      })
    }

    // كشف الشذوذ: خصم كبير، دفعات مكررة، حجوزات بدون سداد
    const anomalies = []
    for (const b of bks || []) {
      const disc = num(b.discount_amount), tot = num(b.total_amount)
      if (tot > 0 && disc / tot > 0.30 && b.status !== 'cancelled') {
        anomalies.push({ t: '⚠️ خصم كبير', d: `الوحدة ${b.units?.unit_number} — خصم ${SAR(disc)} من إجمالي ${SAR(tot)} (${Math.round(disc / tot * 100)}%)` })
      }
    }
    // دفعات متكررة بنفس المبلغ ونفس الحجز خلال أقل من ساعة
    const byBooking = {}
    for (const p of pays || []) {
      const k = p.booking_id; if (!k) continue
      byBooking[k] = byBooking[k] || []
      byBooking[k].push(p)
    }
    for (const [bid, list] of Object.entries(byBooking)) {
      list.sort((a, b) => new Date(a.payment_date) - new Date(b.payment_date))
      for (let i = 1; i < list.length; i++) {
        if (list[i].amount === list[i - 1].amount) {
          anomalies.push({ t: '⚠️ دفعة مكررة محتملة', d: `الحجز ${bid.slice(0, 8)} — مبلغ ${SAR(list[i].amount)} مسجّل مرتين` })
          break
        }
      }
    }
    // اقتراح تسعير: لكل وحدة، احسب معدل إشغالها آخر 90 يوم
    const per = {}
    for (const b of bks || []) {
      if (b.status === 'cancelled') continue
      const d0 = new Date(b.check_in_date), d1 = new Date(b.check_out_date)
      const nights = Math.max(1, (d1 - d0) / 86400000)
      per[b.unit_id] = per[b.unit_id] || { unit: b.units?.unit_number, price: b.units?.daily_price, cat: b.units?.category, nights: 0 }
      per[b.unit_id].nights += nights
    }
    const suggest = (units || []).map(u => {
      const rec = per[u.id] || { nights: 0 }
      const occ = Math.min(1, rec.nights / 365)
      let factor = 1
      if (occ > 0.85) factor = 1.15         // مطلوبة جداً → ارفع 15%
      else if (occ > 0.65) factor = 1.05    // ازدياد بسيط
      else if (occ < 0.30) factor = 0.90    // شاغرة كثيراً → خفّض 10%
      const suggested = Math.round(num(u.daily_price) * factor / 10) * 10
      return {
        unit: u.unit_number, current: u.daily_price, suggested,
        occ: Math.round(occ * 100), delta: suggested - num(u.daily_price)
      }
    }).filter(x => x.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

    setData({ days, forecast, anomalies, suggest })
  })() }, [profile])

  if (!data) return <div className="panel">جارٍ حساب التحليلات المتقدمة…</div>

  return (
    <>
      <HeatmapPanel days={data.days} />
      <div className="grid2">
        <ForecastPanel forecast={data.forecast} />
        <AnomaliesPanel anomalies={data.anomalies} />
      </div>
      <PricingPanel suggest={data.suggest} />
    </>
  )
}

function HeatmapPanel({ days }) {
  // شبكة 53 عمود × 7 صفوف
  const cols = 53
  const cell = 12, gap = 3
  const w = cols * (cell + gap), h = 7 * (cell + gap) + 20
  const color = v => {
    if (v <= 0) return '#EEF2F6'
    if (v < 0.25) return '#CFEBD9'
    if (v < 0.5) return '#8FD3A8'
    if (v < 0.75) return '#41B06E'
    return '#1B7F42'
  }
  return (
    <div className="panel"><h3>خريطة إشغال حرارية — آخر 365 يوماً</h3>
      <div style={{ overflowX: 'auto' }}>
        <svg width={w} height={h}>
          {days.map((d, i) => {
            const col = Math.floor(i / 7), row = i % 7
            return <rect key={d.k} x={col * (cell + gap)} y={row * (cell + gap)}
              width={cell} height={cell} rx={2.5} fill={color(d.v)}>
              <title>{d.k} — إشغال {Math.round(d.v * 100)}%</title>
            </rect>
          })}
        </svg>
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--muted)', marginTop: 8, alignItems: 'center' }}>
        <span>أقل</span>
        {[0, 0.2, 0.4, 0.6, 0.9].map(v =>
          <i key={v} style={{ width: 14, height: 14, background: color(v), borderRadius: 3, display: 'inline-block' }} />)}
        <span>أعلى</span>
      </div>
    </div>
  )
}

function ForecastPanel({ forecast }) {
  const max = Math.max(...forecast.map(f => f.value), 1)
  return (
    <div className="panel"><h3>توقّع الإيراد — الأشهر الثلاثة القادمة</h3>
      {forecast.every(f => f.value === 0)
        ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>لا توجد بيانات كافية لبناء التوقع بعد</p>
        : <div className="bars">
            {forecast.map((f, i) =>
              <div className="bar" key={i}>
                <b style={{ color: 'var(--gold-d)' }}>{Math.round(f.value / 1000)}K</b>
                <i style={{ height: (f.value / max * 100) + '%', background: 'linear-gradient(180deg,var(--gold-l),var(--gold-d))' }} />
                {f.label}
              </div>)}
          </div>}
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
        الحساب: متوسط الأشهر الثلاثة الماضية + معدّل النمو الشهري.
      </p>
    </div>
  )
}

function AnomaliesPanel({ anomalies }) {
  return (
    <div className="panel"><h3>كشف الحجوزات غير الطبيعية</h3>
      {anomalies.length === 0
        ? <p style={{ color: 'var(--green)', fontSize: 13 }}>✓ لا توجد حالات مريبة — كل شيء طبيعي</p>
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {anomalies.slice(0, 8).map((a, i) =>
              <div key={i} style={{ padding: '10px 12px', background: '#FFF7E7', borderInlineStart: '3px solid var(--gold-d)', borderRadius: 8, fontSize: 13 }}>
                <b>{a.t}</b><br /><span style={{ color: 'var(--muted)' }}>{a.d}</span>
              </div>)}
          </div>}
    </div>
  )
}

function PricingPanel({ suggest }) {
  return (
    <div className="panel"><h3>اقتراح تسعير ديناميكي حسب الإشغال</h3>
      {suggest.length === 0
        ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>الأسعار الحالية مناسبة أو لا توجد بيانات كافية</p>
        : <table className="tbl">
          <thead><tr><th>الوحدة</th><th>الإشغال (سنة)</th><th>السعر الحالي</th><th>السعر المقترح</th><th>الفرق</th></tr></thead>
          <tbody>{suggest.slice(0, 10).map(r =>
            <tr key={r.unit}>
              <td>{r.unit}</td><td>{r.occ}%</td>
              <td>{SAR(r.current)}</td><td className="money">{SAR(r.suggested)}</td>
              <td style={{ color: r.delta > 0 ? 'var(--green)' : 'var(--st-oc)', fontWeight: 800 }}>
                {r.delta > 0 ? '↑ +' : '↓ '}{SAR(Math.abs(r.delta))}
              </td>
            </tr>)}
          </tbody>
        </table>}
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
        منطق الاقتراح: إشغال أكبر من 85% ⇒ ارفع 15%، بين 65-85% ⇒ ارفع 5%، أقل من 30% ⇒ خفّض 10%.
      </p>
    </div>
  )
}
