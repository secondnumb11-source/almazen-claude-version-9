import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { REWARD_LABEL, STATUS_LABEL, REF_STATUS_LABEL } from '../lib/referral'
import { drainOutbox } from '../lib/outbox'

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('ar-SA') : '—')

/** مراحل تتبّع طلب المكافأة — تُعرض خطوة بخطوة */
const STEPS = [
  { k: 'registered', label: 'تسجيل المنشأة المُرشَّحة', icon: '📝' },
  { k: 'paid', label: 'سداد اشتراك المنشأة الجديدة', icon: '💳' },
  { k: 'requested', label: 'إرسال طلب المكافأة', icon: '📤' },
  { k: 'admin', label: 'مراجعة إدارة المنصة', icon: '🔍' },
  { k: 'done', label: 'تطبيق التمديد / صرف المبلغ', icon: '🎉' },
]

function stepStateFor(reward, referral) {
  // يعيد فهرس آخر خطوة مكتملة وحالة الرفض
  const rejected = reward?.status === 'rejected'
  let done = 0
  if (referral || reward) done = 1
  if (referral?.status === 'paid' || reward) done = 2
  if (reward) done = 3
  if (reward && reward.status !== 'pending_admin') done = 4
  if (reward && (reward.status === 'approved' || reward.status === 'paid')) done = 5
  return { done, rejected }
}

