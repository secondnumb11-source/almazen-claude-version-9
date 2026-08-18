import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { useBranches } from '../BranchContext'
import { SAR, num, today } from '../lib/helpers'
import { SkeletonKpis } from '../components/Skeleton'
import BookingTrendsChart from '../components/BookingTrendsChart'
import BookingSourcePieChart from '../components/BookingSourcePieChart'
import OccupancyForecastChart from '../components/OccupancyForecastChart'
import UnitPerformanceChart from '../components/UnitPerformanceChart'
import KpiCardConfigModal from '../components/KpiCardConfigModal'
import AccountingIntegrityTool from '../components/AccountingIntegrityTool'
import { Settings2, Check, Paintbrush, Maximize2, GripHorizontal, SlidersHorizontal, Trash2, RotateCcw, PlusCircle } from 'lucide-react'
import OperationsCalendar from '../components/OperationsCalendar'

const DEFAULT_LAYOUT = [
  { id: 't_bookings', title: 'عدد الحجوزات (اليوم)', valueKey: 'bookings_today', size: '1', color: 'default', group: 'today' },
  { id: 't_vacant', title: 'الوحدات الشاغرة (اليوم)', valueKey: 'vacant_units', size: '1', color: 'default', group: 'today' },
  { id: 't_occupied', title: 'الوحدات المشغولة (اليوم)', valueKey: 'occupied_units', size: '1', color: 'default', group: 'today' },
  { id: 't_departures', title: 'المغادرون (اليوم)', valueKey: 'departures_today', size: '1', color: 'default', group: 'today' },
  { id: 't_arrivals', title: 'القادمون (اليوم)', valueKey: 'arrivals_today', size: '1', color: 'default', group: 'today' },
  { id: 'm_occ', title: 'نسبة الإشغال (الشهر)', valueKey: 'occ', size: '1', color: 'default', group: 'month' },
  { id: 'm_top', title: 'أعلى وحدة دخلاً', valueKey: 'top', size: '2', color: 'default', group: 'month' },
  { id: 'm_low', title: 'أقل وحدة دخلاً', valueKey: 'low', size: '1', color: 'default', group: 'month' },
  { id: 'm_contracts', title: 'عدد العقود (الشهر)', valueKey: 'contracts', size: '1', color: 'default', group: 'month' },
  { id: 'f_rev', title: 'إيرادات الشهر', valueKey: 'rev', size: '2', color: 'dark', group: 'fin', restricted: true },
  { id: 'f_exp', title: 'مصروفات الشهر', valueKey: 'exp', size: '1', color: 'default', group: 'fin', restricted: true },
  { id: 'f_net', title: 'صافي الربح', valueKey: 'net', size: '1', color: 'gold', group: 'fin', restricted: true },
  { id: 'f_growth', title: 'نمو الإيرادات', valueKey: 'growth', size: '2', color: 'green', group: 'fin', restricted: true }
];

