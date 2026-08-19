import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { SAR, num, today, PAY_METHODS, uploadFile, openStoredDocument } from '../lib/helpers'
import CustomerDocVault, { DOC_TYPES } from './CustomerDocVault'
import RentalContract from './RentalContract'
import PrintableDoc, { DocGrid } from './PrintableDoc'
import { QRCodeSVG } from 'qrcode.react'
import {
  X, User, Phone, IdCard, Calendar, Star, ShieldAlert, Award, FileText,
  DollarSign, CheckCircle2, AlertTriangle, Printer, MessageSquare, Key, RefreshCw,
  Edit, Plus, Trash2, Tag, Lock, Unlock, Shield, Heart, QrCode
} from 'lucide-react'

const PAY_TYPE_LABEL = { rent: 'إيجار', down_payment: 'عربون', insurance: 'تأمين', penalty: 'غرامة', other: 'أخرى' }

const BEHAVIOR_TRAITS = [
  { id: 'clean', label: '🧹 المحافظة على النظافة' },
  { id: 'quiet', label: '🤫 هادئ ولا يصدر إزعاج' },
  { id: 'punctual', label: '⏰ ملتزم بمواعيد الدخول والخروج' },
  { id: 'late_pay', label: '⚠️ يتأخر في سداد المستحقات' },
  { id: 'damage', label: '🚨 إتلاف أثاث أو محتويات الوحدة' },
  { id: 'complaints', label: '📢 وجود شكاوى من الجيران' }
]

