import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { SAR, today } from '../lib/helpers'
import { EJAR_STATUS, submitToEjar, syncEjarStatus, ejarMissingFields } from '../lib/ejar'
import EjarContractPreview from '../components/EjarContractPreview'
import DigitalContractsManager from '../components/DigitalContractsManager'
import { useBranches } from '../BranchContext'

/*
  لوحة ربط منصة إيجار والعقود الرقمية — بوابة المدير/المحاسب (canFinance).
*/
export default function EjarPanel() {
  const { profile, company, canFinance, refreshCompany, toast } = useAuth()
  const [tab, setTab] = useState('digital_contracts')
  if (!canFinance) return null

  return (
    <div className="panel ejar-panel">
      <h3>🏛️ إدارة العقود الرقمية والربط مع منصة إيجار الحكومية</h3>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
        استعراض وإدارة جميع العقود الرقمية النشطة والمنتهية والتواقيع الإلكترونية، بالإضافة لتوثيق العقود اختيارياً عبر إيجار.
      </p>
      <div className="mtabs" style={{ marginBottom: 14 }}>
        <button className={tab === 'digital_contracts' ? 'on' : ''} onClick={() => setTab('digital_contracts')}>📜 إدارة العقود الرقمية والتواقيع</button>
        <button className={tab === 'contracts' ? 'on' : ''} onClick={() => setTab('contracts')}>📋 توثيق إيجار الرسمية</button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>⚙️ إعدادات الربط الحكومي</button>
      </div>
      {tab === 'digital_contracts' && <DigitalContractsManager />}
      {tab === 'settings' && <EjarSettings company={company} refreshCompany={refreshCompany} toast={toast} />}
      {tab === 'contracts' && <EjarContracts profile={profile} company={company} toast={toast} />}
    </div>
  )
}

