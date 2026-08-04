import React, { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../AuthContext'
import { supabase } from '../../lib/supabase'
import { AcctPage, Field, Notice, EmptyState, RefreshButton } from '../../components/accounting/AcctKit'
import { ShieldCheck, Save, Activity, Send, ListChecks } from 'lucide-react'

/**
 * الربط مع منصة شموس (وزارة الداخلية) ووزارة السياحة.
 *
 * وضع صريح: المواصفة التقنية لواجهة شموس ليست منشورة علناً — تُسلَّم
 * للمتكاملين المرخّصين عبر «علم/تقنين» بعد التعاقد. لذلك لا تُخترع هنا
 * نقطة اتصال ولا أسماء حقول. ما هو جاهز فعلاً:
 *   • تخزين بيانات الربط لكل منشأة بحماية تقصر الاطلاع على الصلاحية المالية.
 *   • بناء حمولة التسجيل من بيانات النظام الحقيقية بكل الحقول المطلوبة.
 *   • طابور يستقبل كل تسجيل دخول وخروج تلقائياً وينتظر التفعيل.
 *   • قياس جاهزية يكشف الناقص حقلاً بحقل قبل التعاقد.
 * فور تسليم المواصفة لا يتبقى إلا مُرسِل HTTP يقرأ من هذا الطابور.
 */
export default function ShomoosPage() {
  const { profile } = useAuth()
  const cid = profile?.company_id

  const [f, setF] = useState(null)
  const [ready, setReady] = useState([])
  const [fields, setFields] = useState([])
  const [queue, setQueue] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  const set = (k, v) => setF(s => ({ ...s, [k]: v }))

  const load = useCallback(async () => {
    if (!cid) return
    setBusy(true); setErr('')
    try {
      const [s, r, m, q] = await Promise.all([
        supabase.from('shomoos_settings').select('*').eq('company_id', cid).maybeSingle(),
        supabase.rpc('shomoos_readiness', { p_company: cid }),
        supabase.from('shomoos_field_map').select('*').order('required', { ascending: false }),
        supabase.from('shomoos_queue').select('id, event_type, status, created_at, last_error')
          .eq('company_id', cid).order('created_at', { ascending: false }).limit(50),
      ])
      if (s.error) throw new Error(s.error.message)
      setF(s.data || {
        company_id: cid, enabled: false, environment: 'sandbox',
        auto_send_checkin: true, auto_send_checkout: true,
      })
      if (r.error) throw new Error(r.error.message)
      setReady(r.data || [])
      setFields(m.data || [])
      setQueue(q.data || [])
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [cid])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setBusy(true); setErr(''); setOk('')
    try {
      const row = { ...f, company_id: cid, updated_at: new Date().toISOString() }
      delete row.created_at
      if (typeof row.api_key === 'string' && row.api_key.startsWith('•')) delete row.api_key
      const { error } = await supabase.from('shomoos_settings').upsert(row, { onConflict: 'company_id' })
      if (error) throw new Error(error.message)
      setOk('حُفظت إعدادات الربط')
      await load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const testConnection = async () => {
    setBusy(true); setErr(''); setOk('')
    try {
      if (!f?.api_base_url) throw new Error('أدخل عنوان خدمة شموس أولاً — يُسلَّم مع المواصفة التقنية من مزوّد الخدمة')
      const res = await fetch(f.api_base_url, { method: 'HEAD', mode: 'cors' })
      await supabase.from('shomoos_settings').update({
        last_status: res.ok ? 'reachable' : `http_${res.status}`,
        last_checked_at: new Date().toISOString(),
      }).eq('company_id', cid)
      setOk(res.ok
        ? 'الخادم يستجيب. التسجيل الفعلي يحتاج المواصفة الرسمية للمسارات والحقول من مزوّد الخدمة.'
        : `الخادم رد بالرمز ${res.status}`)
      await load()
    } catch (e) {
      setErr('تعذّر الوصول للعنوان من المتصفح — غالباً حظر CORS أو عنوان غير صحيح. '
        + 'خدمات شموس تُستدعى عادةً من الخادم لا من المتصفح، وهذا متوقّع قبل تسليم المواصفة.')
      await supabase.from('shomoos_settings').update({
        last_status: 'unreachable', last_checked_at: new Date().toISOString(),
      }).eq('company_id', cid)
    } finally { setBusy(false) }
  }

  if (!f) {
    return <AcctPage title="الربط مع شموس" icon={<ShieldCheck size={20} />}><EmptyState>جارٍ التحميل…</EmptyState></AcctPage>
  }

  const failing = ready.filter(r => r.o_status === 'fail').length
  const warning = ready.filter(r => r.o_status === 'warn').length
  const passing = ready.filter(r => r.o_status === 'pass').length

  return (
    <AcctPage
      title="الربط مع منصة شموس ووزارة السياحة"
      icon={<ShieldCheck size={20} />}
      subtitle="تسجيل بيانات النزلاء لدى وزارة الداخلية — الإعدادات والجاهزية وطابور الإرسال"
      tools={
        <>
          <RefreshButton onClick={load} busy={busy} />
          <button className="btn btn-ghost btn-sm" onClick={testConnection} disabled={busy}>
            <Activity size={14} /> اختبار الوصول
          </button>
          <button className="btn btn-gold btn-sm" onClick={save} disabled={busy}>
            <Save size={14} /> حفظ
          </button>
        </>
      }
    >
      <Notice kind="error" onClose={() => setErr('')}>{err}</Notice>
      <Notice kind="ok" onClose={() => setOk('')}>{ok}</Notice>

      <Notice kind="info">
        المواصفة التقنية لواجهة شموس غير منشورة علناً — تُسلَّم للمتكاملين المرخّصين عبر «علم / تقنين»
        بعد التعاقد. النظام هنا جاهز من جهته: يبني الحمولة الكاملة من بياناتك ويضعها في طابور،
        ولا يتبقى إلا توصيل عنوان الخدمة ومساراتها الرسمية.
      </Notice>

      {/* ------------------------ الجاهزية ------------------------ */}
      <div className="acct-kpis">
        <div><span>عناصر جاهزة</span><b style={{ color: '#065F46' }}>{passing}</b></div>
        <div className={warning ? 'due' : ''}><span>بيانات ناقصة</span><b>{warning}</b></div>
        <div className={failing ? 'due' : ''}><span>إعدادات مطلوبة</span><b>{failing}</b></div>
      </div>

      <section className="acct-section">
        <div className="acct-section-head">
          <ListChecks size={16} />
          <b>قياس الجاهزية</b>
          <span>يفحص إعدادات المنشأة واكتمال بيانات النزلاء في الحجوزات النشطة</span>
        </div>
        <table className="acct-table sm">
          <thead><tr><th>العنصر</th><th>الحالة</th><th>التفصيل</th><th>عدد النواقص</th></tr></thead>
          <tbody>
            {ready.map((r, i) => (
              <tr key={i}>
                <td>{r.o_item}</td>
                <td>
                  <span className={'acct-badge ' + (r.o_status === 'pass' ? 'ok' : r.o_status === 'warn' ? 'warn' : 'bad')}>
                    {r.o_status === 'pass' ? 'جاهز' : r.o_status === 'warn' ? 'ناقص' : 'مطلوب'}
                  </span>
                </td>
                <td>{r.o_detail}</td>
                <td className="num">{r.o_count || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ------------------------ الإعدادات ------------------------ */}
      <section className="acct-section">
        <div className="acct-section-head">
          <b>بيانات الربط</b>
          <span>تُستخرج من حساب منشأتك في شموس بعد اعتماد الرخصة</span>
        </div>
        <div className="acct-form">
          <label><span>رقم المنشأة لدى وزارة الداخلية *</span>
            <input value={f.facility_number || ''} dir="ltr" onChange={e => set('facility_number', e.target.value)} />
          </label>
          <label><span>رقم رخصة وزارة السياحة *</span>
            <input value={f.tourism_license || ''} dir="ltr" onChange={e => set('tourism_license', e.target.value)} />
          </label>
          <label><span>اسم المنشأة كما في الرخصة</span>
            <input value={f.facility_name || ''} onChange={e => set('facility_name', e.target.value)} />
          </label>
          <label><span>المدينة</span>
            <input value={f.facility_city || ''} onChange={e => set('facility_city', e.target.value)} />
          </label>
          <label className="wide"><span>عنوان خدمة شموس (من المواصفة الرسمية)</span>
            <input value={f.api_base_url || ''} dir="ltr" placeholder="https://…" onChange={e => set('api_base_url', e.target.value)} />
          </label>
          <label><span>اسم المستخدم للربط</span>
            <input value={f.api_username || ''} dir="ltr" onChange={e => set('api_username', e.target.value)} />
          </label>
          <label><span>مفتاح الربط (API Key)</span>
            <input type="password" dir="ltr" value={f.api_key || ''}
              placeholder={f.api_key ? 'محفوظ — اتركه فارغاً للإبقاء عليه' : 'ألصق المفتاح'}
              onChange={e => set('api_key', e.target.value)} />
          </label>
          <label><span>البيئة</span>
            <select value={f.environment || 'sandbox'} onChange={e => set('environment', e.target.value)}>
              <option value="sandbox">تجريبية (Sandbox)</option>
              <option value="production">إنتاج</option>
            </select>
          </label>
          <label className="acct-chk">
            <input type="checkbox" checked={!!f.enabled} onChange={e => set('enabled', e.target.checked)} />
            تفعيل الربط (يبدأ تجميع السجلات في الطابور تلقائياً)
          </label>
          <label className="acct-chk">
            <input type="checkbox" checked={f.auto_send_checkin !== false} onChange={e => set('auto_send_checkin', e.target.checked)} />
            تسجيل تلقائي عند دخول النزيل
          </label>
          <label className="acct-chk">
            <input type="checkbox" checked={f.auto_send_checkout !== false} onChange={e => set('auto_send_checkout', e.target.checked)} />
            تسجيل تلقائي عند خروج النزيل
          </label>
        </div>
        {f.last_checked_at && (
          <p className="sbset-hint" style={{ marginTop: 10 }}>
            آخر اختبار وصول: {new Date(f.last_checked_at).toLocaleString('ar-SA')} — النتيجة: {f.last_status || '—'}
          </p>
        )}
      </section>

      {/* ------------------ الحقول التي يطلبها شموس ------------------ */}
      <section className="acct-section">
        <div className="acct-section-head">
          <b>البيانات التي يطلبها شموس ومصدر كل حقل في نظامك</b>
          <span>كل حقل مربوط بعموده الفعلي — لا حقل بلا مصدر</span>
        </div>
        <table className="acct-table sm">
          <thead><tr><th>الحقل</th><th>إلزامي</th><th>مصدره في النظام</th><th>ملاحظة</th></tr></thead>
          <tbody>
            {fields.map(x => (
              <tr key={x.field_key}>
                <td>{x.label_ar}</td>
                <td><span className={'acct-badge ' + (x.required ? 'bad' : '')}>{x.required ? 'إلزامي' : 'اختياري'}</span></td>
                <td dir="ltr" style={{ textAlign: 'right' }}><code>{x.source_table}.{x.source_col}</code></td>
                <td>{x.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ------------------------ الطابور ------------------------ */}
      <section className="acct-section">
        <div className="acct-section-head">
          <Send size={16} />
          <b>طابور التسجيل</b>
          <span>كل دخول وخروج يدخل هنا تلقائياً عند تفعيل الربط — والسجل الناقص يُحجب مع بيان نقصه</span>
        </div>
        {!queue.length ? (
          <EmptyState>الطابور فارغ. فعّل الربط ليبدأ تجميع سجلات النزلاء تلقائياً.</EmptyState>
        ) : (
          <table className="acct-table sm">
            <thead><tr><th>الحدث</th><th>الحالة</th><th>التاريخ</th><th>ملاحظة</th></tr></thead>
            <tbody>
              {queue.map(q => (
                <tr key={q.id}>
                  <td>{q.event_type === 'checkin' ? 'دخول' : q.event_type === 'checkout' ? 'خروج' : 'تحديث'}</td>
                  <td>
                    <span className={'acct-badge ' + (
                      q.status === 'sent' ? 'ok' : q.status === 'blocked' ? 'bad' : 'warn')}>
                      {{ pending: 'بانتظار الإرسال', sent: 'أُرسل', failed: 'فشل', blocked: 'محجوب — بيانات ناقصة' }[q.status]}
                    </span>
                  </td>
                  <td>{new Date(q.created_at).toLocaleString('ar-SA')}</td>
                  <td>{q.last_error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </AcctPage>
  )
}