export default function Customer360Modal({ customer, onClose, onChanged }) {
  const { profile, company, toast, isOwner } = useAuth()
  const [activeTab, setActiveTab] = useState('financial') // 'financial' | 'bookings' | 'documents' | 'portal' | 'loyalty'

  // Blacklist state
  const [showBlacklistModal, setShowBlacklistModal] = useState(false)
  const [blacklistForm, setBlacklistForm] = useState({
    reason: '',
    debtAmount: ''
  })
  const [savingBlacklist, setSavingBlacklist] = useState(false)

  // Edit profile state
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({
    full_name: customer.full_name || '',
    id_type: customer.id_type || 'national_id',
    id_number: customer.id_number || '',
    phone: customer.phone || '',
    email: customer.email || '',
    birth_date: customer.birth_date || '',
    notes: customer.notes || '',
    is_vip: customer.is_vip || false
  })
  const [savingProfile, setSavingProfile] = useState(false)

  // Behavioral Rating state
  const [ratingVal, setRatingVal] = useState(customer.rating || 5)
  const [ratingNotes, setRatingNotes] = useState('')
  const [selectedTraits, setSelectedTraits] = useState([])
  const [savingRating, setSavingRating] = useState(false)
  const [ratingHistory, setRatingHistory] = useState([])

  // Loyalty & Portal states
  const [loyaltyHistory, setLoyaltyHistory] = useState([])
  const [redeemPts, setRedeemPts] = useState('')
  const [redeeming, setRedeeming] = useState(false)

  const [portalAccounts, setPortalAccounts] = useState({})
  const [editingCredsId, setEditingCredsId] = useState(null)
  const [credsForm, setCredsForm] = useState({ username: '', password: '' })
  const [msgPreview, setMsgPreview] = useState('')

  // Report & Print states
  const [showReport, setShowReport] = useState(false)
  const [selectedContractBk, setSelectedContractBk] = useState(null)

  // Load audit logs & loyalty
  useEffect(() => {
    if (!customer?.id) return
    // Rating audit logs
    supabase.from('audit_logs')
      .select('*, user:user_id(full_name)')
      .eq('company_id', profile.company_id)
      .eq('entity', 'customers')
      .eq('entity_id', customer.id)
      .eq('action', 'rate_customer')
      .order('created_at', { ascending: false })
      .then(({ data }) => setRatingHistory(data || []))

    // Loyalty transactions
    supabase.from('loyalty_transactions')
      .select('*')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setLoyaltyHistory(data || []))

    // Portal Accounts
    const bookingIds = (customer.bookings || []).map(b => b.id)
    if (bookingIds.length) {
      supabase.from('tenant_portal_accounts')
        .select('booking_id, username, access_token, is_active')
        .in('booking_id', bookingIds)
        .then(({ data }) => {
          const m = {}
          ;(data || []).forEach(a => { m[a.booking_id] = a })
          setPortalAccounts(m)
        })
    }
  }, [customer, profile])

  // Computed Financial Metrics
  const bookings = customer.bookings || []
  const allPayments = bookings.flatMap(b => (b.payments || []).map(p => ({ ...p, unit_number: b.units?.unit_number })))
  // الحجوزات الملغاة لا تُحتسب ضمن الالتزامات التعاقدية
  const activeBookings = bookings.filter(b => b.status !== 'cancelled')
  const totalContracted = activeBookings.reduce((sum, b) => sum + num(b.total_amount), 0)
  const totalDownPayment = allPayments.filter(p => p.payment_type === 'down_payment').reduce((s, p) => s + num(p.amount), 0)
  const totalInsurance = allPayments.filter(p => p.payment_type === 'insurance').reduce((s, p) => s + num(p.amount), 0)
  const totalRefunded = allPayments.filter(p => p.payment_type === 'refund').reduce((s, p) => s + num(p.amount), 0)
  // إجمالي المسدد فعلياً مقابل قيمة العقد: يستثني مبالغ التأمين (أمانة مستردة) ويخصم المبالغ المرتجعة
  const totalPaid = allPayments
    .filter(p => p.payment_type !== 'insurance' && p.payment_type !== 'refund')
    .reduce((sum, p) => sum + num(p.amount), 0) - totalRefunded
  const totalPendingDebt = Math.max(0, Math.round((totalContracted - totalPaid) * 100) / 100)


  // Check Blacklist Status
  const isBlacklisted = customer.is_blacklisted || customer.rating === 1 || customer.notes?.includes('[BLACKLIST]') || false
  const blacklistReason = customer.blacklist_reason || (customer.notes?.match(/\[BLACKLIST_REASON:(.*?)\]/)?.[1]) || ''

  // Blacklist Toggle Action
  const handleToggleBlacklist = async (status) => {
    setSavingBlacklist(true)
    try {
      const reason = blacklistForm.reason.trim()
      let updatedNotes = customer.notes || ''
      updatedNotes = updatedNotes.replace(/\[BLACKLIST\].*?(\[\/BLACKLIST\]|$)/g, '').trim()

      if (status) {
        updatedNotes = `${updatedNotes} [BLACKLIST] [BLACKLIST_REASON:${reason}]`.trim()
      }

      // Try updating column directly
      const patch = {
        is_blacklisted: status,
        blacklist_reason: status ? reason : null,
        outstanding_amount: status && blacklistForm.debtAmount ? num(blacklistForm.debtAmount) : 0,
        notes: updatedNotes,
        rating: status ? 1 : (customer.rating === 1 ? 5 : customer.rating)
      }

      const { error } = await supabase.from('customers').update(patch).eq('id', customer.id)
      if (error) {
        // Fallback update without new schema columns if not present
        await supabase.from('customers').update({
          notes: updatedNotes,
          rating: status ? 1 : 5
        }).eq('id', customer.id)
      }

      // Audit Log
      await supabase.from('audit_logs').insert({
        company_id: profile.company_id,
        user_id: profile.id,
        action: status ? 'blacklist_customer' : 'unblacklist_customer',
        entity: 'customers',
        entity_id: customer.id,
        new_data: { status, reason, debt: blacklistForm.debtAmount }
      })

      toast(status ? '⛔ تم إدراج العميل في القائمة السوداء' : '✅ تم إلغاء حظر العميل وإزالته من القائمة السوداء')
      setShowBlacklistModal(false)
      if (onChanged) onChanged()
    } catch (err) {
      toast('خطأ في العملية: ' + err.message, true)
    } finally {
      setSavingBlacklist(false)
    }
  }

  // Save Profile Info
  const handleSaveProfile = async () => {
    if (!profileForm.full_name || !profileForm.id_number || !profileForm.phone) {
      return toast('الاسم ورقم الإثبات والجوال حقول إجبارية', true)
    }
    setSavingProfile(true)
    try {
      const { error } = await supabase.from('customers').update({
        ...profileForm,
        birth_date: profileForm.birth_date || null
      }).eq('id', customer.id)

      if (error) throw error
      toast('✓ تم تحديث البيانات الأساسية للعميل')
      setEditingProfile(false)
      if (onChanged) onChanged()
    } catch (err) {
      toast('خطأ أثناء حفظ البيانات: ' + err.message, true)
    } finally {
      setSavingProfile(false)
    }
  }

  // Submit Behavioral Rating
  const handleSubmitRating = async () => {
    setSavingRating(true)
    try {
      const { error } = await supabase.from('customers').update({ rating: ratingVal }).eq('id', customer.id)
      if (!error) {
        await supabase.from('audit_logs').insert({
          company_id: profile.company_id,
          user_id: profile.id,
          action: 'rate_customer',
          entity: 'customers',
          entity_id: customer.id,
          new_data: { rating: ratingVal, traits: selectedTraits, notes: ratingNotes }
        })
        toast('✓ تم حفظ التقييم السلوكي للعميل')
        setRatingNotes('')
        if (onChanged) onChanged()
      }
    } catch (err) {
      toast('خطأ في حفظ التقييم', true)
    } finally {
      setSavingRating(false)
    }
  }

  // Redeem Loyalty Points
  const handleRedeemPoints = async () => {
    const pts = num(redeemPts)
    if (!pts || pts <= 0) return toast('أدخل عدد نقاط صحيح', true)
    setRedeeming(true)
    try {
      const { data, error } = await supabase.rpc('redeem_loyalty_points', {
        p_customer_id: customer.id,
        p_points: pts
      })
      if (error) throw error
      toast(`✓ تم استبدال ${pts} نقطة = ${SAR(data)}`)
      setRedeemPts('')
      if (onChanged) onChanged()
    } catch (err) {
      toast('خطأ: ' + err.message, true)
    } finally {
      setRedeeming(false)
    }
  }

  // Generate WhatsApp Financial Statement Text
  const getFinancialStatementText = () => {
    return `كشف حساب موحد — ${company?.name || 'المازن'}
👤 العميل: ${customer.full_name}
🆔 رقم الإثبات: ${customer.id_number}

📊 الملخص المالي:
• إجمالي التعاقدات: ${SAR(totalContracted)}
• إجمالي المدفوعات: ${SAR(totalPaid)}
• المتبقي / الديون: ${SAR(totalPendingDebt)}
• عدد الإقامات الحالية والحسابات: ${bookings.length} حجز

شرفنا بخدمتكم دائماً.`
  }

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(980px, 96vw)', maxHeight: '92vh', overflow: 'hidden', padding: 0, borderRadius: '24px' }}>

        {/* 360 Header Bar */}
        <div style={{
          padding: '20px 24px',
          background: isBlacklisted
            ? 'linear-gradient(135deg, #7F1D1D 0%, #1E1B4B 100%)'
            : 'linear-gradient(135deg, #0A192F 0%, #1E3A8A 100%)',
          color: '#ffffff',
          borderBottom: '3px solid #C9A84C',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
          flexWrap: 'wrap'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: isBlacklisted ? '#EF4444' : 'linear-gradient(135deg, #F5D97E, #B8862F)',
              color: isBlacklisted ? '#ffffff' : '#0A192F',
              display: 'grid',
              placeItems: 'center',
              fontWeight: '900',
              fontSize: '22px',
              boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
              flexShrink: 0
            }}>
              {isBlacklisted ? <ShieldAlert size={28} /> : customer.full_name?.[0] || '👤'}
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '900', letterSpacing: '-0.3px' }}>
                  {customer.full_name}
                </h2>
                {customer.is_vip && <span className="chip chip-gold">👑 VIP</span>}
                {isBlacklisted ? (
                  <span className="chip chip-danger" style={{ fontWeight: '800', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ShieldAlert size={14} /> القائمة السوداء (محظور)
                  </span>
                ) : (
                  <span className="chip chip-ok" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CheckCircle2 size={14} /> عميل نشط
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#93C5FD', marginTop: '4px', flexWrap: 'wrap' }}>
                <span><IdCard size={13} /> {DOC_TYPES[customer.id_type] || 'إثبات'}: <strong dir="ltr" style={{ color: '#fff' }}>{customer.id_number}</strong></span>
                <span><Phone size={13} /> الجوال: <strong dir="ltr" style={{ color: '#fff' }}>{customer.phone}</strong></span>
                {customer.email && <span>البريد: <strong style={{ color: '#fff' }}>{customer.email}</strong></span>}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              className="btn btn-blue btn-sm"
              onClick={() => setShowReport(true)}
              style={{ fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Printer size={15} /> طباعة تقرير 360
            </button>

            {isBlacklisted ? (
              <button
                className="btn btn-sm"
                onClick={() => handleToggleBlacklist(false)}
                style={{ background: '#10B981', color: '#fff', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Unlock size={15} /> إزالة من القائمة السوداء
              </button>
            ) : (
              <button
                className="btn btn-sm"
                onClick={() => setShowBlacklistModal(true)}
                style={{ background: '#EF4444', color: '#fff', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <ShieldAlert size={15} /> إدراج بالقائمة السوداء
              </button>
            )}

            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.15)',
                border: 'none',
                color: '#fff',
                borderRadius: '10px',
                width: '36px',
                height: '36px',
                cursor: 'pointer',
                display: 'grid',
                placeItems: 'center'
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Modal Main Body Scrollable Area */}
        <div style={{ padding: '20px 24px', maxHeight: 'calc(92vh - 100px)', overflowY: 'auto' }}>

          {/* 360 Top Financial & Operational KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginBottom: '20px' }}>
            <div className="kpi color-dark">
              <div className="v">{bookings.length} حجز</div>
              <div className="l">إجمالي الحجوزات السابقة</div>
            </div>

            <div className="kpi color-default">
              <div className="v">{SAR(totalContracted)}</div>
              <div className="l">إجمالي التعاقدات</div>
            </div>

            <div className="kpi color-green">
              <div className="v">{SAR(totalPaid)}</div>
              <div className="l">إجمالي المبالغ المدفوعة</div>
            </div>

            <div className={`kpi ${totalPendingDebt > 0 ? 'color-gold' : 'color-default'}`}>
              <div className="v" style={{ color: totalPendingDebt > 0 ? '#DC2626' : undefined }}>
                {SAR(totalPendingDebt)}
              </div>
              <div className="l">المبالغ المعلقة / الديون</div>
            </div>

            <div className="kpi color-default">
              <div className="v" style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#D97706' }}>
                {'★'.repeat(customer.rating || 5)}
              </div>
              <div className="l">التقييم السلوكي للعميل</div>
            </div>
          </div>

          {/* Blacklist Warning Box if Blacklisted */}
          {isBlacklisted && (
            <div style={{
              background: '#FEF2F2',
              border: '2px dashed #EF4444',
              borderRadius: '16px',
              padding: '16px',
              marginBottom: '20px',
              display: 'flex',
              gap: '12px',
              alignItems: 'center'
            }}>
              <ShieldAlert size={32} color="#DC2626" style={{ flexShrink: 0 }} />
              <div>
                <strong style={{ fontSize: '15px', color: '#991B1B', display: 'block', marginBottom: '2px' }}>
                  ⚠️ العميل مدرج في القائمة السوداء (Blacklist Alert)
                </strong>
                <span style={{ fontSize: '13px', color: '#B91C1C' }}>
                  سبب الحظر: {blacklistReason || 'عدم الالتزام أو وجود مطالبات مالية معلقة.'}
                </span>
              </div>
            </div>
          )}

          {/* Nav Tabs */}
          <div className="acc-tabs" style={{ marginBottom: '20px', flexWrap: 'wrap' }}>
            <button
              className={activeTab === 'financial' ? 'on' : ''}
              onClick={() => setActiveTab('financial')}
            >
              📊 الموقف المالي والكشف
            </button>
            <button
              className={activeTab === 'bookings' ? 'on' : ''}
              onClick={() => setActiveTab('bookings')}
            >
              🏢 سجل الحجوزات ({bookings.length})
            </button>
            <button
              className={activeTab === 'documents' ? 'on' : ''}
              onClick={() => setActiveTab('documents')}
            >
              🪪 أرشيف الوثائق والخدمات
            </button>
            <button
              className={activeTab === 'portal' ? 'on' : ''}
              onClick={() => setActiveTab('portal')}
            >
              🔐 بوابة المستأجر والرسائل
            </button>
            <button
              className={activeTab === 'loyalty' ? 'on' : ''}
              onClick={() => setActiveTab('loyalty')}
            >
              🌟 الولاء والتقييم السلوكي
            </button>
            <button
              className={activeTab === 'qrcode' ? 'on' : ''}
              onClick={() => setActiveTab('qrcode')}
            >
              📱 بطاقة QR للتسكين والدخول
            </button>
          </div>

          {/* TAB 1: Financial Ledger */}
          {activeTab === 'financial' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h4 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#0A192F' }}>
                  كشف الحساب والدفعات التفصيلية
                </h4>
                <button
                  className="btn btn-green btn-sm"
                  onClick={() => {
                    const text = getFinancialStatementText()
                    const phone = (customer.phone || '').replace(/\D/g, '').replace(/^0/, '966')
                    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank')
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <MessageSquare size={14} /> إرسال كشف الحساب عبر الواتساب
                </button>
              </div>

              {/* Payments Table */}
              <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>تاريخ الدفعة</th>
                      <th>الوحدة</th>
                      <th>نوع الدفعة</th>
                      <th>المبلغ</th>
                      <th>طريقة السداد</th>
                      <th>المرجع / المستند</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allPayments.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>
                          لا توجد دفعات مسجلة بعد.
                        </td>
                      </tr>
                    ) : (
                      allPayments.map((p, i) => (
                        <tr key={i}>
                          <td dir="ltr">{p.payment_date}</td>
                          <td>وحدة {p.unit_number || '—'}</td>
                          <td>
                            <span className="chip chip-gold">
                              {PAY_TYPE_LABEL[p.payment_type] || p.payment_type}
                            </span>
                          </td>
                          <td className="money" style={{ fontWeight: '800', color: '#10B981' }}>
                            {SAR(p.amount)}
                          </td>
                          <td>{PAY_METHODS[p.method] || p.method}</td>
                          <td>
                            {p.document_url ? (
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => openStoredDocument(supabase, p.document_url, {
                                onError: message => toast(message, true),
                                context: { area: 'customer_360', payment_id: p.id, document_kind: 'payment_receipt' },
                              })}>
                                🔍 عرض
                              </button>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: Bookings History */}
          {activeTab === 'bookings' && (
            <div>
              <h4 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: '800', color: '#0A192F' }}>
                سجل الإقامات والعقود لـ ({customer.full_name})
              </h4>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>الوحدة</th>
                      <th>الفئة</th>
                      <th>من</th>
                      <th>إلى</th>
                      <th>إجمالي العقد</th>
                      <th>المدفوع</th>
                      <th>المتبقي</th>
                      <th>العقد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>
                          لا توجد حجوزات سابقة لهذا العميل.
                        </td>
                      </tr>
                    ) : (
                      bookings.map(b => {
                        const paid = (b.payments || []).reduce((s, p) => s + num(p.amount), 0)
                        const rem = num(b.total_amount) - paid
                        return (
                          <tr key={b.id}>
                            <td style={{ fontWeight: '800' }}>وحدة {b.units?.unit_number}</td>
                            <td>{b.units?.category || '—'}</td>
                            <td dir="ltr">{b.check_in_date}</td>
                            <td dir="ltr">{b.check_out_date}</td>
                            <td className="money">{SAR(b.total_amount)}</td>
                            <td className="money" style={{ color: '#10B981' }}>{SAR(paid)}</td>
                            <td style={{ color: rem > 0 ? '#DC2626' : '#64748B', fontWeight: rem > 0 ? '800' : '400' }}>
                              {SAR(rem)}
                            </td>
                            <td>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => setSelectedContractBk(b)}
                                title="طباعة العقد"
                              >
                                🖨️ طباعة
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: Documents Archive Vault */}
          {activeTab === 'documents' && (
            <CustomerDocVault customer={customer} onUpdated={onChanged} />
          )}

          {/* TAB 4: Tenant Portal Credentials */}
          {activeTab === 'portal' && (
            <div>
              <h4 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: '800', color: '#0A192F' }}>
                إدارة حسابات دخول بوابة المستأجر الذكية
              </h4>

              {bookings.filter(b => portalAccounts[b.id]).length === 0 ? (
                <div style={{ padding: '24px', background: '#F8FAFC', borderRadius: '12px', textAlign: 'center', color: '#64748B' }}>
                  لا توجد حسابات مفعلة حالياً في البوابة. يتم إنشاء الحساب تلقائياً عند تسليم الوحدة.
                </div>
              ) : (
                bookings.map(b => {
                  const acct = portalAccounts[b.id]
                  if (!acct) return null
                  const portalUrl = `${window.location.origin}/tenant-portal?token=${acct.access_token}`

                  return (
                    <div
                      key={b.id}
                      style={{
                        padding: '16px',
                        background: '#F8FAFC',
                        borderRadius: '14px',
                        border: '1px solid #E2E8F0',
                        marginBottom: '16px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <div>
                          <strong style={{ fontSize: '15px', color: '#0A192F' }}>وحدة {b.units?.unit_number}</strong>
                          <span style={{ fontSize: '12px', color: '#64748B', marginRight: '8px' }}>({b.check_in_date} → {b.check_out_date})</span>
                        </div>
                        <span className={`chip ${acct.is_active === false ? 'chip-danger' : 'chip-ok'}`}>
                          {acct.is_active === false ? 'معطّل' : 'نشط'}
                        </span>
                      </div>

                      <div style={{ background: '#fff', padding: '12px', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '13px', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span>اسم المستخدم: <strong dir="ltr">{acct.username}</strong></span>
                          <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(acct.username); toast('✓ تم النسخ') }}>📋 نسخ</button>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>كلمة المرور / الرمز: <strong dir="ltr">{acct.access_token}</strong></span>
                          <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(acct.access_token); toast('✓ تم النسخ') }}>📋 نسخ</button>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}

          {/* TAB 5: Loyalty & Behavioral Rating */}
          {activeTab === 'loyalty' && (
            <div>
              {/* Behavioral Rating Box */}
              <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '14px', border: '1px solid #E2E8F0', marginBottom: '20px' }}>
                <h4 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: '800', color: '#0A192F', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Star size={18} color="#D97706" /> التقييم السلوكي للعميل
                </h4>

                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' }}>
                  <div className="fld" style={{ margin: 0, minWidth: '180px' }}>
                    <label>مستوى التقييم</label>
                    <select value={ratingVal} onChange={e => setRatingVal(Number(e.target.value))}>
                      <option value={5}>⭐⭐⭐⭐⭐ (ممتاز - 5 نجوم)</option>
                      <option value={4}>⭐⭐⭐⭐ (جيد جداً - 4 نجوم)</option>
                      <option value={3}>⭐⭐⭐ (جيد - 3 نجوم)</option>
                      <option value={2}>⭐⭐ (مقبول - نجمتان)</option>
                      <option value={1}>⭐ (سيء / محظور - نجمة)</option>
                    </select>
                  </div>

                  <div className="fld" style={{ margin: 0, flex: 1, minWidth: '220px' }}>
                    <label>ملاحظات التقييم السلوكي</label>
                    <input
                      placeholder="أدخل أي ملاحظات على سلوك المستأجر أثناء الإقامة..."
                      value={ratingNotes}
                      onChange={e => setRatingNotes(e.target.value)}
                    />
                  </div>

                  <button
                    className="btn btn-gold btn-sm"
                    disabled={savingRating}
                    onClick={handleSubmitRating}
                    style={{ alignSelf: 'flex-end', fontWeight: '800', padding: '10px 18px' }}
                  >
                    حفظ التقييم السلوكي
                  </button>
                </div>
              </div>

              {/* Loyalty Points Section */}
              <div style={{ background: '#FEFCE8', padding: '16px', borderRadius: '14px', border: '1px solid #FDE047' }}>
                <strong style={{ fontSize: '15px', color: '#854D0E', display: 'block', marginBottom: '4px' }}>
                  برنامج الولاء - الرصيد الحالي: {customer.loyalty_points || 0} نقطة
                </strong>
                <span style={{ fontSize: '12px', color: '#A16207' }}>
                  (كل 10 نقاط تعادل 1 ر.س خصماً على الإقامات القادمة)
                </span>

                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <input
                    type="number"
                    style={{ maxWidth: '160px', background: '#fff' }}
                    placeholder="عدد النقاط للاستبدال"
                    value={redeemPts}
                    onChange={e => setRedeemPts(e.target.value)}
                  />
                  <button
                    className="btn btn-blue btn-sm"
                    disabled={redeeming}
                    onClick={handleRedeemPoints}
                    style={{ fontWeight: '800' }}
                  >
                    {redeeming ? 'جاري الاستبدال...' : 'استبدال النقاط'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: Guest Check-In & Portal QR Code */}
          {activeTab === 'qrcode' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', alignItems: 'start' }}>
              <div style={{
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: '16px',
                padding: '24px',
                textAlign: 'center',
                boxShadow: '0 4px 12px rgba(0,0,0,0.03)'
              }}>
                <div style={{ display: 'inline-block', background: '#fff', padding: '16px', borderRadius: '16px', border: '1px solid #CBD5E1', marginBottom: '16px' }}>
                  <QRCodeSVG
                    value={`${window.location.origin}/portal?id=${customer.id_number}`}
                    size={200}
                    level="H"
                    includeMargin={true}
                  />
                </div>
                <h4 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: '800', color: '#0F172A' }}>
                  بطاقة الدخول والدخول السريع (Guest Check-In Pass)
                </h4>
                <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 16px' }}>
                  يمكن للنزيل مسح الرمز كاميرا الجوال للوصول المباشر لبوابة المستأجر والوحدة
                </p>

                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                  <button
                    className="btn btn-gold btn-sm"
                    onClick={() => window.print()}
                    style={{ fontWeight: '800', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Printer size={15} /> طباعة البطاقة
                  </button>
                </div>
              </div>

              <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '16px', padding: '20px' }}>
                <h4 style={{ fontSize: '15px', fontWeight: '800', color: '#1E40AF', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <QrCode size={18} /> مميزات بطاقة QR الموحدة
                </h4>
                <ul style={{ paddingRight: '18px', margin: 0, fontSize: '13px', color: '#1E3A8A', lineHeight: '1.8' }}>
                  <li>تسريع عملية الاستقبال والتسكين بنقرة واحدة بمجرد القراءة الضوئية.</li>
                  <li>دخول آمن ومباشر لبوابة الخدمة الذاتية الخاصة بالنزيل دون الحاجة لتسجيل كلمة مرور.</li>
                  <li>تقديم طلبات الخدمات الفرعية (تنظيف، صيانة، تمديد إقامة، وسداد الدفعات).</li>
                  <li>رابط الوصول المباشر: <br /><code dir="ltr" style={{ fontSize: '11px', background: '#DBEAFE', padding: '2px 6px', borderRadius: '4px' }}>{`${window.location.origin}/portal?id=${customer.id_number}`}</code></li>
                </ul>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Blacklist Modal Sub-dialog */}
      {showBlacklistModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          background: 'rgba(0,0,0,0.7)',
          display: 'grid',
          placeItems: 'center',
          padding: '16px'
        }}>
          <div style={{ background: '#fff', borderRadius: '18px', maxWidth: '460px', width: '100%', padding: '20px', direction: 'rtl' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '17px', color: '#DC2626', fontWeight: '900' }}>
              ⛔ إدراج العميل في القائمة السوداء
            </h3>
            <p style={{ fontSize: '13px', color: '#475569', marginBottom: '14px' }}>
              سيتم وضع علامة تحذير بارزة لمنع التأجير لهذا العميل في شاشة الموظفين.
            </p>

            <div className="fld" style={{ marginBottom: '12px' }}>
              <label>سبب الإدراج في القائمة السوداء *</label>
              <textarea
                value={blacklistForm.reason}
                onChange={e => setBlacklistForm({ ...blacklistForm, reason: e.target.value })}
                placeholder="اكتب سبب الحظر (إتلاف أثاث / عدم دفع / مشاكل مع السكان...)"
                rows={3}
                style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowBlacklistModal(false)}>إلغاء</button>
              <button
                className="btn btn-sm"
                disabled={savingBlacklist}
                onClick={() => handleToggleBlacklist(true)}
                style={{ background: '#DC2626', color: '#fff', fontWeight: '800' }}
              >
                تأكيد الإدراج بالقائمة السوداء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Contract Modal */}
      {selectedContractBk && (
        <RentalContract
          onClose={() => setSelectedContractBk(null)}
          company={company}
          customer={customer}
          unit={selectedContractBk.units}
          booking={selectedContractBk}
          employeeName={selectedContractBk.profiles?.full_name}
        />
      )}

      {/* Printable 360 Report */}
      {showReport && (
        <PrintableDoc
          company={company}
          title={`تقرير العميل الموحد (360 View) — ${customer.full_name}`}
          docKind="statement" docTable="customers" docId={customer.id}
          qrValue={JSON.stringify({ customer: customer.full_name, id: customer.id_number, phone: customer.phone })}
          onClose={() => setShowReport(false)}
        >
          <h4 className="contract-h4">البيانات الشخصية والتعريفية</h4>
          <DocGrid items={[
            ['الاسم الكامل', customer.full_name],
            ['نوع الإثبات', DOC_TYPES[customer.id_type] || customer.id_type],
            ['رقم الإثبات', customer.id_number],
            ['الجوال', customer.phone],
            ['البريد الإلكتروني', customer.email || '—'],
            ['حالة الحظر', isBlacklisted ? '⛔ قائمة سوداء' : 'نشط'],
            ['التقييم السلوكي', '★'.repeat(customer.rating || 5)],
            ['نقاط الولاء', (customer.loyalty_points || 0) + ' نقطة'],
          ]} />

          <h4 className="contract-h4">الملخص المالي الموحد</h4>
          <DocGrid items={[
            ['إجمالي التعاقدات', SAR(totalContracted)],
            ['إجمالي المدفوع', SAR(totalPaid)],
            ['المتبقي / الديون', SAR(totalPendingDebt)],
            ['العربون المدفوع', SAR(totalDownPayment)],
            ['التأمين المدفوع', SAR(totalInsurance)],
            ['عدد الحجوزات', bookings.length],
          ]} />

          <h4 className="contract-h4">سجل الحجوزات والإقامات</h4>
          <table className="tbl" style={{ marginBottom: 8 }}>
            <thead>
              <tr><th>الوحدة</th><th>الفئة</th><th>تاريخ الدخول</th><th>تاريخ الخروج</th><th>المبلغ</th><th>المدفوع</th></tr>
            </thead>
            <tbody>
              {bookings.map(b => (
                <tr key={b.id}>
                  <td>وحدة {b.units?.unit_number}</td>
                  <td>{b.units?.category || '—'}</td>
                  <td dir="ltr">{b.check_in_date}</td>
                  <td dir="ltr">{b.check_out_date}</td>
                  <td className="money">{SAR(b.total_amount)}</td>
                  <td className="money">{SAR((b.payments || []).reduce((s, p) => s + num(p.amount), 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PrintableDoc>
      )}
    </div>
  )
}