function BookingsPaymentsCard({ companyId }) {
  const { scopeQuery, activeBranch } = useBranches()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) return
    ;(async () => {
      const first = today().slice(0, 8) + '01'
      const { data: bkData } = await scopeQuery(supabase.from('bookings')
        .select(`id, total_amount, discount_amount, check_in_date, customers(full_name), units(unit_number)`)
        .eq('company_id', companyId))
        .gte('created_at', first)
        .in('status', ['confirmed', 'checked_in'])
        .limit(10)
      setData(bkData || [])
      setLoading(false)
    })()
  }, [companyId, activeBranch])

  return (
    <div className="panel">
      <h3>📋 آخر الحجوزات والدفعات (هذا الشهر)</h3>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)' }}>جارٍ التحميل…</div>
      ) : data.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)' }}>لا توجد حجوزات هذا الشهر</div>
      ) : (
        <table className="tbl" style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th>الوحدة</th>
              <th>العميل</th>
              <th>المبلغ</th>
              <th>الخصم</th>
              <th>الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {data.map(b => (
              <tr key={b.id}>
                <td data-label="الوحدة">{b.units?.unit_number}</td>
                <td data-label="العميل">{b.customers?.full_name}</td>
                <td data-label="المبلغ">{SAR(b.total_amount)}</td>
                <td data-label="الخصم">{SAR(b.discount_amount || 0)}</td>
                <td data-label="الإجمالي" style={{ fontWeight: 'bold', color: 'var(--green)' }}>{SAR((b.total_amount || 0) - (b.discount_amount || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function PendingPaymentsCard({ companyId }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) return
    ;(async () => {
      const { data: pendingData } = await supabase.rpc('overdue_payments', { p_company: companyId, p_days: 1 })
      setData(pendingData || [])
      setLoading(false)
    })()
  }, [companyId])

  const totalOverdue = data.reduce((sum, p) => sum + (p.amount_due || 0), 0)

  return (
    <div className="panel">
      <h3>⚠️ المتأخرات والدفعات المعلقة</h3>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)' }}>جارٍ التحميل…</div>
      ) : data.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--green)' }}>✓ لا توجد متأخرات</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>عدد المتأخرين</div>
              <div style={{ fontSize: 18, fontWeight: 'bold', color: 'var(--st-oc)' }}>{data.length}</div>
            </div>
            <div style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>إجمالي المتأخرات</div>
              <div style={{ fontSize: 18, fontWeight: 'bold', color: 'var(--st-oc)' }}>{SAR(totalOverdue)}</div>
            </div>
          </div>
          <table className="tbl" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th>العميل</th>
                <th>الوحدة</th>
                <th>المبلغ</th>
                <th>الأيام</th>
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 8).map((p, i) => (
                <tr key={i}>
                  <td data-label="العميل">{p.customer_name}</td>
                  <td data-label="الوحدة">{p.unit_number}</td>
                  <td data-label="المبلغ" style={{ color: 'var(--st-oc)', fontWeight: 'bold' }}>{SAR(p.amount_due)}</td>
                  <td data-label="الأيام">{p.days_overdue} يوم</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

function TodayRentalsCard({ companyId }) {
  const { scopeQuery, activeBranch } = useBranches()
  const [rentals, setRentals] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) return
    ;(async () => {
      try {
        const { data } = await scopeQuery(supabase.from('bookings')
          .select(`id, check_in_date, unit_id, units(unit_number), customers(full_name), base_price`)
          .eq('company_id', companyId))
          .eq('check_in_date', today())
          .in('status', ['confirmed', 'checked_in'])
        setRentals(data || [])
      } catch (err) {
        console.error('Rentals load error:', err)
      }
      setLoading(false)
    })()
  }, [companyId, activeBranch])

  return (
    <div className="panel" style={{ flex: 1, minWidth: 300 }}>
      <h3>🛬 الوحدات المؤجرة اليوم</h3>
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>جارٍ التحميل…</div>
      ) : rentals.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>لا توجد حجوزات اليوم</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rentals.map(r => (
            <div key={r.id} style={{
              padding: 12,
              background: 'var(--bg-secondary)',
              borderRadius: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                  وحدة {r.units?.unit_number}
                </div>
                <div style={{ fontSize: 14, color: 'var(--muted)' }}>
                  {r.customers?.full_name}
                </div>
              </div>
              <div style={{ textAlign: 'left', color: 'var(--green)' }}>
                {SAR(r.base_price)}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)', textAlign: 'center', fontWeight: 'bold' }}>
        إجمالي: {rentals.length} حجز
      </div>
    </div>
  )
}

function TodayCheckoutsCard({ companyId }) {
  const { scopeQuery, activeBranch } = useBranches()
  const [checkouts, setCheckouts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) return
    ;(async () => {
      try {
        const { data } = await scopeQuery(supabase.from('bookings')
          .select(`id, check_out_date, unit_id, units(unit_number), customers(full_name), base_price`)
          .eq('company_id', companyId))
          .eq('check_out_date', today())
          .in('status', ['confirmed', 'checked_in'])
        setCheckouts(data || [])
      } catch (err) {
        console.error('Checkouts load error:', err)
      }
      setLoading(false)
    })()
  }, [companyId, activeBranch])

  return (
    <div className="panel" style={{ flex: 1, minWidth: 300 }}>
      <h3>🛫 الوحدات المسلمة اليوم (المغادرون)</h3>
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>جارٍ التحميل…</div>
      ) : checkouts.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>لا توجد مغادرات اليوم</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {checkouts.map(c => (
            <div key={c.id} style={{
              padding: 12,
              background: 'var(--bg-secondary)',
              borderRadius: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                  وحدة {c.units?.unit_number}
                </div>
                <div style={{ fontSize: 14, color: 'var(--muted)' }}>
                  {c.customers?.full_name}
                </div>
              </div>
              <div style={{ textAlign: 'left', color: 'var(--orange)' }}>
                {SAR(c.base_price)}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)', textAlign: 'center', fontWeight: 'bold' }}>
        إجمالي: {checkouts.length} مغادر
      </div>
    </div>
  )
}

/*
  الصفحة الرئيسية بعد تسجيل الدخول — تظهر حسب دور المستخدم:
  • موظف → قادمون/مغادرون اليوم + الوحدات المتاحة + إجراءات سريعة
  • محاسب/مالك → إيراد الشهر + متأخرات + تدفق + مقترحات
*/
export default function Home({ onNav, dashEditMode, setDashEditMode }) {
  const { profile, company, canFinance, isOwner, isSuperAdmin, toast } = useAuth()
  const { scopeQuery, activeBranch } = useBranches()
  const [s, setS] = useState(null)
  
  // Dashboard states from Dashboard.jsx
  const [t, setT] = useState(null)       // إحصائيات اليوم (RPC)
  const [m, setM] = useState(null)       // إحصائيات الشهر
  const [fin, setFin] = useState(null)   // مالية المدير
  const [layout, setLayout] = useState([])
  const [draggedIdx, setDraggedIdx] = useState(null)
  const [activeModalCard, setActiveModalCard] = useState(null)

  useEffect(() => {
    if (!profile) return
    (async () => {
      const cid = profile.company_id
      const t_date = today()
      const first = t_date.slice(0, 8) + '01'
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
      const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
      const [{ data: units }, { data: bkAll }, { data: pays }, { data: od }, { data: soon }] = await Promise.all([
        scopeQuery(supabase.from('units').select('status').eq('company_id', cid)),
        scopeQuery(supabase.from('bookings').select('status, check_in_date, check_out_date').eq('company_id', cid)),
        scopeQuery(supabase.from('payments').select('amount, payment_date').eq('company_id', cid)).gte('payment_date', first),
        supabase.rpc('overdue_payments', { p_company: cid, p_days: 1 }).then(r => r).catch(() => ({ data: [] })),
        scopeQuery(supabase.from('bookings')
          .select('id, check_in_date, check_out_date, status, units(unit_number), customers(full_name, phone)')
          .eq('company_id', cid)).in('status', ['confirmed','checked_in'])
          .lte('check_out_date', in7).gte('check_out_date', t_date)
      ])
      const arrivals = (bkAll || []).filter(b => b.check_in_date === t_date && b.status !== 'cancelled').length
      const departures = (bkAll || []).filter(b => b.check_out_date === t_date && b.status !== 'cancelled').length
      const dist = {}
      for (const u of units || []) dist[u.status] = (dist[u.status] || 0) + 1
      const monthRev = (pays || []).reduce((s, p) => s + num(p.amount), 0)
      const overdueTotal = (od || []).reduce((s, o) => s + num(o.amount_due), 0)
      const todayDepartures = (soon || []).filter(b => b.check_out_date === t_date)
      const tomorrowDepartures = (soon || []).filter(b => b.check_out_date === tomorrow)
      const weekDepartures = (soon || []).filter(b => b.check_out_date > tomorrow)
      setS({ arrivals, departures, dist, monthRev, overdueTotal,
        unitsCount: (units || []).length, overdueCount: (od || []).length,
        todayDepartures, tomorrowDepartures, weekDepartures })

      // Logic from Dashboard.jsx
      const { data: td } = await supabase.rpc('dashboard_today', { p_company: cid })
      setT(td)
      const { data: occ } = await supabase.rpc('occupancy_rate', { p_company: cid, p_from: first, p_to: t_date })
      const { data: contracts } = await scopeQuery(supabase.from('bookings')
        .select('id', { count: 'exact', head: true }).eq('company_id', cid))
        .gte('created_at', first).neq('status', 'cancelled')
      
      const { data: paysByUnit } = await scopeQuery(supabase.from('payments')
        .select('amount, booking_id, bookings(unit_id, units(unit_number))')
        .eq('company_id', cid)).gte('payment_date', first)
      const byUnit = {}
      for (const p of paysByUnit || []) {
        const un = p.bookings?.units?.unit_number || '—'
        byUnit[un] = (byUnit[un] || 0) + Number(p.amount)
      }
      const sorted = Object.entries(byUnit).sort((a, b) => b[1] - a[1])
      
      setM({
        occ: occ ?? 0,
        contracts: contracts?.count ?? 0,
        top: sorted[0]?.[0] || '—',
        low: sorted.at(-1)?.[0] || '—'
      })
      
      if (canFinance) {
        const rev = (paysByUnit || []).reduce((s, p) => s + Number(p.amount), 0)
        const { data: exps } = await scopeQuery(supabase.from('expenses')
          .select('amount').eq('company_id', cid)).gte('expense_date', first)
        const exp = (exps || []).reduce((s, e) => s + Number(e.amount), 0)
        
        const d = new Date(first);
        d.setMonth(d.getMonth() - 1);
        const prevFirst = d.toISOString().slice(0, 10);
        
        const d2 = new Date(first);
        d2.setDate(d2.getDate() - 1);
        const prevLast = d2.toISOString().slice(0, 10);
        const { data: prevPays } = await scopeQuery(supabase.from('payments')
          .select('amount')
          .eq('company_id', cid))
          .gte('payment_date', prevFirst)
          .lte('payment_date', prevLast)
        
        const prevRev = (prevPays || []).reduce((s, p) => s + Number(p.amount), 0)
        
        let growth = 0;
        if (prevRev > 0) {
          growth = ((rev - prevRev) / prevRev) * 100;
        } else if (rev > 0) {
          growth = 100;
        }
        setFin({ rev, exp, net: rev - exp, growth, prevRev })
      }
    })()
  }, [profile, canFinance, activeBranch])

  // Load layout preferences (from Dashboard.jsx)
  useEffect(() => {
    if (!profile?.id) return
    let isSet = false

    const loadLayout = async () => {
      try {
        const { data: userProf } = await supabase
          .from('profiles')
          .select('settings')
          .eq('id', profile.id)
          .maybeSingle()

        const dbLayout = userProf?.settings?.dashboard_layout
        if (Array.isArray(dbLayout) && dbLayout.length > 0) {
          const merged = dbLayout.map(p => {
            const def = DEFAULT_LAYOUT.find(d => d.id === p.id);
            return def ? { ...def, ...p } : null;
          }).filter(Boolean);
          const missing = DEFAULT_LAYOUT.filter(d => !merged.find(m => m.id === d.id));
          setLayout([...merged, ...missing]);
          isSet = true;
        }
      } catch (e) {
        console.warn('Could not read settings from DB, trying localStorage', e)
      }

      if (!isSet) {
        const saved = localStorage.getItem('dashboard_layout_u_' + profile.id);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            const merged = parsed.map(p => {
              const def = DEFAULT_LAYOUT.find(d => d.id === p.id);
              return def ? { ...def, ...p } : null;
            }).filter(Boolean);
            
            const missing = DEFAULT_LAYOUT.filter(d => !merged.find(m => m.id === d.id));
            setLayout([...merged, ...missing]);
          } catch (e) {
            setLayout([...DEFAULT_LAYOUT]);
          }
        } else {
          setLayout([...DEFAULT_LAYOUT]);
        }
      }
    }

    loadLayout()
  }, [profile?.id]);

  /**
   * حفظ تخطيط اللوحة: محلياً فوراً ثم في ملف المستخدم بقاعدة البيانات.
   * الحفظ تلقائي بلا سؤال — كان مشروطاً بـ window.confirm فإذا ألغاه المستخدم
   * بقي الإعداد محلياً فقط، فيعود التخطيط للافتراضي على أي متصفح أو جهاز آخر.
   */
  const saveLayout = async (newLayout) => {
    setLayout(newLayout);
    if (!profile?.id) return
    try {
      localStorage.setItem('dashboard_layout_u_' + profile.id, JSON.stringify(newLayout));
    } catch { /* التخزين المحلي قد يكون ممتلئاً أو معطّلاً */ }

    try {
      const currentSettings = profile.settings || {}
      const { error } = await supabase.from('profiles').update({
        settings: { ...currentSettings, dashboard_layout: newLayout, updated_at: new Date().toISOString() }
      }).eq('id', profile.id)
      if (error) throw error
    } catch (err) {
      console.warn('حُفظ التخطيط محلياً، وتعذّر حفظه في قاعدة البيانات:', err?.message || err)
    }
  };

  const changeColor = (index) => {
    const colors = ['default', 'dark', 'green', 'gold'];
    const newLayout = [...layout];
    const currIdx = colors.indexOf(newLayout[index].color || 'default');
    newLayout[index].color = colors[(currIdx + 1) % colors.length];
    saveLayout(newLayout);
  };

  const changeSize = (index) => {
    const sizes = ['1', '2', '3'];
    const newLayout = [...layout];
    const currIdx = sizes.indexOf(newLayout[index].size || '1');
    newLayout[index].size = sizes[(currIdx + 1) % sizes.length];
    saveLayout(newLayout);
  };

  const handleRemoveCard = (id) => {
    const newLayout = layout.map(item => item.id === id ? { ...item, hidden: true } : item)
    saveLayout(newLayout)
  }

  const handleRestoreCard = (id) => {
    const newLayout = layout.map(item => item.id === id ? { ...item, hidden: false } : item)
    saveLayout(newLayout)
  }

  const handleRestoreDefaults = async () => {
    if (window.confirm('إلغاء كافة التغييرات: هل أنت متأكد من رغبتك في استعادة الإعدادات الافتراضية للنظام (Undo Changes)؟')) {
      await saveLayout(DEFAULT_LAYOUT);
      if (toast) toast('تمت استعادة الإعدادات الافتراضية للنظام ✓');
    }
  };

  const handleSaveModalCard = (updatedCard) => {
    const newLayout = layout.map(item => item.id === updatedCard.id ? updatedCard : item)
    saveLayout(newLayout)
    if (toast) toast('تم حفظ تخصيص البطاقة بنجاح ✓')
  }

  const handleDragStart = (e, index) => {
    setDraggedIdx(index)
    e.dataTransfer.effectAllowed = 'move'
  };

  const handleDragOver = (e, index) => {
    e.preventDefault()
    if (draggedIdx === null || draggedIdx === index) return
    const newLayout = [...layout]
    const draggedItem = newLayout[draggedIdx]
    newLayout.splice(draggedIdx, 1)
    newLayout.splice(index, 0, draggedItem)
    setDraggedIdx(index)
    setLayout(newLayout)
  };

  const handleDragEnd = () => {
    setDraggedIdx(null)
    saveLayout(layout)
  };

  const getValue = (item) => {
    if (item.group === 'today' && t) return t[item.valueKey] ?? '…';
    if (item.group === 'month' && m) {
      if (item.valueKey === 'occ') return m.occ + '%';
      return m[item.valueKey] ?? '…';
    }
    if (item.group === 'fin' && fin) {
      if (item.valueKey === 'growth') {
        const val = fin.growth;
        return (val > 0 ? '+' : '') + val.toFixed(1) + '%';
      }
      return SAR(fin[item.valueKey]);
    }
    return '…';
  };

  const hour = new Date().getHours()
  const greet = hour < 12 ? 'صباح الخير' : hour < 18 ? 'مساء الخير' : 'أهلاً بك'

  if (!s) return <div><div className="hero-strip"><h2>مرحباً {profile?.full_name} 👋</h2></div><SkeletonKpis /></div>

  return (
    <div>
      <div className="hero-strip">
        <div>
          <div className="hero-hi">{greet} {profile?.full_name?.split(' ')[0]} 👋</div>
          <h2>{company?.name || 'المازن'}</h2>
          <div className="hero-sub">اليوم {new Date().toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
        <div className="hero-actions">
          <button className="btn btn-gold btn-sm" onClick={() => onNav?.('dash')}>إدارة الوحدات →</button>
          {profile?.role === 'accountant' && <button className="btn btn-ghost btn-sm" onClick={() => onNav?.('reports')}>قسم المحاسبة →</button>}
        </div>
      </div>

      {/* AccountingIntegrityTool نُقلت إلى صفحة "الاختبارات الذكية للمحاسبة" */}

      {/* Dashboard Metrics (from Dashboard.jsx) */}
      <div className="pg-title" style={{ marginTop: 30, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>لوحة التحكم</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {dashEditMode && (
            <button 
              className="btn btn-ghost btn-sm" 
              onClick={handleRestoreDefaults}
              style={{ fontSize: 12, color: '#ef4444', borderColor: '#fee2e2', background: '#fff' }}
              title="إعادة ضبط المظهر وتخطيط البطاقات للافتراضي"
            >
              <RotateCcw size={14} /> إعادة ضبط الواجهة (Reset Layout)
            </button>
          )}
          {setDashEditMode && (
            <button
              className={`btn ${dashEditMode ? 'btn-green' : 'btn-gold'} btn-sm`}
              onClick={() => setDashEditMode(prev => !prev)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: '800' }}
            >
              {dashEditMode ? <Check size={16} /> : <Settings2 size={16} />}
              {dashEditMode ? 'إنهاء التخصيص' : 'تخصيص اللوحة'}
            </button>
          )}
        </div>
      </div>
      <div className="panel" style={{ 
        background: dashEditMode ? 'rgba(255,255,255,0.7)' : '#fff', 
        border: dashEditMode ? '2px dashed var(--gold)' : '1px solid var(--line)',
        transition: 'all 0.3s ease',
        marginTop: 20
      }}>
        {dashEditMode ? (
          <div style={{ marginBottom: 24, padding: 16, background: '#f8fafc', borderRadius: 12, color: 'var(--blue-2)', fontSize: 14, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ background: 'var(--gold-l)', color: '#fff', width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Paintbrush size={18} /></div>
              <div>
                <strong style={{ display: 'block', fontSize: 15, marginBottom: 6 }}>وضع تخصيص اللوحة مفعّل — مرّر على أي بطاقة لتظهر أدواتها</strong>
                <div style={{ display: 'grid', gap: 4, fontSize: 13.5, lineHeight: 1.7 }}>
                  <span><b>⣿ سحب</b> — أمسك البطاقة واسحبها لتغيير ترتيبها في اللوحة.</span>
                  <span><b>⚙ تخصيص</b> — نافذة كاملة لاختيار اللون والحجم مع معاينة مباشرة.</span>
                  <span><b>⤢ الحجم</b> — تبديل سريع بين 1x و 2x و 3x (عرض البطاقة في الشبكة).</span>
                  <span><b>🖌 اللون</b> — تبديل سريع بين الافتراضي والداكن والأخضر والذهبي.</span>
                  <span><b>🗑 حذف</b> — إخفاء البطاقة، وتظهر أسفل اللوحة لاستعادتها في أي وقت.</span>
                </div>
                <div style={{ marginTop: 8, fontSize: 12.5, color: '#15803d', fontWeight: 700 }}>
                  ✓ كل تغيير يُحفظ فوراً في ملفك الشخصي — يعود كما تركته عند تسجيل الدخول من أي جهاز.
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 20, padding: '9px 14px', background: '#FFFDF7', borderRadius: 10, border: '1px solid rgba(201,168,76,0.4)', fontSize: 12.5, color: '#6B5417', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Settings2 size={15} style={{ flexShrink: 0 }} />
            <span>هذه اللوحة قابلة للتخصيص بالكامل — اضغط <b>«تخصيص اللوحة»</b> بالأعلى للتحكم في حجم البطاقات وألوانها وترتيبها، أو لإخفاء ما لا تحتاجه واستعادته لاحقاً. يُحفظ اختيارك في حسابك.</span>
          </div>
        )}
        
        <div className="kpis custom-grid">
          {layout.map((item, index) => {
            if (item.hidden && !dashEditMode) return null;
            if (item.hidden && dashEditMode) return null; // We show them in a different section
            if (item.restricted && !canFinance) return null;
            if (item.group === 'fin' && !canFinance) return null;
            
            const isDarkBg = ['dark', 'green', 'gold'].includes(item.color);
            let valStyle = {};
            
            if (item.valueKey === 'exp') {
              valStyle.color = isDarkBg ? '#fca5a5' : 'var(--st-oc)';
            } else if (item.valueKey === 'growth' && fin) {
              valStyle.direction = 'ltr';
              if (fin.growth >= 0) {
                if (item.color === 'green') valStyle.color = '#ffffff';
                else if (isDarkBg) valStyle.color = '#6ee7b7';
                else valStyle.color = 'var(--green)';
              } else {
                valStyle.color = isDarkBg ? '#fca5a5' : 'var(--st-oc)';
              }
            }
            
            return (
              <div 
                key={item.id} 
                className={`kpi size-${item.size || '1'} color-${item.color || 'default'}`}
                draggable={dashEditMode}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                style={{ cursor: dashEditMode ? 'grab' : 'default', opacity: draggedIdx === index ? 0.5 : 1 }}
              >
                <div className="v" style={valStyle}>{getValue(item)}</div>
                <div className="l">{item.title}</div>
                
                {dashEditMode && (
                  <>
                    <div className="kpi-edit-outline"></div>
                    <div className="kpi-edit-actions" style={{ maxWidth: '160px', cursor: 'pointer' }}>
                      <button className="kpi-edit-btn" style={{ cursor: 'grab' }} title="سحب لإعادة الترتيب">
                        <GripHorizontal size={15} />
                      </button>
                      <button className="kpi-edit-btn" onClick={() => setActiveModalCard(item)} title="فتح نافذة التعديل والتخصيص">
                        <SlidersHorizontal size={15} />
                      </button>
                      <button className="kpi-edit-btn" onClick={() => changeSize(index)} title="تغيير الحجم السريع (1x / 2x / 3x)">
                        <Maximize2 size={15} />
                      </button>
                      <button className="kpi-edit-btn" onClick={() => changeColor(index)} title="تغيير اللون السريع">
                        <Paintbrush size={15} />
                      </button>
                      <button className="kpi-edit-btn" onClick={() => handleRemoveCard(item.id)} title="إخفاء من اللوحة الرئيسية" style={{ color: '#ef4444' }}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>

        {dashEditMode && layout.filter(x => x.hidden).length > 0 && (
          <div style={{ marginTop: 32, paddingTop: 20, borderTop: '1px solid #e2e8f0' }}>
            <h4 style={{ fontSize: 14, color: '#64748b', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <RotateCcw size={14} /> بطاقات مخفية (يمكنك إعادتها للوحة)
            </h4>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {layout.filter(x => x.hidden).map(item => (
                <div key={item.id} style={{ 
                  padding: '8px 12px', 
                  background: '#f8fafc', 
                  borderRadius: 10, 
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13
                }}>
                  <span style={{ color: '#0f172a', fontWeight: 'bold' }}>{item.title}</span>
                  <button 
                    onClick={() => handleRestoreCard(item.id)}
                    style={{ 
                      background: 'var(--gold)', 
                      color: '#fff', 
                      border: 'none', 
                      borderRadius: 6, 
                      padding: '4px 8px', 
                      fontSize: 11, 
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    <PlusCircle size={12} /> إظهار
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* تقويم العمليات — كل الوحدات في شهر واحد */}
      <div style={{ marginTop: 20, marginBottom: 20 }}>
        <OperationsCalendar />
      </div>

      {/* Analytics Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px', marginBottom: '20px' }}>
        <OccupancyForecastChart />
        <UnitPerformanceChart />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        <BookingTrendsChart />
        <BookingSourcePieChart />
      </div>

      <div className="grid2" style={{ marginTop: 22 }}>
        <div className="panel">
          <h3>إجراءات سريعة</h3>
          <div className="quick-actions">
            <button className="qa-btn" onClick={() => onNav?.('dash')}>
              <span className="qa-ico">🏢</span><b>إدارة الوحدات</b>
              <span>حجز، إخلاء، صيانة، تعديل</span>
            </button>
            {profile?.role === 'accountant' && <button className="qa-btn" onClick={() => onNav?.('reports')}>
              <span className="qa-ico">📊</span><b>قسم المحاسبة</b>
              <span>Excel + PDF بالفلاتر التي تختارها</span>
            </button>}
            {(isOwner || profile?.role === 'accountant') && <button className="qa-btn" onClick={() => onNav?.('settings')}>
              <span className="qa-ico">⚙️</span><b>الإعدادات</b>
              <span>المستخدمون، الفروع، الهوية</span>
            </button>}
          </div>
        </div>

        <div className="panel">
          <h3>حالة الوحدات</h3>
          <div className="status-strip">
            {[
              ['available', 'متاحة', 'var(--st-av)'],
              ['reserved', 'محجوزة', 'var(--st-rs)'],
              ['occupied', 'مسكونة', 'var(--st-oc)'],
              ['cleaning', 'تنظيف', 'var(--st-cl)'],
              ['maintenance', 'صيانة', 'var(--st-cl)']
            ].map(([k, label, c]) => (
              <div key={k} className="status-item">
                <span className="status-dot" style={{ background: c }} />
                <b>{s.dist[k] || 0}</b>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="mini-note">
            الإجمالي: {s.unitsCount} وحدة —
            نسبة الإشغال: {s.unitsCount ? Math.round(((s.dist.occupied || 0) + (s.dist.reserved || 0)) / s.unitsCount * 100) : 0}%
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h3>⏰ التسليمات القادمة (تنبيهات الموظف)</h3>
        <div className="upcoming-grid">
          <UpcomingCol color="var(--st-oc)" label="مغادرة اليوم" list={s.todayDepartures} empty="لا مغادرين اليوم" />
          <UpcomingCol color="var(--st-rs)" label="مغادرة غداً" list={s.tomorrowDepartures} empty="لا مغادرين غداً" />
          <UpcomingCol color="var(--gold-d)" label="خلال الأسبوع" list={s.weekDepartures} empty="لا مغادرين خلال 7 أيام" />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 24, marginBottom: 24, flexWrap: 'wrap' }}>
        <TodayRentalsCard companyId={profile.company_id} />
        <TodayCheckoutsCard companyId={profile.company_id} />
      </div>

      <BookingsPaymentsCard companyId={profile.company_id} />
      <PendingPaymentsCard companyId={profile.company_id} />

      <KpiCardConfigModal
        isOpen={Boolean(activeModalCard)}
        onClose={() => setActiveModalCard(null)}
        card={activeModalCard}
        onSave={handleSaveModalCard}
      />
    </div>
  )
}



function UpcomingCol({ color, label, list, empty }) {
  return (
    <div className="upcoming-col">
      <div className="upcoming-h"><span style={{ background: color }} />{label} ({list.length})</div>
      {list.length === 0
        ? <div className="upcoming-empty">{empty}</div>
        : list.map(b => (
          <div key={b.id} className="upcoming-item">
            <b>وحدة {b.units?.unit_number}</b>
            <span>{b.customers?.full_name}</span>
            <small dir="ltr">{b.check_out_date}</small>
          </div>
        ))}
    </div>
  )
}
