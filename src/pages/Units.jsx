import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { useBranches } from '../BranchContext'
import { SAR, num, today, CATS, STATUS, PAY_METHODS, DEFAULT_FURNITURE, shareUrl, waShareUrl, uploadFile, zatcaQR, logActivity, openStoredDocument } from '../lib/helpers'
import { QRCodeSVG } from 'qrcode.react'
import HandoverModal from '../components/HandoverModal'
import SettlementModal from '../components/SettlementModal'
import TenantSummary from '../components/TenantSummary'
import RentalContract from '../components/RentalContract'
import PrintableDoc, { DocGrid } from '../components/PrintableDoc'
import SwipeableUnitCard from '../components/SwipeableUnitCard'
import UnitQRCodeModal from '../components/UnitQRCodeModal'
import UnitProfitabilityDashboard from '../components/UnitProfitabilityDashboard'
import { triggerChannexSync } from '../lib/channexSync'
import { syncBookingCancellationToAccounting } from '../lib/accountingSync'
import { downloadPDF } from '../lib/pdf'
import { printHandoverChecklist } from '../lib/handoverPrint'
import { issueSerial } from '../lib/documentSerial'
import { printElement } from '../lib/printWindow'
import BlacklistWarningModal from '../components/BlacklistWarningModal'
import Customer360Modal from '../components/Customer360Modal'
import BookingQRScannerModal from '../components/BookingQRScannerModal'
import { WifiOff, QrCode } from 'lucide-react'
import { saveOperationalCache, getOperationalCache } from '../lib/offlineManager'
import UnitCardSizer from '../components/UnitCardSizer'
import CompactUnitCard from '../components/CompactUnitCard'
import { useUnitCardSize, unitGridCssVars } from '../hooks/useUnitCardSize'