function Progress({ done, rejected }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
      {STEPS.map((s, i) => {
        const active = i < done
        const isCurrent = i === done
        const bad = rejected && i === 3
        return (
          <div key={s.k} style={{
            flex: '1 1 140px', minWidth: 130, padding: '8px 10px', borderRadius: 10,
            border: '1px solid ' + (bad ? '#c0392b' : active ? 'var(--gold-l, #B8860B)' : 'rgba(128,128,128,.35)'),
            background: bad ? 'rgba(192,57,43,.10)' : active ? 'rgba(184,134,11,.12)' : 'transparent',
            opacity: active || isCurrent ? 1 : .55,
          }}>
            <div style={{ fontSize: 12, opacity: .75 }}>{i + 1} · {s.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: 11, opacity: .8 }}>
              {bad ? 'مرفوض' : active ? 'مكتملة ✓' : isCurrent ? 'قيد التنفيذ…' : 'بانتظار'}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * صفحة تتبّع حالة طلبات الترشيح وصرف المكافآت.
 * تظهر لصاحب كود الترشيح (الموظف/المحاسب/المدير) وللمنشأة المُرشَّحة على حد سواء،
 * مع تسلسل زمني لكل تغيّر حالة (سجل التدقيق الخاص بهم فقط).
 */
export default function ReferralTracking() {
  const { toast } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const { data: res, error } = await supabase.rpc('referral_track_my')
    if (error && !silent) toast('تعذر تحميل بيانات التتبّع: ' + error.message, true)
    if (!error) setData(res || null)
    if (!silent) setLoading(false)
  }, [toast])

  useEffect(() => { load() }, [load])
  // إعادة محاولة إرسال أي إشعارات بريد متعثرة عند فتح الصفحة
  useEffect(() => { drainOutbox(5).catch(() => {}) }, [])

  // ضمان عرض أحدث البيانات: تحديث صامت عند عودة التركيز للنافذة وكل دقيقتين
  useEffect(() => {
    const refresh = () => { load(true).catch(() => {}) }
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    const t = setInterval(refresh, 120000)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(t)
    }
  }, [load])


  const rewards = useMemo(() => data?.rewards || [], [data])
  const outgoing = useMemo(() => data?.outgoing || [], [data])
  const incoming = data?.incoming && data.incoming !== null ? data.incoming : null
  const timeline = useMemo(() => data?.timeline || [], [data])

  if (loading) return <div className="panel">جاري تحميل حالة الطلبات…</div>

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>🚦 تتبّع حالة الترشيح والمكافآت</h3>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          تابع كل طلب خطوة بخطوة: من تسجيل المنشأة المُرشَّحة، إلى سداد اشتراكها، ثم إرسال طلب المكافأة،
          فمراجعة إدارة المنصة، وأخيراً تطبيق التمديد أو صرف المبلغ النقدي.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
          <span className="chip">إجمالي الترشيحات: <b>{outgoing.length}</b></span>
          <span className="chip chip-green">مسدّدة: <b>{outgoing.filter(r => r.status === 'paid').length}</b></span>
          <span className="chip">طلبات المكافآت: <b>{rewards.length}</b></span>
          <span className="chip chip-gold">
            نهاية اشتراكك الحالي: <b>{data?.subscription_ends_at ? new Date(data.subscription_ends_at).toLocaleDateString('ar-SA') : '—'}</b>
          </span>
          <button className="btn btn-outline btn-sm" onClick={() => load()}>تحديث</button>
        </div>
      </div>

      {incoming && (
        <div className="panel" style={{ borderRight: '3px solid var(--gold-l, #B8860B)' }}>
          <h4 style={{ marginTop: 0 }}>🎯 ترشيحك الوارد من: {incoming.referrer_name || 'صاحب الرابط'}</h4>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            الكود: <b>{incoming.code}</b> — الحالة: <b>{REF_STATUS_LABEL[incoming.status] || incoming.status}</b> —
            تُضاف <b>3 أشهر مجانية</b> على اشتراكك بعد السداد واعتماد الإدارة.
          </p>
          <Progress {...stepStateFor(rewards.find(w => w.beneficiary === 'referred'), incoming)} />
        </div>
      )}

      {/* بطاقة تتبّع لكل طلب مكافأة */}
      {rewards.map(w => {
        const ref = outgoing.find(r => r.id === w.referral_id) || (incoming && incoming.id === w.referral_id ? incoming : null)
        const st = stepStateFor(w, ref)
        const logs = timeline.filter(t => t.reward_id === w.id)
        return (
          <div className="panel" key={w.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <h4 style={{ margin: 0 }}>
                طلب رقم <span style={{ fontFamily: 'monospace' }}>{w.request_no}</span> — {REWARD_LABEL(w)}
              </h4>
              <span className={'chip ' + (w.status === 'approved' || w.status === 'paid' ? 'chip-green' : w.status === 'rejected' ? 'chip-red' : '')}>
                {STATUS_LABEL[w.status] || w.status}
              </span>
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              المستفيد: <b>{w.beneficiary === 'referrer' ? (w.beneficiary_name || 'صاحب الترشيح') : 'المنشأة المُرشَّحة'}</b> —
              المنشأة المُرشَّحة: <b>{w.referred_company_name || '—'}</b> —
              المستوى: <b>{w.tier === 'milestone' ? 'إنجاز 3 اشتراكات' : 'ترشيح مفرد'}</b> —
              تاريخ الطلب: {fmt(w.requested_at)}
            </p>
            <Progress {...st} />
            {w.admin_note && <p style={{ fontSize: 12, marginTop: 10 }}>📌 ملاحظة الإدارة: {w.admin_note}</p>}

            {logs.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>سجل التحديثات</div>
                <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12, lineHeight: 1.9 }}>
                  {logs.map(l => (
                    <li key={l.id}>
                      {fmt(l.created_at)} — <b>{l.action}</b>
                      {l.old_status ? ` (${l.old_status} ← ${l.new_status})` : ''} — بواسطة {l.actor_name || 'الإدارة'}
                      {l.note ? ` — ${l.note}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      })}

      {rewards.length === 0 && !incoming && (
        <div className="panel" style={{ textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 32 }}>🎁</div>
          <p className="muted">لا توجد طلبات مكافآت بعد — شارك رابط أو كود الترشيح للبدء.</p>
        </div>
      )}

      {/* حالة الترشيحات الصادرة */}
      <div className="panel">
        <h4 style={{ marginTop: 0 }}>📋 المنشآت المُرشَّحة ومراحلها</h4>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead><tr><th>المنشأة</th><th>المالك</th><th>الكود</th><th>تاريخ التسجيل</th><th>تاريخ السداد</th><th>الحالة</th></tr></thead>
            <tbody>
              {outgoing.map(r => (
                <tr key={r.id}>
                  <td><b>{r.referred_company_name || '—'}</b></td>
                  <td>{r.referred_owner_name || '—'}</td>
                  <td style={{ fontFamily: 'monospace' }}>{r.code}</td>
                  <td style={{ fontSize: 12 }}>{fmt(r.signed_up_at)}</td>
                  <td style={{ fontSize: 12 }}>{fmt(r.paid_at)}</td>
                  <td><span className={'chip ' + (r.status === 'paid' ? 'chip-green' : '')}>{REF_STATUS_LABEL[r.status] || r.status}</span></td>
                </tr>
              ))}
              {outgoing.length === 0 && <tr><td colSpan="6" style={{ textAlign: 'center', padding: 18 }}>لا توجد ترشيحات صادرة</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
