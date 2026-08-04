import React, { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../AuthContext'
import { supabase } from '../../lib/supabase'
import { AcctPage, Field, Notice, EmptyState } from '../../components/accounting/AcctKit'
import { Plug, Save, Trash2, Activity } from 'lucide-react'

/**
 * الربط مع أودو (Odoo).
 * الربط شخصي: لكل مستخدم حسابه ومفتاحه، ولا يقرأ أحدٌ مفتاح غيره —
 * سياسة RLS على odoo_connections تقصر الصفوف على auth.uid() حتى للسوبر أدمن.
 *
 * الاتصال يتم عبر واجهة أودو القياسية JSON-RPC:
 *   /web/session/authenticate  للتحقق من الهوية
 *   /jsonrpc  (execute_kw) لقراءة وكتابة السجلات
 * ومفتاح الـ API يُستخدم مكان كلمة المرور كما توثّقه أودو 14+.
 */
export default function OdooPage() {
  const { session, profile } = useAuth()
  const uid = session?.user?.id

  const [f, setF] = useState({ base_url: '', db_name: '', login: '', api_key: '', is_active: true })
  const [exists, setExists] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [probe, setProbe] = useState(null)

  const set = (k, v) => setF(s => ({ ...s, [k]: v }))

  const load = useCallback(async () => {
    if (!uid) return
    const { data, error } = await supabase.from('odoo_connections').select('*').eq('user_id', uid).maybeSingle()
    if (error) { setErr(error.message); return }
    if (data) { setF({ ...data, api_key: data.api_key ? '••••••••••••••••' : '' }); setExists(true) }
  }, [uid])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setBusy(true); setErr(''); setOk('')
    try {
      const row = {
        user_id: uid, company_id: profile?.company_id || null,
        base_url: f.base_url.replace(/\/+$/, ''), db_name: f.db_name, login: f.login,
        is_active: f.is_active !== false, updated_at: new Date().toISOString(),
      }
      // لا نكتب المفتاح إن لم يُغيَّر — القيمة المعروضة مموّهة
      if (f.api_key && !f.api_key.startsWith('•')) row.api_key = f.api_key
      else if (!exists) throw new Error('أدخل مفتاح الربط')

      const { error } = await supabase.from('odoo_connections')
        .upsert(row, { onConflict: 'user_id' })
      if (error) throw new Error(error.message)
      setExists(true); setOk('حُفظت إعدادات الربط في حسابك وحدك')
      await load()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  /**
   * اختبار الاتصال الحقيقي بخادم أودو.
   * يُنفَّذ من المتصفح مباشرة إلى خادم المستخدم؛ إن منع خادمه CORS
   * ظهر ذلك صراحةً بدل ادّعاء نجاح غير مثبت.
   */
  const test = async () => {
    setBusy(true); setErr(''); setOk(''); setProbe(null)
    const url = f.base_url.replace(/\/+$/, '')
    try {
      if (!url) throw new Error('أدخل عنوان خادم أودو أولاً')
      const key = f.api_key && !f.api_key.startsWith('•')
        ? f.api_key
        : (await supabase.from('odoo_connections').select('api_key').eq('user_id', uid).maybeSingle()).data?.api_key
      if (!key) throw new Error('لا يوجد مفتاح ربط محفوظ')

      const res = await fetch(`${url}/jsonrpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', method: 'call',
          params: { service: 'common', method: 'login', args: [f.db_name, f.login, key] },
          id: Date.now(),
        }),
      })
      const json = await res.json()
      if (json.error) throw new Error(json.error.data?.message || json.error.message || 'رفض الخادم البيانات')
      const okConn = !!json.result
      setProbe({ ok: okConn, uid: json.result })
      await supabase.from('odoo_connections').update({
        last_status: okConn ? 'connected' : 'auth_failed',
        last_checked_at: new Date().toISOString(),
      }).eq('user_id', uid)
      if (okConn) setOk(`الاتصال ناجح — معرّف المستخدم في أودو: ${json.result}`)
      else setErr('رفض أودو بيانات الدخول — راجع اسم قاعدة البيانات والبريد والمفتاح')
    } catch (e) {
      const isNet = /Failed to fetch|NetworkError|CORS/i.test(e.message)
      setProbe({ ok: false, network: isNet })
      setErr(isNet
        ? 'تعذّر الوصول لخادم أودو من المتصفح. غالباً بسبب حظر CORS أو أن العنوان غير صحيح — تأكد أن العنوان يبدأ بـ https وأن الخادم يسمح بالنطاق.'
        : e.message)
      await supabase.from('odoo_connections').update({
        last_status: 'error', last_checked_at: new Date().toISOString(),
      }).eq('user_id', uid)
    } finally { setBusy(false) }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await supabase.from('odoo_connections').delete().eq('user_id', uid)
      setF({ base_url: '', db_name: '', login: '', api_key: '', is_active: true })
      setExists(false); setOk('حُذف الربط')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  if (!uid) return <AcctPage title="الربط مع أودو" icon={<Plug size={20} />}><EmptyState>سجّل الدخول أولاً.</EmptyState></AcctPage>

  return (
    <AcctPage
      title="الربط مع أودو (Odoo)"
      icon={<Plug size={20} />}
      subtitle="ربط شخصي لكل مستخدم — مفتاحك لا يراه أحد غيرك، ولا حتى مدير المنصة"
      tools={
        <>
          <button className="btn btn-ghost btn-sm" onClick={test} disabled={busy}>
            <Activity size={14} /> اختبار الاتصال
          </button>
          <button className="btn btn-gold btn-sm" onClick={save} disabled={busy || !f.base_url || !f.db_name || !f.login}>
            <Save size={14} /> حفظ
          </button>
          {exists && <button className="btn btn-danger btn-sm" onClick={remove} disabled={busy}><Trash2 size={14} /> حذف الربط</button>}
        </>
      }
    >
      <Notice kind="error" onClose={() => setErr('')}>{err}</Notice>
      <Notice kind="ok" onClose={() => setOk('')}>{ok}</Notice>

      <section className="acct-section">
        <div className="acct-section-head">
          <b>بيانات الاتصال</b>
          <span>احصل على مفتاح الربط من أودو: الإعدادات ← المستخدمون ← حسابك ← مفاتيح API</span>
        </div>
        <div className="acct-form">
          <label className="wide"><span>عنوان خادم أودو *</span>
            <input value={f.base_url} onChange={e => set('base_url', e.target.value)}
              placeholder="https://mycompany.odoo.com" dir="ltr" />
          </label>
          <label><span>اسم قاعدة البيانات *</span>
            <input value={f.db_name} onChange={e => set('db_name', e.target.value)} placeholder="mycompany" dir="ltr" />
          </label>
          <label><span>البريد / اسم الدخول *</span>
            <input value={f.login} onChange={e => set('login', e.target.value)} dir="ltr" />
          </label>
          <label className="wide"><span>مفتاح الربط (API Key) *</span>
            <input type="password" value={f.api_key} onChange={e => set('api_key', e.target.value)}
              placeholder={exists ? 'محفوظ — اتركه فارغاً للإبقاء عليه' : 'ألصق المفتاح هنا'} dir="ltr" />
          </label>
          <label className="acct-chk">
            <input type="checkbox" checked={f.is_active !== false} onChange={e => set('is_active', e.target.checked)} />
            الربط مفعّل
          </label>
        </div>
      </section>

      {probe && (
        <section className="acct-section">
          <div className="acct-section-head"><b>نتيجة الاختبار</b></div>
          <table className="acct-table sm">
            <tbody>
              <tr><td>حالة الاتصال</td>
                <td><span className={'acct-badge ' + (probe.ok ? 'ok' : 'bad')}>
                  {probe.ok ? 'متصل بنجاح' : probe.network ? 'تعذّر الوصول للخادم' : 'رُفضت بيانات الدخول'}
                </span></td></tr>
              {probe.uid && <tr><td>معرّف المستخدم في أودو</td><td>{probe.uid}</td></tr>}
              <tr><td>آخر فحص</td><td>{new Date().toLocaleString('ar-SA')}</td></tr>
            </tbody>
          </table>
        </section>
      )}

      <section className="acct-section">
        <div className="acct-section-head"><b>ما الذي يفعله الربط</b></div>
        <ul className="acct-list">
          <li>يتحقق من هويتك على خادم أودو عبر واجهة JSON-RPC القياسية.</li>
          <li>يجعل شجرة حسابات المازن وقيوده قابلة للمزامنة مع دفاتر أودو لديك.</li>
          <li>الربط شخصي: كل مستخدم ينشئ حسابه في أودو ويربطه إن أراد — ولا يؤثر على غيره.</li>
          <li>مفتاحك مخزّن في صفٍّ محمي بسياسة تقصر القراءة على حسابك وحده.</li>
        </ul>
      </section>
    </AcctPage>
  )
}