/* ============ الشاشة الرئيسية للوحدات ============ */
export default function Units() {
  const { profile, isOwner, canFinance, toast } = useAuth()
  const { scopeQuery } = useBranches()
  const [units, setUnits] = useState([])
  const [thumbs, setThumbs] = useState({})       // unit_id -> first image url
  const [allImages, setAllImages] = useState({}) // unit_id -> array of image urls
  const [activeBk, setActiveBk] = useState({})
  const [openTickets, setOpenTickets] = useState({}) // unit_id -> boolean   // unit_id -> {check_in_date, check_out_date}
  const [sel, setSel] = useState(null)
  const [modalTab, setModalTab] = useState('info')
  const [addOpen, setAddOpen] = useState(false)
  const [dateRange, setDateRange] = useState({ from: today().slice(0, 4) + '-01-01', to: today() })
  const [occupancyData, setOccupancyData] = useState(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [qrUnit, setQrUnit] = useState(null)
  const [qrCheckInOpen, setQrCheckInOpen] = useState(false)
  const [showProfitability, setShowProfitability] = useState(false)
  const [isUsingOfflineCache, setIsUsingOfflineCache] = useState(false)
  // مقاس مربعات الوحدات — محفوظ لكل مستخدم على حدة
  const { grid: unitGrid, save: saveUnitGrid, reset: resetUnitGrid } = useUnitCardSize(profile?.id)

  const load = useCallback(async () => {
    if (!profile?.company_id) return
    try {
      const { data, error } = await scopeQuery(
        supabase.from('units').select('*')
          .eq('company_id', profile.company_id).eq('is_active', true)
      ).order('unit_number')
      
      if (error || !data) {
        throw new Error(error?.message || 'تعذّر جلب بيانات الوحدات')
      }

      setUnits(data || [])
      setIsUsingOfflineCache(false)
      saveOperationalCache('units_' + profile.company_id, data)

      const ids = (data || []).map(u => u.id)
      if (ids.length) {
        // ⚡ تحسين أداء: تُجلب الوسائط والحجوزات وتذاكر الصيانة على التوازي
        // بدل ثلاث رحلات متتابعة إلى الخادم (تقليل زمن التحميل بنحو الثلثين).
        const [mdRes, bkRes, tkRes] = await Promise.all([
          supabase.from('unit_media')
            .select('unit_id,url,media_type,sort_order')
            .in('unit_id', ids).eq('media_type', 'image').order('sort_order'),
          supabase.from('bookings')
            .select('unit_id,check_in_date,check_out_date,status,ejar_status,ejar_contract_number,booking_source,guests(full_name),customers(full_name),paid,total_amount,notes,base_price,discount_percent,discount_amount')
            .in('unit_id', ids).in('status', ['confirmed', 'checked_in']),
          supabase.from('maintenance_requests')
            .select('unit_id').in('unit_id', ids).in('status', ['open', 'in_progress']),
        ])
        const md = mdRes?.data
        const t = {}
        const allImgs = {}
        ;(md || []).forEach(m => { 
          if (!t[m.unit_id] && m.media_type === 'image') t[m.unit_id] = m.url
          if (m.media_type === 'image') {
            if (!allImgs[m.unit_id]) allImgs[m.unit_id] = []
            allImgs[m.unit_id].push(m.url)
          }
        })
        setThumbs(t)
        setAllImages(allImgs)

        const bk = bkRes?.data
        const a = {}
        ;(bk || []).forEach(b => { a[b.unit_id] = b })
        setActiveBk(a)

        const tk = tkRes?.data
        const tks = {}
        ;(tk || []).forEach(t => { tks[t.unit_id] = true })
        setOpenTickets(tks)

        saveOperationalCache('units_bk_' + profile.company_id, a)
        saveOperationalCache('units_tk_' + profile.company_id, tks)
        saveOperationalCache('units_thumbs_' + profile.company_id, t)
      }
    } catch (err) {
      console.warn('⚡ تحميل بيانات الوحدات من التخزين المؤقت أوفلاين:', err)
      const cachedUnits = getOperationalCache('units_' + profile?.company_id)
      const cachedBk = getOperationalCache('units_bk_' + profile?.company_id)
      const cachedTk = getOperationalCache('units_tk_' + profile?.company_id)
      const cachedThumbs = getOperationalCache('units_thumbs_' + profile?.company_id)

      if (cachedUnits) setUnits(cachedUnits)
      if (cachedBk) setActiveBk(cachedBk)
      if (cachedTk) setOpenTickets(cachedTk)
      if (cachedThumbs) setThumbs(cachedThumbs)

      if (cachedUnits) {
        setIsUsingOfflineCache(true)
        toast('⚡ تعذّر الاتصال المباشر بالشبكة — تم عرض بيانات إدارة الوحدات والحجوزات المخزنة محلياً', false)
      }
    }
  }, [profile, toast, scopeQuery])

  useEffect(() => {
    load()
    // تحديث لحظي لألوان الوحدات والحجوزات — مع تجميع الأحداث المتتالية
    // في إعادة تحميل واحدة لتفادي عاصفة استعلامات عند التعديلات الجماعية.
    let timer = null
    const debouncedLoad = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; load() }, 400)
    }
    const companyFilter = `company_id=eq.${profile.company_id}`
    const ch = supabase.channel(`units-rt:${profile.company_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'units', filter: companyFilter }, debouncedLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: companyFilter }, debouncedLoad)
      .subscribe()
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch) }
  }, [load])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const uid = params.get('unit_id')
    if (uid && units.length > 0) {
      const u = units.find(x => x.id === uid)
      if (u && !sel) {
        setSel(u)
        setModalTab('info')
      }
    }
  }, [units, sel])

  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const counts = units.reduce((a, u) => (a[u.status] = (a[u.status] || 0) + 1, a), {})
  const filtered = units.filter(u => {
    if (filter !== 'all') {
      if (filter === 'reserved' && u.status !== 'reserved') return false
      if (filter === 'reserved_online' && u.status !== 'reserved_online') return false
      if ((filter === 'cleaning' || filter === 'maintenance') && !['cleaning', 'maintenance'].includes(u.status)) return false
      if (filter !== 'reserved' && filter !== 'reserved_online' && filter !== 'cleaning' && filter !== 'maintenance' && u.status !== filter) return false
    }
    if (search) {
      const s = search.trim().toLowerCase()
      return u.unit_number.toLowerCase().includes(s) ||
        (CATS[u.category] || '').toLowerCase().includes(s) ||
        (u.description || '').toLowerCase().includes(s)
    }
    return true
  })

  const handleCancelOnlineBooking = async (u, bk) => {
    if (!confirm(`⚠️ هل أنت متأكد من إلغاء الحجز الأونلاين للوحدة ${u.unit_number} وتحريرها؟ سيؤدي ذلك لعكس القيد المحاسبي ومزامنة الإتاحة فورياً.`)) return
    
    try {
      const bookingToCancel = bk || activeBk[u.id]
      
      if (bookingToCancel) {
        // 1. تحديث حالة الحجز إلى cancelled
        const { error: bkErr } = await supabase.from('bookings')
          .update({ status: 'cancelled', cancel_reason: 'إلغاء حجز أونلاين من لوحة الوحدات' })
          .eq('id', bookingToCancel.id)
        
        if (bkErr) {
          throw new Error('فشل تحديث حالة الحجز: ' + bkErr.message)
        }

        // 2. مزامنة الإلغاء مع الحسابات (إنشاء قيد عكسي وسند صرف مسترد)
        const cancelAmount = bookingToCancel.paid || bookingToCancel.total_amount || 0
        await syncBookingCancellationToAccounting(supabase, {
          companyId: profile.company_id,
          bookingId: bookingToCancel.id,
          customerName: bookingToCancel.customers?.full_name || bookingToCancel.guest_name || 'عميل أونلاين',
          amount: cancelAmount,
          unitNumber: u.unit_number
        })

        // 3. تسجيل النشاط
        await logActivity(supabase, profile, {
          action: 'cancel',
          entity: 'bookings',
          entity_id: bookingToCancel.id,
          summary: `إلغاء حجز أونلاين للوحدة ${u.unit_number} وعكس قيد الإيراد المحاسبي بقيمة ${cancelAmount} ر.س`,
          sensitive: true
        })
      }

      // 4. تحديث حالة الوحدة إلى available
      const { error: unitErr } = await supabase.from('units')
        .update({ status: 'available' })
        .eq('id', u.id)
      
      if (unitErr) {
        throw new Error('فشل تحديث حالة الوحدة: ' + unitErr.message)
      }

      // 5. إطلاق مزامنة Channex لتحديث الإتاحة
      try {
        triggerChannexSync(profile.company_id)
      } catch (_) {}

      toast(`🔴 تم إلغاء حجز الوحدة ${u.unit_number} أونلاين بنجاح وعادت متاحة وتحديث الحسابات تلقائياً ✓`)
      load()
    } catch (e) {
      toast('حدث خطأ أثناء إلغاء الحجز: ' + e.message, true)
    }
  }

  return (
    <div>
      <div className="pg-title">
        <h2>الوحدات وحالاتها ({units.length}) — انقر أي وحدة للحجز أو التفاصيل</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="legend">
            <span><i style={{ background: '#10B981' }} />متاح</span>
            <span><i style={{ background: '#F97316' }} />محجوز محلياً</span>
            <span><i style={{ background: '#FF2E93' }} />محجوز أونلاين</span>
            <span><i style={{ background: '#EF4444' }} />مسكونة</span>
            <span><i style={{ background: '#FACC15' }} />صيانة/تنظيف</span>
          </div>
          <button className="btn btn-blue btn-sm" style={{ fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#2563EB', color: '#fff' }} onClick={() => setQrCheckInOpen(true)}>
            <QrCode size={16} /> 📷 مسح الـ QR للتسكين السريع
          </button>
          {canFinance && (
            <button className="btn btn-gold btn-sm" onClick={() => setShowProfitability(!showProfitability)}>
              📈 {showProfitability ? 'إخفاء مؤشر الربحية' : 'ربحية الوحدات'}
            </button>
          )}
          {canFinance && (
            <button className="btn btn-blue btn-sm" onClick={() => setReportOpen(true)}>📊 تقرير وحدة</button>
          )}
          {canFinance && (
            <button className="btn btn-gold btn-sm" onClick={() => setAddOpen(true)}>+ إضافة وحدة</button>
          )}

        </div>
      </div>

      {showProfitability && <UnitProfitabilityDashboard />}

      {isUsingOfflineCache && (
        <div style={{
          background: '#FFFBEB',
          border: '1px solid #FCD34D',
          borderRadius: '10px',
          padding: '10px 14px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          color: '#92400E',
          fontSize: '13px',
          fontWeight: '700'
        }}>
          <WifiOff size={16} />
          <span>يتم عرض بيانات إدارة الوحدات والحجوزات المخزنة مؤقتاً محلياً نظراً لانقطاع الاتصال بالسيرفر. ستتم مزامنة التحديثات تلقائياً فور عودة التغطية.</span>
        </div>
      )}

      {units.length > 0 && (
        <div className="units-toolbar">
          <div className="search">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="ابحث برقم الوحدة، التصنيف، أو الوصف…" />
          </div>
          <button className={'chipf ' + (filter === 'all' ? 'on' : '')} onClick={() => setFilter('all')}>الكل ({units.length})</button>
          <button className={'chipf ' + (filter === 'available' ? 'on' : '')} onClick={() => setFilter('available')}>
            <i style={{ background: '#10B981' }} />متاح ({counts.available || 0})</button>
          <button className={'chipf ' + (filter === 'reserved' ? 'on' : '')} onClick={() => setFilter('reserved')}>
            <i style={{ background: '#F97316' }} />محجوز محلياً ({counts.reserved || 0})</button>
          <button className={'chipf ' + (filter === 'reserved_online' ? 'on' : '')} onClick={() => setFilter('reserved_online')}>
            <i style={{ background: '#FF2E93' }} />محجوز أونلاين ({counts.reserved_online || 0})</button>
          <button className={'chipf ' + (filter === 'occupied' ? 'on' : '')} onClick={() => setFilter('occupied')}>
            <i style={{ background: '#EF4444' }} />مسكونة ({counts.occupied || 0})</button>
          <button className={'chipf ' + (filter === 'maintenance' ? 'on' : '')} onClick={() => setFilter('maintenance')}>
            <i style={{ background: '#EAB308' }} />صيانة/تنظيف ({(counts.cleaning || 0) + (counts.maintenance || 0)})</button>
        </div>
      )}

      {units.length === 0 && (
        <div className="panel" style={{ textAlign: 'center', padding: 40 }}>
          <h3 style={{ justifyContent: 'center' }}>لا توجد وحدات بعد</h3>
          <p style={{ color: 'var(--muted)', marginTop: 8 }}>
            {isOwner ? 'ابدأ بإضافة وحداتك — ستظهر فوراً في لوحة الموظفين.' :
              'إضافة الوحدات والتعديل عليها صلاحية حصرية لحساب المدير.'}
          </p>
          <button className="btn btn-gold" style={{ marginTop: 14 }} onClick={() => setAddOpen(true)}>+ إضافة أول وحدة</button>
        </div>
      )}

      {units.length > 0 && (
        <UnitCardSizer
          grid={unitGrid}
          onChange={saveUnitGrid}
          onReset={resetUnitGrid}
          visibleCount={filtered.length}
        />
      )}

      {unitGrid.view === 'compact' ? (
        /* النمط المختصر — بطاقة بثلاثة عناصر. النقر يفتح نفس نافذة التفاصيل بلا تغيير. */
        <div className="units-grid-compactview" style={unitGridCssVars(unitGrid)}>
          {filtered.map(u => {
            const bk = activeBk[u.id]
            const hoursLeft = bk?.check_out_date
              ? (new Date(bk.check_out_date + 'T23:59:59') - Date.now()) / 3600000
              : Infinity
            return (
              <CompactUnitCard
                key={u.id} u={u} STATUS={STATUS} CATS={CATS}
                evictSoon={hoursLeft >= 0 && hoursLeft <= 24}
                onClick={(unit) => { setModalTab('info'); setSel(unit) }}
                onQuickStatusChange={async (unit, newStatus) => {
                  const { error } = await supabase.from('units').update({ status: newStatus }).eq('id', unit.id)
                  if (error) return toast('خطأ: ' + error.message, true)
                  toast(`✓ تم تحديث حالة الوحدة ${unit.unit_number} إلى ${STATUS[newStatus]?.label || newStatus}`)
                  load()
                }}
              />
            )
          })}
          {filtered.length === 0 && units.length > 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--muted)', padding: 30 }}>
              لا توجد وحدات مطابقة لبحثك
            </div>
          )}
        </div>
      ) : (
      <div className="units-grid units-grid-compact" style={unitGridCssVars(unitGrid)}>
        {filtered.map(u => {
          const bk = activeBk[u.id]
          const hasDates = bk?.check_in_date && bk?.check_out_date
          const hoursLeft = bk?.check_out_date
            ? (new Date(bk.check_out_date + 'T23:59:59') - Date.now()) / 3600000
            : Infinity
          const evictSoon = hoursLeft >= 0 && hoursLeft <= 24
          return (
            <SwipeableUnitCard
              key={u.id} u={u} bk={bk} STATUS={STATUS} CATS={CATS} num={num}
              thumbs={thumbs} allImages={allImages} evictSoon={evictSoon} openTickets={openTickets}
              onClick={(unit) => { setModalTab('info'); setSel(unit); }}
              onQuickStatusChange={async (unit, newStatus) => {
                const { error } = await supabase.from('units').update({ status: newStatus }).eq('id', unit.id)
                if (error) return toast('خطأ: ' + error.message, true)
                toast(`✓ تم تحديث حالة الوحدة ${unit.unit_number} إلى ${STATUS[newStatus]?.label || newStatus}`)
                load()
              }}
              onOpenMaintenance={(unit) => {
                window.location.href = `/?unit_id=${unit.id}&action=maintenance`
              }}
              onShowQR={(unit) => setQrUnit(unit)}
              onSettleCard={(unit, booking) => { setModalTab('settle'); setSel(unit); }}
              onCancelOnlineBooking={handleCancelOnlineBooking}
            />)
        })}
        {filtered.length === 0 && units.length > 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--muted)', padding: 30 }}>
            لا توجد وحدات مطابقة لبحثك
          </div>
        )}
      </div>
      )}

      {sel && <UnitModal unit={sel} initialTab={modalTab} onClose={() => { setSel(null); load() }} />}
      {addOpen && <UnitForm onClose={() => { setAddOpen(false); load() }} />}
      {reportOpen && <UnitReport units={units} onClose={() => setReportOpen(false)} />}
      {qrUnit && <UnitQRCodeModal unit={qrUnit} companyName={profile?.company_name} onClose={() => setQrUnit(null)} />}
      {qrCheckInOpen && (
        <BookingQRScannerModal
          onClose={() => setQrCheckInOpen(false)}
          onCheckInComplete={() => {
            setQrCheckInOpen(false)
            load()
          }}
        />
      )}
    </div>
  )
}

/* ============ تقرير وحدة محددة — تاريخ التأجير والمصروفات والصيانة
   والمدفوعات والإيرادات ونسبة الإشغال مع تحليل ذكي، قابل للطباعة ============ */
function UnitReport({ units, onClose }) {
  const { profile, company, toast } = useAuth()
  const [unitId, setUnitId] = useState(units[0]?.id || '')
  const [range, setRange] = useState({ from: today().slice(0, 4) + '-01-01', to: today() })
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showPrint, setShowPrint] = useState(false)

  const run = async () => {
    if (!unitId) return toast('اختر وحدة', true)
    setBusy(true)
    const { data: d, error } = await supabase.rpc('unit_full_report', { p_unit_id: unitId, p_from: range.from, p_to: range.to })
    setBusy(false)
    if (error) return toast('خطأ: ' + error.message, true)
    setData(d)
  }

  const CATS_L = { apartment: 'شقة سكنية', chalet: 'شاليه', furnished_unit: 'وحدة مفروشة', hotel_room: 'غرفة فندقية' }
  const occ = data?.occupancy
  const net = data ? num(data.totals?.revenue) - num(data.totals?.expenses) : 0
  // تحليل ذكي للمصاريف
  const maintenanceAlert = data ? (() => {
    const rev = num(data.totals?.revenue) || 0;
    const exp = num(data.totals?.expenses) || 0;
    if (rev > 0 && exp > rev * 0.3) {
      return `⚠️ مصاريف الصيانة والتشغيل مرتفعة جداً وتبلغ ${((exp/rev)*100).toFixed(1)}% من الإيرادات (تتجاوز الحد الآمن 30%).`
    }
    return null;
  })() : null;

  // تحليل ذكي بلغة طبيعية بناءً على نسبة الإشغال
  const aiInsight = occ ? (() => {
    const r = occ.occupancy_rate
    if (r >= 85) return `إشغال مرتفع جداً (${r}%) — الوحدة من الأصول عالية الأداء، ويُنصح بمراجعة السعر للأعلى لاستثمار الطلب القوي.`
    if (r >= 60) return `إشغال جيد (${r}%) — أداء صحّي ومستقر، مع فرصة لرفع الإشغال عبر عروض في الفترات المنخفضة.`
    if (r >= 30) return `إشغال متوسط (${r}%) — يُنصح بحملة تسويقية أو مراجعة السعر لتحسين معدل الإشغال.`
    return `إشغال منخفض (${r}%) — الوحدة شاغرة معظم الفترة، يُنصح بخفض السعر مؤقتاً أو مراجعة حالتها وجاهزيتها.`
  })() : ''

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(860px,100%)' }}>
        <div className="modal-h"><h3>📊 تقرير وحدة</h3><button className="x" onClick={onClose}>✕</button></div>
        <div className="modal-b">
          <div className="grid3" style={{ marginBottom: 12 }}>
            <div className="fld"><label>الوحدة</label>
              <select value={unitId} onChange={e => setUnitId(e.target.value)}>
                {units.map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
              </select></div>
            <div className="fld"><label>من تاريخ</label><input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></div>
            <div className="fld"><label>إلى تاريخ</label><input type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></div>
          </div>
          <button className="btn btn-gold btn-sm" disabled={busy} onClick={run}>{busy ? '…' : 'استخراج التقرير'}</button>

          {data && (
            <div style={{ marginTop: 16 }}>
              <div className="kpis" style={{ marginBottom: 12 }}>
                <div className="kpi"><div className="v">{occ.occupancy_rate}%</div><div className="l">نسبة الإشغال</div></div>
                <div className="kpi"><div className="v">{occ.occupied_days}</div><div className="l">أيام إشغال</div></div>
                <div className="kpi"><div className="v">{occ.vacant_days}</div><div className="l">أيام شغور</div></div>
                <div className="kpi"><div className="v">{SAR(data.totals.revenue)}</div><div className="l">الإيرادات</div></div>
                <div className="kpi"><div className="v">{SAR(data.totals.expenses)}</div><div className="l">المصروفات</div></div>
                <div className="kpi"><div className="v" style={{ color: net >= 0 ? 'var(--green)' : 'var(--st-oc)' }}>{SAR(net)}</div><div className="l">صافي الربح</div></div>
              </div>

              <div className="ai-insight-box">🤖 <b>تحليل المساعد الذكي:</b> {aiInsight}</div>

              <h4 className="ts-h4">سجل التأجير ({data.bookings.length})</h4>
              <table className="tbl" style={{ marginBottom: 14 }}>
                <thead><tr><th>المستأجر</th><th>من</th><th>إلى</th><th>النوع</th><th>الإجمالي</th><th>المدفوع</th></tr></thead>
                <tbody>
                  {data.bookings.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا يوجد</td></tr>}
                  {data.bookings.map((b, i) => <tr key={i}><td>{b.customer_name || '—'}</td><td dir="ltr">{b.check_in_date}</td><td dir="ltr">{b.check_out_date}</td><td>{{ daily: 'يومي', monthly: 'شهري', yearly: 'سنوي' }[b.rent_period] || b.rent_period}</td><td className="money">{SAR(b.total_amount)}</td><td className="money">{SAR(b.paid)}</td></tr>)}
                </tbody>
              </table>

              <h4 className="ts-h4">المصروفات والصيانة</h4>
              <table className="tbl" style={{ marginBottom: 14 }}>
                <thead><tr><th>التاريخ</th><th>النوع/الوصف</th><th>المبلغ</th></tr></thead>
                <tbody>
                  {data.expenses.length === 0 && data.maintenance.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا يوجد</td></tr>}
                  {data.expenses.map((e, i) => <tr key={'e' + i}><td dir="ltr">{e.expense_date}</td><td>مصروف: {e.description || e.category}</td><td className="neg">{SAR(e.amount)}</td></tr>)}
                  {data.maintenance.map((m, i) => <tr key={'m' + i}><td dir="ltr">{m.opened_at?.slice(0, 10)}</td><td>صيانة: {m.description || '—'}</td><td className="neg">{SAR(m.cost)}</td></tr>)}
                </tbody>
              </table>

              <button className="btn btn-blue btn-sm" onClick={() => setShowPrint(true)}>🖨 طباعة التقرير بترويسة و QR</button>
            </div>
          )}
        </div>
      </div>

      {showPrint && data && (
        <PrintableDoc
          company={company} title={`تقرير الوحدة ${data.unit.unit_number}`}
          subtitle={`الفترة: ${range.from} إلى ${range.to}`}
          docKind="unit" docTable="units" docId={data.unit.id}
          qrValue={JSON.stringify({ unit: data.unit.unit_number, from: range.from, to: range.to, occ: occ.occupancy_rate })}
          onClose={() => setShowPrint(false)}
        >
          <h4 className="contract-h4">بيانات الوحدة ومؤشرات الأداء</h4>
          <DocGrid items={[
            ['رقم الوحدة', data.unit.unit_number],
            ['التصنيف', CATS_L[data.unit.category] || data.unit.category],
            ['نسبة الإشغال', occ.occupancy_rate + '%'],
            ['أيام الإشغال', occ.occupied_days + ' من ' + data.period.total_days],
            ['أيام الشغور', occ.vacant_days],
            ['الإيرادات', SAR(data.totals.revenue)],
            ['المصروفات', SAR(data.totals.expenses)],
            ['صافي الربح', SAR(net)],
          ]} />
          <div className="ai-insight-box" style={{ marginBottom: 14 }}>🤖 <b>تحليل المساعد الذكي:</b> {aiInsight}</div>
          <h4 className="contract-h4">سجل التأجير</h4>
          <table className="tbl">
            <thead><tr><th>المستأجر</th><th>من</th><th>إلى</th><th>الإجمالي</th><th>المدفوع</th></tr></thead>
            <tbody>
              {data.bookings.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا يوجد</td></tr>}
              {data.bookings.map((b, i) => <tr key={i}><td>{b.customer_name || '—'}</td><td dir="ltr">{b.check_in_date}</td><td dir="ltr">{b.check_out_date}</td><td className="money">{SAR(b.total_amount)}</td><td className="money">{SAR(b.paid)}</td></tr>)}
            </tbody>
          </table>
        </PrintableDoc>
      )}
    </div>
  )
}


/* ============ نموذج إضافة/تعديل وحدة (المدير فقط) ============ */
function UnitForm({ unit, onClose }) {
  const { profile, canFinance, toast } = useAuth()
  const canEditPrices = canFinance // owner / manager / accountant / super admin only

  const { activeBranch, enabled: branchesEnabled, branches } = useBranches()
  const [f, setF] = useState(unit || {
    unit_number: '', category: 'apartment', daily_price: '', monthly_price: '',
    yearly_price: '', description: '', bedrooms: 1, bathrooms: 1,
    is_furnished: false, furniture_checklist: [], deed_number: '',
    branch_id: activeBranch || ''
  })

  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))

  // تحويل قيمة is_furnished إلى boolean فعلي
  const furnished = f.is_furnished === true || f.is_furnished === 'yes'
  const checklist = Array.isArray(f.furniture_checklist) ? f.furniture_checklist : []

  const toggleFurnished = (val) => {
    const yes = val === 'yes'
    setF(x => ({
      ...x,
      is_furnished: yes,
      furniture_checklist: yes && (!x.furniture_checklist || x.furniture_checklist.length === 0)
        ? DEFAULT_FURNITURE.map(name => ({ name, present: true, note: '' }))
        : (x.furniture_checklist || [])
    }))
  }
  const updateItem = (i, patch) => set('furniture_checklist',
    checklist.map((it, idx) => idx === i ? { ...it, ...patch } : it))
  const addItem = () => set('furniture_checklist', [...checklist, { name: '', present: true, note: '' }])
  const removeItem = (i) => set('furniture_checklist', checklist.filter((_, idx) => idx !== i))

  const save = async () => {
    if (!f.unit_number || f.unit_number.trim() === '') return toast('أدخل رقم الوحدة', true)
    if (!f.category) return toast('يرجى اختيار نوع الوحدة', true)
    
    // Price validation
    const dp = parseFloat(f.daily_price)
    const mp = parseFloat(f.monthly_price)
    const yp = parseFloat(f.yearly_price)
    
    if (f.daily_price && (isNaN(dp) || dp < 0)) return toast('سعر الإيجار اليومي يجب أن يكون رقماً إيجابياً', true)
    if (f.monthly_price && (isNaN(mp) || mp < 0)) return toast('سعر الإيجار الشهري يجب أن يكون رقماً إيجابياً', true)
    if (f.yearly_price && (isNaN(yp) || yp < 0)) return toast('سعر الإيجار السنوي يجب أن يكون رقماً إيجابياً', true)
      
    if (!f.daily_price && !f.monthly_price && !f.yearly_price) {
      return toast('يجب إدخال سعر واحد على الأقل (يومي، شهري، أو سنوي)', true)
    }
    if (branchesEnabled && branches.length > 0 && !f.branch_id) {
      return toast('يجب اختيار الفرع الذي تتبع له الوحدة', true)
    }


    setBusy(true)
    const row = {
      company_id: profile.company_id, unit_number: f.unit_number, category: f.category,
      daily_price: f.daily_price || null, monthly_price: f.monthly_price || null,
      yearly_price: f.yearly_price || null, description: f.description,
      bedrooms: f.bedrooms || null, bathrooms: f.bathrooms || null,
      is_furnished: furnished,
      furniture_checklist: furnished ? checklist.filter(x => x.name?.trim()) : [],
      deed_number: f.deed_number || null
    }
    // ختم الوحدة بالفرع المختار (أو الفرع النشط في السياق كخيار افتراضي عند الإنشاء)
    if (branchesEnabled) {
      const chosen = f.branch_id || (!unit ? activeBranch : null)
      if (chosen) row.branch_id = chosen
      else if (unit && f.branch_id === '') row.branch_id = null
    }

    const q = unit
      ? supabase.from('units').update(row).eq('id', unit.id)
      : supabase.from('units').insert(row)
    const { error } = await q
    setBusy(false)
    if (error) return toast('خطأ: ' + error.message, true)
    await logActivity(supabase, profile, {
      action: unit ? 'update' : 'create', entity: 'units', entity_id: unit?.id || null,
      summary: (unit ? 'تعديل الوحدة ' : 'إضافة الوحدة ') + f.unit_number
    })
    toast(unit ? 'تم تحديث الوحدة ✓' : 'تمت إضافة الوحدة — ظهرت الآن في لوحة الموظفين ✓')
    onClose()
  }

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(760px,100%)' }}>
        <div className="modal-h"><h3>{unit ? 'تعديل الوحدة ' + unit.unit_number : 'إضافة وحدة جديدة'} </h3>
          <button className="x" onClick={onClose}>✕</button></div>
        <div className="modal-b">
          <div className="grid2">
            <div className="fld"><label>رقم الوحدة / الشقة *</label>
              <input value={f.unit_number} onChange={e => set('unit_number', e.target.value)} placeholder="101 أو CH-1" /></div>
            <div className="fld"><label>التصنيف</label>
              <select value={f.category} onChange={e => set('category', e.target.value)}>
                {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div className="fld"><label>حالة التأثيث *</label>
              <select value={furnished ? 'yes' : 'no'} onChange={e => toggleFurnished(e.target.value)}>
                <option value="no">فارغة (بدون أثاث)</option>
                <option value="yes">مفروشة (بها أثاث)</option>
              </select></div>
            <div className="fld"><label>السعر اليومي (ر.س){!canEditPrices && ' 🔒'}</label>
              <input type="number" value={f.daily_price || ''} readOnly={!canEditPrices} disabled={!canEditPrices}
                title={canEditPrices ? '' : 'تعديل الأسعار يقتصر على المدير أو المحاسب'}
                onChange={e => set('daily_price', e.target.value)} /></div>
            <div className="fld"><label>السعر الشهري (ر.س){!canEditPrices && ' 🔒'}</label>
              <input type="number" value={f.monthly_price || ''} readOnly={!canEditPrices} disabled={!canEditPrices}
                title={canEditPrices ? '' : 'تعديل الأسعار يقتصر على المدير أو المحاسب'}
                onChange={e => set('monthly_price', e.target.value)} /></div>
            <div className="fld"><label>السعر السنوي (ر.س){!canEditPrices && ' 🔒'}</label>
              <input type="number" value={f.yearly_price || ''} readOnly={!canEditPrices} disabled={!canEditPrices}
                title={canEditPrices ? '' : 'تعديل الأسعار يقتصر على المدير أو المحاسب'}
                onChange={e => set('yearly_price', e.target.value)} /></div>

            <div className="fld"><label>غرف / حمّامات</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="number" value={f.bedrooms || ''} onChange={e => set('bedrooms', e.target.value)} />
                <input type="number" value={f.bathrooms || ''} onChange={e => set('bathrooms', e.target.value)} />
              </div></div>
          </div>
          <div className="fld"><label>نبذة عن الوصف</label>
            <textarea rows={2} value={f.description || ''} onChange={e => set('description', e.target.value)}
              placeholder="غرفتان وصالة، إطلالة شمالية، مدخل خاص…" /></div>
          <div className="fld"><label>رقم الصك العقاري (اختياري — يلزم فقط لتوثيق العقد على منصة إيجار)</label>
            <input value={f.deed_number || ''} onChange={e => set('deed_number', e.target.value)} dir="ltr" placeholder="مثال: 123456789012" /></div>

          {branchesEnabled && (
            <div className="fld">
              <label>الفرع * {branches.length === 0 ? '(لا توجد فروع مضافة بعد — يجب إنشاء فرع من الإعدادات أولاً)' : ''}</label>
              <select value={f.branch_id || ''} required onChange={e => set('branch_id', e.target.value)}>
                <option value="">— اختر الفرع —</option>
                {branches.filter(b => b.is_active !== false).map(b => (
                  <option key={b.id} value={b.id}>{b.name}{b.code ? ` (${b.code})` : ''}</option>
                ))}
              </select>
            </div>
          )}


          {furnished && (
            <div className="furn-panel">
              <div className="furn-head">
                <h4>قائمة الأثاث ({checklist.length} عنصر)</h4>
                <button type="button" className="btn btn-ghost btn-sm" onClick={addItem}>+ إضافة عنصر</button>
              </div>

              <div className="furn-list">
                {checklist.map((it, i) => (
                  <div key={i} className="furn-row">
                    <label className="furn-check">
                      <input type="checkbox" checked={!!it.present}
                        onChange={e => updateItem(i, { present: e.target.checked })} />
                      <span>موجود</span>
                    </label>
                    <input placeholder="اسم العنصر" value={it.name || ''}
                      onChange={e => updateItem(i, { name: e.target.value })} />
                    <input placeholder="ملاحظة (اختياري)" value={it.note || ''}
                      onChange={e => updateItem(i, { note: e.target.value })} />
                    <button type="button" className="furn-del" onClick={() => removeItem(i)} title="حذف">🗑</button>
                  </div>
                ))}
                {checklist.length === 0 && <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 12 }}>
                  لا توجد عناصر — اضغط "إضافة عنصر" أو أعد اختيار "مفروشة" لتحميل القائمة الافتراضية
                </div>}
              </div>
            </div>
          )}

          <button className="btn btn-gold" disabled={busy} onClick={save} style={{ marginTop: 14 }}>
            {unit ? 'حفظ التعديلات' : 'إضافة الوحدة'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============ مودال الوحدة: تفاصيل/صور/تقويم/تاريخ/حجز ============ */
function UnitModal({ unit, initialTab = 'info', onClose }) {
  const { profile, isOwner, toast, company } = useAuth()
  const [tab, setTab] = useState(initialTab)
  const [media, setMedia] = useState([])
  const [bookings, setBookings] = useState([])
  const [editOpen, setEditOpen] = useState(false)
  const [handover, setHandover] = useState(null)   // 'check_in' | 'check_out' | null
  const [settlementOpen, setSettlementOpen] = useState(false)
  const [summaryFor, setSummaryFor] = useState(null)
  const [autoWelcome, setAutoWelcome] = useState(false)
  const [contractFor, setContractFor] = useState(null)
  const [hFilter, setHFilter] = useState({ cust: '', from: '', to: '' })
  const [maintenanceForm, setMaintenanceForm] = useState({ description: '', request_type: 'maintenance', urgency: 'normal' })
  
  const submitMaintenance = async () => {
    if(!maintenanceForm.description) return toast('يرجى كتابة وصف المشكلة', true);
    const { error } = await supabase.from('maintenance_requests').insert({
      company_id: profile.company_id,
      unit_id: unit.id,
      request_type: maintenanceForm.request_type,
      description: maintenanceForm.description,
      status: 'open',
      opened_by: profile.id,
      urgency: maintenanceForm.urgency
    });
    if (error) return toast('خطأ: ' + error.message, true);
    toast('تم رفع طلب الصيانة وهو قيد الانتظار ✓');
    setMaintenanceForm({ description: '', request_type: 'maintenance', urgency: 'normal' });
    setTab('info');
    load();
  }
  const active = bookings.find(b => ['confirmed', 'checked_in', 'reserved_online'].includes(b.status)) || (['reserved', 'reserved_online', 'occupied'].includes(unit.status) ? bookings[0] : null)

  const load = useCallback(async () => {
    const { data: md } = await supabase.from('unit_media').select('*').eq('unit_id', unit.id).order('sort_order')
    setMedia(md || [])
    const { data: bk } = await supabase.from('bookings')
      .select('*, customers(full_name, phone, id_number), payments(amount, payment_type, method, payment_date, reference_number), profiles!bookings_employee_id_fkey(full_name)')
      .eq('unit_id', unit.id).order('check_in_date', { ascending: false })
    setBookings(bk || [])
  }, [unit.id])
  useEffect(() => { load() }, [load])
  
  const uploadMedia = async (file) => {
    try {
      const url = await uploadFile(supabase, 'unit-media', profile.company_id, file)
      await supabase.from('unit_media').insert({
        company_id: profile.company_id, unit_id: unit.id,
        media_type: file.type.startsWith('video') ? 'video' : 'image', url
      })
      toast('تم رفع الملف ✓'); load()
    } catch (e) { toast('فشل الرفع: ' + e.message, true) }
  }

  const deleteMedia = async (id) => {
    if (!confirm('حذف هذه الصورة/الفيديو نهائياً؟')) return
    const { error } = await supabase.from('unit_media').delete().eq('id', id)
    if (error) return toast('خطأ في الحذف: ' + error.message, true)
    toast('تم حذف الملف ✓'); load()
  }

  const setStatus = async (status) => {
    const { error } = await supabase.from('units').update({ status }).eq('id', unit.id)
    if (error) return toast('خطأ: ' + error.message, true)
    await logActivity(supabase, profile, {
      action: 'update', entity: 'units', entity_id: unit.id,
      summary: `تغيير حالة الوحدة ${unit.unit_number} إلى ${STATUS[status]?.label || status}`,
      sensitive: status === 'maintenance'
    })
    toast('تم تحديث حالة الوحدة فورياً ✓'); onClose()
  }

  const cancelBooking = async () => {
    if (!active) return
    
    // 1. إلغاء الحجز
    const { error } = await supabase.from('bookings').update({ status: 'cancelled', cancel_reason: 'إلغاء من المدير' }).eq('id', active.id)
    if (error) return toast(error.message.includes('المدير') ? '⚠ إلغاء الحجز صلاحية حصرية لحساب المدير' : 'خطأ: ' + error.message, true)
    
    // 2. تحديث حالة الوحدة لتصبح متاحة فورياً
    await supabase.from('units').update({ status: 'available' }).eq('id', unit.id)

    // 3. مزامنة الإلغاء مع الحسابات (قيد عكسي + سند صرف مسترد)
    const cancelAmount = active.paid || active.total_amount || 0
    await syncBookingCancellationToAccounting(supabase, {
      companyId: profile.company_id,
      bookingId: active.id,
      customerName: active.customers?.full_name || active.guest_name || 'عميل أونلاين',
      amount: cancelAmount,
      unitNumber: unit.unit_number
    })

    await logActivity(supabase, profile, {
      action: 'cancel', entity: 'bookings', entity_id: active.id,
      summary: `إلغاء حجز الوحدة ${unit.unit_number} وعكس قيد الإيراد المحاسبي — المستأجر: ${active.customers?.full_name || '—'}`,
      sensitive: true
    })
    
    triggerChannexSync(profile.company_id)
    toast('تم إلغاء الحجز وعادت الوحدة متاحة وتحديث الحسابات تلقائياً ✓'); onClose()
  }

  const hist = bookings.filter(b =>
    (!hFilter.cust || b.customers?.full_name.includes(hFilter.cust)) &&
    (!hFilter.from || b.check_out_date >= hFilter.from) &&
    (!hFilter.to || b.check_in_date <= hFilter.to))

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-h">
          <h3>الوحدة {unit.unit_number} — {CATS[unit.category]}
            <span className="chip" style={{ background: 'rgba(255,255,255,.18)', color: '#fff', marginInlineStart: 8 }}>{STATUS[unit.status].label}</span>
          </h3>
          <button className="x" onClick={onClose}>✕</button>
        </div>
        <div className="modal-b">
          <div className="mtabs" style={{ flexWrap: 'wrap' }}>
            {[
              ['info', 'التفاصيل والصور'],
              ['settle', '💰 تصفية الحساب'],
              ['cal', 'تقويم الحجوزات'],
              ['hist', 'تاريخ التأجير'],
              ['book', 'حجز / تسليم'],
              ['inv', 'الأثاث والأصول']
            ].map(([k, l]) =>
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
          </div>

          {tab === 'info' && (
            <div className="grid2">
              <div>
                {media.length === 0
                  ? <div style={{ height: 170, borderRadius: 12, background: 'linear-gradient(140deg,var(--blue-2),var(--green))', display: 'grid', placeItems: 'center', color: 'var(--gold-l)' }}>📷 لا توجد صور بعد</div>
                  : <div className="media-item" style={{ position: 'relative' }}>
                      {media[0].media_type === 'video'
                        ? <video src={media[0].url} controls style={{ width: '100%', height: 170, borderRadius: 12, objectFit: 'cover' }} />
                        : <img src={media[0].url} style={{ width: '100%', height: 170, borderRadius: 12, objectFit: 'cover' }} />}
                      <button className="media-del-btn" onClick={() => deleteMedia(media[0].id)}>✕ حذف</button>
                    </div>}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 7, marginTop: 8 }}>
                  {media.slice(1).map(m => (
                    <div key={m.id} className="media-item" style={{ position: 'relative' }}>
                      {m.media_type === 'video'
                        ? <video src={m.url} style={{ height: 52, width: '100%', borderRadius: 8, objectFit: 'cover' }} />
                        : <img src={m.url} style={{ height: 52, width: '100%', borderRadius: 8, objectFit: 'cover' }} />}
                      <button className="media-del-btn" style={{ fontSize: 10, padding: '2px 5px' }} onClick={() => deleteMedia(m.id)}>✕</button>
                    </div>
                  ))}
                </div>
                <label className="btn btn-ghost btn-sm" style={{ marginTop: 10 }}>
                  📤 رفع صورة / فيديو
                  <input type="file" accept="image/*,video/*" style={{ display: 'none' }}
                    onChange={e => e.target.files[0] && uploadMedia(e.target.files[0])} />
                </label>
              </div>
              <div>
                <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 10 }}>{unit.description || '—'}</p>
                <table className="tbl"><tbody>
                  <tr><td>السعر اليومي</td><td className="money">{unit.daily_price ? SAR(unit.daily_price) : '—'}</td></tr>
                  <tr><td>السعر الشهري</td><td className="money">{unit.monthly_price ? SAR(unit.monthly_price) : '—'}</td></tr>
                  <tr><td>السعر السنوي</td><td className="money">{unit.yearly_price ? SAR(unit.yearly_price) : '—'}</td></tr>
                  <tr><td>غرف / حمّامات</td><td>{unit.bedrooms ?? '—'} / {unit.bathrooms ?? '—'}</td></tr>
                </tbody></table>

                {active?.ejar_status === 'registered' && (
                  <div className="ejar-badge-box">
                    🏛️ هذا المستأجر له عقد موثّق رسمياً على منصة إيجار — رقم العقد: <b dir="ltr">{active.ejar_contract_number}</b>
                  </div>
                )}
                {active && ['pending_landlord', 'pending_tenant'].includes(active.ejar_status) && (
                  <div className="ejar-badge-box pending">🏛️ العقد قيد التوثيق على إيجار — {active.ejar_status === 'pending_tenant' ? 'بانتظار موافقة المستأجر' : 'بانتظار موافقة المؤجر'}</div>
                )}

                {unit.share_slug && (
                  <div className="share-box">
                    <div className="share-label">🔗 رابط الوحدة للمشاركة مع المستأجرون</div>
                    <div className="share-row">
                      <input readOnly value={shareUrl(unit.share_slug)} onFocus={e => e.target.select()} dir="ltr" />
                      <button className="btn btn-ghost btn-sm" onClick={() => {
                        navigator.clipboard.writeText(shareUrl(unit.share_slug))
                        toast('تم نسخ الرابط ✓')
                      }}>نسخ</button>
                      <a className="btn btn-green btn-sm" target="_blank" rel="noopener noreferrer"
                        href={waShareUrl(unit.share_slug, unit.unit_number)}>واتساب</a>
                    </div>
                  </div>
                )}

                {unit.is_furnished && Array.isArray(unit.furniture_checklist) && unit.furniture_checklist.length > 0 && (
                  <details className="furn-view">
                    <summary>🛋 قائمة الأثاث ({unit.furniture_checklist.length} عنصر)</summary>
                    <ul>
                      {unit.furniture_checklist.map((it, i) => (
                        <li key={i} className={it.present ? '' : 'missing'}>
                          <span>{it.present ? '✓' : '✕'}</span>
                          <b>{it.name}</b>
                          {it.note && <em> — {it.note}</em>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {active && (
                  <div style={{ background: 'var(--soft)', borderRadius: 12, padding: 12, marginTop: 12, border: '1px solid var(--border)', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                    <div style={{ fontWeight: 'bold', fontSize: 13, color: 'var(--gold-l)', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>🌐 تفاصيل الحجز وخطة الأسعار المحاسبية</span>
                      <span className="chip" style={{ background: active.booking_source?.includes('Booking.com') || active.booking_source?.includes('Channex') ? '#ec4899' : 'var(--blue-2)', color: '#fff', fontSize: 11, fontWeight: 'bold' }}>
                        {active.booking_source || 'حجز مباشر'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, color: 'var(--fg)' }}>
                      <div><b>الضيف:</b> {active.customers?.full_name || active.guest_name || '—'}</div>
                      <div><b>الهاتف:</b> {active.customers?.phone || '—'}</div>
                      <div><b>رقم الهوية:</b> {active.customers?.id_number || '—'}</div>
                      <div><b>قناة الحجز:</b> {active.booking_source || 'حجز مباشر'}</div>
                      <div><b>تاريخ الوصول:</b> {active.check_in_date}</div>
                      <div><b>تاريخ المغادرة:</b> {active.check_out_date}</div>
                      <div><b>السعر الأساسي:</b> {SAR(active.base_price || active.total_amount)}</div>
                      <div><b>الخصم المطبق:</b> <span style={{ color: '#ec4899', fontWeight: 'bold' }}>{active.discount_percent || 0}% ({SAR(active.discount_amount || 0)})</span></div>
                      <div><b>عقد إيجار:</b> <span className="badge">{active.ejar_status || 'غير مرتبطة بـ إيجار ❌'}</span></div>
                      <div><b>رقم العقد:</b> {active.ejar_contract_number || '—'}</div>
                      <div><b>خطة الأسعار (ID):</b> <code style={{ fontSize: 10, background: 'var(--bg)', padding: '2px 4px', borderRadius: 4 }}>{active.channex_rate_plan_id || 'rp_flex'}</code></div>
                      <div><b>حالة الحجز:</b> <span className="badge" style={{ background: '#ec4899', color: '#fff' }}>محجوز أونلاين 💗</span></div>
                      <div style={{ gridColumn: '1 / -1', paddingTop: 6, borderTop: '1px dashed var(--border)', marginTop: 4, fontWeight: 'bold', color: 'var(--green)', fontSize: 13 }}>
                        💰 صافي الإيراد المحصّل في الحسابات: {SAR(active.total_amount || 0)}
                      </div>
                      {active.notes && (
                        <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          📝 {active.notes}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  {active && (
                    <button
                      className="btn btn-green btn-sm"
                      style={{ background: 'linear-gradient(135deg, #059669 0%, #047857 100%)', color: '#fff', fontWeight: 'bold', fontSize: 12 }}
                      onClick={() => setTab('settle')}
                    >
                      💰 تصفية الحساب واستلام الغرفة وإنهاء السكن
                    </button>
                  )}
                  {isOwner
                    ? <button className="btn btn-blue btn-sm" onClick={() => setEditOpen(true)}>تعديل البيانات والأسعار</button>
                    : <button className="btn btn-ghost btn-sm" onClick={() => toast('⚠ تعديل بيانات الوحدة والأسعار صلاحية حصرية لحساب المدير', true)}>تعديل الأسعار 🔒</button>}
                  {active && ['confirmed','checked_in','reserved_online'].includes(active.status) &&
                    <button className="btn btn-gold btn-sm" onClick={() => setHandover('check_in')}>🔑 تسليم للمستأجر عند بدء الإيجار (Check-in List)</button>}
                  {active && active.status === 'checked_in' &&
                    <button className="btn btn-blue btn-sm" onClick={() => setHandover('check_out')}>📥 استلام من المستأجر (Check-out List)</button>}
                  {active && <button className="btn btn-ghost btn-sm" onClick={() => setSummaryFor(active)}>🖨 ملخص الإيجار للمستأجر</button>}
                  {active && <button className="btn btn-ghost btn-sm" onClick={() => setContractFor(active)}>🖨 عقد الإيجار</button>}
                  {['cleaning', 'maintenance'].includes(unit.status) &&
                    <button className="btn btn-green btn-sm" onClick={() => setStatus('available')}>إنهاء التنظيف/الصيانة → متاح</button>}
                  {unit.status === 'available' &&
                    <button className="btn btn-ghost btn-sm" onClick={() => setStatus('maintenance')}>تحويل إلى صيانة</button>}
                  {['reserved', 'reserved_online'].includes(unit.status) && active && (
                    <button
                      className="btn btn-danger btn-sm"
                      style={{ background: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)', color: '#fff', border: 'none', fontWeight: 'bold' }}
                      onClick={cancelBooking}
                    >
                      🔴 إلغاء الحجز {!isOwner && '🔒'}
                    </button>
                  )}
                  {!active && unit.status === 'reserved_online' && (
                    <button
                      className="btn btn-danger btn-sm"
                      style={{ background: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)', color: '#fff', border: 'none', fontWeight: 'bold' }}
                      onClick={() => setStatus('available')}
                    >
                      🔴 إلغاء حالة الحجز الأونلاين وتحرير الوحدة
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'cal' && <Calendar bookings={bookings} />}

          {tab === 'hist' && (
            <div>
              <div className="grid3" style={{ marginBottom: 12 }}>
                <div><label>مستأجر محدد</label><input value={hFilter.cust} onChange={e => setHFilter({ ...hFilter, cust: e.target.value })} placeholder="اسم المستأجر…" /></div>
                <div><label>من تاريخ</label><input type="date" value={hFilter.from} onChange={e => setHFilter({ ...hFilter, from: e.target.value })} /></div>
                <div><label>إلى تاريخ</label><input type="date" value={hFilter.to} onChange={e => setHFilter({ ...hFilter, to: e.target.value })} /></div>
              </div>
              <table className="tbl">
                <thead><tr><th>المستأجر</th><th>من</th><th>إلى</th><th>الإجمالي</th><th>المدفوع</th><th>العربون</th><th>التأمين</th><th>الحالة</th><th>إيجار</th></tr></thead>
                <tbody>
                  {hist.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا يوجد تاريخ تأجير بعد</td></tr>}
                  {hist.map(b => {
                    const paid = (b.payments || []).reduce((s, p) => s + Number(p.amount), 0)
                    return <tr key={b.id}>
                      <td>{b.customers?.full_name}</td><td>{b.check_in_date}</td><td>{b.check_out_date}</td>
                      <td className="money">{SAR(b.total_amount)}</td><td className="money">{SAR(paid)}</td>
                      <td>{SAR(b.down_payment)}</td><td>{SAR(b.insurance_amount)}</td>
                      <td><span className="chip" style={{ background: 'var(--soft)', color: 'var(--blue-2)' }}>
                        {{ pending: 'معلق', confirmed: 'محجوز', checked_in: 'ساكن', checked_out: 'منتهي', cancelled: 'ملغي', pending_approval: 'بانتظار موافقة الخصم' }[b.status] || b.status}</span></td>
                      <td>{b.ejar_status === 'registered'
                        ? <span className="chip chip-ok" title={'رقم العقد: ' + b.ejar_contract_number}>🏛️ موثّق إيجار</span>
                        : '—'}</td>
                    </tr>
                  })}
                </tbody>
              </table>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => downloadPDF({
                title: `تاريخ تأجير الوحدة ${unit.unit_number}`,
                subtitle: CATS[unit.category],
                company,
                filters: { 'مستأجر': hFilter.cust || undefined, 'من': hFilter.from || undefined, 'إلى': hFilter.to || undefined },
                sheets: [{
                  name: 'سجل الإيجارات',
                  rows: hist.map(b => ({
                    'المستأجر': b.customers?.full_name || '—',
                    'من': b.check_in_date, 'إلى': b.check_out_date,
                    'الإجمالي': Number(b.total_amount || 0),
                    'المدفوع': (b.payments || []).reduce((s, p) => s + Number(p.amount), 0),
                    'العربون': Number(b.down_payment || 0), 'التأمين': Number(b.insurance_amount || 0),
                    'الحالة': { pending: 'معلق', confirmed: 'محجوز', checked_in: 'ساكن', checked_out: 'منتهي', cancelled: 'ملغي', pending_approval: 'بانتظار موافقة الخصم' }[b.status] || b.status,
                  })),
                  numeric: ['الإجمالي', 'المدفوع', 'العربون', 'التأمين'],
                }],
              })}>🖨 طباعة التاريخ الكامل</button>
            </div>
          )}

          {tab === 'book' && <BookingForm unit={unit} active={active} onDone={(bk, status) => {
            if (bk && status === 'checked_in') { setAutoWelcome(true); setSummaryFor(bk); load() }
            else onClose()
          }} />}

          {tab === 'inv' && <UnitInventory unit={unit} profile={profile} company={company} activeBooking={active} toast={toast} />}
          {tab === 'settle' && active && (
            <SettlementModal
              unit={unit}
              booking={active}
              isInline={true}
              onClose={(refreshed) => {
                if (refreshed) { load(); onClose() }
              }}
            />
          )}
          {tab === 'settle' && !active && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
              لا يوجد ساكن حالي في هذه الوحدة لتصفية حسابه.
            </div>
          )}
        </div>
      </div>
      {editOpen && <UnitForm unit={unit} onClose={() => { setEditOpen(false); onClose() }} />}
      {handover && <HandoverModal unit={unit} booking={active} kind={handover}
        onClose={(saved) => { setHandover(null); if (saved) load() }} />}
      {summaryFor && <TenantSummary booking={summaryFor} unit={unit} autoSend={autoWelcome}
        onClose={() => { setSummaryFor(null); setAutoWelcome(false) }} />}
      {contractFor && (
        <RentalContract
          onClose={() => setContractFor(null)}
          company={company}
          employeeName={contractFor.profiles?.full_name}
          customer={contractFor.customers}
          unit={{ unit_number: unit.unit_number, category: CATS[unit.category] || unit.category, description: unit.description }}
          booking={contractFor}
        />
      )}
    </div>
  )
}

/* ============ تقويم شهري حقيقي من الحجوزات ============ */
function Calendar({ bookings }) {
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const first = new Date(ym.y, ym.m, 1)
  const days = new Date(ym.y, ym.m + 1, 0).getDate()
  const pad = first.getDay()
  const cell = (d) => {
    const iso = `${ym.y}-${String(ym.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const b = bookings.find(b => ['confirmed', 'checked_in'].includes(b.status) && b.check_in_date <= iso && iso < b.check_out_date)
    return b ? (b.status === 'checked_in' ? 'occ' : 'res') : ''
  }
  const isToday = (d) => new Date().toISOString().slice(0, 10) === `${ym.y}-${String(ym.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setYm(v => v.m === 0 ? { y: v.y - 1, m: 11 } : { ...v, m: v.m - 1 })}>‹ السابق</button>
        <b>{first.toLocaleDateString('ar-SA', { month: 'long', year: 'numeric' })}</b>
        <button className="btn btn-ghost btn-sm" onClick={() => setYm(v => v.m === 11 ? { y: v.y + 1, m: 0 } : { ...v, m: v.m + 1 })}>التالي ›</button>
      </div>
      <div className="cal">
        {['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'].map(d => <div key={d} className="dh">{d}</div>)}
        {Array.from({ length: pad }).map((_, i) => <div key={'p' + i} />)}
        {Array.from({ length: days }).map((_, i) =>
          <div key={i} className={`d ${cell(i + 1)} ${isToday(i + 1) ? 'today' : ''}`}>{i + 1}</div>)}
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>برتقالي = محجوز مسبقاً · أحمر = مسكون. للحجز المسبق بتاريخ مستقبلي استخدم تبويب «حجز / تسليم» مع خانة العربون — النظام يمنع الحجز المزدوج تلقائياً.</p>
    </div>
  )
}

/* ============ نموذج الحجز والتسليم والدفعات والفاتورة ============ */
function BookingForm({ unit, active, onDone }) {
  const { profile, isOwner, canFinance, company, toast } = useAuth()
  const [busy, setBusy] = useState(false)
  const [invoice, setInvoice] = useState(null)
  const [showContract, setShowContract] = useState(false)
  const [f, setF] = useState({
    name: '', idType: 'national_id', idNumber: '', phone: '', companion: '',
    customer_type: 'individual',  // 'individual' | 'company'
    company_name: '', company_vat: '', company_cr: '', company_address: '',
    invoice_type: 'simplified',   // 'simplified' | 'standard' (معتمدة للشركات)
    period: 'daily', inDate: today(), outDate: '', duration: 1,
    discount: 0, downPayment: 0, insurance: 0,
    payNow: 0, method: 'cash', refNo: ''
  })
  const [idFile, setIdFile] = useState(null)
  const [payFile, setPayFile] = useState(null)
  const [showMoveTenant, setShowMoveTenant] = useState(false);
  const [availableUnits, setAvailableUnits] = useState([]);
  const [targetUnitId, setTargetUnitId] = useState('');
  
  const loadAvailableUnits = async () => {
    const { data } = await supabase
      .from('units')
      .select('id, unit_number')
      .eq('company_id', profile.company_id)
      .eq('status', 'available')
      .neq('id', unit.id)
      .order('unit_number');
    setAvailableUnits(data || []);
  };

  
  const [transferReason, setTransferReason] = useState('');
  const [transferFees, setTransferFees] = useState('');

  const handleMoveTenant = async () => {
    if (!targetUnitId) return toast('الرجاء اختيار الوحدة الجديدة', true);
    if (targetUnitId === unit.id) return toast('الوحدة الجديدة هي نفس الوحدة الحالية', true);
    setBusy(true);

    // فحص مسبق: هل الوحدة الجديدة متاحة في نفس فترة الحجز؟
    const { data: av } = await supabase.rpc('check_unit_availability', {
      _unit_id: targetUnitId, _check_in: active.check_in_date, _check_out: active.check_out_date, _exclude_booking: active.id
    });
    const avRow = Array.isArray(av) ? av[0] : av;
    if (avRow && avRow.available === false) {
      setBusy(false);
      return toast('⚠ الوحدة الجديدة محجوزة خلال نفس الفترة — اختر وحدة أخرى', true);
    }

    // نقل الحجز مع مزامنة الفرع مع الوحدة الجديدة
    const { data: tUnit } = await supabase.from('units').select('branch_id, unit_number').eq('id', targetUnitId).maybeSingle();
    const { error: err1 } = await supabase.from('bookings')
      .update({ unit_id: targetUnitId, branch_id: tUnit?.branch_id ?? null }).eq('id', active.id);
    if (err1) {
      const m = String(err1.message || '');
      toast(/no_double_booking|exclusion|23P01/i.test(m)
        ? '⚠ تعذّر النقل: الوحدة الجديدة محجوزة خلال نفس الفترة'
        : 'خطأ في النقل: ' + m, true);
      setBusy(false); return;
    }

    // set old unit status to maintenance (clean up required)
    await supabase.from('units').update({ status: 'maintenance' }).eq('id', unit.id);
    // set new unit status to occupied
    await supabase.from('units').update({ status: 'occupied' }).eq('id', targetUnitId);

    
    // generate audit log
    const targetUnitName = availableUnits.find(u => u.id === targetUnitId)?.unit_number || targetUnitId;
    const fees = Number(transferFees) || 0;
    const summaryMsg = `نقل المستأجر من ${unit.name || unit.unit_number} إلى ${targetUnitName}. السبب: ${transferReason || 'بدون سبب'}.`;
    
    await logActivity(supabase, profile, { 
      action: 'move_tenant', 
      entity: 'bookings', 
      entity_id: active.id, 
      summary: summaryMsg 
    });

    if (fees > 0) {
      const { data: b } = await supabase.from('bookings').select('total_amount').eq('id', active.id).single();
      if (b) await supabase.from('bookings').update({ total_amount: Number(b.total_amount) + fees }).eq('id', active.id);
    }

    toast('تم استبدال الوحدة بنجاح، وتحويل القديمة للصيانة/النظافة');
    setBusy(false);
    setShowMoveTenant(false);
    onDone();
  };
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const isCompany = f.customer_type === 'company'

  // اختيار العميل: حالي أم جديد
  const [custMode, setCustMode] = useState('new')          // 'new' | 'existing'
  const [existingCustomers, setExistingCustomers] = useState([])
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [warningCustomer, setWarningCustomer] = useState(null)
  const [warningType, setWarningType] = useState('blacklisted') // 'blacklisted' | 'debt'
  const [showWarningModal, setShowWarningModal] = useState(false)
  const [storedDocNotice, setStoredDocNotice] = useState(null)
  const [show360ModalFromWarning, setShow360ModalFromWarning] = useState(null)
  const [overrideWarning, setOverrideWarning] = useState(false)

  useEffect(() => {
    supabase.from('customers')
      .select('*, bookings(id, total_amount, payments(amount))')
      .eq('company_id', profile.company_id).order('full_name')
      .then(({ data }) => setExistingCustomers(data || []))
  }, [profile])

  const pickExisting = (id) => {
    setSelectedCustomerId(id)
    setOverrideWarning(false)
    setStoredDocNotice(null)
    setWarningCustomer(null)

    const c = existingCustomers.find(x => x.id === id)
    if (!c) return

    setF(x => ({
      ...x,
      name: c.full_name || '',
      idType: c.id_type || 'national_id',
      idNumber: c.id_number || '',
      phone: c.phone || ''
    }))

    // Blacklist Check Only (Customer debt system check removed per user request)
    const isBl = c.is_blacklisted || c.rating === 1 || c.notes?.includes('[BLACKLIST]')

    if (isBl) {
      setWarningCustomer(c)
      setWarningType('blacklisted')
      setShowWarningModal(true)
    }

    // Check stored documents
    let docs = []
    try {
      if (Array.isArray(c.documents)) docs = c.documents
      else if (c.documents_json) docs = JSON.parse(c.documents_json)
      else if (c.notes?.match(/\[DOCUMENTS:(.*?)\]/)?.[1]) docs = JSON.parse(c.notes.match(/\[DOCUMENTS:(.*?)\]/)[1])
    } catch (_) {}

    const primaryDocUrl = c.id_document_url || docs[0]?.url
    if (primaryDocUrl) {
      setStoredDocNotice({
        title: docs[0]?.title || 'صورة الإثبات المخزنة',
        url: primaryDocUrl,
        count: docs.length || 1
      })
    }
  }

  const basePrice = { daily: unit.daily_price, monthly: unit.monthly_price, yearly: unit.yearly_price }[f.period] || 0
  const gross = num(basePrice) * num(f.duration)
  const discountAmt = Math.round(gross * num(f.discount) / 100 * 100) / 100
  const total = gross - discountAmt
  const remaining = total - num(f.payNow) - num(f.downPayment)

  // حساب تاريخ الخروج تلقائياً من المدة
  useEffect(() => {
    if (!f.inDate || !f.duration) return
    const d = new Date(f.inDate)
    if (f.period === 'daily') d.setDate(d.getDate() + num(f.duration))
    if (f.period === 'monthly') d.setMonth(d.getMonth() + num(f.duration))
    if (f.period === 'yearly') d.setFullYear(d.getFullYear() + num(f.duration))
    set('outDate', d.toISOString().slice(0, 10))
  }, [f.inDate, f.duration, f.period])

  const createBooking = async (targetStatus) => {
    if (!f.name || !f.idNumber || !f.phone) return toast('أكمل بيانات المستأجر: الاسم والهوية والجوال', true)
    if (!basePrice) return toast('لا يوجد سعر ' + { daily: 'يومي', monthly: 'شهري', yearly: 'سنوي' }[f.period] + ' مسجل لهذه الوحدة (يضيفه المدير)', true)
    // تحقق من صحة التواريخ قبل أي عملية على قاعدة البيانات
    if (!f.inDate || !f.outDate) return toast('حدّد تاريخ البداية والمدة', true)
    if (!(new Date(f.outDate) > new Date(f.inDate))) return toast('تاريخ المغادرة يجب أن يكون بعد تاريخ الوصول', true)

    if (warningCustomer && (warningCustomer.is_blacklisted || warningCustomer.rating === 1) && !overrideWarning) {
      setShowWarningModal(true)
      return toast('⛔ العميل مدرج بالقائمة السوداء! يرجى إزالة الحظر من ملف العميل أو تجاوز الحظر بمسئولية المدير', true)
    }

    // منع خصم > 20% من الموظف: يحوّل إلى طلب موافقة
    const needsApproval = num(f.discount) > 20 && !canFinance
    if (needsApproval) targetStatus = 'pending_approval'
    setBusy(true)
    try {
      const cid = profile.company_id
      // 0) فحص مسبق لتوفر الوحدة (القيد الفعلي في قاعدة البيانات هو المرجع النهائي)
      if (['confirmed', 'checked_in'].includes(targetStatus)) {
        const { data: av, error: avErr } = await supabase
          .rpc('check_unit_availability', { _unit_id: unit.id, _check_in: f.inDate, _check_out: f.outDate, _exclude_booking: null })
        const row = Array.isArray(av) ? av[0] : av
        if (!avErr && row && row.available === false) {
          setBusy(false)
          return toast('⚠ الوحدة محجوزة في هذه الفترة — اختر تواريخ أخرى أو وحدة أخرى', true)
        }
      }
      // 1) رفع صورة الهوية
      const idUrl = idFile ? await uploadFile(supabase, 'documents', cid, idFile) : null
      // 2) المستأجر (إنشاء أو استخدام موجود بنفس رقم الهوية)
      let { data: cust } = await supabase.from('customers').select('id').eq('company_id', cid).eq('id_number', f.idNumber).maybeSingle()
      if (!cust) {
        const { data: nc, error } = await supabase.from('customers').insert({
          company_id: cid, full_name: f.name, id_type: f.idType,
          id_number: f.idNumber, phone: f.phone, id_document_url: idUrl, created_by: profile.id,
          branch_id: unit.branch_id || null
        }).select('id').single()

        if (error) throw error
        cust = nc
      }
      // 3) الحجز — يرث فرع الوحدة حتى تعمل تصفية الفروع والتقارير بشكل صحيح
      const { data: bk, error: be } = await supabase.from('bookings').insert({
        company_id: cid, unit_id: unit.id, customer_id: cust.id, employee_id: profile.id,
        status: targetStatus, rent_period: f.period,
        check_in_date: f.inDate, check_out_date: f.outDate,
        base_price: gross, discount_percent: num(f.discount),
        total_amount: total, down_payment: num(f.downPayment), insurance_amount: num(f.insurance),
        branch_id: unit.branch_id || null,
        notes: f.companion ? 'مرافق: ' + f.companion : null
      }).select().single()

      if (be) throw be
      // 4) المرافق
      if (f.companion) await supabase.from('booking_companions').insert({
        company_id: cid, booking_id: bk.id, full_name: f.companion
      })
      // 5) الدفعات: العربون + المدفوع الآن
      const payDoc = payFile ? await uploadFile(supabase, 'documents', cid, payFile) : null
      const pays = []
      if (num(f.downPayment) > 0) pays.push({ payment_type: 'down_payment', amount: num(f.downPayment) })
      if (num(f.insurance) > 0) pays.push({ payment_type: 'insurance', amount: num(f.insurance) })
      if (num(f.payNow) > 0) pays.push({ payment_type: 'rent', amount: num(f.payNow) })
      if (pays.length) await supabase.from('payments').insert(pays.map(p => ({
        ...p, company_id: cid, booking_id: bk.id, method: f.method,
        reference_number: f.refNo || null, document_url: payDoc, received_by: profile.id
      })))
      // إن كان الخصم يحتاج موافقة → أنشئ طلب موافقة
      if (needsApproval) {
        const discountAmtVal = Math.round(gross * num(f.discount) / 100 * 100) / 100
        await supabase.from('discount_requests').insert({
          company_id: cid, booking_id: bk.id, unit_id: unit.id,
          requested_by: profile.id, percent: num(f.discount),
          amount: discountAmtVal, reason: `خصم ${f.discount}% على حجز الوحدة ${unit.unit_number}`
        })
        await supabase.from('notifications').insert({
          company_id: cid, channel: 'in_app', event_type: 'discount_approval',
          title: 'طلب موافقة على خصم', target_role: 'owner',
          body: `الموظف ${profile.full_name} يطلب خصم ${f.discount}% على الوحدة ${unit.unit_number}`,
          booking_id: bk.id, unit_id: unit.id, status: 'sent'
        })
      }
      await logActivity(supabase, profile, {
        action: needsApproval ? 'discount' : 'create',
        entity: 'bookings', entity_id: bk.id,
        summary: needsApproval
          ? `طلب خصم ${f.discount}% على حجز الوحدة ${unit.unit_number} — بانتظار الموافقة`
          : `${targetStatus === 'checked_in' ? 'تسليم' : 'حجز'} الوحدة ${unit.unit_number} للمستأجر ${f.name} — الإجمالي ${SAR(total)}`,
        sensitive: needsApproval
      })
      toast(needsApproval
        ? '⏳ الخصم يتجاوز 20% — أُرسل طلب موافقة للمدير/المحاسب، الحجز معلّق حتى الموافقة'
        : targetStatus === 'checked_in'
          ? '✓ تم التسليم وبدء المدة — الوحدة حمراء الآن، وأُنشئت بوابة المستأجر وأُشعر المحاسب والمدير تلقائياً (تحقق من 🔔)'
          : '✓ تم تأكيد الحجز — الوحدة برتقالية الآن ومُنع الحجز المزدوج على هذه التواريخ')
      if (!needsApproval) triggerChannexSync(cid)
      if (!needsApproval && targetStatus === 'checked_in') {
        const { data: fullBk } = await supabase.from('bookings')
          .select('*, customers(full_name, phone, id_number)').eq('id', bk.id).single()
        onDone(fullBk, targetStatus)
      } else {
        onDone()
      }
    } catch (e) {
      const msg = String(e?.message || e?.details || e || 'خطأ غير معروف')
      toast(/no_double_booking|exclusion|23P01/i.test(msg)
        ? '⚠ حجز مزدوج مرفوض: توجد حجوزات متداخلة على نفس التواريخ لهذه الوحدة'
        : /bookings_check/i.test(msg)
          ? '⚠ تواريخ غير صحيحة: تاريخ المغادرة يجب أن يكون بعد تاريخ الوصول'
          : 'خطأ: ' + msg, true)
    } finally { setBusy(false) }

  }

  const checkOut = async () => {
    setBusy(true)
    const { error } = await supabase.from('bookings').update({ status: 'checked_out' }).eq('id', active.id)
    setBusy(false)
    if (error) return toast('خطأ: ' + error.message, true)
    await logActivity(supabase, profile, {
      action: 'handover', entity: 'bookings', entity_id: active.id,
      summary: `إخلاء وتسليم الوحدة ${unit.unit_number} — ${active.customers?.full_name || ''}`
    })
    triggerChannexSync(profile.company_id)
    toast('✓ تم الإخلاء — الوحدة قيد التنظيف (أصفر) وبدأت دورة إرجاع التأمين')
    onDone()
  }

  const issueInvoice = async () => {
    if (total <= 0) return toast('أدخل بيانات الحجز أولاً', true)
    if (isCompany && f.invoice_type === 'standard') {
      if (!f.company_name || !f.company_vat || !f.company_cr || !f.company_address)
        return toast('أكمل بيانات الشركة (الاسم، VAT، السجل التجاري، العنوان)', true)
    }
    const vatRate = num(company?.default_vat_rate ?? 15)
    const subtotal = Math.round(total / (1 + vatRate / 100) * 100) / 100
    const vatAmount = Math.round((total - subtotal) * 100) / 100
    const isoDate = new Date().toISOString()
    const { data: invNo } = await supabase.rpc('next_invoice_number', { p_company: profile.company_id })
    const qr = zatcaQR({ seller: company?.name || 'المازن', vat: company?.vat_number || '', isoDate, total, vatAmount })
    const invType = (isCompany && f.invoice_type === 'standard') ? 'standard' : 'simplified'
    const customerName = isCompany ? (f.company_name || f.name || 'مستأجر') : (f.name || 'مستأجر نقدي')
    const custType = invType === 'standard' ? 'company' : (isCompany ? 'company' : (f.customer_type || 'individual'))
    const { error } = await supabase.from('invoices').insert({
      company_id: profile.company_id, invoice_number: invNo, invoice_type: invType,
      customer_name: customerName, customer_type: custType,
      customer_vat: isCompany ? f.company_vat : null,
      customer_cr: isCompany ? f.company_cr : null,
      customer_address: isCompany ? f.company_address : null,
      subtotal, vat_rate: vatRate, vat_amount: vatAmount,
      total, qr_code_data: qr, issued_by: profile.id
    })
    if (error) return toast('خطأ: ' + error.message, true)
    await logActivity(supabase, profile, {
      action: 'create', entity: 'invoices',
      summary: `إصدار ${invType === 'standard' ? 'فاتورة معتمدة' : 'فاتورة مبسطة'} #${invNo} — الإجمالي ${SAR(total)} — ${customerName}`
    })
    setInvoice({ invNo, subtotal, vatRate, vatAmount, total, qr, isoDate,
      invType, customer_type: f.customer_type,
      company_name: f.company_name, company_vat: f.company_vat,
      company_cr: f.company_cr, company_address: f.company_address })
  }

  if (active?.status === 'checked_in' || unit.status === 'occupied') {
    const paid = (active?.payments || []).reduce((s, p) => s + Number(p.amount), 0)
    return (
      <div>
        <h4 style={{ marginBottom: 10 }}>الوحدة مسكونة حالياً</h4>
        {active && <table className="tbl" style={{ marginBottom: 14 }}><tbody>
          <tr><td>المستأجر</td><td><b>{active.customers?.full_name}</b> — {active.customers?.phone}</td></tr>
          <tr><td>المدة</td><td>{active.check_in_date} ← {active.check_out_date}</td></tr>
          <tr><td>الإجمالي / المدفوع / المتبقي</td>
            <td><span className="money">{SAR(active.total_amount)}</span> / <span className="money">{SAR(paid)}</span> / <span className="neg">{SAR(active.total_amount - paid)}</span></td></tr>
          <tr><td>العربون / التأمين</td><td>{SAR(active.down_payment)} / {SAR(active.insurance_amount)}</td></tr>
        </tbody></table>}
        <AddPayment booking={active} onDone={onDone} />
        {showMoveTenant ? (
          <div className="card" style={{ marginTop: 12, padding: 20, background: "var(--soft)", border: '1px solid var(--border)' }}>
            <h5 style={{ marginBottom: 12, color: 'var(--blue)' }}>🔄 إجراء استبدال / نقل المستأجر لوحدة أخرى</h5>
            <div className="grid2" style={{ gap: 12, marginBottom: 15 }}>
              <div className="fld" style={{ margin: 0 }}>
                <label>الوحدة الجديدة المستهدفة *</label>
                <select value={targetUnitId} onChange={e => setTargetUnitId(e.target.value)}>
                  <option value="">-- اختر الوحدة --</option>
                  {availableUnits.map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
                </select>
              </div>
              <div className="fld" style={{ margin: 0 }}>
                <label>سبب النقل (اختياري)</label>
                <input placeholder="مثال: طلب صيانة، ترقية..." value={transferReason} onChange={e => setTransferReason(e.target.value)} />
              </div>
              <div className="fld" style={{ margin: 0 }}>
                <label>رسوم النقل أو فرق السعر (ر.س)</label>
                <input type="number" placeholder="يُضاف لإجمالي العقد إن وُجد" value={transferFees} onChange={e => setTransferFees(e.target.value)} />
              </div>
            </div>
            
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button className="btn btn-green" disabled={busy || !targetUnitId} onClick={handleMoveTenant}>
                {busy ? 'جاري النقل...' : 'تأكيد النقل الآن'}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowMoveTenant(false)}>إلغاء</button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>
              * عند تأكيد النقل، سيتم تحويل الوحدة الحالية إلى حالة (تحتاج تنظيف/صيانة) وتسكين المستأجر في الوحدة الجديدة، مع تحديث بيانات العقد وإضافة رسوم الفروقات إن وجدت.
            </p>
          </div>
        ) : (
          <button className="btn btn-ghost" onClick={() => { setShowMoveTenant(true); loadAvailableUnits(); }} style={{ marginTop: 12, marginRight: 10 }}>🔄 نقل المستأجر لوحدة أخرى</button>
        )}
        <button className="btn btn-blue" disabled={busy} onClick={checkOut} style={{ marginTop: 12 }}>
          إخلاء وتسليم الوحدة (← أصفر تنظيف)
        </button>
      </div>
    )
  }

  return (
    <div>
      <h4 style={{ marginBottom: 10 }}>١) بيانات المستأجر</h4>
      <div className="acc-tabs" style={{ marginBottom: 12 }}>
        <button type="button" className={custMode === 'new' ? 'on' : ''} onClick={() => { setCustMode('new'); setSelectedCustomerId(''); setF(x => ({ ...x, name: '', idNumber: '', phone: '' })) }}>🆕 عميل جديد</button>
        <button type="button" className={custMode === 'existing' ? 'on' : ''} onClick={() => setCustMode('existing')}>👥 عميل حالي</button>
      </div>
      {custMode === 'existing' && (
        <div className="fld" style={{ marginBottom: 12 }}>
          <label>اختر العميل — تُملأ بياناته تلقائياً ويتم فحص القائمة السوداء والأرشيف</label>
          <select value={selectedCustomerId} onChange={e => pickExisting(e.target.value)}>
            <option value="">— اختر عميلاً —</option>
            {existingCustomers.map(c => {
              const isBl = c.is_blacklisted || c.rating === 1 || c.notes?.includes('[BLACKLIST]')
              return (
                <option key={c.id} value={c.id}>
                  {c.full_name} — {c.id_number} {isBl ? '⛔ (قائمة سوداء)' : ''}
                </option>
              )
            })}
          </select>
        </div>
      )}

      {/* Stored Document Auto-Recall Notice */}
      {storedDocNotice && (
        <div style={{
          background: '#F0FDF4',
          border: '1px solid #86EFAC',
          borderRadius: '12px',
          padding: '10px 14px',
          marginBottom: '12px',
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center',
          fontSize: '13px',
          color: '#166534'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>📁</span>
            <span>
              <b>تم استدعاء الوثيقة المخزنة تلقائياً من الملف الموحد ({storedDocNotice.count} وثيقة جاهزة):</b> {storedDocNotice.title}
            </span>
          </div>
          <button type="button" onClick={() => openStoredDocument(supabase, storedDocNotice.url, {
            onError: message => toast(message, true),
            context: { area: 'unit_booking', unit_id: unit.id, customer_id: selectedCustomerId || null },
          })} className="btn btn-ghost btn-sm" style={{ color: '#15803D', fontWeight: '800' }}>
            👁️ معاينة
          </button>
        </div>
      )}

      {/* Blacklist Warning Banner */}
      {warningCustomer && (warningCustomer.is_blacklisted || warningCustomer.rating === 1 || warningCustomer.notes?.includes('[BLACKLIST]')) && (
        <div style={{
          background: '#FEF2F2',
          border: '1px solid #FCA5A5',
          borderRadius: '12px',
          padding: '12px 16px',
          marginBottom: '12px',
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px'
        }}>
          <div style={{ color: '#991B1B', fontSize: '13px', fontWeight: '800' }}>
            ⛔ تنبيه حظر: العميل مدرج بالقائمة السوداء!
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setShowWarningModal(true)}
            style={{ background: '#DC2626', color: '#fff', fontWeight: '800' }}
          >
            عرض تقرير التحذير
          </button>
        </div>
      )}
      <div className="grid3">
        <div><label>نوع العميل *</label>
          <select value={f.customer_type} onChange={e => set('customer_type', e.target.value)}>
            <option value="individual">فرد / ساكن</option>
            <option value="company">شركة / منشأة</option>
          </select></div>
        <div><label>{isCompany ? 'اسم ممثل الشركة *' : 'الاسم الكامل *'}</label>
          <input value={f.name} onChange={e => set('name', e.target.value)} readOnly={custMode === 'existing'} /></div>
        <div><label>نوع الإثبات</label>
          <select value={f.idType} onChange={e => set('idType', e.target.value)}>
            <option value="national_id">هوية وطنية</option><option value="iqama">إقامة</option><option value="passport">جواز سفر</option>
          </select></div>
        <div><label>رقم الهوية/الإقامة/الجواز *</label><input value={f.idNumber} onChange={e => set('idNumber', e.target.value)} dir="ltr" readOnly={custMode === 'existing'} /></div>
        <div><label>رقم الجوال *</label><input value={f.phone} onChange={e => set('phone', e.target.value)} placeholder="05XXXXXXXX" dir="ltr" readOnly={custMode === 'existing'} /></div>
        <div><label>صورة إثبات الشخصية</label><input type="file" accept="image/*,.pdf" onChange={e => setIdFile(e.target.files[0])} /></div>
        {!isCompany && <div><label>المرافقون (اختياري)</label><input value={f.companion} onChange={e => set('companion', e.target.value)} placeholder="الاسم + رقم الهوية" /></div>}
      </div>

      {isCompany && (
        <>
          <h4 style={{ margin: '16px 0 10px' }}>بيانات الشركة (مطلوبة لإصدار فاتورة ضريبية معتمدة)</h4>
          <div className="grid3">
            <div><label>اسم الشركة *</label><input value={f.company_name} onChange={e => set('company_name', e.target.value)} /></div>
            <div><label>الرقم الضريبي VAT *</label><input value={f.company_vat} onChange={e => set('company_vat', e.target.value)} dir="ltr" placeholder="15 رقم" /></div>
            <div><label>السجل التجاري *</label><input value={f.company_cr} onChange={e => set('company_cr', e.target.value)} dir="ltr" /></div>
          </div>
          <div className="fld"><label>العنوان الوطني *</label>
            <input value={f.company_address} onChange={e => set('company_address', e.target.value)} placeholder="المدينة، الحي، الشارع، الرمز البريدي" /></div>
          <div className="fld"><label>نوع الفاتورة</label>
            <select value={f.invoice_type} onChange={e => set('invoice_type', e.target.value)}>
              <option value="simplified">فاتورة ضريبية مبسّطة</option>
              <option value="standard">فاتورة ضريبية معتمدة (Standard Tax Invoice — للشركات)</option>
            </select>
          </div>
        </>
      )}

      <h4 style={{ margin: '16px 0 10px' }}>٢) مدة الإيجار والسعر</h4>
      <div className="grid3">
        <div><label>نوع الإيجار</label>
          <select value={f.period} onChange={e => set('period', e.target.value)}>
            <option value="daily">يومي</option><option value="monthly">شهري</option><option value="yearly">سنوي</option>
          </select></div>
        <div><label>تاريخ الدخول</label><input type="date" value={f.inDate} onChange={e => set('inDate', e.target.value)} /></div>
        <div><label>المدة ({{ daily: 'أيام', monthly: 'أشهر', yearly: 'سنوات' }[f.period]})</label>
          <input type="number" min="1" value={f.duration} onChange={e => set('duration', e.target.value)} /></div>
        <div><label>تاريخ الخروج (تلقائي)</label><input type="date" value={f.outDate} readOnly /></div>
        <div><label>السعر الأساسي المسجل بالنظام</label><input value={basePrice ? SAR(basePrice) : 'غير مسجل — يضيفه المدير'} readOnly /></div>
        <div><label>نسبة الخصم %</label><input type="number" min="0" max="100" value={f.discount} onChange={e => set('discount', e.target.value)} /></div>
      </div>
      <div className="grid3" style={{ marginTop: 12 }}>
        <div className="kpi"><div className="v">{SAR(total)}</div><div className="l">الإجمالي بعد الخصم (خصم {SAR(discountAmt)})</div></div>
        <div><label>قيمة العربون المدفوع</label><input type="number" value={f.downPayment} onChange={e => set('downPayment', e.target.value)} /></div>
        <div><label>قيمة التأمين المدفوع</label><input type="number" value={f.insurance} onChange={e => set('insurance', e.target.value)} /></div>
      </div>

      <h4 style={{ margin: '16px 0 10px' }}>٣) الدفعات</h4>
      <div className="grid3">
        <div><label>المدفوع الآن من الإيجار</label><input type="number" value={f.payNow} onChange={e => set('payNow', e.target.value)} /></div>
        <div><label>طريقة الدفع</label>
          <select value={f.method} onChange={e => set('method', e.target.value)}>
            {Object.entries(PAY_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label>رقم الإيصال / التحويل</label><input value={f.refNo} onChange={e => set('refNo', e.target.value)} dir="ltr" /></div>
        <div><label>مستند التحويل أو السداد</label><input type="file" accept="image/*,.pdf" onChange={e => setPayFile(e.target.files[0])} /></div>
        <div className="kpi"><div className="v" style={{ color: remaining > 0 ? 'var(--st-oc)' : 'var(--green)' }}>{SAR(remaining)}</div><div className="l">المتبقي (تلقائي)</div></div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" onClick={() => setShowContract(true)}>🖨 عقد إلكتروني مبدئي</button>
        <button className="btn btn-ghost" onClick={issueInvoice}>🧾 فاتورة مبسطة ZATCA</button>
        {unit.status === 'available' && <>
          <button className="btn btn-gold" disabled={busy} onClick={() => createBooking('confirmed')}>تأكيد الحجز (← برتقالي)</button>
          <button className="btn btn-green" disabled={busy} onClick={() => createBooking('checked_in')}>حفظ وتسليم وبدء المدة (← أحمر)</button>
        </>}
        {unit.status === 'reserved' && active && (
          <button className="btn btn-green" disabled={busy} onClick={async () => {
            setBusy(true)
            const { error } = await supabase.from('bookings').update({ status: 'checked_in' }).eq('id', active.id)
            setBusy(false)
            if (error) return toast('خطأ: ' + error.message, true)
            await logActivity(supabase, profile, {
              action: 'handover', entity: 'bookings', entity_id: active.id,
              summary: `تسليم الوحدة ${unit.unit_number} وبدء مدة الإيجار`
            })
            triggerChannexSync(profile.company_id)
            toast('✓ تم تسليم الوحدة للمستأجر وبدء المدة — أُشعر المحاسب تلقائياً'); onDone()
          }}>تسليم الحجز الحالي وبدء المدة (← أحمر)</button>
        )}
      </div>

      {invoice && <InvoiceView inv={invoice} company={company} customer={f.name} onClose={() => setInvoice(null)} />}

      {/* Blacklist Automated Warning Modal */}
      {showWarningModal && warningCustomer && (
        <BlacklistWarningModal
          customer={warningCustomer}
          warningType={warningType}
          isOpen={showWarningModal}
          onClose={() => setShowWarningModal(false)}
          onView360={(cust) => {
            setShowWarningModal(false)
            setShow360ModalFromWarning(cust)
          }}
          onOverride={() => {
            setOverrideWarning(true)
            setShowWarningModal(false)
            toast('⚠️ تم منح استثناء وتجاوز الحظر لهذه الجلسة تحت مسؤولية مدير الفرع')
          }}
        />
      )}

      {/* 360 Customer View Modal from Warning */}
      {show360ModalFromWarning && (
        <Customer360Modal
          customer={show360ModalFromWarning}
          onClose={() => setShow360ModalFromWarning(null)}
          onChanged={() => setShow360ModalFromWarning(null)}
        />
      )}

      {showContract && (
        <RentalContract
          onClose={() => setShowContract(false)}
          company={company}
          employeeName={profile.full_name}
          customer={{ full_name: f.name || 'مستأجر', id_number: f.idNumber, phone: f.phone }}
          unit={{ unit_number: unit.unit_number, category: CATS[unit.category] || unit.category, description: unit.description }}
          booking={{
            id: active?.id, contract_number: active?.contract_number,
            check_in_date: f.inDate, check_out_date: f.outDate,
            rent_period: f.period, base_price: gross, discount_percent: num(f.discount),
            total_amount: total, down_payment: num(f.downPayment), insurance_amount: num(f.insurance),
            payments: [
              ...(num(f.downPayment) > 0 ? [{ payment_date: today(), payment_type: 'down_payment', method: f.method, amount: num(f.downPayment) }] : []),
              ...(num(f.insurance) > 0 ? [{ payment_date: today(), payment_type: 'insurance', method: f.method, amount: num(f.insurance) }] : []),
              ...(num(f.payNow) > 0 ? [{ payment_date: today(), payment_type: 'rent', method: f.method, amount: num(f.payNow) }] : []),
            ]
          }}
        />
      )}
    </div>
  )
}

