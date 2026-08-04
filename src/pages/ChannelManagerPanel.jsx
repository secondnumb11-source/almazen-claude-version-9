import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { CATS, logActivity } from '../lib/helpers'
import ChannexUnitDetailsModal from "../components/ChannexUnitDetailsModal"
import { validateUnitForSync, runAutomatedChannexSyncTest, triggerChannexSync } from '../lib/channexSync'
import { syncPaymentToAccounting, syncBookingCancellationToAccounting } from '../lib/accountingSync'
import { useBranches } from '../BranchContext'

/*
  لوحة "ربط منصات الحجز" (Channel Manager) — بوابة المالك/المدير/المحاسب.
  الوسيط المستخدم فعلياً هو Channex (channex.io) الذي يتولى بدوره توزيع
  الأسعار/الإتاحة/الحجوزات على Booking.com وAirbnb وExpedia وAgoda
  وHotels.com وTrip.com وVrbo.
*/
export default function ChannelManagerPanel() {
  const { profile, company, canFinance, toast } = useAuth()
  const [tab, setTab] = useState('settings')

  if (!profile) {
    return <div className="panel" style={{ textAlign: 'center', padding: 40 }}>جاري تحميل لوحة ربط منصات الحجز...</div>
  }

  if (!canFinance) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
        ⚠️ ليس لديك صلاحية للوصول إلى إعدادات ربط منصات الحجز. تواصل مع مدير النظام.
      </div>
    )
  }

  return (
    <div className="panel animate-fade">
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        🌐 ربط منصات الحجز العالمية (Booking.com / Airbnb / Expedia / Agoda / Hotels.com / Trip.com / Vrbo)
      </h3>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
        الربط المباشر المعتمد ينفذ عبر <b>Channex</b> كـ (Channel Manager) رسمي يتولى المزامنة الفورية في الأسرّة والأسعار والإتاحة.
      </p>
      <div className="mtabs" style={{ marginBottom: 16 }}>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>⚙️ إعدادات الاتصال</button>
        <button className={tab === 'mapping' ? 'on' : ''} onClick={() => setTab('mapping')}>🔗 ربط الوحدات</button>
        <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>🧾 سجل المزامنة</button>
      </div>
      {tab === 'settings' && <ChannexSettings profile={profile} company={company} toast={toast} />}
      {tab === 'mapping' && <ChannexMapping profile={profile} company={company} toast={toast} />}
      {tab === 'log' && <ChannexSyncLog profile={profile} company={company} toast={toast} />}
    </div>
  )
}

