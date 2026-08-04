import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { SAR } from '../lib/helpers'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, AreaChart, Area, ScatterChart, Scatter, ZAxis, LineChart, Line, Legend } from 'recharts'
import FinancialExportModule from './FinancialExportModule'
import { performFinancialExport } from '../lib/exportUtils'
import ReferralAccountNotice from './ReferralAccountNotice'


export default function AccountSettings() {
  const { profile, company, isOwner, toast } = useAuth()
  const [subTab, setSubTab] = useState('overview')
  const [users, setUsers] = useState([])
  const [reqSent, setReqSent] = useState(false)
  const [passForm, setPassForm] = useState({ email: '', password: '' })
  const [passBusy, setPassBusy] = useState(false)
  
  const [usage, setUsage] = useState([
    { name: 'الوحدات', current: 0, limit: 50 },
    { name: 'المستخدمين', current: 0, limit: 10 },
    { name: 'الحجوزات', current: 0, limit: 500 }
  ])
  const [monthlyUsage, setMonthlyUsage] = useState([
    { name: 'يناير', units: 10, bookings: 40, revenue: 12000, occupancy: 45 },
    { name: 'فبراير', units: 15, bookings: 65, revenue: 18000, occupancy: 52 },
    { name: 'مارس', units: 20, bookings: 80, revenue: 25000, occupancy: 60 },
    { name: 'أبريل', units: 25, bookings: 120, revenue: 35000, occupancy: 70 },
    { name: 'مايو', units: 28, bookings: 150, revenue: 42000, occupancy: 75 },
    { name: 'يونيو', units: 35, bookings: 200, revenue: 60000, occupancy: 85 },
  ])
  const [heatmapData, setHeatmapData] = useState([])
  const [logs, setLogs] = useState([])
  
  // Activity Log Filters
  const [logFilterActor, setLogFilterActor] = useState('')
  const [logFilterAction, setLogFilterAction] = useState('')

  // Security status mock state
  const lastPassChange = profile?.password_last_changed || localStorage.getItem('last_password_change')
  const daysSinceChange = lastPassChange ? Math.floor((new Date() - new Date(lastPassChange)) / (1000 * 3600 * 24)) : null
  const [mfaEnabledState, setMfaEnabledState] = useState(profile?.mfa_enabled || false)
  const mfaEnabled = mfaEnabledState
  
  const toggleMfa = async () => {
    const newVal = !mfaEnabled
    setMfaEnabledState(newVal)
    toast(newVal ? 'تم تفعيل المصادقة الثنائية بنجاح' : 'تم إيقاف المصادقة الثنائية', !newVal)
  }

  useEffect(() => {
    (async () => {
      const { data: usersData } = await supabase.from('profiles').select('*').eq('company_id', company.id).neq('id', profile.id)
      setUsers(usersData || [])
      
      const { count: unitsCount } = await supabase.from('units').select('id', { count: 'exact', head: true }).eq('company_id', company.id)
      const { count: usersCount } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('company_id', company.id)
      
      const firstMonth = new Date().toISOString().slice(0, 7) + '-01'
      const { count: bksCount } = await supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('company_id', company.id).gte('created_at', firstMonth)
      
      setUsage([
        { name: 'الوحدات', current: unitsCount || 0, limit: 50 },
        { name: 'المستخدمين', current: usersCount || 0, limit: 10 },
        { name: 'الحجوزات', current: bksCount || 0, limit: 500 }
      ])
      
      const { data: auditData } = await supabase.from('audit_logs')
        .select('*')
        .eq('company_id', company.id)
        .order('created_at', { ascending: false })
        .limit(500)
        
      setLogs(auditData || [])

      if (auditData && auditData.length > 0) {
        const heatmapMap = {}
        const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
        auditData.forEach(log => {
          const d = new Date(log.created_at)
          const day = DAYS[d.getDay()]
          const hour = String(d.getHours()).padStart(2, '0') + ':00'
          const key = `${day}-${hour}`
          heatmapMap[key] = (heatmapMap[key] || 0) + 1
        })
        const newHeatmap = Object.keys(heatmapMap).map(k => {
          const [day, hour] = k.split('-')
          return { day, hour, z: heatmapMap[k] * 20 }
        })
        if (newHeatmap.length > 0) setHeatmapData(newHeatmap)
      }
    })()
  }, [company.id, profile.id])

  const requestExtension = async () => {
    setReqSent(true)
    const { error } = await supabase.from('subscription_extension_requests').insert({
      company_id: company.id,
      requested_by: profile.id,
      status: 'pending'
    })
    
    if (error) {
      toast('خطأ في إرسال الطلب: ' + error.message, true)
      setReqSent(false)
    } else {
      toast('✓ تم إرسال طلب تمديد الاشتراك للإدارة بنجاح.')
    }
  }

  const updateCredentials = async () => {
    if (!passForm.email && !passForm.password) {
      toast('الرجاء إدخال البريد الإلكتروني الجديد أو كلمة المرور', true)
      return
    }
    setPassBusy(true)
    try {
      const updates = {}
      if (passForm.email) updates.email = passForm.email
      if (passForm.password) updates.password = passForm.password

      const { error } = await supabase.auth.updateUser(updates)
      if (error) throw error

      if (passForm.password) {
        localStorage.setItem('last_password_change', new Date().toISOString())
      }
      
      toast('تم تحديث بيانات الدخول بنجاح! قد تتلقى رسالة تأكيد على بريدك.')
      setPassForm({ email: '', password: '' })
    } catch (err) {
      toast('حدث خطأ: ' + err.message, true)
    } finally {
      setPassBusy(false)
    }
  }

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchActor = logFilterActor ? (log.new_data?.actor || '').toLowerCase().includes(logFilterActor.toLowerCase()) : true
      const matchAction = logFilterAction ? log.action === logFilterAction : true
      return matchActor && matchAction
    }).slice(0, 50)
  }, [logs, logFilterActor, logFilterAction])

  const TABS = [
    { id: 'overview', label: 'نظرة عامة', icon: '👤' },
    { id: 'activity', label: 'سجل النشاط', icon: '📋' },
    ...(isOwner ? [
      { id: 'occupancy', label: 'تحليلات الإشغال', icon: '📈' },
      { id: 'platforms', label: 'منصات الحجز', icon: '🌐' }
    ] : [])
  ]

  // التواريخ تُقرأ من الأعمدة الفعلية في قاعدة البيانات.
  // أثناء التجربة يكون trial_ends_at هو المصدر الوحيد الصحيح — العمود القديم
  // subscription_end قد يحمل قيمة افتراضية قديمة (سنة) ولا يُعتمد عليه هنا.
  const subEndRaw = company?.plan === 'trial'
    ? (company?.trial_ends_at || company?.subscription_ends_at || null)
    : (company?.subscription_ends_at || company?.subscription_end || company?.trial_ends_at || null)

  const subStartRaw = company?.subscription_start || company?.trial_started_at || company?.created_at
  const subStart = subStartRaw ? new Date(subStartRaw).toLocaleDateString('ar-SA') : '—'
  const daysRemaining = subEndRaw ? Math.ceil((new Date(subEndRaw) - new Date()) / 86400000) : null
  const subEnd = subEndRaw ? (daysRemaining > 3650 ? 'غير محدود' : new Date(subEndRaw).toLocaleDateString('ar-SA')) : '—'
  const isExpired = daysRemaining != null && daysRemaining <= 0
  const subStatusLabel = isExpired ? 'منتهي' : (company?.plan === 'trial' ? 'فترة تجريبية' : company?.plan === 'suspended' ? 'موقوف مؤقتاً' : 'نشط')


  return (
    <div style={{ animation: 'fade 0.3s ease' }}>
      {/* Sub Tabs */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 12 }}>
        {TABS.map(t => (
          <button 
            key={t.id} 
            className={`btn btn-sm ${subTab === t.id ? 'btn-gold' : 'btn-ghost'}`}
            onClick={() => setSubTab(t.id)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {subTab === 'overview' && (
        <>
          <ReferralAccountNotice />
          <div className="grid2" style={{ marginBottom: 20 }}>

            <div>
              <div className="panel" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                <h4 style={{ marginBottom: 16 }}>الاشتراك والباقة</h4>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span>الباقة الحالية:</span>
                  <span className="chip chip-gold">{company?.plan || 'النمو (Growth)'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span>حالة الاشتراك:</span>
                  <span className={`chip ${isExpired ? 'chip-red' : 'chip-green'}`}>
                    {subStatusLabel}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span>بداية الاشتراك:</span>
                  <b>{subStart}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span>تاريخ نهاية الاشتراك:</span>
                  <b>{subEnd}</b>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <span>المدة المتبقية:</span>
                  <b style={{ color: daysRemaining != null && daysRemaining <= 7 && daysRemaining > 0 ? 'var(--warn)' : 'inherit' }}>
                    {daysRemaining == null ? '—' : daysRemaining > 3650 ? 'غير محدود' : daysRemaining > 0 ? `${daysRemaining} يوم` : 'منتهٍ'}
                  </b>

                </div>
                
                <div
                  className="auth-note"
                  style={{ fontSize: 13, lineHeight: 2, marginBottom: 16, borderRight: '3px solid #B8860B', padding: '10px 12px', borderRadius: 8 }}
                >
                  <b>تنبيه:</b> سيتم تمديد اشتراكك <b>ثلاثة أشهر إضافية</b> تُضاف تلقائياً على تاريخ نهاية
                  الاشتراك بعد سداد قيمة الاشتراك واعتماده من الإدارة، وتُحدَّث الحالة والتاريخ أعلاه بشكل فوري.
                </div>
                <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
                  تتيح لك الباقة الحالية إدارة الوحدات والمستخدمين المحددين. يمكنك طلب تمديد أو ترقية الباقة عند الحاجة.
                </p>

                <button 
                  className="btn btn-blue" 
                  style={{ width: '100%' }} 
                  disabled={reqSent}
                  onClick={requestExtension}
                >
                  {reqSent ? '⏳ تم إرسال طلب التمديد' : 'طلب تمديد/ترقية الاشتراك'}
                </button>
              </div>

              <div className="panel" style={{ marginTop: 20, border: '1px solid rgba(255,255,255,0.08)' }}>
                <h4 style={{ marginBottom: 16 }}>🛡️ بطاقة الحالة الأمنية وبيانات الدخول (Security Status)</h4>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                  <div>
                    <label style={{ fontSize: 13, color: 'var(--muted)' }}>البريد الإلكتروني الجديد</label>
                    <input 
                      type="email" 
                      className="inp" 
                      placeholder="اتركه فارغاً إذا لم ترغب بتغييره"
                      value={passForm.email} 
                      onChange={e => setPassForm(p => ({ ...p, email: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 13, color: 'var(--muted)' }}>كلمة المرور الجديدة</label>
                    <input 
                      type="password" 
                      className="inp" 
                      placeholder="اتركها فارغة إذا لم ترغب بتغييرها"
                      value={passForm.password} 
                      onChange={e => setPassForm(p => ({ ...p, password: e.target.value }))}
                    />
                  </div>
                  <button 
                    className="btn btn-gold" 
                    onClick={updateCredentials} 
                    disabled={passBusy || (!passForm.email && !passForm.password)}
                  >
                    {passBusy ? 'جارٍ التحديث...' : 'تحديث بيانات الدخول'}
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
                    <span>حالة كلمة المرور:</span>
                    <span>
                      {daysSinceChange === null ? (
                        <span style={{ color: '#EAB308' }}>⚠️ غير معروف</span>
                      ) : daysSinceChange > 90 ? (
                        <span style={{ color: '#EF4444' }}>❌ قديمة ({daysSinceChange} يوم)</span>
                      ) : (
                        <span style={{ color: '#10B981' }}>✓ جيدة (منذ {daysSinceChange} يوم)</span>
                      )}
                    </span>
                  </div>
                  <div style={{ padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
                    <span>المصادقة الثنائية (MFA):</span>
                    <span>
                      {mfaEnabled ? (
                        <span style={{ color: '#10B981' }}>✓ مفعلة</span>
                      ) : (
                        <span style={{ color: '#EF4444' }}>⚠️ غير مفعلة</span>
                      )}
                    </span>
                  </div>
                </div>

                <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 16 }}>
                  <h5 style={{ marginBottom: 12 }}>إعدادات المصادقة الثنائية (2FA)</h5>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>تأمين إضافي للحساب</span>
                    <button 
                      className={`btn btn-sm ${mfaEnabled ? 'btn-red' : 'btn-blue'}`}
                      onClick={toggleMfa}
                    >
                      {mfaEnabled ? 'إيقاف 2FA' : 'تفعيل 2FA'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="panel" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              {isOwner && (
                <div style={{ marginBottom: 24 }}>
                  <h4 style={{ marginBottom: 16 }}>📈 نمو الموارد (الوحدات المُدارة مقابل الحجوزات النشطة)</h4>
                  <div style={{ height: 250, width: '100%' }}>
                    <ResponsiveContainer>
                      <AreaChart data={monthlyUsage} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorUnits" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#2563EB" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#2563EB" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorBookings" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                        <Tooltip contentStyle={{ background: '#0F172A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff' }} />
                        <Area type="monotone" dataKey="units" name="الوحدات المُدارة" stroke="#2563EB" fillOpacity={1} fill="url(#colorUnits)" />
                        <Area type="monotone" dataKey="bookings" name="الحجوزات النشطة" stroke="#10B981" fillOpacity={1} fill="url(#colorBookings)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              <h4 style={{ marginBottom: 16 }}>📊 استهلاك الموارد (مقارنة بالباقة)</h4>
              <div style={{ height: 180, width: '100%' }}>
                <ResponsiveContainer>
                  <BarChart data={usage} layout="vertical" margin={{ top: 0, right: 20, left: 20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
                    <XAxis type="number" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} width={80} />
                    <Tooltip 
                      contentStyle={{ background: '#0F172A', border: '1px solid rgba(231,200,115,0.3)', borderRadius: 8, color: '#fff' }} 
                      itemStyle={{ color: '#E7C873' }} 
                      formatter={(value, name, props) => [`${value} / ${props.payload.limit}`, 'الاستهلاك']}
                    />
                    <Bar dataKey="current" name="الاستهلاك الحالي" radius={[0, 4, 4, 0]} barSize={20}>
                      {usage.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.current >= entry.limit ? '#EF4444' : entry.current >= entry.limit * 0.8 ? '#EAB308' : '#10B981'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
          
          <div className="panel" style={{ marginBottom: 20 }}>
            <h4 style={{ marginBottom: 12 }}>حسابات المحاسبين والموظفين التابعة للمنشأة</h4>
            <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>المستخدمون الذين تم إنشاؤهم من قبل المدير أو الحساب الرئيسي للمنشأة.</p>
            <table className="tbl">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>الدور</th>
                  <th>اسم المستخدم / الإيميل</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && <tr><td colSpan="4" style={{textAlign:'center', color:'var(--muted)'}}>لا يوجد موظفون آخرون</td></tr>}
                {users.map(u => (
                  <tr key={u.id}>
                    <td>{u.full_name}</td>
                    <td>{u.role === 'accountant' ? 'محاسب' : u.role === 'manager' ? 'مدير' : 'موظف'}</td>
                    <td dir="ltr">{u.username || u.email || '—'}</td>
                    <td>{u.is_active ? <span className="chip chip-green">نشط</span> : <span className="chip chip-red">موقوف</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <FinancialExportModule 
            moduleTitle="تصدير التقارير المالية والعمليات (Export Center)"
            onExport={(config) => performFinancialExport(profile, company, config, toast)}
          />
        </>
      )}

      {subTab === 'activity' && (
        <div className="panel">
          <h4 style={{ marginBottom: 16 }}>📋 سجل النشاط (Activity Log)</h4>
          
          <div className="grid2" style={{ marginBottom: 20 }}>
            <div style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8 }}>
              <h5 style={{ marginBottom: 8, fontSize: 13 }}>🔥 خريطة النشاط لأوقات الذروة (Heatmap)</h5>
              <div style={{ height: 160, width: '100%' }}>
                <ResponsiveContainer>
                  <ScatterChart margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
                    <XAxis dataKey="hour" type="category" name="الساعة" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis dataKey="day" type="category" name="اليوم" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} width={45} />
                    <ZAxis dataKey="z" type="number" range={[20, 400]} name="مستوى النشاط" />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ background: '#0F172A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }} />
                    <Scatter name="النشاطات" data={heatmapData} fill="#E7C873" opacity={0.8} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <input 
              type="text" 
              className="inp" 
              placeholder="🔍 تصفية باسم الموظف..." 
              value={logFilterActor} 
              onChange={e => setLogFilterActor(e.target.value)} 
              style={{ flex: 1 }}
            />
            <select className="inp" value={logFilterAction} onChange={e => setLogFilterAction(e.target.value)} style={{ width: 200 }}>
              <option value="">جميع النشاطات</option>
              <option value="create">إنشاء</option>
              <option value="update">تحديث</option>
              <option value="delete">حذف</option>
            </select>
          </div>

          <table className="tbl">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.05)', color: '#fff' }}>
                <th style={{ color: '#fff' }}>التاريخ والوقت</th>
                <th style={{ color: '#fff' }}>الموظف</th>
                <th style={{ color: '#fff' }}>الإجراء</th>
                <th style={{ color: '#fff' }}>الكيان</th>
                <th style={{ color: '#fff' }}>التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: 20, color: '#94a3b8' }}>لا توجد نتائج</td>
                </tr>
              )}
              {filteredLogs.map(log => (
                <tr key={log.id} style={{ transition: 'background 0.2s', ':hover': { background: 'rgba(255,255,255,0.02)' } }}>
                  <td style={{ color: '#CBD5E1', fontSize: 13 }}>{new Date(log.created_at).toLocaleString('ar-SA')}</td>
                  <td style={{ color: '#F8FAFC', fontWeight: 'bold' }}>{log.new_data?.actor || 'غير معروف'}</td>
                  <td>
                    <span className={`chip chip-${log.action === 'create' ? 'green' : log.action === 'update' ? 'blue' : log.action === 'delete' ? 'red' : 'gold'}`}>
                      {log.action === 'create' ? 'إنشاء' : log.action === 'update' ? 'تحديث' : log.action === 'delete' ? 'حذف' : log.action}
                    </span>
                  </td>
                  <td style={{ color: '#94A3B8' }}>{log.entity}</td>
                  <td style={{ color: '#F1F5F9' }}>{log.summary || log.new_data?.summary || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isOwner && subTab === 'occupancy' && (
        <div className="panel">
          <h4 style={{ marginBottom: 8 }}>📈 تحليلات الإشغال</h4>
          <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 20 }}>
            توضح هذه الرسوم البيانية نسب الإشغال الشهرية مقارنة بالوحدات المتاحة، لتقديم رؤية استراتيجية حول أداء التأجير.
          </p>
          <div style={{ height: 400, width: '100%' }}>
            <ResponsiveContainer>
              <LineChart data={monthlyUsage} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis yAxisId="left" stroke="#10B981" label={{ value: 'نسبة الإشغال (%)', angle: -90, position: 'insideLeft', fill: '#10B981' }} />
                <YAxis yAxisId="right" orientation="right" stroke="#EAB308" />
                <Tooltip contentStyle={{ background: '#0F172A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff' }} />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="occupancy" name="نسبة الإشغال (%)" stroke="#10B981" strokeWidth={3} activeDot={{ r: 8 }} />
                <Line yAxisId="right" type="monotone" dataKey="revenue" name="الإيرادات (SAR)" stroke="#EAB308" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {isOwner && subTab === 'platforms' && (
        <div className="panel">
          <h4 style={{ marginBottom: 16 }}>🌐 حالة الربط مع منصات الحجز (OTA)</h4>
          <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 24 }}>
            تحقق من حالة الاتصال التزامني مع المنصات الخارجية مثل Booking.com و Airbnb لمنع الحجوزات المزدوجة وتحديث الأسعار تلقائياً.
          </p>
          
          <div className="grid2" style={{ gap: 20 }}>
            <div style={{ padding: 20, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 40, height: 40, background: '#003580', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 20 }}>B.</div>
                  <h3 style={{ margin: 0 }}>Booking.com</h3>
                </div>
                <span className="chip chip-green" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, background: '#10B981', borderRadius: '50%', display: 'inline-block' }}></span> متصل</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: '#cbd5e1' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>آخر مزامنة:</span> <b dir="ltr">منذ 5 دقائق</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>الوحدات المرتبطة:</span> <b>12 وحدة</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>طريقة الربط:</span> <b>XML API (2-Way)</b></div>
              </div>
              <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" style={{ flex: 1 }}>مزامنة الآن</button>
                <button className="btn btn-ghost btn-sm" style={{ flex: 1 }}>إعدادات المنصة</button>
              </div>
            </div>

            <div style={{ padding: 20, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 40, height: 40, background: '#FF5A5F', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 20 }}>A.</div>
                  <h3 style={{ margin: 0 }}>Airbnb</h3>
                </div>
                <span className="chip chip-gold" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, background: '#EAB308', borderRadius: '50%', display: 'inline-block' }}></span> جاري التهيئة</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: '#cbd5e1' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>آخر مزامنة:</span> <b dir="ltr">-</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>الوحدات المرتبطة:</span> <b>0 وحدة</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>طريقة الربط:</span> <b>iCal (1-Way)</b></div>
              </div>
              <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
                <button className="btn btn-blue btn-sm" style={{ flex: 1 }}>استكمال الربط</button>
              </div>
            </div>
            
            <div style={{ padding: 20, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
              <div style={{ fontSize: 24, marginBottom: 12 }}>+</div>
              <h4>إضافة منصة جديدة</h4>
              <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>ادمج مع Agoda, Expedia, وغيرها</p>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 16 }}>تصفح المنصات</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
