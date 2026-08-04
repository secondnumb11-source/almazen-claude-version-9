import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { referralLink, REWARD_LABEL, STATUS_LABEL, REF_STATUS_LABEL, notifySuperAdminsReward, notifyReferralStepChange } from '../lib/referral'

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('ar-SA') : '—')

/**
 * قسم الترشيح — متاح لجميع المستخدمين (موظف / محاسب / مدير / مالك).
 * البيانات معزولة على مستوى المنشأة: كل موظفي المنشأة والمدير يرون نفس البيانات،
 * ولا تظهر لهم بيانات أي منشأة أخرى (مفروض في RLS ودوال SECURITY DEFINER).
 */
export default function ReferralPanel() {
  const { profile, session, toast } = useAuth()
  const [data, setData] = useState(null)
  const [myCode, setMyCode] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [claim, setClaim] = useState(null) // { referral, tier }
  const [form, setForm] = useState({ kind: 'months', name: '', phone: '' })

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: code, error: e1 }, { data: dash, error: e2 }] = await Promise.all([
      supabase.rpc('referral_my_code'),
      supabase.rpc('referral_my_dashboard'),
    ])
    if (e1) toast('تعذر توليد كود الترشيح: ' + e1.message, true)
    if (e2) toast('تعذر تحميل بيانات الترشيح: ' + e2.message, true)
    setMyCode(Array.isArray(code) ? code[0] : code)
    setData(dash || null)
    setLoading(false)
  }, [toast])

  useEffect(() => { load() }, [load])

  const referrals = data?.referrals || []
  const rewards = data?.rewards || []
  const paidCount = referrals.filter(r => r.status === 'paid').length
  const unclaimedMilestone = Number(data?.paid_unclaimed || 0)

  const link = myCode ? referralLink(myCode.code) : ''

  const copy = async (txt, msg) => {
    try { await navigator.clipboard.writeText(txt); toast(msg) }
    catch { toast('تعذر النسخ — انسخ يدوياً', true) }
  }

  const openClaim = (referral, tier) => {
    setForm({ kind: 'months', name: profile?.full_name || '', phone: profile?.phone || '' })
    setClaim({ referral, tier })
  }

  const submitClaim = async () => {
    if (form.kind === 'cash' && (!form.name.trim() || !form.phone.trim())) {
      return toast('الاسم الكامل ورقم الهاتف مطلوبان للاستبدال النقدي', true)
    }
    setBusy(true)
    const args = {
      p_kind: form.kind,
      p_contact_name: form.name.trim() || null,
      p_contact_phone: form.phone.trim() || null,
      p_contact_email: session?.user?.email || null,
    }
    const { data: res, error } = claim.tier === 'milestone'
      ? await supabase.rpc('referral_claim_milestone', args)
      : await supabase.rpc('referral_claim', { p_referral_id: claim.referral.id, ...args })
    setBusy(false)
    if (error) return toast('تعذر إرسال الطلب: ' + error.message, true)

    await notifySuperAdminsReward({
      request_no: res?.request_no,
      reward_kind: form.kind,
      tier: claim.tier,
      months: res?.months,
      cash_amount: res?.cash_amount,
      employee_name: form.name || profile?.full_name,
      employee_phone: form.phone || profile?.phone,
      employee_email: session?.user?.email,
      employee_role: profile?.role,
      referral_code: myCode?.code,
      referral_link: link,
      referred_company_name: claim.referral?.referred_company_name || null,
      referred_owner_name: claim.referral?.referred_owner_name || null,
      referred_email: claim.referral?.referred_email || null,
      referred_phone: claim.referral?.referred_phone || null,
      referral_status: claim.referral?.status || 'paid',
      requested_at: new Date().toISOString(),
    })

    // بريد تأكيد للمستخدم بانتقال الطلب إلى الخطوة الجديدة (بانتظار اعتماد الإدارة) — عبر Outbox
    await notifyReferralStepChange({
      event: 'submitted',
      request_no: res?.request_no,
      new_status: 'pending_admin',
      reward_kind: form.kind,
      tier: claim.tier,
      months: res?.months,
      cash_amount: res?.cash_amount,
      user_email: session?.user?.email,
      referrer_name: form.name || profile?.full_name,
      referral_code: myCode?.code,
      referral_link: link,
      referred_company_name: claim.referral?.referred_company_name || null,
    })


    setClaim(null)
    toast(form.kind === 'cash'
      ? '✓ تم إرسال الطلب لخدمة العملاء — سيتم المراجعة والتواصل معك للاستلام'
      : '✓ تم إرسال طلب تمديد الاشتراك لاعتماد الإدارة')
    load()
  }

  const incoming = data?.incoming && data.incoming !== null ? data.incoming : null

  if (loading) return <div className="panel">جاري تحميل بيانات الترشيح…</div>

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* بطاقة الكود والرابط */}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>🎁 رابط وكود الترشيح الخاص بـ {profile?.full_name || 'المستخدم'}</h3>
        <p className="muted" style={{ fontSize: 13 }}>
          رشّح منشأة جديدة عبر الرابط أو الكود — الاثنان يعملان منفصلين أو مجتمعين. عند سداد المنشأة الجديدة
          لاشتراكها: تحصل على <b>3 أشهر إضافية</b> على اشتراكك أو <b>200 ريال نقداً</b>، وتحصل المنشأة الجديدة
          على <b>3 أشهر مجانية</b>. وعند إتمام <b>3 اشتراكات مسددة</b> تحصل على <b>سنة كاملة</b> أو <b>600 ريال</b>.
          كل تمديد يمر باعتماد إدارة المنصة أولاً.
        </p>

        <div className="grid2" style={{ gap: 12 }}>
          <div>
            <label className="muted" style={{ fontSize: 12 }}>كود الترشيح</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <b style={{ fontSize: 22, letterSpacing: 2, fontFamily: 'monospace' }}>{myCode?.code || '—'}</b>
              <button className="btn btn-outline btn-sm" onClick={() => copy(myCode?.code || '', 'تم نسخ الكود ✓')}>نسخ الكود</button>
            </div>
          </div>
          <div>
            <label className="muted" style={{ fontSize: 12 }}>رابط الترشيح</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input readOnly value={link} style={{ flex: 1, direction: 'ltr', fontSize: 12 }} />
              <button className="btn btn-gold btn-sm" onClick={() => copy(link, 'تم نسخ الرابط ✓')}>نسخ الرابط</button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
          <span className="chip">إجمالي الترشيحات: <b>{referrals.length}</b></span>
          <span className="chip chip-green">مسدّدة: <b>{paidCount}</b></span>
          <span className="chip chip-gold">مؤهّلة لمكافأة الإنجاز: <b>{unclaimedMilestone}</b>/3</span>
          {unclaimedMilestone >= 3 && (
            <button className="btn btn-gold btn-sm" onClick={() => openClaim(null, 'milestone')}>
              🏆 المطالبة بمكافأة 3 اشتراكات (سنة كاملة أو 600 ريال)
            </button>
          )}
        </div>
      </div>

      {/* ترشيح وارد (إن كانت منشأتي سجّلت عبر رابط) */}
      {incoming && (
        <div className="panel" style={{ borderRight: '3px solid var(--gold-l, #B8860B)' }}>
          <h4 style={{ marginTop: 0 }}>✓ تم تأكيد ترشيحك من: {incoming.referrer_name || 'صاحب الرابط'}</h4>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            كود الترشيح: <b>{incoming.code}</b> — سيتم إضافة <b>3 أشهر مجانية</b> على مدة اشتراكك بعد سداد الاشتراك
            واعتماد الإدارة. الحالة الحالية: <b>{REF_STATUS_LABEL[incoming.status] || incoming.status}</b>
          </p>
        </div>
      )}

      {/* جدول الترشيحات */}
      <div className="panel">
        <h4 style={{ marginTop: 0 }}>📋 المنشآت المُرشَّحة عبر روابط منشأتك</h4>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>المنشأة الجديدة</th><th>اسم المالك</th><th>البريد</th><th>الجوال</th>
                <th>الكود</th><th>صاحب الترشيح</th><th>تاريخ التسجيل</th><th>الحالة</th><th>المكافأة</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map(r => {
                const claimed = rewards.some(w => w.referral_id === r.id && w.beneficiary === 'referrer' && w.status !== 'rejected')
                return (
                  <tr key={r.id}>
                    <td><b>{r.referred_company_name || '—'}</b></td>
                    <td>{r.referred_owner_name || '—'}</td>
                    <td dir="ltr" style={{ fontSize: 12 }}>{r.referred_email || '—'}</td>
                    <td dir="ltr" style={{ fontSize: 12 }}>{r.referred_phone || '—'}</td>
                    <td style={{ fontFamily: 'monospace' }}>{r.code}</td>
                    <td>{r.referrer_name || '—'}</td>
                    <td style={{ fontSize: 12 }}>{fmt(r.signed_up_at)}</td>
                    <td>
                      <span className={'chip ' + (r.status === 'paid' ? 'chip-green' : '')}>
                        {REF_STATUS_LABEL[r.status] || r.status}
                      </span>
                    </td>
                    <td>
                      {claimed
                        ? <span className="chip">تم تقديم الطلب</span>
                        : r.status === 'paid'
                          ? <button className="btn btn-gold btn-sm" onClick={() => openClaim(r, 'single')}>المطالبة بالمكافأة</button>
                          : <span className="muted" style={{ fontSize: 12 }}>بانتظار السداد</span>}
                    </td>
                  </tr>
                )
              })}
              {referrals.length === 0 && (
                <tr><td colSpan="9" style={{ textAlign: 'center', padding: 20 }}>لا توجد ترشيحات بعد — شارك رابطك للبدء</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* طلبات المكافآت */}
      <div className="panel">
        <h4 style={{ marginTop: 0 }}>💼 طلبات المكافآت وحالتها</h4>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 800 }}>
            <thead>
              <tr><th>رقم الطلب</th><th>المستفيد</th><th>نوع المكافأة</th><th>المستوى</th><th>تاريخ الطلب</th><th>الحالة</th><th>ملاحظة الإدارة</th></tr>
            </thead>
            <tbody>
              {rewards.map(w => (
                <tr key={w.id}>
                  <td style={{ fontFamily: 'monospace' }}>{w.request_no}</td>
                  <td>{w.beneficiary === 'referrer' ? (w.beneficiary_name || 'صاحب الترشيح') : 'المنشأة المُرشَّحة'}</td>
                  <td>{REWARD_LABEL(w)}</td>
                  <td>{w.tier === 'milestone' ? 'إنجاز 3 اشتراكات' : 'ترشيح مفرد'}</td>
                  <td style={{ fontSize: 12 }}>{fmt(w.requested_at)}</td>
                  <td><span className={'chip ' + (w.status === 'approved' || w.status === 'paid' ? 'chip-green' : w.status === 'rejected' ? 'chip-red' : '')}>{STATUS_LABEL[w.status] || w.status}</span></td>
                  <td style={{ fontSize: 12 }}>{w.admin_note || '—'}</td>
                </tr>
              ))}
              {rewards.length === 0 && <tr><td colSpan="7" style={{ textAlign: 'center', padding: 20 }}>لا توجد طلبات مكافآت</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* نافذة المطالبة */}
      {claim && (
        <div className="modal-backdrop" style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 900
        }} onClick={() => !busy && setClaim(null)}>
          <div className="panel" style={{ width: 'min(520px, 94vw)', maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>
              {claim.tier === 'milestone' ? '🏆 مكافأة إتمام 3 اشتراكات' : '🎁 مكافأة الترشيح'}
            </h3>
            {claim.referral && (
              <p className="muted" style={{ fontSize: 13 }}>
                المنشأة المُرشَّحة: <b>{claim.referral.referred_company_name}</b> — حالة الاشتراك: <b>مسدَّد</b>
              </p>
            )}
            <div className="fld">
              <label>اختر نوع المكافأة</label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className={'btn btn-sm ' + (form.kind === 'months' ? 'btn-gold' : 'btn-outline')}
                  onClick={() => setForm(f => ({ ...f, kind: 'months' }))}>
                  {claim.tier === 'milestone' ? 'سنة كاملة على الاشتراك' : 'تمديد 3 أشهر على الاشتراك'}
                </button>
                <button className={'btn btn-sm ' + (form.kind === 'cash' ? 'btn-gold' : 'btn-outline')}
                  onClick={() => setForm(f => ({ ...f, kind: 'cash' }))}>
                  {claim.tier === 'milestone' ? 'استبدال نقدي 600 ريال' : 'استبدال نقدي 200 ريال'}
                </button>
              </div>
            </div>
            <div className="fld"><label>الاسم الكامل {form.kind === 'cash' && '*'}</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="fld"><label>رقم الهاتف {form.kind === 'cash' && '*'}</label>
              <input dir="ltr" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="05XXXXXXXX" /></div>
            <p className="muted" style={{ fontSize: 12 }}>
              سيُرسل الطلب إلى إدارة المنصة (Super Admin) للمراجعة والاعتماد — التمديد أو الصرف لا يتم إلا بعد الاعتماد.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setClaim(null)}>إلغاء</button>
              <button className="btn btn-gold btn-sm" disabled={busy} onClick={submitClaim}>
                {busy ? 'جاري الإرسال…' : 'إرسال الطلب'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