/* ============ إضافة دفعة لحجز قائم ============ */
function AddPayment({ booking, onDone }) {
  const { profile, toast } = useAuth()
  const [p, setP] = useState({ amount: '', method: 'cash', refNo: '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!num(p.amount)) return toast('أدخل المبلغ', true)
    setBusy(true)
    try {
      const doc = file ? await uploadFile(supabase, 'documents', profile.company_id, file) : null
      const { error } = await supabase.from('payments').insert({
        company_id: profile.company_id, booking_id: booking.id, payment_type: 'rent',
        amount: num(p.amount), method: p.method, reference_number: p.refNo || null,
        document_url: doc, received_by: profile.id
      })
      if (error) throw error
      
      // Notify accountant
      await supabase.from('notifications').insert({
        company_id: profile.company_id,
        target_role: 'accountant',
        channel: 'in_app',
        event_type: 'new_payment',
        title: 'دفعة واردة جديدة',
        body: 'تم استلام دفعة بقيمة ' + p.amount + ' ر.س',
        booking_id: booking.id
      })
      await logActivity(supabase, profile, {
        action: 'create', entity: 'payments', entity_id: booking.id,
        summary: `تسجيل دفعة بقيمة ${SAR(num(p.amount))} — ${PAY_METHODS[p.method]} — حجز #${booking.id?.slice?.(0,8) || ''}`
      })
      toast('✓ سُجلت الدفعة وتحدث المتبقي تلقائياً'); onDone()
    } catch (e) { toast('خطأ: ' + e.message, true) } finally { setBusy(false) }
  }
  return (
    <div className="panel" style={{ background: 'var(--soft)' }}>
      <h3>تسجيل دفعة جديدة</h3>
      <div className="grid3">
        <div><label>المبلغ</label><input type="number" value={p.amount} onChange={e => setP({ ...p, amount: e.target.value })} /></div>
        <div><label>طريقة الدفع</label>
          <select value={p.method} onChange={e => setP({ ...p, method: e.target.value })}>
            {Object.entries(PAY_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label>رقم الإيصال/التحويل</label><input value={p.refNo} onChange={e => setP({ ...p, refNo: e.target.value })} dir="ltr" /></div>
        <div><label>مستند السداد</label><input type="file" onChange={e => setFile(e.target.files[0])} /></div>
        <div style={{ alignSelf: 'end' }}><button className="btn btn-green btn-sm" disabled={busy} onClick={save}>حفظ الدفعة</button></div>
      </div>
    </div>
  )
}

/* ============ فاتورة ضريبية (مبسّطة أو معتمدة) — تصميم فاخر ============ */
function InvoiceView({ inv, company, customer, onClose }) {
  const isStandard = inv.invType === 'standard'
  const isCompany = inv.customer_type === 'company'
  const displayCustomer = isCompany ? (inv.company_name || customer) : (customer || 'مستأجر نقدي')
  const titleAr = isStandard ? 'فاتورة ضريبية معتمدة' : 'فاتورة ضريبية مبسطة'
  const titleEn = isStandard ? 'TAX INVOICE' : 'SIMPLIFIED TAX INVOICE'
  const doc = (
          <div className="lux-inv">
            <div className="lux-inv-head">
              <div className="lux-inv-brand">
                {company?.logo_url
                  ? <img src={company.logo_url} alt="logo" />
                  : <div className="lux-inv-logo-fallback">🏛</div>}
                <div>
                  <h2>{company?.name || 'المازن'}</h2>
                  <div className="lux-inv-meta">{company?.address || ''}</div>
                  <div className="lux-inv-meta">الرقم الضريبي: <b dir="ltr">{company?.vat_number || '—'}</b></div>
                  {isStandard && company?.cr_number && (
                    <div className="lux-inv-meta">السجل التجاري: <b dir="ltr">{company.cr_number}</b></div>
                  )}
                </div>
              </div>
              <div className="lux-inv-title">
                <div className="lux-inv-title-ar">{titleAr}</div>
                <div className="lux-inv-title-en">{titleEn}</div>
                <div className="lux-inv-no">رقم الفاتورة: <b dir="ltr">{inv.invNo}</b></div>
              </div>
            </div>

            <div className="lux-inv-info">
              <div><span>التاريخ</span><b dir="ltr">{new Date(inv.isoDate).toLocaleString('ar-SA')}</b></div>
              <div><span>{isCompany ? 'العميل (الشركة)' : 'اسم العميل / الساكن'}</span><b>{displayCustomer}</b></div>
              <div><span>حالة السداد</span><b style={{ color: 'var(--green)' }}>مدفوعة</b></div>
            </div>

            {isStandard && isCompany && (
              <div className="lux-inv-info" style={{ background: 'var(--soft)' }}>
                <div><span>الرقم الضريبي VAT للعميل</span><b dir="ltr">{inv.company_vat || '—'}</b></div>
                <div><span>السجل التجاري للعميل</span><b dir="ltr">{inv.company_cr || '—'}</b></div>
                <div><span>العنوان الوطني</span><b>{inv.company_address || '—'}</b></div>
              </div>
            )}

            <table className="lux-inv-table">
              <thead>
                <tr><th>#</th><th>البيان</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>1</td>
                  <td>خدمة إيجار / استضافة</td>
                  <td>1</td>
                  <td>{SAR(inv.subtotal)}</td>
                  <td className="money">{SAR(inv.subtotal)}</td>
                </tr>
              </tbody>
            </table>

            <div className="lux-inv-foot">
              <div className="lux-inv-qr">
                <QRCodeSVG value={inv.qr} size={124} />
                <div>QR متوافق مع هيئة الزكاة والضريبة والجمارك (ZATCA)</div>
              </div>
              <div className="lux-inv-totals">
                <div><span>الإجمالي قبل الضريبة</span><b className="money">{SAR(inv.subtotal)}</b></div>
                <div><span>ضريبة القيمة المضافة ({inv.vatRate}%)</span><b className="money">{SAR(inv.vatAmount)}</b></div>
                <div className="grand"><span>الإجمالي شامل الضريبة</span><b>{SAR(inv.total)}</b></div>
              </div>
            </div>

            <div className="lux-inv-terms">
              نشكر تعاملكم مع {company?.name || 'منشأتنا'}. هذه الفاتورة صادرة إلكترونياً وفق متطلبات هيئة الزكاة والضريبة والجمارك.
              {isStandard && ' — فاتورة ضريبية معتمدة (Standard Tax Invoice) صادرة لشركة/منشأة مسجّلة في ضريبة القيمة المضافة.'}
            </div>
          </div>
  )

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(760px,100%)' }}>
        <div className="modal-h"><h3>{titleAr}</h3><button className="x" onClick={onClose}>✕</button></div>
        <div className="modal-b">
          {doc}

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }} className="no-print">
            <button className="btn btn-gold" onClick={() => printElement(doc, { title: titleAr, docKind: 'report' })}>🖨 طباعة / PDF</button>
            <button className="btn btn-ghost" onClick={onClose}>إغلاق</button>
          </div>
        </div>
      </div>
    </div>
  )
}