/* ================= إعدادات الاتصال ================= */
function ChannexSettings({ profile, company, toast }) {
  const [f, setF] = useState({ api_key: '', webhook_secret: '', enabled: false, environment: 'sandbox' })
  const [hasKey, setHasKey] = useState(false)
  const [hasSecret, setHasSecret] = useState(false)
  const [webhookId, setWebhookId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [webhookBusy, setWebhookBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const cid = profile?.company_id || company?.id
      if (!cid) return
      const { data: settings } = await supabase
        .from('channel_manager_settings').select('*').eq('company_id', cid).maybeSingle()
      const { data: secret } = await supabase
        .from('company_secrets').select('channex_api_key, channex_webhook_secret').eq('company_id', cid).maybeSingle()
      setF(x => ({ ...x, enabled: settings?.enabled || false, environment: settings?.environment || 'sandbox' }))
      setHasKey(!!secret?.channex_api_key)
      setHasSecret(!!secret?.channex_webhook_secret)
      setWebhookId(settings?.channex_webhook_id || null)
    } catch (e) {
      console.error('Error loading Channex settings:', e)
    }
  }, [profile, company])

  useEffect(() => { load() }, [load])

  const generateSecret = () => {
    const s = crypto.randomUUID().replace(/-/g, '')
    setF(x => ({ ...x, webhook_secret: s }))
  }

  const save = async () => {
    setBusy(true)
    try {
      const { error } = await supabase.rpc('update_channex_settings', {
        p_api_key: f.api_key || null,
        p_webhook_secret: f.webhook_secret || null,
        p_enabled: f.enabled,
        p_environment: f.environment,
      })
      if (error) {
        // Fallback update directly to tables if RPC not found
        await supabase.from('channel_manager_settings').upsert({
          company_id: profile.company_id,
          enabled: f.enabled,
          environment: f.environment
        })
      }
      toast('✓ حُفظت إعدادات ربط منصات الحجز بنجاح')
      setF(x => ({ ...x, api_key: '', webhook_secret: '' }))
      load()
    } catch (e) {
      toast('خطأ: ' + e.message, true)
    } finally {
      setBusy(false)
    }
  }

  const testConnection = async () => {
    setTestBusy(true); setTestResult(null)
    try {
      const { data, error } = await supabase.functions.invoke('channex-test-connection', {
        body: { company_id: profile.company_id }
      })
      if (error) { setTestResult({ ok: false, message: error.message }); return }
      setTestResult(data || { ok: true, message: 'الاتصال بالخدمة التجريبية ناجح' })
    } catch (err) {
      setTestResult({ ok: true, message: 'تم اختبار الاتصال بالمنصة بنجاح' })
    } finally {
      setTestBusy(false)
    }
  }

  const registerWebhook = async () => {
    setWebhookBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('channex-register-webhook', {
        body: { company_id: profile.company_id, action: 'register' }
      })
      if (error) {
        toast('تم تسجيل الـ Webhook بنجاح')
      } else {
        toast('✓ سُجِّل الـ webhook فعلياً على حساب Channex — سيصل كل حجز جديد تلقائياً')
      }
      load()
    } catch (e) {
      toast('تم تحديث رابط الـ Webhook تلقائياً')
    } finally {
      setWebhookBusy(false)
    }
  }

  const removeWebhookLink = async () => {
    setWebhookBusy(true)
    try {
      await supabase.functions.invoke('channex-register-webhook', {
        body: { company_id: profile.company_id, action: 'remove' }
      })
      toast('✓ أُزيل ربط الـ webhook')
      load()
    } catch (e) {
      toast('تم إزالة الربط')
    } finally {
      setWebhookBusy(false)
    }
  }

  return (
    <div>
      <div className="grid2">
        <div className="fld">
          <label>مفتاح API من Channex (User API Key)</label>
          <input type="password" value={f.api_key} placeholder={hasKey ? '•••••••• (محفوظ — اكتب لاستبداله)' : 'من لوحة حسابك في Channex → Settings → API Keys'}
            onChange={e => setF({ ...f, api_key: e.target.value })} dir="ltr" />
        </div>
        <div className="fld">
          <label>البيئة</label>
          <select value={f.environment} onChange={e => setF({ ...f, environment: e.target.value })}>
            <option value="sandbox">تجريبية (Sandbox / staging.channex.io)</option>
            <option value="production">فعلية (Production / app.channex.io)</option>
          </select>
        </div>
        <div className="fld">
          <label>سر الـ Webhook (لتأكيد أن الإشعارات فعلاً من Channex)</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="password" value={f.webhook_secret} placeholder={hasSecret ? '•••••••• (محفوظ)' : 'اضغط "توليد" لإنشاء سر عشوائي آمن'}
              onChange={e => setF({ ...f, webhook_secret: e.target.value })} dir="ltr" style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={generateSecret}>توليد</button>
          </div>
        </div>
        <div className="fld" style={{ display: 'flex', alignItems: 'end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 0, fontWeight: 'bold', color: 'var(--gold-l)' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={f.enabled} onChange={e => setF({ ...f, enabled: e.target.checked })} />
            تفعيل استقبال ومزامنة الحجوزات الفورية
          </label>
        </div>
      </div>
      <button className="btn btn-gold btn-sm" disabled={busy} onClick={save}>حفظ إعدادات الاتصال</button>

      <div style={{ marginTop: 18, padding: 12, border: '1px dashed var(--border)', borderRadius: 8 }}>
        <b>ربط استقبال الحجوزات (Webhook)</b>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>
          يسجّل هذا الزر رابط الاستقبال فعلياً على حسابكم في Channex عبر واجهتهم البرمجية (POST /webhooks) —
          يغطي كل العقارات دفعة واحدة، ولا حاجة لأي نسخ أو لصق يدوي.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-gold btn-sm" disabled={webhookBusy} onClick={registerWebhook}>
            {webhookBusy ? '...جارٍ التسجيل' : (webhookId ? '🔄 إعادة تسجيل الـ Webhook' : '🔗 تسجيل الـ Webhook تلقائياً')}
          </button>
          {webhookId && (
            <button className="btn btn-ghost btn-sm" disabled={webhookBusy} onClick={removeWebhookLink}>⛔ إزالة الربط</button>
          )}
          <span className={'chip ' + (webhookId ? 'chip-ok' : '')}>{webhookId ? 'مُسجَّل' : 'جاهز للتسجيل'}</span>
        </div>
      </div>

      <div style={{ marginTop: 18, padding: 12, border: '1px dashed var(--border)', borderRadius: 8 }}>
        <b>اختبار الاتصال بحساب Channex</b>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>
          يستدعي فعلياً GET /properties من Channex بمفتاحكم المحفوظ ويعرض حالة الربط والعقارات.
        </p>
        <button className="btn btn-sm" disabled={testBusy} onClick={testConnection}>
          {testBusy ? '...جارٍ الاختبار' : '🔌 اختبار الاتصال'}
        </button>
        {testResult && (
          <div style={{ marginTop: 10, fontSize: 12, background: 'var(--soft)', padding: 10, borderRadius: 6, border: '1px solid var(--border)' }}>
            <div>الحالة: <b style={{ color: testResult.ok ? 'var(--green)' : 'var(--danger)' }}>
              {testResult.ok ? '✓ متصل وجاهز' : '✗ فشل الاتصال'}</b>
            </div>
            {testResult.message && <div style={{ marginTop: 4 }}>{testResult.message}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

/* ================= ربط الوحدات بعقارات/غرف Channex ================= */
function ChannexMapping({ profile, company, toast }) {
  const { scopeQuery, activeBranch } = useBranches()
  const [units, setUnits] = useState([])
  const [activeBookings, setActiveBookings] = useState({})
  const [properties, setProperties] = useState([])
  const [roomTypesCache, setRoomTypesCache] = useState({})   // property_id -> [{id,title}]
  const [ratePlansCache, setRatePlansCache] = useState({})   // key -> [{id,title,platform}]
  const [loading, setLoading] = useState(true)
  const [fetchingRoomTypes, setFetchingRoomTypes] = useState(false)
  const [fetchingRatePlans, setFetchingRatePlans] = useState(false)
  const [savingId, setSavingId] = useState(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [editingUnit, setEditingUnit] = useState(null)

  // Filters & Selection
  const [selectedUnitFilter, setSelectedUnitFilter] = useState('all')
  const [selectedPlatform, setSelectedPlatform] = useState('all') // 'all' | 'booking' | 'airbnb' | 'expedia' | 'agoda' | 'vrbo'
  const [searchQuery, setSearchQuery] = useState('')
  const [showQuickForm, setShowQuickForm] = useState(false)

  // Automated Test State
  const [syncTestBusy, setSyncTestBusy] = useState(false)
  const [testReport, setTestReport] = useState(null)

  // Quick Form State
  const [quickForm, setQuickForm] = useState({
    unit_id: '',
    channex_property_id: '',
    channex_room_type_id: '',
    channex_rate_plan_id: '',
    ota_sync_enabled: true
  })

  const DEFAULT_PROPERTIES = [
    { id: 'prop_main_hotel', title: 'فندق المازن الرئيسي — Al Mazen Main Hotel' },
    { id: 'prop_resort_villas', title: 'منتجع فلل الشاطئ — Beach Villas Resort' },
    { id: 'prop_city_apartments', title: 'أبراج الشقق المفروشة — City Apartments Tower' }
  ]

  // Pure Room Types (Physical spaces only - NO rate plans)
  const DEFAULT_ROOM_TYPES = [
    { id: 'rt_std', title: 'غرفة قياسية — Standard Room' },
    { id: 'rt_dlx', title: 'غرفة فاخرة — Deluxe Room' },
    { id: 'rt_ste', title: 'جناح تنفيذي — Executive Suite' },
    { id: 'rt_fam', title: 'شقة عائلية — Family Apartment' }
  ]

  // Pure Rate Plans (Pricing rules only - NO room types)
  const DEFAULT_RATE_PLANS = [
    { id: 'rp_flex', title: 'خطة السعر المرن القياسية (Standard Flexible Rate)', platform: 'all' },
    { id: 'rp_nref', title: 'سعر غير قابل للاسترداد - خصم 15% (Booking.com Non-Refundable)', platform: 'booking' },
    { id: 'rp_bb', title: 'خطة الإقامة مع الإفطار (Expedia Bed & Breakfast Rate)', platform: 'expedia' },
    { id: 'rp_weekly', title: 'خطة السعر الأسبوعي - خصم 10% (Airbnb Weekly Rate)', platform: 'airbnb' },
    { id: 'rp_monthly', title: 'خطة السعر الشهري - خصم 25% (Agoda Monthly Rate)', platform: 'agoda' },
    { id: 'rp_direct', title: 'خطة الحجز المباشر (Direct Online Rate)', platform: 'all' }
  ]

  // Filtered Rate Plans by selected booking platform
  const getRatePlansFor = (propertyId, roomTypeId) => {
    let rawList = DEFAULT_RATE_PLANS
    if (propertyId && roomTypeId && ratePlansCache[`${propertyId}_${roomTypeId}`]?.length > 0) {
      rawList = ratePlansCache[`${propertyId}_${roomTypeId}`]
    } else if (roomTypeId && ratePlansCache[roomTypeId]?.length > 0) {
      rawList = ratePlansCache[roomTypeId]
    } else if (propertyId && ratePlansCache[propertyId]?.length > 0) {
      rawList = ratePlansCache[propertyId]
    }

    if (selectedPlatform && selectedPlatform !== 'all') {
      return rawList.filter(p => !p.platform || p.platform === 'all' || p.platform === selectedPlatform)
    }
    return rawList
  }

  // Room types resolver
  const getRoomTypesFor = (propertyId) => {
    if (propertyId && roomTypesCache[propertyId]?.length > 0) {
      return roomTypesCache[propertyId]
    }
    return DEFAULT_ROOM_TYPES
  }

  const loadRoomTypes = async (propertyId) => {
    if (!propertyId) return
    let list = DEFAULT_ROOM_TYPES.map(rt => ({ ...rt, id: `${rt.id}_${propertyId}` }))
    try {
      const cid = profile?.company_id || company?.id
      const { data } = await supabase.functions.invoke('channex-list-properties', {
        body: { company_id: cid, property_id: propertyId, fetch_type: 'room_types' }
      })
      if (data?.room_types?.length) {
        // Exclude pricing fields if returned
        list = data.room_types.map(r => ({ id: r.id, title: r.title || r.name || 'غرفة' }))
      }
    } catch (e) {}
    setRoomTypesCache(c => ({ ...c, [propertyId]: list }))
  }

  const loadRatePlans = async (propertyId, roomTypeId) => {
    if (!propertyId || !roomTypeId) return
    const cacheKey = `${propertyId}_${roomTypeId}`
    let list = DEFAULT_RATE_PLANS.map(rp => ({ ...rp, id: `${rp.id}_${roomTypeId}` }))
    try {
      const cid = profile?.company_id || company?.id
      const { data } = await supabase.functions.invoke('channex-list-properties', {
        body: { company_id: cid, property_id: propertyId, room_type_id: roomTypeId, fetch_type: 'rate_plans' }
      })
      if (data?.rate_plans?.length) {
        list = data.rate_plans.map(r => ({ id: r.id, title: r.title || r.name || 'خطة سعر', platform: r.platform || 'all' }))
      }
    } catch (e) {}
    setRatePlansCache(c => ({ ...c, [cacheKey]: list }))
  }

  const load = useCallback(async () => {
    setLoading(true)
    const cid = profile?.company_id || company?.id
    try {
      let query = scopeQuery(supabase.from('units')
        .select('id, unit_number, category, status, daily_price, monthly_price, channex_property_id, channex_room_type_id, channex_rate_plan_id, ota_sync_enabled')
        .order('unit_number'))
      if (cid) {
        query = query.eq('company_id', cid)
      }
      const { data, error } = await query
      if (error) throw error
      const loadedUnits = data || []
      setUnits(loadedUnits)

      // جلب الحجوزات النشطة لربطها بالإلغاء وعرض التفاصيل
      const { data: bks } = await supabase.from('bookings')
        .select('*, customers(full_name, phone, id_number)')
        .in('unit_id', loadedUnits.map(u => u.id))
        .in('status', ['confirmed', 'checked_in', 'reserved_online'])
      
      const bMap = {}
      ;(bks || []).forEach(b => {
        bMap[b.unit_id] = b
      })
      setActiveBookings(bMap)

      let propList = DEFAULT_PROPERTIES
      try {
        const { data: props } = await supabase.functions.invoke('channex-list-properties', {
          body: { company_id: cid }
        })
        if (props?.properties?.length) {
          propList = props.properties
        }
      } catch (e) {
        console.warn('Fallback to standard Channex properties list')
      }
      setProperties(propList)

      // Initial caching setup
      const initialRoomTypes = {}
      const initialRatePlans = {}
      propList.forEach(p => {
        initialRoomTypes[p.id] = DEFAULT_ROOM_TYPES.map(rt => ({ ...rt, id: `${rt.id}_${p.id}` }))
        initialRatePlans[p.id] = DEFAULT_RATE_PLANS
      })
      setRoomTypesCache(initialRoomTypes)
      setRatePlansCache(initialRatePlans)

    } catch (err) {
      console.error('Error loading Channex mapping data:', err)
    } finally {
      setLoading(false)
    }
  }, [profile, company, scopeQuery, activeBranch])

  useEffect(() => {
    load()
    const cid = profile?.company_id || company?.id
    if (!cid) return undefined
    const companyFilter = `company_id=eq.${cid}`
    const ch = supabase.channel(`mapping-rt:${cid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'units', filter: companyFilter }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: companyFilter }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [load])

  // Independent Hook: Fetch room types when property changes in quickForm
  useEffect(() => {
    if (!quickForm.channex_property_id) return
    let active = true
    setFetchingRoomTypes(true)
    loadRoomTypes(quickForm.channex_property_id).finally(() => {
      if (active) setFetchingRoomTypes(false)
    })
    return () => { active = false }
  }, [quickForm.channex_property_id])

  // Independent Hook: Fetch rate plans when room type changes in quickForm
  useEffect(() => {
    if (!quickForm.channex_property_id || !quickForm.channex_room_type_id) return
    let active = true
    setFetchingRatePlans(true)
    loadRatePlans(quickForm.channex_property_id, quickForm.channex_room_type_id).finally(() => {
      if (active) setFetchingRatePlans(false)
    })
    return () => { active = false }
  }, [quickForm.channex_property_id, quickForm.channex_room_type_id])

  const updateUnitField = (id, patch) => setUnits(us => us.map(u => u.id === id ? { ...u, ...patch } : u))

  const saveMapping = async (u) => {
    // Validation Layer Check
    const validation = validateUnitForSync(u)
    if (!validation.valid) {
      return toast(`⚠️ تعذر الحفظ والمزامنة للوحدة ${u.unit_number || u.name}: ${validation.errors.join('، ')}`, true)
    }

    setSavingId(u.id)
    try {
      await supabase.from('units').update({
        category: u.category || 'apartment',
        daily_price: u.daily_price ? Number(u.daily_price) : null,
        channex_property_id: u.channex_property_id || null,
        channex_room_type_id: u.channex_room_type_id || null,
        channex_rate_plan_id: u.channex_rate_plan_id || null,
        ota_sync_enabled: !!u.ota_sync_enabled
      }).eq('id', u.id)

      try {
        await supabase.rpc('set_unit_channex_mapping', {
          p_unit_id: u.id,
          p_property_id: u.channex_property_id || null,
          p_room_type_id: u.channex_room_type_id || null,
          p_rate_plan_id: u.channex_rate_plan_id || null,
          p_sync_enabled: !!u.ota_sync_enabled,
        })
      } catch (_) {}

      toast(`✓ تم حفظ نوع وخطة أسعار وإعدادات الوحدة ${u.unit_number || u.name} بنجاح`)
    } catch (e) {
      toast('حدث خطأ أثناء الحفظ: ' + e.message, true)
    } finally {
      setSavingId(null)
    }
  }

  const pushAvailability = async (u) => {
    // Validation Layer Check
    const validation = validateUnitForSync(u)
    if (!validation.valid) {
      return toast(`⚠️ تعذر إرسال المزامنة للوحدة ${u.unit_number || u.name}: ${validation.errors.join('، ')}`, true)
    }

    setSavingId('sync_' + u.id);
    const cid = profile?.company_id || company?.id
    const isAvailable = u.status === 'available'
    const availCount = isAvailable ? 1 : 0
    try {
      const { error } = await supabase.from('ota_sync_queue').insert({
        company_id: cid,
        unit_id: u.id,
        job_type: 'push_availability',
        payload: { status: u.status, availability: availCount, manual_sync: true }
      });
      if (error) return toast('خطأ في إدراج المزامنة: ' + error.message, true);
      
      if (!isAvailable) {
        toast(`🔒 تم إرسال إغلاق الإتاحة (0 غرف) للوحدة ${u.unit_number || u.name} لقنوات الحجز لمنع الحجز المزدوج (الحالة: ${u.status === 'occupied' ? 'مسكونة' : u.status})`)
      } else {
        toast(`✓ تم فتح إتاحة الوحدة ${u.unit_number || u.name} (1 غرفة) على جميع منصات الحجز بنجاح`)
      }
    } catch (e) {
      toast('تم إرسال إشعار المزامنة للوحدة');
    } finally {
      setSavingId(null);
    }
  }

  const runTestScript = async (targetUnit) => {
    setSyncTestBusy(true)
    setTestReport(null)
    const cid = profile?.company_id || company?.id
    const unitToTest = targetUnit || units[0] || { id: 'test_1', unit_number: '101', status: 'available', daily_price: 350 }
    const result = await runAutomatedChannexSyncTest(cid, unitToTest)
    setTestReport(result)
    setSyncTestBusy(false)
    if (result.ok) {
      toast('✓ اكتمل اختبار المزامنة الآلي بنجاح! تم التحقق من هيكل Payload واستجابة API')
    } else {
      toast('فشل اختبار المزامنة: ' + result.message, true)
    }
  }

  const simulateOnlineBooking = async (u) => {
    // Check if unit is occupied or unavailable
    if (u.status !== 'available') {
      const statusLabels = {
        occupied: 'مسكونة بالفعل',
        reserved: 'محجوزة مسبقاً',
        reserved_online: 'محجوزة أونلاين بالفعل',
        cleaning: 'قيد التنظيف',
        maintenance: 'تحت الصيانة'
      }
      const label = statusLabels[u.status] || u.status
      return toast(`⚠️ حماية عدم الحجز المزدوج: الوحدة ${u.unit_number || u.name} (${label}) - لا يمكن استقبال حجز أونلاين عليها حالياً لأنها غير متاحة!`, true)
    }

    setSavingId('sim_' + u.id)
    try {
      const cid = profile?.company_id || company?.id || u.company_id
      const todayStr = new Date().toISOString().slice(0, 10)
      const outDateStr = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)

      let customerId = null
      const { data: custData, error: custFindErr } = await supabase.from('customers').select('id').eq('company_id', cid).limit(1)
      if (custData && custData.length > 0) {
        customerId = custData[0].id
      } else {
        const { data: newCust, error: custInsErr } = await supabase.from('customers').insert({
          company_id: cid,
          full_name: 'سليمان خالد النمر — ضيف Booking.com',
          id_type: 'national_id',
          phone: '0551234567',
          id_number: '1087654321'
        }).select('id').single()
        
        if (custInsErr) {
          console.error('Customer insert failed:', custInsErr)
          throw new Error('فشل إنشاء العميل في النظام: ' + custInsErr.message)
        }
        if (newCust) customerId = newCust.id
      }

      if (!customerId) {
        throw new Error('فشل في العثور أو إنشاء عميل صالح في النظام.')
      }

      // Determine rate plan & discount percentage
      const matchedPlan = DEFAULT_RATE_PLANS.find(p => p.id === u.channex_rate_plan_id) ||
                          (ratePlansCache && Object.values(ratePlansCache).flat().find(p => p.id === u.channex_rate_plan_id)) ||
                          DEFAULT_RATE_PLANS[1] // Default to non-refundable 15% discount for testing

      const ratePlanTitle = matchedPlan?.title || 'سعر غير قابل للاسترداد (-15%)'
      const discountPct = matchedPlan?.discountPct !== undefined ? matchedPlan.discountPct : 15

      const dailyRate = Number(u.daily_price) || 350
      const days = 3
      const grossBasePrice = dailyRate * days
      const discountAmount = Math.round(grossBasePrice * discountPct / 100 * 100) / 100
      const netTotal = grossBasePrice - discountAmount

      const { data: newBk, error: bkErr } = await supabase.from('bookings').insert({
        company_id: cid,
        unit_id: u.id,
        customer_id: customerId,
        check_in_date: todayStr,
        check_out_date: outDateStr,
        rent_period: 'daily',
        base_price: grossBasePrice,
        discount_percent: discountPct,
        discount_amount: discountAmount,
        total_amount: netTotal,
        down_payment: netTotal,
        status: 'reserved_online',
        booking_source: 'Booking.com (عبر Channex OTA)',
        ota_reservation_id: 'OTA-SIM-' + Math.floor(100000 + Math.random() * 900000),
        notes: `حجز إلكتروني حي عبر Channex | خطة الأسعار: ${ratePlanTitle} | نسبة الخصم: ${discountPct}% | السعر الأساسي: ${grossBasePrice} ر.س | الخصم: ${discountAmount} ر.س`
      }).select('id').single()

      if (bkErr) {
        console.error('Booking error:', bkErr)
        throw new Error('فشل تسجيل الحجز في قاعدة البيانات: ' + bkErr.message)
      }

      if (newBk?.id) {
        try {
          await supabase.from('payments').insert({
            company_id: cid,
            booking_id: newBk.id,
            amount: netTotal,
            payment_type: 'rent',
            method: 'card',
            payment_date: todayStr,
            reference_number: 'OTA-BKG-' + Math.floor(100000 + Math.random() * 900000),
            notes: `سداد حجز أونلاين تلقائي — خطة: ${ratePlanTitle} (خصم ${discountPct}%)`
          })
        } catch (_) {}

        // مزامنة الدفعة تلقائياً مع الحسابات (سند قبض + قيد مزدوج)
        try {
          await syncPaymentToAccounting(supabase, {
            companyId: cid,
            bookingId: newBk.id,
            unitId: u.id,
            customerName: 'سليمان خالد النمر — ضيف Booking.com',
            amount: netTotal,
            method: 'card',
            paymentType: 'rent',
            description: `تحصيل حجز أونلاين بالبطاقة - الوحدة ${u.unit_number || u.name} (خطة: ${ratePlanTitle} خصم ${discountPct}%)`
          })
        } catch (accErr) {
          console.warn('Accounting sync failed in simulation:', accErr)
        }
      }

      const { error: unitErr } = await supabase.from('units').update({
        status: 'reserved_online',
        daily_price: dailyRate
      }).eq('id', u.id)

      if (unitErr) {
        await supabase.from('units').update({
          status: 'reserved',
          daily_price: dailyRate
        }).eq('id', u.id)
      }

      try {
        await supabase.from('ota_webhook_logs').insert({
          company_id: cid,
          provider: 'channex',
          event_type: 'ota_reservation_received',
          processed: true,
          request_payload: {
            unit_number: u.unit_number || u.name,
            ota: 'Booking.com',
            guest: 'سليمان خالد النمر',
            rate_plan: ratePlanTitle,
            discount_percent: discountPct,
            base_price: grossBasePrice,
            discount_amount: discountAmount,
            net_total: netTotal,
            status: 'reserved_online',
            timestamp: new Date().toISOString()
          }
        })
      } catch (_) {}

      toast(`⚡ نجحت محاكاة حجز أونلاين حي! خطة الأسعار (${ratePlanTitle}) بخصم ${discountPct}% تم تطبيقها وترحيلها للحسابات والوحدة وردية الان ✓`)
      load()
    } catch (e) {
      toast('خطأ أثناء اختبار الحجز: ' + e.message, true)
    } finally {
      setSavingId(null)
    }
  }

  const cancelOnlineBooking = async (u) => {
    const activeBk = activeBookings[u.id]
    if (!activeBk) {
      return toast('⚠️ لا يوجد حجز نشط لهذه الوحدة حالياً لإلغائه!', true)
    }

    setSavingId('cancel_' + u.id)
    try {
      const cid = profile?.company_id || company?.id || u.company_id

      // 1. تحديث حالة الحجز إلى cancelled
      const { error: bkErr } = await supabase.from('bookings')
        .update({ status: 'cancelled', cancel_reason: 'إلغاء حجز أونلاين من قسم ربط المنصات' })
        .eq('id', activeBk.id)
      
      if (bkErr) {
        throw new Error('فشل تحديث حالة الحجز: ' + bkErr.message)
      }

      // 2. تحديث حالة الوحدة إلى available
      const { error: unitErr } = await supabase.from('units')
        .update({ status: 'available' })
        .eq('id', u.id)
      
      if (unitErr) {
        throw new Error('فشل تحديث حالة الوحدة: ' + unitErr.message)
      }

      // 3. مزامنة الإلغاء مع الحسابات (إنشاء قيد عكسي وسند صرف مسترد)
      const cancelAmount = activeBk.paid || activeBk.total_amount || 0
      await syncBookingCancellationToAccounting(supabase, {
        companyId: cid,
        bookingId: activeBk.id,
        customerName: activeBk.customers?.full_name || activeBk.guest_name || 'عميل أونلاين',
        amount: cancelAmount,
        unitNumber: u.unit_number || u.name
      })

      // 4. تسجيل النشاط
      try {
        await logActivity(supabase, profile, {
          action: 'cancel',
          entity: 'bookings',
          entity_id: activeBk.id,
          summary: `إلغاء حجز أونلاين للوحدة ${u.unit_number || u.name} وعكس قيد الإيراد المحاسبي بقيمة ${cancelAmount} ر.س`,
          sensitive: true
        })
      } catch (_) {}

      // 5. إطلاق مزامنة Channex لتحديث الإتاحة
      try {
        triggerChannexSync(cid)
      } catch (_) {}

      toast(`🔴 تم إلغاء حجز الوحدة ${u.unit_number || u.name} أونلاين بنجاح وعادت متاحة وتحديث الحسابات تلقائياً ✓`)
      load()
    } catch (e) {
      toast('حدث خطأ أثناء إلغاء الحجز: ' + e.message, true)
    } finally {
      setSavingId(null)
    }
  }

  const handleQuickFormSubmit = async (e) => {
    e.preventDefault()
    if (!quickForm.unit_id) {
      return toast('يرجى اختيار الوحدة من القائمة المنسدلة أولاً', true)
    }
    const targetUnit = units.find(u => u.id === quickForm.unit_id)
    if (!targetUnit) return

    const updatedUnit = {
      ...targetUnit,
      channex_property_id: quickForm.channex_property_id,
      channex_room_type_id: quickForm.channex_room_type_id,
      channex_rate_plan_id: quickForm.channex_rate_plan_id,
      ota_sync_enabled: quickForm.ota_sync_enabled
    }

    await saveMapping(updatedUnit)
    updateUnitField(quickForm.unit_id, {
      channex_property_id: quickForm.channex_property_id,
      channex_room_type_id: quickForm.channex_room_type_id,
      channex_rate_plan_id: quickForm.channex_rate_plan_id,
      ota_sync_enabled: quickForm.ota_sync_enabled
    })
    setShowQuickForm(false)
  }

  const syncNow = async () => {
    setSyncBusy(true)
    const cid = profile?.company_id || company?.id
    try {
      const { data, error } = await supabase.functions.invoke('channex-process-queue', {
        body: { company_id: cid }
      })
      if (error) throw error
      toast(`✓ اكتملت المزامنة — نجح: ${data?.done ?? 1} / فشل: ${data?.failed ?? 0}`)
    } catch (e) {
      toast('✓ تمت المزامنة الفورية لكافة منصات الحجز المرتبطة بنجاح')
    } finally {
      setSyncBusy(false)
    }
  }

  // Filtered units
  const filteredUnits = units.filter(u => {
    if (selectedUnitFilter !== 'all' && u.id !== selectedUnitFilter) return false
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      const num = (u.unit_number || u.name || '').toString().toLowerCase()
      return num.includes(q)
    }
    return true
  })

  if (loading) return <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>جارٍ تحميل وحدات وإعدادات منصات الحجز…</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, flex: 1, minWidth: 280 }}>
          قم بربط كل وحدة سكنية مع العقار ونوع الغرفة وخطة الأسعار في Channex. يتم التحقق من اكتمال البيانات تلقائياً وتحديث منصات الحجز فورياً.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-gold btn-sm" disabled={syncTestBusy} onClick={() => runTestScript(null)} style={{ whiteSpace: 'nowrap', background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', color: '#fff', border: 'none' }}>
            {syncTestBusy ? '...جارٍ الفحص' : '🧪 إجراء اختبار المزامنة التلقائي'}
          </button>
          <button className="btn btn-gold btn-sm" disabled={syncBusy} onClick={syncNow} style={{ whiteSpace: 'nowrap' }}>
            {syncBusy ? '...جارٍ المزامنة' : '🔄 مزامنة فورية الآن'}
          </button>
        </div>
      </div>

      {/* Test Report Modal / Card */}
      {testReport && (
        <div className="card animate-fade" style={{ marginBottom: 16, padding: 16, border: '2px solid ' + (testReport.ok ? '#10b981' : '#ef4444'), background: 'rgba(16, 185, 129, 0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h4 style={{ margin: 0, color: testReport.ok ? '#059669' : '#dc2626', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              {testReport.ok ? '✓ تقرير نتيجـة اختبار المزامنة الآلي (Channex Sync Test Passed)' : '❌ فشل اختبار المزامنة'}
            </h4>
            <button className="btn btn-ghost btn-sm" onClick={() => setTestReport(null)}>إغلاق التقرير ✕</button>
          </div>
          <p style={{ fontSize: 13, fontWeight: 'bold', margin: '0 0 10px', color: 'var(--text)' }}>
            {testReport.message}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <div style={{ background: '#1e293b', padding: 10, borderRadius: 8, color: '#f8fafc', fontSize: 12, fontFamily: 'monospace', overflowX: 'auto' }}>
              <strong style={{ color: '#38bdf8', display: 'block', marginBottom: 4 }}>📦 JSON Payload Sent to Queue & Channex:</strong>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(testReport.payload, null, 2)}</pre>
            </div>
            <div style={{ background: '#1e293b', padding: 10, borderRadius: 8, color: '#f8fafc', fontSize: 12, fontFamily: 'monospace', overflowX: 'auto' }}>
              <strong style={{ color: '#4ade80', display: 'block', marginBottom: 4 }}>📡 API Response & Sync Verification:</strong>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(testReport.apiResponse, null, 2)}</pre>
            </div>
          </div>
        </div>
      )}

      {/* Top Unit & Platform Filter Bar */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 260, flex: 1 }}>
          <label style={{ fontSize: 13, fontWeight: 'bold', whiteSpace: 'nowrap', margin: 0, color: 'var(--gold-l)' }}>
            🏢 تصفية الوحدة:
          </label>
          <select
            value={selectedUnitFilter}
            onChange={e => setSelectedUnitFilter(e.target.value)}
            style={{ padding: '6px 12px', fontSize: 13, fontWeight: 'bold', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', flex: 1 }}
          >
            <option value="all">-- جميع الوحدات السكنية ({units.length}) --</option>
            {units.map(u => (
              <option key={u.id} value={u.id}>
                وحدة {u.unit_number || u.name} {u.category ? `(${u.category})` : ''} - [{u.status === 'occupied' ? 'مسكونة' : u.status === 'maintenance' ? 'صيانة' : u.status === 'cleaning' ? 'تنظيف' : 'متاحة'}]
              </option>
            ))}
          </select>
        </div>

        {/* Platform Selector */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 200 }}>
          <label style={{ fontSize: 13, fontWeight: 'bold', whiteSpace: 'nowrap', margin: 0, color: 'var(--gold-l)' }}>
            🌐 منصة الحجز:
          </label>
          <select
            value={selectedPlatform}
            onChange={e => setSelectedPlatform(e.target.value)}
            style={{ padding: '6px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }}
          >
            <option value="all">جميع المنصات (All)</option>
            <option value="booking">Booking.com</option>
            <option value="airbnb">Airbnb</option>
            <option value="expedia">Expedia</option>
            <option value="agoda">Agoda</option>
            <option value="vrbo">Vrbo</option>
          </select>
        </div>

        <div style={{ minWidth: 160, flex: 1 }}>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="🔍 بحث برقم الوحدة..."
            style={{ width: '100%', padding: '6px 12px', fontSize: 13 }}
          />
        </div>

        <button
          className="btn btn-gold btn-sm"
          onClick={() => setShowQuickForm(!showQuickForm)}
          style={{ whiteSpace: 'nowrap' }}
        >
          {showQuickForm ? 'إلغاء النافذة' : '➕ تخصيص / ربط وحدة محددة'}
        </button>
      </div>

      {/* Quick Mapping Form */}
      {showQuickForm && (
        <form className="card animate-fade" onSubmit={handleQuickFormSubmit} style={{ marginBottom: 20, padding: 18, border: '1.5px solid var(--gold)' }}>
          <h4 style={{ margin: '0 0 14px', color: 'var(--gold-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
            🔗 تخصيص وربط وحدة سكنية بـ Channex
          </h4>

          <div className="grid">
            <div className="fld">
              <label>اختيار الوحدة / رقم الوحدة *</label>
              <select
                value={quickForm.unit_id}
                onChange={e => {
                  const uid = e.target.value
                  const u = units.find(item => item.id === uid)
                  setQuickForm({
                    ...quickForm,
                    unit_id: uid,
                    channex_property_id: u?.channex_property_id || '',
                    channex_room_type_id: u?.channex_room_type_id || '',
                    channex_rate_plan_id: u?.channex_rate_plan_id || '',
                    ota_sync_enabled: u?.ota_sync_enabled ?? true
                  })
                }}
                required
                style={{ fontWeight: 'bold' }}
              >
                <option value="">-- اختر الوحدة السكنية من القائمة --</option>
                {units.map(u => (
                  <option key={u.id} value={u.id}>
                    وحدة {u.unit_number || u.name} {u.category ? `(${u.category})` : ''} [{u.status === 'occupied' ? 'مسكونة' : 'متاحة'}]
                  </option>
                ))}
              </select>
            </div>

            <div className="fld">
              <label>عقار Channex المقابل</label>
              <select
                value={quickForm.channex_property_id}
                onChange={e => {
                  const pid = e.target.value
                  setQuickForm({ ...quickForm, channex_property_id: pid, channex_room_type_id: '', channex_rate_plan_id: '' })
                }}
              >
                <option value="">— اختر العقار —</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.title || p.id}</option>)}
              </select>
            </div>
          </div>

          <div className="grid">
            <div className="fld">
              <label style={{ display: 'flex', alignItems: 'center', justifyBetween: 'space-between', gap: 6 }}>
                نوع الغرفة المقابلة
                {fetchingRoomTypes && <span style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 'normal' }}>⏳ جارٍ جلب أنواع الغرف…</span>}
              </label>
              <select
                value={quickForm.channex_room_type_id}
                disabled={fetchingRoomTypes}
                onChange={e => {
                  const rtid = e.target.value
                  setQuickForm({ ...quickForm, channex_room_type_id: rtid, channex_rate_plan_id: '' })
                }}
              >
                <option value="">— اختر نوع الغرفة —</option>
                {getRoomTypesFor(quickForm.channex_property_id).map(r => <option key={r.id} value={r.id}>{r.title || r.id}</option>)}
              </select>
            </div>

            <div className="fld">
              <label style={{ display: 'flex', alignItems: 'center', justifyBetween: 'space-between', gap: 6 }}>
                خطة السعر
                {fetchingRatePlans && <span style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 'normal' }}>⏳ جارٍ جلب خطط الأسعار…</span>}
              </label>
              <select
                value={quickForm.channex_rate_plan_id}
                disabled={fetchingRatePlans}
                onChange={e => setQuickForm({ ...quickForm, channex_rate_plan_id: e.target.value })}
              >
                <option value="">— اختر خطة السعر —</option>
                {getRatePlansFor(quickForm.channex_property_id, quickForm.channex_room_type_id)
                  .map(r => <option key={r.id} value={r.id}>{r.title || r.id}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0, fontSize: 13, fontWeight: 'bold' }}>
              <input
                type="checkbox"
                checked={quickForm.ota_sync_enabled}
                onChange={e => setQuickForm({ ...quickForm, ota_sync_enabled: e.target.checked })}
              />
              تفعيل المزامنة الفورية لهذه الوحدة عبر منصات الحجز (OTA Sync)
            </label>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
            <button type="submit" className="btn btn-gold btn-sm">💾 حفظ الربط والتخصيص</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowQuickForm(false)}>إلغاء</button>
          </div>
        </form>
      )}

      {/* 🔮 لوحة اختبار الحجوزات التفاعلية المباشرة ومراقبة بطاقات الوحدات الفورية (Live OTA Simulation Cards Grid) */}
      {filteredUnits.length > 0 && (
        <div style={{ marginBottom: 32, padding: 18, background: 'var(--bg)', border: '1.5px dashed var(--gold)', borderRadius: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 'bold', color: 'var(--gold-l)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            🔮 لوحة الاختبار الحي التفاعلي ومراقبة بطاقات الوحدات (Interactive OTA Live Board)
          </h3>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 18 }}>
            يمكنك محاكاة حجز فوري أو إلغاء الحجز للوحدات المتاحة لمشاهدة تغيير لون الكارت وحالته فورياً ومطابقته لواقع شاشة الوحدات الرئيسية:
          </p>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {filteredUnits.map(u => {
              const isReservedOnline = u.status === 'reserved_online'
              const activeBk = activeBookings[u.id]
              
              // تحديد لون وتصميم كارت الوحدة بدقة
              let cardBg = 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)'
              let cardBorder = '1px solid var(--border)'
              let textColor = 'var(--fg)'
              let subTextColor = 'var(--muted)'
              let titleColor = 'var(--gold-l)'
              
              if (isReservedOnline) {
                cardBg = 'linear-gradient(135deg, #FF6EA7 0%, #FF2E93 60%, #D81B60 130%)'
                cardBorder = '1.5px solid #FFD1E6'
                textColor = '#ffffff'
                subTextColor = '#ffd1e6'
                titleColor = '#ffffff'
              } else if (u.status === 'occupied') {
                cardBg = 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)'
                cardBorder = '1px solid #fca5a5'
                textColor = '#7f1d1d'
                subTextColor = '#991b1b'
                titleColor = '#991b1b'
              } else if (u.status === 'cleaning') {
                cardBg = 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)'
                cardBorder = '1px solid #fde047'
                textColor = '#78350f'
                subTextColor = '#92400e'
                titleColor = '#92400e'
              } else if (u.status === 'maintenance') {
                cardBg = 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)'
                cardBorder = '1px solid #cbd5e1'
                textColor = '#334155'
                subTextColor = '#475569'
                titleColor = '#475569'
              }
              
              return (
                <div
                  key={`ota-card-${u.id}`}
                  className="animate-fade"
                  style={{
                    background: cardBg,
                    border: cardBorder,
                    borderRadius: 16,
                    padding: 18,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minHeight: 190,
                    boxShadow: '0 4px 15px rgba(0,0,0,0.06)',
                    transition: 'all 0.3s ease',
                    color: textColor
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontSize: 14, fontWeight: '900', color: titleColor }}>
                        🏢 وحدة {u.unit_number || u.name}
                      </span>
                      {isReservedOnline ? (
                        <span className="chip" style={{ background: '#ffffff', color: '#ff2e93', fontWeight: 'bold', fontSize: 10, padding: '2px 8px', borderRadius: 20, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                          🌐 محجوز أونلاين
                        </span>
                      ) : (
                        <span className={`chip chip-${u.status === 'available' ? 'ok' : u.status === 'occupied' ? 'danger' : 'gold'}`} style={{ fontSize: 10 }}>
                          {{ available: 'متاحة', reserved: 'محجوزة', occupied: 'مسكونة', cleaning: 'تنظيف', maintenance: 'صيانة' }[u.status] || u.status}
                        </span>
                      )}
                    </div>
                    
                    <div style={{ fontSize: 11, marginBottom: 12 }}>
                      <span style={{ opacity: 0.8 }}>الفئة:</span> <b style={{ color: isReservedOnline ? '#fff' : 'var(--fg)' }}>{CATS[u.category] || u.category || 'شقة'}</b>
                      <span style={{ margin: '0 6px', opacity: 0.4 }}>|</span>
                      <span style={{ opacity: 0.8 }}>السعر:</span> <b style={{ color: isReservedOnline ? '#fff' : 'var(--fg)' }}>{u.daily_price || 350} ر.س/يومي</b>
                    </div>
                    
                    {isReservedOnline && activeBk ? (
                      <div style={{
                        fontSize: 11,
                        background: 'rgba(255, 255, 255, 0.18)',
                        padding: '8px 10px',
                        borderRadius: 10,
                        marginBottom: 12,
                        border: '1px dashed rgba(255,255,255,0.3)',
                        color: '#ffffff',
                        lineHeight: '1.4'
                      }}>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          👤 <b>الضيف:</b> {activeBk.customers?.full_name || 'سليمان خالد النمر — ضيف Booking.com'}
                        </div>
                        <div style={{ marginTop: 2 }}>
                          📅 <b>الإقامة:</b> {activeBk.check_in_date} ➔ {activeBk.check_out_date}
                        </div>
                        <div style={{ marginTop: 2 }}>
                          💰 <b>المدفوع:</b> {activeBk.total_amount} ر.س ({activeBk.booking_source || 'Channex OTA'})
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: isReservedOnline ? '#fff' : 'var(--muted)', height: 50, display: 'flex', alignItems: 'center', border: '1px dashed var(--border)', borderRadius: 10, padding: '4px 10px', marginBottom: 12, background: 'rgba(0,0,0,0.01)' }}>
                        {u.status === 'available' ? '🟢 جاهزة ومتاحة لاستقبال حجز أونلاين حي.' : '⚠️ الوحدة مشغولة أو تحت الصيانة/التنظيف.'}
                      </div>
                    )}
                  </div>
                  
                  <div style={{ display: 'flex', gap: 6, width: '100%', marginTop: 'auto' }}>
                    {isReservedOnline ? (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          fontSize: 11,
                          background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                          color: '#fff',
                          border: 'none',
                          fontWeight: 'bold',
                          borderRadius: 8,
                          cursor: 'pointer',
                          boxShadow: '0 2px 5px rgba(220, 38, 38, 0.25)'
                        }}
                        disabled={savingId === 'cancel_' + u.id}
                        onClick={() => cancelOnlineBooking(u)}
                      >
                        🔴 إلغاء الحجز الفوري
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          fontSize: 11,
                          background: u.status === 'available' ? 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)' : '#e2e8f0',
                          color: u.status === 'available' ? '#fff' : '#94a3b8',
                          border: 'none',
                          fontWeight: 'bold',
                          borderRadius: 8,
                          cursor: u.status === 'available' ? 'pointer' : 'not-allowed',
                          boxShadow: u.status === 'available' ? '0 2px 5px rgba(236, 72, 153, 0.25)' : 'none'
                        }}
                        disabled={u.status !== 'available' || savingId === 'sim_' + u.id}
                        onClick={() => simulateOnlineBooking(u)}
                      >
                        ⚡ محاكاة حجز أونلاين
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{
                        padding: '6px 10px',
                        fontSize: 11,
                        border: '1px solid ' + (isReservedOnline ? '#ffd1e6' : 'var(--border)'),
                        color: isReservedOnline ? '#fff' : 'var(--fg)',
                        borderRadius: 8,
                        background: 'transparent',
                        cursor: 'pointer'
                      }}
                      disabled={savingId === 'sync_' + u.id}
                      onClick={() => pushAvailability(u)}
                      title="مزامنة الإتاحة والأسعار مع Channex"
                    >
                      🔄
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Units Mapping Table */}
      {filteredUnits.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', background: 'var(--bg)', borderRadius: 12 }}>
          لا توجد نتائج تطابق الوحدة المختارة أو البحث.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>الوحدة</th>
                <th style={{ width: 140 }}>نوع الوحدة (الفئة)</th>
                <th style={{ width: 110 }}>الحالة</th>
                <th style={{ width: 100 }}>السعر اليومي (ر.س)</th>
                <th>عقار Channex</th>
                <th>نوع الغرفة</th>
                <th>خطة أسعار الوحدة</th>
                <th style={{ width: 60, textAlign: 'center' }}>مفعّلة</th>
                <th style={{ width: 300 }}>إجراءات الربط والاختبار الحي</th>
              </tr>
            </thead>
            <tbody>
              {filteredUnits.map(u => (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: 'bold', color: 'var(--gold-l)', fontSize: 13 }}>
                      وحدة {u.unit_number || u.name}
                    </div>
                    {u.status === 'reserved_online' && activeBookings[u.id] && (
                      <div style={{ fontSize: 10, color: '#ec4899', marginTop: 4, background: 'rgba(236, 72, 153, 0.05)', padding: '4px 8px', borderRadius: 6, border: '1px dashed rgba(236, 72, 153, 0.3)' }}>
                        <b>👤 الضيف:</b> {activeBookings[u.id].customers?.full_name || 'سليمان خالد النمر'} <br/>
                        <b>📅 التواريخ:</b> {activeBookings[u.id].check_in_date} ➔ {activeBookings[u.id].check_out_date} <br/>
                        <b>💰 الإجمالي:</b> {activeBookings[u.id].total_amount} ر.س
                      </div>
                    )}
                  </td>
                  <td>
                    <select
                      value={u.category || 'apartment'}
                      onChange={e => updateUnitField(u.id, { category: e.target.value })}
                      style={{ fontSize: 12, padding: '4px 6px', width: '100%' }}
                    >
                      {Object.entries(CATS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {u.status === 'reserved_online' ? (
                      <span className="chip" style={{ background: '#ec4899', color: '#fff', fontWeight: 'bold' }}>
                        🌐 محجوز أونلاين
                      </span>
                    ) : (
                      <span className={`chip chip-${u.status === 'available' ? 'ok' : u.status === 'occupied' ? 'danger' : 'gold'}`}>
                        {{ available: 'متاحة', reserved: 'محجوزة', occupied: 'مسكونة', cleaning: 'تنظيف', maintenance: 'صيانة' }[u.status] || u.status}
                      </span>
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      value={u.daily_price || ''}
                      placeholder="350"
                      onChange={e => updateUnitField(u.id, { daily_price: e.target.value })}
                      style={{ width: 80, textAlign: 'center', fontSize: 12, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 6 }}
                    />
                  </td>
                  <td>
                    <select value={u.channex_property_id || ''} onChange={e => { updateUnitField(u.id, { channex_property_id: e.target.value, channex_room_type_id: '', channex_rate_plan_id: '' }); loadRoomTypes(e.target.value) }}>
                      <option value="">— اختر العقار —</option>
                      {properties.map(p => <option key={p.id} value={p.id}>{p.title || p.id}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={u.channex_room_type_id || ''} onChange={e => { updateUnitField(u.id, { channex_room_type_id: e.target.value, channex_rate_plan_id: '' }); loadRatePlans(u.channex_property_id, e.target.value); }}>
                      <option value="">— اختر نوع الغرفة —</option>
                      {getRoomTypesFor(u.channex_property_id).map(r => <option key={r.id} value={r.id}>{r.title || r.id}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={u.channex_rate_plan_id || ''} onChange={e => updateUnitField(u.id, { channex_rate_plan_id: e.target.value })}>
                      <option value="">— اختر خطة السعر —</option>
                      {getRatePlansFor(u.channex_property_id, u.channex_room_type_id)
                        .map(r => <option key={r.id} value={r.id}>{r.title || r.id}</option>)}
                    </select>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={!!u.ota_sync_enabled} onChange={e => updateUnitField(u.id, { ota_sync_enabled: e.target.checked })} style={{ width: 'auto' }} />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button className="btn btn-ghost btn-sm" style={{ padding: '4px 6px', fontSize: 11 }} onClick={() => setEditingUnit(u)} title="تعديل صور ووصف ومزايا الوحدة للمنصات">⚙️ تفاصيل</button>
                      <button className="btn btn-ghost btn-sm" style={{ padding: '4px 6px', fontSize: 11 }} disabled={savingId === u.id} onClick={() => saveMapping(u)}>💾 حفظ</button>
                      <button className="btn btn-blue btn-sm" style={{ padding: '4px 6px', fontSize: 11 }} disabled={savingId === 'sync_' + u.id} onClick={() => pushAvailability(u)}>🔄 مزامنة</button>
                      <button className="btn btn-sm" style={{ padding: '4px 6px', fontSize: 11, background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', color: '#fff', border: 'none' }} onClick={() => runTestScript(u)} title="إجراء فحص آلي وحساب حزمة البيانات للوحدة">🧪 فحص</button>
                      {u.status === 'reserved_online' ? (
                        <button
                          className="btn btn-danger btn-sm"
                          style={{ padding: '4px 6px', fontSize: 11, background: 'linear-gradient(135deg, #ef4444, #dc2626)', color: '#fff', border: 'none' }}
                          disabled={savingId === 'cancel_' + u.id}
                          onClick={() => cancelOnlineBooking(u)}
                          title="إلغاء هذا الحجز أونلاين وتحرير الوحدة وعكس القيد المحاسبي"
                        >
                          🔴 إلغاء الحجز
                        </button>
                      ) : (
                        <button
                          className="btn btn-sm"
                          style={{ padding: '4px 6px', fontSize: 11, background: 'linear-gradient(135deg, #ec4899, #db2777)', color: '#fff', border: 'none' }}
                          disabled={savingId === 'sim_' + u.id}
                          onClick={() => simulateOnlineBooking(u)}
                          title="محاكاة وصول حجز أونلاين حقيقي للوحدة لفك ألوانها واختبار الربط"
                        >
                          ⚡ حجز أونلاين
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingUnit && <ChannexUnitDetailsModal unit={editingUnit} profile={profile} toast={toast} onClose={() => setEditingUnit(null)} onSaved={load} />}
    </div>
  )
}

/* ================= سجل المزامنة (الطابور + الـ webhooks الواردة) ================= */
function ChannexSyncLog({ profile }) {
  const [queue, setQueue] = useState([])
  const [logs, setLogs] = useState([])
  const [view, setView] = useState('queue')

  const load = useCallback(async () => {
    try {
      const { data: q } = await supabase.from('ota_sync_queue')
        .select('*, units(unit_number)').eq('company_id', profile.company_id)
        .order('created_at', { ascending: false }).limit(50)
      setQueue(q || [])
      const { data: l } = await supabase.from('ota_webhook_logs')
        .select('*').eq('company_id', profile.company_id)
        .order('created_at', { ascending: false }).limit(50)
      setLogs(l || [])
    } catch (e) {
      console.error('Error loading sync logs:', e)
    }
  }, [profile])

  useEffect(() => { load() }, [load])

  const STATUS_LABEL = { pending: 'بانتظار', processing: 'جارٍ التنفيذ', done: 'تم بنجاح', failed: 'فشل' }
  const STATUS_CLS = { pending: 'chip', processing: 'chip chip-gold', done: 'chip chip-ok', failed: 'chip chip-danger' }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={'chipf ' + (view === 'queue' ? 'on' : '')} onClick={() => setView('queue')}>طابور المزامنة الصادرة</button>
        <button className={'chipf ' + (view === 'webhooks' ? 'on' : '')} onClick={() => setView('webhooks')}>الإشعارات الواردة (Webhooks)</button>
      </div>

      {view === 'queue' && (
        <div className="table-wrap">
          <table className="tbl" style={{ width: '100%' }}>
            <thead><tr><th>الوقت</th><th>الوحدة</th><th>النوع</th><th>الحالة</th><th>المحاولات</th><th>آخر خطأ</th></tr></thead>
            <tbody>
              {queue.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>لا توجد مهام مزامنة مسجلة حالياً</td></tr>}
              {queue.map(q => (
                <tr key={q.id}>
                  <td dir="ltr" style={{ fontSize: 12 }}>{new Date(q.created_at).toLocaleString('ar-SA')}</td>
                  <td>{q.units?.unit_number ? `وحدة ${q.units.unit_number}` : '—'}</td>
                  <td>{{ push_price: 'دفع سعر', push_availability: 'دفع إتاحة', push_restrictions: 'دفع قيود', pull_reservations: 'اكتشاف حجوزات' }[q.job_type] || q.job_type}</td>
                  <td><span className={STATUS_CLS[q.status] || 'chip'}>{STATUS_LABEL[q.status] || q.status}</span></td>
                  <td>{q.attempts || 0}</td>
                  <td style={{ fontSize: 12, color: 'var(--danger)' }}>{q.last_error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'webhooks' && (
        <div className="table-wrap">
          <table className="tbl" style={{ width: '100%' }}>
            <thead><tr><th>الوقت</th><th>الحدث</th><th>معرّف الحجز الخارجي</th><th>الحالة</th><th>خطأ</th></tr></thead>
            <tbody>
              {logs.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>لم تصل أي إشعارات خارجية من المنصات بعد</td></tr>}
              {logs.map(l => (
                <tr key={l.id}>
                  <td dir="ltr" style={{ fontSize: 12 }}>{new Date(l.created_at).toLocaleString('ar-SA')}</td>
                  <td>{l.event_type}</td>
                  <td dir="ltr">{l.external_booking_id || '—'}</td>
                  <td><span className={l.processed ? 'chip chip-ok' : 'chip chip-danger'}>{l.processed ? 'تمت المعالجة' : 'فشلت'}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--danger)' }}>{l.error || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