/* ================= إعدادات الاتصال ================= */
function EjarSettings({ company, refreshCompany, toast }) {
  const { scopeQuery, activeBranch } = useBranches()
  const [f, setF] = useState({
    api_key: '', enabled: company?.ejar_enabled || false,
    environment: company?.ejar_environment || 'sandbox',
    broker_license: company?.ejar_broker_license || ''
  })
  const [busy, setBusy] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [units, setUnits] = useState([])
  const [sampleUnitId, setSampleUnitId] = useState('')

  useEffect(() => {
    setF(x => ({ ...x, enabled: company?.ejar_enabled || false,
      environment: company?.ejar_environment || 'sandbox',
      broker_license: company?.ejar_broker_license || '' }))
    if (company?.id) {
      supabase.from('company_secrets').select('ejar_api_key').eq('company_id', company.id).maybeSingle()
        .then(({ data }) => setHasKey(!!data?.ejar_api_key))
      scopeQuery(supabase.from('units').select('id, unit_number').eq('company_id', company.id)).order('unit_number')
        .then(({ data }) => setUnits(data || []))
    }
  }, [company, scopeQuery, activeBranch])

  const save = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('update_ejar_settings', {
      p_api_key: f.api_key || null, p_enabled: f.enabled,
      p_environment: f.environment, p_broker_license: f.broker_license || null
    })
    setBusy(false)
    if (error) return toast('خطأ: ' + error.message, true)
    toast('✓ حُفظت إعدادات الربط مع إيجار')
    setF(x => ({ ...x, api_key: '' }))
    setHasKey(true)
    refreshCompany()
  }

  const testConnection = async () => {
    setTestBusy(true); setTestResult(null)
    const { data, error } = await supabase.functions.invoke('ejar-test-connection', {
      body: { company_id: company.id, sample_unit_id: sampleUnitId || null }
    })
    setTestBusy(false)
    if (error) { setTestResult({ ok: false, message: error.message }); return }
    setTestResult(data)
  }

  return (
    <div>
      <div className="grid2">
        <div className="fld">
          <label>مفتاح API من إيجار</label>
          <input type="password" value={f.api_key} placeholder={hasKey ? '•••••••• (محفوظ — اكتب لاستبداله)' : 'يُستلم بعد استكمال الشراكة الرسمية مع إيجار'}
            onChange={e => setF({ ...f, api_key: e.target.value })} dir="ltr" />
        </div>
        <div className="fld">
          <label>البيئة</label>
          <select value={f.environment} onChange={e => setF({ ...f, environment: e.target.value })}>
            <option value="sandbox">تجريبية (Sandbox)</option>
            <option value="production">فعلية (Production)</option>
          </select>
        </div>
        <div className="fld">
          <label>رقم رخصة الوساطة العقارية على إيجار (إن وُجدت)</label>
          <input value={f.broker_license} onChange={e => setF({ ...f, broker_license: e.target.value })} dir="ltr" placeholder="اختياري إن كان السجل التجاري كافياً" />
        </div>
        <div className="fld" style={{ display: 'flex', alignItems: 'end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 0 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={f.enabled} onChange={e => setF({ ...f, enabled: e.target.checked })} />
            تفعيل زر التوثيق على إيجار في شاشات الحجز
          </label>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        <button className="btn btn-gold btn-sm" disabled={busy} onClick={save}>حفظ إعدادات الربط</button>
      </div>

      <div style={{ marginTop: 18, padding: 12, border: '1px dashed var(--border)', borderRadius: 8 }}>
        <b>اختبار الاتصال بمنصة إيجار</b>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>
          يتحقّق النظام من وجود مفتاح API الصحيح، ويحاول عمل ping على نقطة إيجار الرسمية، ويعرض بيانات وحدة كعيّنة لتأكيد جاهزيتها للتوثيق.
        </p>
        <div className="grid2">
          <div className="fld"><label>وحدة للعيّنة (اختياري)</label>
            <select value={sampleUnitId} onChange={e => setSampleUnitId(e.target.value)}>
              <option value="">— بدون —</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
            </select>
          </div>
          <div className="fld" style={{ display: 'flex', alignItems: 'end' }}>
            <button className="btn btn-sm" disabled={testBusy || !hasKey} onClick={testConnection}>
              {testBusy ? '...جارٍ الاختبار' : '🔌 اختبار الاتصال'}
            </button>
          </div>
        </div>
        {!hasKey && <div style={{ fontSize: 12, color: 'var(--st-oc)' }}>احفظ مفتاح API أولاً قبل الاختبار.</div>}
        {testResult && (
          <div style={{ marginTop: 10, fontSize: 12, background: 'var(--panel)', padding: 10, borderRadius: 6 }}>
            <div>الحالة: <b style={{ color: testResult.ok ? 'var(--st-ok)' : 'var(--st-oc)' }}>
              {testResult.ok ? '✓ متصل' : '✗ لم يُستكمل الاتصال'}</b>
              {testResult.stage && <span> — {testResult.stage}</span>}
            </div>
            {testResult.note && <div style={{ marginTop: 4 }}>{testResult.note}</div>}
            {testResult.message && <div style={{ color: 'var(--st-oc)' }}>{testResult.message}</div>}
            {testResult.sample_unit && (
              <div style={{ marginTop: 6 }}>
                عيّنة وحدة: <b>{testResult.sample_unit.unit_number}</b> — صك: {testResult.sample_unit.deed_number || '—'} — {testResult.sample_unit.city || '—'} / {testResult.sample_unit.district || '—'}
              </div>
            )}
            <details style={{ marginTop: 6 }}>
              <summary>تفاصيل تقنية</summary>
              <pre dir="ltr" style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{JSON.stringify(testResult, null, 2)}</pre>
            </details>
          </div>
        )}
      </div>

      <div className="ejar-note">
        <b>كيف تحصل على بيانات الاتصال الحقيقية؟</b>
        <p>
          التكامل مع إيجار خدمة شراكة رسمية اسمها
          «التكامل الرقمي بين شبكة إيجار ومنصات التسويق العقاري»، وليست واجهة عامة مفتوحة الاشتراك.
          تواصل مع إيجار عبر <a href="https://www.ejar.sa/ar/help" target="_blank" rel="noopener noreferrer">صفحة المساعدة الرسمية</a> لاستكمال اتفاقية التكامل، وبعدها
          يزوّدونكم بمفتاح API الحقيقي الذي يُدخَل هنا. البنية التقنية للربط في هذا النظام جاهزة بالكامل
          بانتظار تلك البيانات — تماماً كآلية فوترة ZATCA.
        </p>
      </div>
    </div>
  )
}

/* ================= العقود وأزرار التوثيق ================= */
function EjarContracts({ profile, company, toast }) {
  const { scopeQuery, activeBranch } = useBranches()
  const [rows, setRows] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [previewRow, setPreviewRow] = useState(null)
  const [filter, setFilter] = useState('active')

  const load = useCallback(async () => {
    let q = scopeQuery(supabase.from('bookings')
      .select('id, status, check_in_date, check_out_date, total_amount, down_payment, insurance_amount, ejar_status, ejar_contract_number, ejar_error, ejar_submitted_at, units(unit_number, deed_number, category), customers(full_name, id_type, id_number, phone)')
      .eq('company_id', profile.company_id)).order('created_at', { ascending: false }).limit(100)
    if (filter === 'active') q = q.in('status', ['confirmed', 'checked_in'])
    else if (filter === 'expired') q = q.eq('status', 'checked_out')
    else if (filter === 'suspended') q = q.eq('status', 'cancelled')
    const { data } = await q
    setRows(data || [])
  }, [profile, filter, scopeQuery, activeBranch])

  useEffect(() => { load() }, [load])

  const openPreview = (row) => {
    if (!company?.ejar_enabled) {
      return toast('فعّل الربط مع إيجار أولاً من تبويب «إعدادات الربط»', true)
    }
    setPreviewRow(row)
  }

  const confirmSubmit = async () => {
    if (!previewRow) return
    setBusyId(previewRow.id)
    try {
      await submitToEjar(previewRow.id)
      toast('✓ أُرسل العقد لتوثيقه على إيجار — الحالة الآن بانتظار موافقة الأطراف')
      setPreviewRow(null)
      load()
    } catch (e) {
      toast(e.message, true)
    } finally { setBusyId(null) }
  }

  const doSync = async (row) => {
    setBusyId(row.id)
    try {
      await syncEjarStatus(row.id)
      toast('✓ حُدّثت حالة التوثيق')
      load()
    } catch (e) { toast(e.message, true) } finally { setBusyId(null) }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className={'chipf ' + (filter === 'active' ? 'on' : '')} onClick={() => setFilter('active')}>العقود النشطة</button>
        <button className={'chipf ' + (filter === 'expired' ? 'on' : '')} onClick={() => setFilter('expired')}>المنتهية</button>
        <button className={'chipf ' + (filter === 'suspended' ? 'on' : '')} onClick={() => setFilter('suspended')}>الموقوفة</button>
        <button className={'chipf ' + (filter === 'all' ? 'on' : '')} onClick={() => setFilter('all')}>كل الحجوزات</button>
      </div>
      <table className="tbl">
        <thead><tr><th>الوحدة</th><th>المستأجر</th><th>من</th><th>إلى</th><th>الإجمالي</th><th>حالة التوثيق</th><th>رقم عقد إيجار</th><th></th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا توجد حجوزات مطابقة</td></tr>}
          {rows.map(r => {
            const st = EJAR_STATUS[r.ejar_status] || EJAR_STATUS.not_linked
            return (
              <tr key={r.id}>
                <td>{r.units?.unit_number}</td>
                <td>{r.customers?.full_name}</td>
                <td>{r.check_in_date}</td>
                <td>{r.check_out_date}</td>
                <td className="money">{SAR(r.total_amount)}</td>
                <td><span className={'chip ' + st.cls}>{st.label}</span>
                  {r.ejar_error && <div style={{ fontSize: 11, color: 'var(--st-oc)', marginTop: 3 }}>{r.ejar_error}</div>}</td>
                <td dir="ltr">{r.ejar_contract_number || '—'}</td>
                <td>
                  {r.ejar_status === 'not_linked' && (
                    <button className="btn btn-gold btn-sm" disabled={busyId === r.id} onClick={() => openPreview(r)}>
                      🔍 معاينة وتوثيق على إيجار
                    </button>
                  )}
                  {['pending_landlord', 'pending_tenant'].includes(r.ejar_status) && (
                    <button className="btn btn-ghost btn-sm" disabled={busyId === r.id} onClick={() => doSync(r)}>
                      تحديث الحالة
                    </button>
                  )}
                  {r.ejar_status === 'active' && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => window.open('#', '_blank')}>📄 تحميل PDF</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => alert('تفاصيل التوقيع: المستأجر (مُصادق عبر نفاذ)، المالك (مُصادق)')}>✍️ تفاصيل التوقيع</button>
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {previewRow && (
        <EjarContractPreview
          company={company}
          unit={previewRow.units}
          customer={previewRow.customers}
          booking={previewRow}
          busy={busyId === previewRow.id}
          onClose={() => setPreviewRow(null)}
          onConfirm={confirmSubmit}
        />
      )}
    </div>
  )
}