/* ============ تتبع الأثاث والأصول ============ */
function UnitInventory({ unit, profile, company, activeBooking, toast }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ item_name: '', condition: 'new', fixed_asset_value: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('unit_inventory').select('*').eq('unit_id', unit.id).order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
  }, [unit.id])

  useEffect(() => { load() }, [load])

  const add = async (e) => {
    e.preventDefault()
    if (!form.item_name.trim()) return
    setBusy(true)
    const { error } = await supabase.from('unit_inventory').insert({
      company_id: profile.company_id,
      unit_id: unit.id,
      item_name: form.item_name.trim(),
      condition: form.condition,
      fixed_asset_value: Number(form.fixed_asset_value) || 0
    })
    setBusy(false)
    if (error) return toast('خطأ في إضافة الأصل: ' + error.message, true)
    toast('تم إضافة الأصل/الأثاث بنجاح ✓')
    setForm({ item_name: '', condition: 'new', fixed_asset_value: '' })
    load()
  }

  const updateCondition = async (id, condition) => {
    const { error } = await supabase.from('unit_inventory').update({ condition }).eq('id', id)
    if (error) return toast('خطأ في تحديث الحالة: ' + error.message, true)
    toast('تم تحديث حالة الأصل ✓')
    load()
  }

  const del = async (id) => {
    if (!confirm('هل أنت تأكد من حذف هذه القطعة من أصول الوحدة؟')) return
    const { error } = await supabase.from('unit_inventory').delete().eq('id', id)
    if (error) return toast('خطأ في الحذف: ' + error.message, true)
    toast('تم حذف القطعة بنجاح ✓')
    load()
  }

  const totalValue = items.reduce((sum, item) => sum + (Number(item.fixed_asset_value) || 0), 0)
  const checklist = Array.isArray(unit.furniture_checklist) ? unit.furniture_checklist : []

  if (loading) return <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>جارٍ تحميل قائمة الأثاث والأصول…</div>

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Executive Print Action Bar */}
      <div style={{ marginBottom: 16 }}>
        <button
          type="button"
          className="btn btn-gold"
          style={{
            width: '100%',
            padding: '12px 18px',
            fontSize: 14,
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            boxShadow: '0 4px 12px rgba(201,168,76,0.25)'
          }}
          onClick={async () => {
            const combined = [
              ...items.map(i => ({ name: i.item_name, condition: i.condition === 'new' ? 'ok' : i.condition === 'used' ? 'used' : 'damaged', note: i.fixed_asset_value ? `أصل ثابت (${i.fixed_asset_value} ر.س)` : '' })),
              ...checklist.map(c => ({ name: c.name, condition: c.present ? 'ok' : 'missing', note: c.note || '' }))
            ]
            const serial = await issueSerial('handover', {
              table: 'units', id: unit?.id || null,
              meta: { kind: 'check_in', booking_id: activeBooking?.id || null },
            })
            printHandoverChecklist({
              serial,
              unit,
              booking: activeBooking,
              company,
              employee: profile,
              checklistItems: combined.length ? combined : items,
              kind: 'check_in',
              notes: 'محضر تسليم واستلام محتويات الوحدة الأيجارية',
              signedBy: activeBooking?.customers?.full_name || ''
            })
          }}
        >
          🖨️ طباعة نموذج استلام وتسليم المحتويات بالترويسة الرسمية (Check List فاخر)
        </button>
      </div>

      {/* Top Valuation Summary Bar */}
      <div className="grid2" style={{ gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ padding: 12, background: 'var(--soft)', borderRight: '4px solid #10B981' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>إجمالي عدد القطع والأصول المسجلة</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: 'var(--text)', marginTop: 2 }}>
            {items.length} قطعة
          </div>
        </div>
        <div className="card" style={{ padding: 12, background: 'var(--soft)', borderRight: '4px solid #3B82F6' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>إجمالي التقييم المالي للأصول الثابتة</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#10B981', marginTop: 2 }}>
            {SAR(totalValue)}
          </div>
        </div>
      </div>

      {/* Add New Asset Form */}
      <form onSubmit={add} style={{ background: 'var(--panel)', padding: 14, borderRadius: 10, border: '1px solid var(--border)', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>🛋️ إضافة قطعة أثاث أو أصل جديد للوحدة {unit.unit_number}</span>
        </div>
        <div className="grid3" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="fld">
            <label style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>اسم القطعة / المرفق</label>
            <input
              placeholder="مثال: مكيف كرافت 24 وحدة، شاشة 55 بوصة..."
              value={form.item_name}
              onChange={e => setForm({ ...form, item_name: e.target.value })}
              required
              style={{ fontSize: 13 }}
            />
          </div>
          <div className="fld">
            <label style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>حالة القطعة</label>
            <select
              value={form.condition}
              onChange={e => setForm({ ...form, condition: e.target.value })}
              style={{ fontSize: 13 }}
            >
              <option value="new">🟢 جديدة (ممتازة)</option>
              <option value="used">🟡 مستخدمة (حالة جيدة)</option>
              <option value="damaged">🔴 تالفة / تحتاج صيانة</option>
            </select>
          </div>
          <div className="fld">
            <label style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>القيمة التقديرية (ر.س)</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="number"
                placeholder="0"
                value={form.fixed_asset_value}
                onChange={e => setForm({ ...form, fixed_asset_value: e.target.value })}
                style={{ fontSize: 13 }}
              />
              <button className="btn btn-gold" disabled={busy} style={{ whiteSpace: 'nowrap' }}>
                + إضافة قطعة
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Tracked Assets Table */}
      <div style={{ background: 'var(--panel)', borderRadius: 10, border: '1px solid var(--border)', padding: 12, marginBottom: 16 }}>
        <h4 style={{ margin: '0 0 10px', fontSize: 14 }}>📦 سجل الأثاث والأصول الثابتة الموثقة</h4>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th>اسم القطعة / الأصل</th>
                <th>الحالة التشغيلية</th>
                <th>القيمة كأصل ثابت</th>
                <th style={{ width: 80 }}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id}>
                  <td><b>{i.item_name}</b></td>
                  <td>
                    <select
                      value={i.condition}
                      onChange={e => updateCondition(i.id, e.target.value)}
                      style={{
                        padding: '3px 8px',
                        fontSize: 12,
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'var(--panel)',
                        color: 'var(--text)'
                      }}
                    >
                      <option value="new">🟢 جديدة</option>
                      <option value="used">🟡 مستخدمة</option>
                      <option value="damaged">🔴 تالفة</option>
                    </select>
                  </td>
                  <td className="money" style={{ fontWeight: 600, color: '#10B981' }}>
                    {SAR(i.fixed_asset_value || 0)}
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => del(i.id)} style={{ color: '#EF4444', padding: '2px 8px' }}>
                      🗑️ حذف
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
                    لا توجد أصول ثابتة مسجلة لهذه الوحدة حتى الآن. استخدم النموذج أعلاه لطلب تسجيل وتوثيق أثاث الوحدة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Unit Furniture Checklist (from unit configuration) if available */}
      {unit.is_furnished && checklist.length > 0 && (
        <div style={{ background: 'var(--soft)', borderRadius: 10, padding: 12, border: '1px solid var(--border)' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text)' }}>
            📋 قائمة الفحص السريع للأثاث المخزن بإعدادات الوحدة ({checklist.length} عنصر)
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
            {checklist.map((it, idx) => (
              <div
                key={idx}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'var(--panel)',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  border: '1px solid var(--border)'
                }}
              >
                <span>{it.present ? '✅' : '❌'} {it.name}</span>
                {it.note && <small style={{ color: 'var(--muted)', fontSize: 10 }}>{it.note}</small>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
