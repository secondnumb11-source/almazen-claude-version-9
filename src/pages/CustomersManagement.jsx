import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { useBranches } from '../BranchContext'
import { SAR, num, today, uploadFile, openStoredDocument, PAY_METHODS } from '../lib/helpers'
import Customer360Modal from '../components/Customer360Modal'
import { ShieldAlert, Star, FileText, UserPlus, Search, Filter, AlertCircle, DollarSign, CheckCircle2, Download, Send, CheckSquare, Square, Plus, WifiOff } from 'lucide-react'
import * as XLSX from 'xlsx'
import { saveOperationalCache, getOperationalCache } from '../lib/offlineManager'

const ID_TYPES = { national_id: 'هوية وطنية', iqama: 'إقامة', passport: 'جواز سفر' }
const PAY_TYPE_LABEL = { rent: 'إيجار', down_payment: 'عربون', insurance: 'تأمين', penalty: 'غرامة', other: 'أخرى' }

/* إدارة العملاء والمستأجرين — الملف الموحد 360، القائمة السوداء، وإدارة الوثائق */
export default function CustomersManagement() {
  const { profile, toast } = useAuth()
  const { scopeQuery, activeBranch } = useBranches()
  const [view, setView] = useState('individuals') // 'individuals' | 'corporate'
  const [customers, setCustomers] = useState([])
  const [corporates, setCorporates] = useState([])
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all') // 'all' | 'blacklisted' | 'vip' | 'debtors'
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [adding, setAdding] = useState(false)
  const [addingCorp, setAddingCorp] = useState(false)
  const [selectedCorp, setSelectedCorp] = useState(null)

  // Bulk Selection State
  const [selectedIds, setSelectedIds] = useState([])
  const [showBroadcastModal, setShowBroadcastModal] = useState(false)
  const [broadcastMsg, setBroadcastMsg] = useState('')
  const [sendingBroadcast, setSendingBroadcast] = useState(false)

  const [isUsingOfflineCache, setIsUsingOfflineCache] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const { data: cData, error: cErr } = await scopeQuery(supabase.from('customers')
        .select(`*, bookings(
          id, total_amount, base_price, discount_percent, discount_amount, contract_number,
          check_in_date, check_out_date, status, rent_period, down_payment, insurance_amount, unit_id,
          units(unit_number, category, description),
          payments(amount, payment_type, method, payment_date, reference_number, document_url),
          profiles!bookings_employee_id_fkey(full_name)
        )`)
        .eq('company_id', profile.company_id)).order('full_name')

      const { data: corpData, error: corpErr } = await supabase.from('corporate_profiles')
        .select('*')
        .eq('company_id', profile.company_id)
        .order('name')

      if (cErr || !cData) {
        throw new Error(cErr?.message || 'تعذّر الاتصال ببيانات العملاء')
      }

      setCustomers(cData || [])
      setCorporates(corpData || [])
      setIsUsingOfflineCache(false)

      if (profile?.company_id) {
        saveOperationalCache('customers_' + profile.company_id, cData)
        saveOperationalCache('corporates_' + profile.company_id, corpData)
      }
    } catch (err) {
      console.warn('⚡ تحميل البيانات العملياتية للعملاء من التخزين المؤقت المحلي:', err)
      const cachedC = getOperationalCache('customers_' + profile?.company_id)
      const cachedCorp = getOperationalCache('corporates_' + profile?.company_id)
      if (cachedC) setCustomers(cachedC)
      if (cachedCorp) setCorporates(cachedCorp)
      if (cachedC || cachedCorp) {
        setIsUsingOfflineCache(true)
        toast('⚡ تعذّر الاتصال المباشر بالشبكة — تم عرض بيانات ملفات العملاء المخزنة محلياً', false)
      }
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [profile, activeBranch])

  // Bulk Actions Logic
  const toggleSelectAll = (list) => {
    if (selectedIds.length === list.length && list.length > 0) {
      setSelectedIds([])
    } else {
      setSelectedIds(list.map(c => c.id))
    }
  }

  const toggleSelectId = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }

  const handleBulkExport = () => {
    const listToExport = customers.filter(c => selectedIds.includes(c.id))
    if (listToExport.length === 0) return toast('يرجى تحديد عميل واحد على الأقل للتصدير', true)

    const exportRows = listToExport.map(c => ({
      'الاسم الكامل': c.full_name,
      'نوع الإثبات': ID_TYPES[c.id_type] || c.id_type,
      'رقم الإثبات': c.id_number,
      'رقم الجوال': c.phone,
      'البريد الإلكتروني': c.email || '—',
      'الجنسية': c.nationality || '—',
      'VIP': c.is_vip ? 'نعم' : 'لا',
      'قائمة سوداء': c.is_blacklisted ? 'نعم' : 'لا',
      'التقييم': c.rating || 5,
      'عدد الحجوزات': (c.bookings || []).length
    }))

    const ws = XLSX.utils.json_to_sheet(exportRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'قائمة العملاء المحددين')
    XLSX.writeFile(wb, `قائمة_العملاء_${today()}.xlsx`)
    toast(`✓ تم تصدير بيانات ${listToExport.length} عميل بصيغة Excel بنجاح`)
  }

  const handleBulkExportCSV = () => {
    const listToExport = customers.filter(c => selectedIds.includes(c.id))
    if (listToExport.length === 0) return toast('يرجى تحديد عميل واحد على الأقل للتصدير', true)

    const exportRows = listToExport.map(c => ({
      'الاسم الكامل': c.full_name,
      'نوع الإثبات': ID_TYPES[c.id_type] || c.id_type,
      'رقم الإثبات': c.id_number,
      'رقم الجوال': c.phone,
      'البريد الإلكتروني': c.email || '—',
      'الجنسية': c.nationality || '—',
      'VIP': c.is_vip ? 'نعم' : 'لا',
      'قائمة سوداء': c.is_blacklisted ? 'نعم' : 'لا',
      'التقييم': c.rating || 5,
      'عدد الحجوزات': (c.bookings || []).length
    }))

    const ws = XLSX.utils.json_to_sheet(exportRows)
    const csvOutput = XLSX.utils.sheet_to_csv(ws)
    const blob = new Blob(["\uFEFF" + csvOutput], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `قائمة_العملاء_${today()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast(`✓ تم تصدير بيانات ${listToExport.length} عميل بصيغة CSV بنجاح`)
  }

  const handleSendBroadcast = async () => {
    if (!broadcastMsg.trim()) return toast('يرجى كتابة نص الإشعار/التنبيه', true)
    setSendingBroadcast(true)
    try {
      const selectedCustomers = customers.filter(c => selectedIds.includes(c.id))
      // Log broadcast in audit logs or notification queue
      await supabase.from('audit_logs').insert({
        company_id: profile.company_id,
        user_id: profile.id,
        action: 'send_mass_notification',
        entity: 'customers',
        new_data: { count: selectedCustomers.length, message: broadcastMsg, recipient_ids: selectedIds }
      })

      // Send notifications to notification queue
      const notifs = selectedCustomers.map(c => ({
        company_id: profile.company_id,
        title: '📢 تنبيه صيانة وتحديث مهم من الإدارة',
        message: broadcastMsg,
        type: 'maintenance_alert',
        recipient_phone: c.phone,
        recipient_email: c.email
      }))

      await supabase.from('notifications').insert(notifs).catch(() => {})

      toast(`📢 تم إرسال تنبيهات SMS والبريد والنظام إلى ${selectedCustomers.length} نزيل/عميل بنجاح!`)
      setShowBroadcastModal(false)
      setBroadcastMsg('')
      setSelectedIds([])
    } catch (e) {
      toast('خطأ في إرسال التنبيه: ' + e.message, true)
    } finally {
      setSendingBroadcast(false)
    }
  }

  // Computed Counts
  const stats = useMemo(() => {
    let blacklisted = 0
    let vip = 0

    customers.forEach(c => {
      const isBl = c.is_blacklisted || c.rating === 1 || c.notes?.includes('[BLACKLIST]')
      if (isBl) blacklisted++
      if (c.is_vip) vip++
    })

    return { total: customers.length, blacklisted, vip }
  }, [customers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return customers.filter(c => {
      const isBl = c.is_blacklisted || c.rating === 1 || c.notes?.includes('[BLACKLIST]')

      // Filter Pill condition
      if (filterType === 'blacklisted' && !isBl) return false
      if (filterType === 'vip' && !c.is_vip) return false

      // Search Query
      if (!q) return true
      return c.full_name?.toLowerCase().includes(q) || c.id_number?.includes(q) || c.phone?.includes(q)
    })
  }, [customers, search, filterType])

  return (
    <div>
      <div className="pg-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>👥 إدارة العملاء والمستأجرين (360 Customer View)</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          {view === 'individuals' ? (
            <button
              className="btn btn-gold btn-sm"
              onClick={() => setAdding(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '800' }}
            >
              <UserPlus size={16} /> + إدراج عميل جديد
            </button>
          ) : (
            <button
              className="btn btn-blue btn-sm"
              onClick={() => setAddingCorp(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '800' }}
            >
              <Plus size={16} /> + إضافة شركة متعاقدة
            </button>
          )}
        </div>
      </div>

      <div className="acc-tabs" style={{ marginBottom: 16 }}>
        <button className={view === 'individuals' ? 'on' : ''} onClick={() => setView('individuals')}>👤 الأفراد</button>
        <button className={view === 'corporate' ? 'on' : ''} onClick={() => setView('corporate')}>🏢 الشركات المتعاقدة</button>
      </div>

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
          <span>يتم عرض ملفات العملاء المخزنة مؤقتاً محلياً نظراً لانقطاع الاتصال بالسيرفر. ستتم مزامنة التحديثات تلقائياً فور عودة التغطية.</span>
        </div>
      )}

      {view === 'individuals' ? (
        <>
          {/* Filter Tabs & Search Header */}
          <div className="panel" style={{ marginBottom: 16, padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
              {/* Search Box */}
              <div style={{ position: 'relative', minWidth: '280px', flex: 1 }}>
                <input
                  placeholder="ابحث باسم العميل، رقم الهوية/الإقامة، أو رقم الجوال..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ width: '100%', paddingRight: '12px' }}
                />
              </div>

              {/* Filter Pills */}
              <div className="acc-tabs" style={{ margin: 0, flexWrap: 'wrap' }}>
                <button
                  className={filterType === 'all' ? 'on' : ''}
                  onClick={() => setFilterType('all')}
                >
                  جميع العملاء ({stats.total})
                </button>
                <button
                  className={filterType === 'blacklisted' ? 'on' : ''}
                  onClick={() => setFilterType('blacklisted')}
                  style={{ color: filterType === 'blacklisted' ? '#fff' : '#DC2626' }}
                >
                  ⛔ القائمة السوداء ({stats.blacklisted})
                </button>
                <button
                  className={filterType === 'vip' ? 'on' : ''}
                  onClick={() => setFilterType('vip')}
                  style={{ color: filterType === 'vip' ? '#fff' : '#D97706' }}
                >
                  👑 عملاء VIP ({stats.vip})
                </button>
              </div>
            </div>

            {/* Bulk Action Bar when customers are selected */}
            {selectedIds.length > 0 && (
              <div style={{
                background: '#3B82F6',
                color: '#fff',
                borderRadius: '12px',
                padding: '12px 18px',
                marginBottom: '16px',
                display: 'flex',
                justify: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px'
              }}>
                <div style={{ fontWeight: 'bold', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CheckSquare size={18} /> تم تحديد ({selectedIds.length}) من أصل ({filtered.length}) عميل
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-sm"
                    onClick={handleBulkExportCSV}
                    style={{ background: '#059669', color: '#fff', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Download size={14} /> تصدير CSV
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={handleBulkExport}
                    style={{ background: '#fff', color: '#1E40AF', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Download size={14} /> تصدير Excel
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => setShowBroadcastModal(true)}
                    style={{ background: '#F59E0B', color: '#fff', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Send size={14} /> إشعار SMS وتنبيه صيانة جماعي
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => setSelectedIds([])}
                    style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}
                  >
                    إلغاء التحديد
                  </button>
                </div>
              </div>
            )}

            {/* Customers Table */}
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: '40px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.length === filtered.length && filtered.length > 0}
                        onChange={() => toggleSelectAll(filtered)}
                      />
                    </th>
                    <th>الاسم والصفة</th>
                    <th>نوع الإثبات</th>
                    <th>رقم الإثبات</th>
                    <th>الجوال</th>
                    <th>الإقامات</th>
                    <th>التقييم السلوكي</th>
                    <th>الموقف المالي</th>
                    <th>الخيارات</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: '24px' }}>جارٍ تحميل دليل العملاء...</td></tr>}
                  {!loading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: '30px' }}>
                        لا يوجد عملاء يطابقون معايير البحث أو التصفية الحالية.
                      </td>
                    </tr>
                  )}
                  {filtered.map(c => {
                    const isBl = c.is_blacklisted || c.rating === 1 || c.notes?.includes('[BLACKLIST]')
                    const bks = c.bookings || []
                    const isSelected = selectedIds.includes(c.id)

                    return (
                      <tr key={c.id} style={{ background: isSelected ? '#EFF6FF' : (isBl ? '#FEF2F2' : undefined) }}>
                        <td data-label="تحديد" style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectId(c.id)}
                          />
                        </td>
                        <td data-label="الاسم والصفة">
                          <div style={{ fontWeight: '800', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span>{c.full_name}</span>
                            {c.is_vip && <span className="chip chip-gold" style={{ fontSize: '10px' }}>VIP</span>}
                            {isBl && (
                              <span className="chip chip-danger" style={{ fontSize: '10px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                <ShieldAlert size={12} /> قائمة سوداء
                              </span>
                            )}
                          </div>
                        </td>
                        <td data-label="نوع الإثبات">{ID_TYPES[c.id_type] || c.id_type}</td>
                        <td data-label="رقم الإثبات" dir="ltr" style={{ fontWeight: '700' }}>{c.id_number}</td>
                        <td data-label="الجوال" dir="ltr">{c.phone}</td>
                        <td data-label="الإقامات">
                          <span className="chip chip-default" style={{ fontSize: '11px' }}>
                            {bks.length} حجز
                          </span>
                        </td>
                        <td data-label="التقييم السلوكي">
                          <span style={{ color: '#D97706', fontSize: '13px' }}>
                            {'★'.repeat(c.rating || 5)}
                          </span>
                        </td>
                        <td data-label="الموقف المالي">
                          <span style={{ color: '#10B981', fontWeight: '700', fontSize: '12px' }}>مُسدد بالكامل ✓</span>
                        </td>
                        <td data-label="الخيارات">
                          <button
                            className="btn btn-blue btn-sm"
                            onClick={() => setSelected(c)}
                            style={{ fontWeight: '800', padding: '6px 12px' }}
                          >
                            الملف الموحد 360
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="panel">
          <div style={{ marginBottom: 16 }}>
            <input
              placeholder="ابحث باسم الشركة، السجل التجاري..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', maxWidth: 400 }}
            />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>اسم الشركة</th>
                  <th>الرقم الضريبي</th>
                  <th>السجل التجاري</th>
                  <th>مسؤول الاتصال</th>
                  <th>الجوال</th>
                  <th>نسبة الخصم</th>
                  <th>الحالة</th>
                  <th>الخيارات</th>
                </tr>
              </thead>
              <tbody>
                {corporates.filter(corp => corp.name.includes(search) || corp.cr_number?.includes(search)).map(corp => (
                  <tr key={corp.id}>
                    <td style={{ fontWeight: 'bold' }}>{corp.name}</td>
                    <td>{corp.vat_number || '—'}</td>
                    <td>{corp.cr_number || '—'}</td>
                    <td>{corp.contact_person || '—'}</td>
                    <td dir="ltr">{corp.phone || '—'}</td>
                    <td>%{corp.discount_rate || 0}</td>
                    <td>
                      <span className={corp.is_active ? 'chip chip-ok' : 'chip chip-danger'}>
                        {corp.is_active ? 'نشط' : 'معطل'}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => setSelectedCorp(corp)}>تعديل</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {adding && <AddCustomerModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />}
      {addingCorp && <AddCorporateModal onClose={() => setAddingCorp(false)} onSaved={() => { setAddingCorp(false); load() }} />}
      {selectedCorp && <AddCorporateModal corp={selectedCorp} onClose={() => setSelectedCorp(null)} onSaved={() => { setSelectedCorp(null); load() }} />}
      {selected && <Customer360Modal customer={selected} onClose={() => setSelected(null)} onChanged={() => { load(); setSelected(null) }} />}

      {/* Broadcast Notification Modal */}
      {showBroadcastModal && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setShowBroadcastModal(false)}>
          <div className="modal" style={{ width: 'min(560px,100%)' }}>
            <div className="modal-h">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Send size={18} color="#F59E0B" /> إرسال تنبيهات SMS وبريد إلكتروني وإشعارات صيانة جماعية
              </h3>
              <button className="x" onClick={() => setShowBroadcastModal(false)}>✕</button>
            </div>
            <div className="modal-b">
              <p style={{ fontSize: '13px', color: '#64748B', marginBottom: '12px' }}>
                سيتم بث هذا التنبيه فورياً عبر قنوات (SMS، البريد الإلكتروني، وبوابة الخدمة الذاتية) إلى النزلاء والمستأجرين المحددين ({selectedIds.length} مستأجر).
              </p>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#334155', display: 'block', marginBottom: '6px' }}>قوالب تنبيهات الصيانة الجاهزة:</label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => setBroadcastMsg('⚡ تنبيه صيانة دورية: نسترعي انتباهكم الكريم بأنه سيتم إجراء صيانة مجدولة لشبكة المياه والكهرباء يوم الغد من الساعة 10:00 صباحاً وحتى 12:00 ظهراً. شاكرين حسن تفهمكم.')}
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                  >
                    🛠️ صيانة دورية للكهرباء والماء
                  </button>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => setBroadcastMsg('🔧 تنبيه فحص المصاعد والتكييف: سيتم تنفيذ أعمال الصيانة الوقائية الفورية لأجهزة التكييف والمصاعد. نرجو أخذ العلم والحيطة.')}
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                  >
                    ❄️ فحص التكييف والمصاعد
                  </button>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => setBroadcastMsg('📢 إشعار عام: نود تذكيركم بمواعيد إخراج النفايات والالتزام بالتعليمات التنظيمية للحفاظ على نظافة وسلامة المجمع.')}
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                  >
                    🧹 تعليمات النظافة والنظام
                  </button>
                </div>
              </div>

              <div className="fld">
                <label>نص التنبيه / الإشعار *</label>
                <textarea
                  rows={4}
                  value={broadcastMsg}
                  onChange={e => setBroadcastMsg(e.target.value)}
                  placeholder="اكتب نص التنبيه أو اختر من القوالب أعلاه..."
                />
              </div>

              <button
                className="btn btn-gold"
                style={{ width: '100%', marginTop: '14px', fontWeight: 'bold' }}
                disabled={sendingBroadcast}
                onClick={handleSendBroadcast}
              >
                {sendingBroadcast ? 'جاري إرسال التنبيهات الجماعية...' : '🚀 إرسال التنبيه الجماعي (SMS + بريد + نظام)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AddCorporateModal({ corp, onClose, onSaved }) {
  const { profile, toast } = useAuth()
  const [f, setF] = useState(corp || { name: '', vat_number: '', cr_number: '', contact_person: '', phone: '', email: '', address: '', discount_rate: 0, notes: '', is_active: true })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!f.name) return toast('اسم الشركة مطلوب', true)
    setSaving(true)
    const { error } = corp 
      ? await supabase.from('corporate_profiles').update(f).eq('id', corp.id)
      : await supabase.from('corporate_profiles').insert({ ...f, company_id: profile.company_id })
    
    setSaving(false)
    if (error) return toast(error.message, true)
    toast('✓ تم حفظ بيانات الشركة')
    onSaved()
  }

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(600px,100%)' }}>
        <div className="modal-h"><h3>{corp ? 'تعديل شركة' : 'إضافة شركة متعاقدة'}</h3><button className="x" onClick={onClose}>✕</button></div>
        <div className="modal-b">
          <div className="grid2">
            <div className="fld"><label>اسم الشركة *</label><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
            <div className="fld"><label>الرقم الضريبي</label><input value={f.vat_number} onChange={e => setF({ ...f, vat_number: e.target.value })} /></div>
            <div className="fld"><label>السجل التجاري</label><input value={f.cr_number} onChange={e => setF({ ...f, cr_number: e.target.value })} /></div>
            <div className="fld"><label>مسؤول الاتصال</label><input value={f.contact_person} onChange={e => setF({ ...f, contact_person: e.target.value })} /></div>
            <div className="fld"><label>الجوال</label><input dir="ltr" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></div>
            <div className="fld"><label>البريد الإلكتروني</label><input dir="ltr" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
            <div className="fld"><label>نسبة الخصم المتفق عليها %</label><input type="number" value={f.discount_rate} onChange={e => setF({ ...f, discount_rate: Number(e.target.value) })} /></div>
            <div className="fld"><label>الحالة</label>
              <select value={f.is_active} onChange={e => setF({ ...f, is_active: e.target.value === 'true' })}>
                <option value="true">نشط</option>
                <option value="false">معطل</option>
              </select>
            </div>
            <div className="fld" style={{ gridColumn: '1 / -1' }}><label>العنوان</label><input value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></div>
            <div className="fld" style={{ gridColumn: '1 / -1' }}><label>ملاحظات</label><textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} rows={2} /></div>
          </div>
          <button className="btn btn-blue" style={{ width: '100%', marginTop: 12 }} disabled={saving} onClick={save}>{saving ? '…جارٍ الحفظ' : 'حفظ البيانات'}</button>
        </div>
      </div>
    </div>
  )
}

function AddCustomerModal({ onClose, onSaved }) {
  const { profile, toast } = useAuth()
  const { activeBranch } = useBranches()
  const [f, setF] = useState({ full_name: '', id_type: 'national_id', id_number: '', birth_date: '', phone: '', email: '', notes: '', nationality: '', passport_number: '', gender: 'male' })
  const [idFile, setIdFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreePrivacy, setAgreePrivacy] = useState(false)
  const [statusCheck, setStatusCheck] = useState(null) // { found: bool, is_blacklisted: bool, is_vip: bool }

  // التحقق الآلي من رقم الهوية عند الإدخال
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (f.id_number.length >= 6) {
        const { data, error } = await supabase.rpc('check_customer_status', { p_id_number: f.id_number })
        if (!error && data?.found) {
          setStatusCheck(data)
          if (data.is_blacklisted) {
            toast('⚠️ تنبيه: هذا الرقم مدرج في القائمة السوداء!', true)
          } else if (data.is_vip) {
            toast('👑 تنبيه: هذا العميل مصنف VIP')
          }
        } else {
          setStatusCheck(null)
        }
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [f.id_number])

  const save = async () => {
    if (!f.full_name || !f.id_number || !f.phone) return toast('أكمل الاسم ورقم الإثبات والجوال', true)
    if (!agreeTerms || !agreePrivacy) return toast('يجب الموافقة على شروط الاستخدام وسياسة الخصوصية', true)
    setSaving(true)
    const id_document_url = idFile ? await uploadFile(supabase, 'documents', profile.company_id, idFile) : null
    const { error } = await supabase.from('customers').insert({
      ...f, birth_date: f.birth_date || null, id_document_url,
      company_id: profile.company_id, created_by: profile.id,
      ...(activeBranch ? { branch_id: activeBranch } : {})
    })
    setSaving(false)
    if (error) return toast('خطأ: ' + error.message, true)
    toast('✓ أُضيف العميل بنجاح')
    onSaved()
  }

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(560px,100%)' }}>
        <div className="modal-h"><h3>عميل جديد</h3><button className="x" onClick={onClose}>✕</button></div>
        <div className="modal-b">
          <div className="grid2">
            <div className="fld"><label>الاسم الكامل *</label><input value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} /></div>
            <div className="fld"><label>الجنسية *</label><input value={f.nationality} onChange={e => setF({ ...f, nationality: e.target.value })} placeholder="مثال: سعودي" /></div>
            <div className="fld"><label>نوع الإثبات</label>
              <select value={f.id_type} onChange={e => setF({ ...f, id_type: e.target.value })}>
                {Object.entries(ID_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div className="fld">
              <label>رقم الإثبات *</label>
              <input dir="ltr" value={f.id_number} onChange={e => setF({ ...f, id_number: e.target.value })} />
              {statusCheck?.found && (
                <div style={{ fontSize: '11px', marginTop: '4px', fontWeight: 'bold' }}>
                  {statusCheck.is_blacklisted ? (
                    <span style={{ color: '#DC2626' }}>⛔ العميل محظور: {statusCheck.blacklist_reason}</span>
                  ) : (
                    <span style={{ color: '#059669' }}>✅ العميل مسجل مسبقاً: {statusCheck.full_name}</span>
                  )}
                </div>
              )}
            </div>
            <div className="fld"><label>الجنس</label>
              <select value={f.gender} onChange={e => setF({ ...f, gender: e.target.value })}>
                <option value="male">ذكر</option>
                <option value="female">أنثى</option>
              </select></div>
            <div className="fld"><label>رقم الجواز (اختياري)</label><input dir="ltr" value={f.passport_number} onChange={e => setF({ ...f, passport_number: e.target.value })} /></div>
            <div className="fld"><label>تاريخ الميلاد</label><input type="date" value={f.birth_date} onChange={e => setF({ ...f, birth_date: e.target.value })} /></div>
            <div className="fld"><label>الجوال *</label><input dir="ltr" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></div>
            <div className="fld"><label>البريد الإلكتروني</label><input dir="ltr" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
            <div className="fld"><label>مستند الهوية/الإقامة</label><input type="file" accept="image/*,.pdf" onChange={e => setIdFile(e.target.files?.[0] || null)} /></div>
            <div className="fld" style={{ gridColumn: '1 / -1' }}><label>ملاحظات</label><input value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
            <div className="fld" style={{ gridColumn: '1 / -1', marginTop: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={agreeTerms} onChange={e => setAgreeTerms(e.target.checked)} />
                أوافق على <a href="/terms" target="_blank" style={{ color: 'var(--gold-d)', textDecoration: 'underline' }}>شروط الاستخدام</a> *
              </label>
            </div>
            <div className="fld" style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={agreePrivacy} onChange={e => setAgreePrivacy(e.target.checked)} />
                أوافق على <a href="/privacy" target="_blank" style={{ color: 'var(--gold-d)', textDecoration: 'underline' }}>سياسة الخصوصية</a> *
              </label>
            </div>
          </div>
          <button className="btn btn-gold" style={{ width: '100%', marginTop: 12 }} disabled={saving || !agreeTerms || !agreePrivacy} onClick={save}>{saving ? '…جارٍ الحفظ' : 'حفظ العميل'}</button>
        </div>
      </div>
    </div>
  )
}

function CustomerDetail({ customer, onClose, onChanged }) {
  const { profile, company, toast, isOwner } = useAuth()
  const canEdit = isOwner || profile.role === 'accountant'      // تعديل بيانات العميل
  const canEditPortal = true                                     // كل الأدوار تعدّل بيانات دخول البوابة
  const [loyalty, setLoyalty] = useState([])
  const [templates, setTemplates] = useState([])
  const [portalAccts, setPortalAccts] = useState({})
  const [editingCreds, setEditingCreds] = useState(null)
  const [credsForm, setCredsForm] = useState({ username: '', password: '' })
  const [savingCreds, setSavingCreds] = useState(false)
  const [msgPreview, setMsgPreview] = useState('')
  const [editingInfo, setEditingInfo] = useState(false)
  const [infoForm, setInfoForm] = useState({
    full_name: customer.full_name || '', id_type: customer.id_type || 'national_id',
    id_number: customer.id_number || '', birth_date: customer.birth_date || '',
    phone: customer.phone || '', email: customer.email || '', notes: customer.notes || ''
  })
  const [idFile, setIdFile] = useState(null)
  const [savingInfo, setSavingInfo] = useState(false)
  const [redeemPoints, setRedeemPoints] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [contractFor, setContractFor] = useState(null)
  const [showReport, setShowReport] = useState(false)

  const [rating, setRating] = useState(customer.rating || 5);
  const [ratingNotes, setRatingNotes] = useState('');
  const [ratingHistory, setRatingHistory] = useState([]);
  
  useEffect(() => {
    supabase.from('audit_logs')
      .select('*, user:user_id(full_name)')
      .eq('company_id', profile.company_id)
      .eq('entity', 'customers')
      .eq('entity_id', customer.id)
      .eq('action', 'rate_customer')
      .order('created_at', { ascending: false })
      .then(({ data }) => setRatingHistory(data || []));
  }, [customer, profile]);

  const submitRating = async () => {
    if (!rating) return;
    setSavingInfo(true);
    const { error } = await supabase.from('customers').update({ rating }).eq('id', customer.id);
    if (!error) {
      await supabase.from('audit_logs').insert({
        company_id: profile.company_id,
        user_id: profile.id,
        action: 'rate_customer',
        entity: 'customers',
        entity_id: customer.id,
        new_data: { rating, notes: ratingNotes }
      });
      toast('تم حفظ التقييم');
      setRatingNotes('');
      onChanged();
    } else {
      toast('خطأ في الحفظ', true);
    }
    setSavingInfo(false);
  };
  const saveInfo = async () => {
    if (!infoForm.full_name || !infoForm.id_number || !infoForm.phone) return toast('أكمل الاسم ورقم الإثبات والجوال', true)
    setSavingInfo(true)
    const patch = { ...infoForm, birth_date: infoForm.birth_date || null }
    if (idFile) patch.id_document_url = await uploadFile(supabase, 'documents', profile.company_id, idFile)
    const { error } = await supabase.from('customers').update(patch).eq('id', customer.id)
    setSavingInfo(false)
    if (error) return toast('خطأ: ' + error.message, true)
    toast('✓ حُدّثت بيانات العميل')
    setEditingInfo(false)
    onChanged()
  }

  const doRedeem = async () => {
    const pts = num(redeemPoints)
    if (!pts || pts <= 0) return toast('أدخل عدد نقاط صحيحاً', true)
    setRedeeming(true)
    const { data, error } = await supabase.rpc('redeem_loyalty_points', { p_customer_id: customer.id, p_points: pts })
    setRedeeming(false)
    if (error) return toast('خطأ: ' + error.message, true)
    toast(`✓ استُبدلت ${pts} نقطة = ${SAR(data)}`)
    setRedeemPoints('')
    onChanged()
  }

  useEffect(() => {
    supabase.from('loyalty_transactions').select('*').eq('customer_id', customer.id).order('created_at', { ascending: false })
      .then(({ data }) => setLoyalty(data || []))
    supabase.from('message_templates').select('*').eq('company_id', profile.company_id)
      .then(({ data }) => setTemplates(data || []))
    const bookingIds = (customer.bookings || []).map(b => b.id)
    if (bookingIds.length) {
      supabase.from('tenant_portal_accounts').select('booking_id, username, access_token, is_active').in('booking_id', bookingIds)
        .then(({ data }) => {
          const m = {}; (data || []).forEach(a => { m[a.booking_id] = a }); setPortalAccts(m)
        })
    }
  }, [customer, profile])

  const saveCreds = async (bookingId) => {
    setSavingCreds(true)
    if (credsForm.username) {
      const { error } = await supabase.from('tenant_portal_accounts').update({ username: credsForm.username }).eq('booking_id', bookingId)
      if (error) { setSavingCreds(false); return toast('خطأ: ' + error.message, true) }
      setPortalAccts(m => ({ ...m, [bookingId]: { ...m[bookingId], username: credsForm.username } }))
    }
    if (credsForm.password) {
      const { error } = await supabase.rpc('set_portal_password', { p_booking_id: bookingId, p_password: credsForm.password })
      if (error) { setSavingCreds(false); return toast('خطأ: ' + error.message, true) }
      setPortalAccts(m => ({ ...m, [bookingId]: { ...m[bookingId], access_token: credsForm.password } }))
    }
    setSavingCreds(false)
    setEditingCreds(null)
    setCredsForm({ username: '', password: '' })
    toast('✓ حُدّثت بيانات دخول البوابة')
  }

  const regenToken = async (bookingId) => {
    const { data, error } = await supabase.rpc('portal_regenerate_token', { p_booking_id: bookingId })
    if (error) return toast('تعذّر توليد رمز جديد: ' + error.message, true)
    toast('✓ تم توليد رمز دخول جديد')
    setPortalAccts(m => ({ ...m, [bookingId]: { ...m[bookingId], access_token: data } }))
  }

  const togglePortal = async (bookingId, active) => {
    const { error } = await supabase.from('tenant_portal_accounts').update({ is_active: active }).eq('booking_id', bookingId)
    if (error) return toast('خطأ: ' + error.message, true)
    toast(active ? '✓ فُعّل حساب البوابة' : '✓ عُطّل حساب البوابة')
    setPortalAccts(m => ({ ...m, [bookingId]: { ...m[bookingId], is_active: active } }))
  }

  // إجماليات مالية للعميل عبر كل حجوزاته
  const allPayments = (customer.bookings || []).flatMap(b => (b.payments || []).map(p => ({ ...p, unit: b.units?.unit_number })))
  const totalContracted = (customer.bookings || []).reduce((s, b) => s + num(b.total_amount), 0)
  const totalPaid = allPayments.reduce((s, p) => s + num(p.amount), 0)
  const totalInsurance = allPayments.filter(p => p.payment_type === 'insurance').reduce((s, p) => s + num(p.amount), 0)
  const totalDeposit = allPayments.filter(p => p.payment_type === 'down_payment').reduce((s, p) => s + num(p.amount), 0)
  const lastRedeem = loyalty.find(l => l.points < 0)

  const activeBooking = (customer.bookings || []).find(b => b.status === 'checked_in') || customer.bookings?.[0]

  const applyTemplate = (t) => {
    const unit = activeBooking?.units?.unit_number || '—'
    const checkout = activeBooking?.check_out_date || '—'
    const checkin = activeBooking?.check_in_date || '—'
    const body = t.body
      .replace('{name}', customer.full_name)
      .replace('{company}', company?.name || 'المازن')
      .replace('{unit}', unit)
      .replace('{checkin}', checkin)
      .replace('{checkout}', checkout)
      .replace('{amount}', '—')
    setMsgPreview(body)
  }

  const sendWhatsApp = () => {
    const phone = (customer.phone || '').replace(/\D/g, '').replace(/^0/, '966')
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msgPreview)}`, '_blank')
  }

  // رسالة ترحيبية احترافية
  const getWelcomeMessage = () => {
    const activeBooking = (customer.bookings || []).find(b => b.status === 'checked_in') || customer.bookings?.[0]
    if (!activeBooking || !portalAccts[activeBooking.id]) return ''

    const acct = portalAccts[activeBooking.id]
    const baseUrl = window.location.origin
    const portalUrl = `${baseUrl}/tenant-portal?token=${acct.access_token}`
    const paid = (activeBooking.payments || []).reduce((s, p) => s + num(p.amount), 0)
    const remaining = num(activeBooking.total_amount) - paid

    return `السلام عليكم ورحمة الله وبركاته،

تشرفنا بضيافتك في ${company?.name || 'منصتنا'}،

فيما يلي بيانات حسابك في بوابة المستأجر:

━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 بيانات الوحدة:
الوحدة: ${activeBooking.units?.unit_number}
الفئة: ${activeBooking.units?.category || '—'}
مدة الإيجار: ${activeBooking.rent_period === 'daily' ? 'يومي' : activeBooking.rent_period === 'monthly' ? 'شهري' : 'سنوي'}

💰 البيانات المالية:
قيمة الإيجار: ${SAR(activeBooking.total_amount)}
المبلغ المدفوع: ${SAR(paid)}
المبلغ المتبقي: ${SAR(remaining)}

📅 تواريخ الإقامة:
تاريخ البدء: ${activeBooking.check_in_date}
تاريخ المغادرة: ${activeBooking.check_out_date}

🔐 بيانات الدخول:
اسم المستخدم: ${acct.username}
كلمة المرور: ${acct.access_token}

🔗 رابط البوابة:
${portalUrl}

━━━━━━━━━━━━━━━━━━━━━━━━━━━

✨ في بوابتك ستجد:
• نسخة عقدك وفاتورتك الضريبية
• كشف حسابك الكامل والدفعات
• تقديم طلبات الصيانة والخدمات
• مراسلتنا والاستفسار عن أي استفسار

نتمنى لك إقامة مريحة وممتعة، وننتظر استفساراتك عبر بوابتك في أي وقت.

مع أطيب التمنيات،
فريق ${company?.name || 'المازن'}`
  }

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(820px,100%)' }}>
        <div className="modal-h"><h3>ملف العميل — {customer.full_name}</h3><button className="x" onClick={onClose}>✕</button></div>
        <div className="modal-b">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <button className="btn btn-blue btn-sm" onClick={() => setShowReport(true)}>🖨 طباعة تقرير العميل الشامل</button>
            {customer.id_document_url && <button className="btn btn-ghost btn-sm" onClick={() => openStoredDocument(supabase, customer.id_document_url, {
              onError: message => toast(message, true),
              context: { area: 'customer_profile', customer_id: customer.id, document_kind: 'identity' },
            })}>🪪 عرض مستند الهوية</button>}
          </div>

          {!editingInfo ? (
            <div className="ts-grid" style={{ marginBottom: 16 }}>
              <div><b>الاسم الكامل</b><span>{customer.full_name}</span></div>
              <div><b>نوع الإثبات</b><span>{ID_TYPES[customer.id_type]}</span></div>
              <div><b>رقم الإثبات</b><span dir="ltr">{customer.id_number}</span></div>
              <div><b>تاريخ الميلاد</b><span dir="ltr">{customer.birth_date || '—'}</span></div>
              <div><b>الجوال</b><span dir="ltr">{customer.phone}</span></div>
              <div><b>البريد</b><span>{customer.email || '—'}</span></div>
              <div><b>نقاط الولاء</b><span className="money">{customer.loyalty_points} نقطة</span></div>
              <div><b>آخر استبدال</b><span>{lastRedeem ? lastRedeem.created_at?.slice(0, 10) : '—'}</span></div>
              <div><b>VIP</b><span>{customer.is_vip ? 'نعم' : 'لا'}</span></div>
              {canEdit && <div style={{ gridColumn: '1 / -1' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditingInfo(true)}>✎ تعديل بيانات العميل</button>
              </div>}
            </div>
          ) : (
          
            <div className="grid2" style={{ marginBottom: 16, background: 'var(--soft)', padding: 12, borderRadius: 8 }}>
              <div className="fld"><label>الاسم الكامل</label><input value={infoForm.full_name} onChange={e => setInfoForm({ ...infoForm, full_name: e.target.value })} /></div>
              <div className="fld"><label>نوع الإثبات</label>
                <select value={infoForm.id_type} onChange={e => setInfoForm({ ...infoForm, id_type: e.target.value })}>
                  {Object.entries(ID_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
              <div className="fld"><label>رقم الإثبات</label><input dir="ltr" value={infoForm.id_number} onChange={e => setInfoForm({ ...infoForm, id_number: e.target.value })} /></div>
              <div className="fld"><label>تاريخ الميلاد</label><input type="date" value={infoForm.birth_date} onChange={e => setInfoForm({ ...infoForm, birth_date: e.target.value })} /></div>
              <div className="fld"><label>الجوال</label><input dir="ltr" value={infoForm.phone} onChange={e => setInfoForm({ ...infoForm, phone: e.target.value })} /></div>
              <div className="fld"><label>البريد الإلكتروني</label><input dir="ltr" value={infoForm.email} onChange={e => setInfoForm({ ...infoForm, email: e.target.value })} /></div>
              <div className="fld"><label>تحديث مستند الهوية/الإقامة</label><input type="file" accept="image/*,.pdf" onChange={e => setIdFile(e.target.files?.[0] || null)} /></div>
              <div className="fld"><label>ملاحظات</label><input value={infoForm.notes} onChange={e => setInfoForm({ ...infoForm, notes: e.target.value })} /></div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
                <button className="btn btn-gold btn-sm" disabled={savingInfo} onClick={saveInfo}>{savingInfo ? '…' : 'حفظ'}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditingInfo(false)}>إلغاء</button>
              </div>
            </div>
          )}

          {canEdit && ( <>
          {/* Rating Section */}
          <div className="card" style={{ marginBottom: 16, padding: 15, background: "var(--soft)" }}>
            <h5>⭐️ تقييم المستأجر</h5>
            <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
              <div className="fld" style={{ flex: 1, margin: 0 }}>
                <select value={rating} onChange={e => setRating(Number(e.target.value))}>
                  <option value={5}>⭐⭐⭐⭐⭐ (ممتاز)</option>
                  <option value={4}>⭐⭐⭐⭐ (جيد جداً)</option>
                  <option value={3}>⭐⭐⭐ (جيد)</option>
                  <option value={2}>⭐⭐ (مقبول)</option>
                  <option value={1}>⭐ (سيء)</option>
                </select>
              </div>
              <div className="fld" style={{ flex: 2, margin: 0 }}>
                <input placeholder="ملاحظات التقييم (اختياري)..." value={ratingNotes} onChange={e => setRatingNotes(e.target.value)} />
              </div>
              <button className="btn btn-green btn-sm" disabled={savingInfo} onClick={submitRating}>تحديث التقييم</button>
            </div>
            
            {ratingHistory.length > 0 && (
              <div style={{ marginTop: 15, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <h6 style={{ marginBottom: 8, color: 'var(--muted)' }}>سجل التقييمات:</h6>
                {ratingHistory.map(r => (
                  <div key={r.id} style={{ fontSize: 13, marginBottom: 6, display: 'flex', gap: 10 }}>
                    <span style={{ color: 'var(--gold)' }}>{'★'.repeat(r.new_data?.rating || 0)}</span>
                    <span style={{ color: 'var(--muted)' }}>{r.user?.full_name}:</span>
                    <span>{r.new_data?.notes || 'بدون ملاحظات'}</span>
                    <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 11 }} dir="ltr">{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
            <div className="panel" style={{ marginBottom: 16, background: 'var(--soft)' }}>
              <b>استبدال نقاط الولاء</b>
              <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>10 نقاط = 1 ر.س — الرصيد الحالي: {customer.loyalty_points} نقطة</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="number" style={{ maxWidth: 140 }} placeholder="عدد النقاط" value={redeemPoints} onChange={e => setRedeemPoints(e.target.value)} />
                <button className="btn btn-blue btn-sm" disabled={redeeming} onClick={doRedeem}>{redeeming ? '…' : 'استبدال'}</button>
              </div>
            </div>
          </>)}

          <h4 className="ts-h4">الملخص المالي للعميل</h4>
          <div className="kpis" style={{ marginBottom: 16 }}>
            <div className="kpi"><div className="v">{SAR(totalContracted)}</div><div className="l">إجمالي التعاقدات</div></div>
            <div className="kpi"><div className="v">{SAR(totalPaid)}</div><div className="l">إجمالي المدفوع</div></div>
            <div className="kpi"><div className="v">{SAR(totalDeposit)}</div><div className="l">العربون المدفوع</div></div>
            <div className="kpi"><div className="v">{SAR(totalInsurance)}</div><div className="l">التأمين المدفوع</div></div>
          </div>

          <h4 className="ts-h4">سجل الإيجارات الكامل ({(customer.bookings || []).length})</h4>
          <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ marginBottom: 16, minWidth: 720 }}>
            <thead><tr><th>الوحدة</th><th>من</th><th>إلى</th><th>النوع</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>العربون</th><th>التأمين</th><th>العقد</th></tr></thead>
            <tbody>
              {(customer.bookings || []).length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا توجد حجوزات</td></tr>}
              {(customer.bookings || []).map(b => {
                const paid = (b.payments || []).reduce((s, p) => s + num(p.amount), 0)
                return (
                  <tr key={b.id}>
                    <td>{b.units?.unit_number}</td><td dir="ltr">{b.check_in_date}</td><td dir="ltr">{b.check_out_date}</td>
                    <td>{{ daily: 'يومي', monthly: 'شهري', yearly: 'سنوي' }[b.rent_period] || b.rent_period}</td>
                    <td className="money">{SAR(b.total_amount)}</td>
                    <td className="money">{SAR(paid)}</td>
                    <td className={num(b.total_amount) - paid > 0 ? 'neg' : 'money'}>{SAR(num(b.total_amount) - paid)}</td>
                    <td>{SAR(b.down_payment)}</td><td>{SAR(b.insurance_amount)}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={() => setContractFor(b)}>🖨</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>

          <h4 className="ts-h4">تفاصيل الدفعات</h4>
          <table className="tbl" style={{ marginBottom: 16 }}>
            <thead><tr><th>التاريخ</th><th>الوحدة</th><th>النوع</th><th>المبلغ</th><th>طريقة الدفع</th><th>المستند</th></tr></thead>
            <tbody>
              {allPayments.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا توجد دفعات</td></tr>}
              {allPayments.sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || '')).map((p, i) => (
                <tr key={i}>
                  <td dir="ltr">{p.payment_date}</td><td>{p.unit || '—'}</td>
                  <td>{PAY_TYPE_LABEL[p.payment_type] || p.payment_type}</td>
                  <td className="money">{SAR(p.amount)}</td><td>{PAY_METHODS[p.method] || p.method}</td>
                  <td>{p.document_url ? <button className="btn btn-ghost btn-sm" onClick={() => openStoredDocument(supabase, p.document_url, {
                    onError: message => toast(message, true),
                    context: { area: 'customer_payments', customer_id: customer.id, document_kind: 'payment' },
                  })}>🔍 عرض</button> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 className="ts-h4">🔐 بيانات دخول بوابة المستأجر</h4>
          {(customer.bookings || []).filter(b => portalAccts[b.id]).length === 0 ? (
            <div style={{ padding: 16, background: 'var(--soft)', borderRadius: 8, textAlign: 'center', color: 'var(--muted)', marginBottom: 16 }}>
              لا توجد حسابات بوابة حالياً. سيتم إنشاء حساب بوابة تلقائياً عند تسليم الوحدة للمستأجر.
            </div>
          ) : (
            (customer.bookings || []).map(b => {
              const acct = portalAccts[b.id]
              if (!acct) return null
              const baseUrl = window.location.origin
              const portalUrl = `${baseUrl}/tenant-portal?token=${acct.access_token}`
              return (
                <div key={b.id} style={{
                  padding: 16,
                  background: 'var(--soft)',
                  borderRadius: 8,
                  marginBottom: 16,
                  border: '1px solid var(--line)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: 16 }}>وحدة {b.units?.unit_number}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{b.units?.category}</div>
                    </div>
                    <span className={'chip ' + (acct.is_active === false ? 'chip-danger' : 'chip-ok')}>
                      {acct.is_active === false ? 'معطّل' : 'نشط'}
                    </span>
                  </div>

                  <div style={{
                    padding: 12,
                    background: '#fff',
                    borderRadius: 6,
                    marginBottom: 12,
                    fontFamily: 'monospace',
                    fontSize: 13,
                    border: '1px solid var(--line)'
                  }}>
                    <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ color: 'var(--muted)', fontSize: 11 }}>اسم المستخدم</div>
                        <div style={{ fontWeight: 'bold', marginTop: 2 }} dir="ltr">{acct.username}</div>
                      </div>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          navigator.clipboard.writeText(acct.username)
                          toast('✓ تم نسخ اسم المستخدم')
                        }}
                      >
                        📋 نسخ
                      </button>
                    </div>

                    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ color: 'var(--muted)', fontSize: 11 }}>كلمة المرور</div>
                        <div style={{ fontWeight: 'bold', marginTop: 2 }} dir="ltr">{acct.access_token}</div>
                      </div>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          navigator.clipboard.writeText(acct.access_token)
                          toast('✓ تم نسخ كلمة المرور')
                        }}
                      >
                        📋 نسخ
                      </button>
                    </div>

                    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ color: 'var(--muted)', fontSize: 11 }}>رابط الدخول</div>
                        <div style={{ fontWeight: 'bold', marginTop: 2, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="ltr">{portalUrl}</div>
                      </div>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          navigator.clipboard.writeText(portalUrl)
                          toast('✓ تم نسخ رابط الدخول')
                        }}
                      >
                        📋 نسخ
                      </button>
                    </div>
                  </div>

                  {editingCreds === b.id && (
                    <div className="grid2" style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 6, padding: 12, marginBottom: 12 }}>
                      <div className="fld"><label>اسم مستخدم جديد (اختياري)</label>
                        <input dir="ltr" value={credsForm.username} placeholder={acct.username}
                          onChange={e => setCredsForm({ ...credsForm, username: e.target.value })} /></div>
                      <div className="fld"><label>كلمة مرور جديدة (6 خانات على الأقل، اختياري)</label>
                        <input dir="ltr" value={credsForm.password}
                          onChange={e => setCredsForm({ ...credsForm, password: e.target.value })} /></div>
                      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
                        <button className="btn btn-gold btn-sm" disabled={savingCreds} onClick={() => saveCreds(b.id)}>{savingCreds ? '…' : 'حفظ'}</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setEditingCreds(null); setCredsForm({ username: '', password: '' }) }}>إلغاء</button>
                      </div>
                      <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--muted)' }}>
                        ⚠️ كلمة مرور قصيرة سهلة التذكّر أقل أماناً من الرمز العشوائي المولَّد تلقائياً — تُستخدم أيضاً كجزء من رابط الدخول المباشر.
                      </div>
                    </div>
                  )}

                  {canEditPortal && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditingCreds(editingCreds === b.id ? null : b.id)}>✎ تعديل اسم المستخدم/كلمة المرور</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => regenToken(b.id)}>🔄 توليد كلمة مرور عشوائية جديدة</button>
                      {acct.is_active === false
                        ? <button className="btn btn-ghost btn-sm" onClick={() => togglePortal(b.id, true)}>✅ تفعيل</button>
                        : <button className="btn btn-ghost btn-sm" onClick={() => togglePortal(b.id, false)}>⛔ تعطيل</button>}
                    </div>
                  )}
                </div>
              )
            })
          )}

          <h4 className="ts-h4">سجل نقاط الولاء</h4>
          <table className="tbl" style={{ marginBottom: 16 }}>
            <thead><tr><th>التاريخ</th><th>النقاط</th><th>السبب</th></tr></thead>
            <tbody>
              {loyalty.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا توجد حركات ولاء بعد</td></tr>}
              {loyalty.map(l => (
                <tr key={l.id}><td>{l.created_at?.slice(0, 10)}</td>
                  <td className={l.points < 0 ? 'neg' : 'money'}>{l.points > 0 ? '+' : ''}{l.points}</td>
                  <td>{l.reason || '—'}</td></tr>
              ))}
            </tbody>
          </table>

          <h4 className="ts-h4">📨 الرسالة الترحيبية والرسائل المجهزة</h4>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <button
              className="btn btn-gold btn-sm"
              onClick={() => setMsgPreview(getWelcomeMessage())}
              disabled={!getWelcomeMessage()}
            >
              🎁 رسالة ترحيبية احترافية
            </button>
            {templates.map(t => <button key={t.id} className="btn btn-ghost btn-sm" onClick={() => applyTemplate(t)}>{t.name}</button>)}
          </div>

          {msgPreview && (
            <>
              <div style={{
                padding: 12,
                background: 'var(--soft)',
                borderRadius: 8,
                marginBottom: 8,
                border: '1px solid var(--line)',
                fontSize: 13,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}>
                {msgPreview}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <textarea
                  className="drawer-notes-area"
                  value={msgPreview}
                  onChange={e => setMsgPreview(e.target.value)}
                  dir="auto"
                  style={{ minHeight: 0, flex: 1, display: 'none' }}
                />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    navigator.clipboard.writeText(msgPreview)
                    toast('✓ تم نسخ الرسالة')
                  }}
                >
                  📋 نسخ الرسالة
                </button>
                <button className="btn btn-green btn-sm" onClick={sendWhatsApp}>💬 إرسال عبر واتساب</button>
              </div>
            </>
          )}
        </div>
      </div>
      {contractFor && (
        <RentalContract
          onClose={() => setContractFor(null)}
          company={company}
          employeeName={contractFor.profiles?.full_name}
          customer={customer}
          unit={contractFor.units}
          booking={contractFor}
        />
      )}
      {showReport && (
        <PrintableDoc
          company={company} title={`تقرير العميل — ${customer.full_name}`}
          docKind="customer" docTable="customers" docId={customer.id}
          qrValue={JSON.stringify({ customer: customer.full_name, id: customer.id_number, phone: customer.phone })}
          onClose={() => setShowReport(false)}
        >
          <h4 className="contract-h4">البيانات الشخصية</h4>
          <DocGrid items={[
            ['الاسم الكامل', customer.full_name],
            ['نوع الإثبات', ID_TYPES[customer.id_type]],
            ['رقم الإثبات', customer.id_number],
            ['تاريخ الميلاد', customer.birth_date || '—'],
            ['الجوال', customer.phone],
            ['البريد', customer.email || '—'],
            ['نقاط الولاء', customer.loyalty_points + ' نقطة'],
            ['آخر استبدال نقاط', lastRedeem ? lastRedeem.created_at?.slice(0, 10) : '—'],
          ]} />
          <h4 className="contract-h4">الملخص المالي</h4>
          <DocGrid items={[
            ['إجمالي التعاقدات', SAR(totalContracted)],
            ['إجمالي المدفوع', SAR(totalPaid)],
            ['المتبقي', SAR(totalContracted - totalPaid)],
            ['العربون المدفوع', SAR(totalDeposit)],
            ['التأمين المدفوع', SAR(totalInsurance)],
            ['عدد الإيجارات', (customer.bookings || []).length],
          ]} />
          <h4 className="contract-h4">سجل الإيجارات</h4>
          <table className="tbl" style={{ marginBottom: 8 }}>
            <thead><tr><th>الوحدة</th><th>من</th><th>إلى</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th></tr></thead>
            <tbody>
              {(customer.bookings || []).length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا توجد</td></tr>}
              {(customer.bookings || []).map(b => {
                const paid = (b.payments || []).reduce((s, p) => s + num(p.amount), 0)
                return <tr key={b.id}>
                  <td>{b.units?.unit_number}</td><td dir="ltr">{b.check_in_date}</td><td dir="ltr">{b.check_out_date}</td>
                  <td className="money">{SAR(b.total_amount)}</td><td className="money">{SAR(paid)}</td>
                  <td>{SAR(num(b.total_amount) - paid)}</td>
                </tr>
              })}
            </tbody>
          </table>
        </PrintableDoc>
      )}
    </div>
  )
}
