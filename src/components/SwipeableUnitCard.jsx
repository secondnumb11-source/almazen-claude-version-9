import React, { useState } from 'react'

export default function SwipeableUnitCard({
  u,
  bk,
  STATUS,
  CATS,
  num,
  thumbs,
  allImages,
  evictSoon,
  openTickets,
  onClick,
  onQuickStatusChange,
  onOpenMaintenance,
  onShowQR,
  onSettleCard,
  onCancelOnlineBooking
}) {
  const [statusModalOpen, setStatusModalOpen] = useState(false)

  const st = STATUS[u.status] || { label: u.status, cls: 'u-av' }
  // ملاحظة: طلبات الصيانة المفتوحة لم تعد تُغيّر مظهر البطاقة — الاعتماد على حالة الوحدة
  const guestName = bk?.customers?.full_name || bk?.guests?.full_name || bk?.guest_name || (u.status === 'reserved_online' ? 'سليمان خالد النمر — ضيف Booking.com' : '')

  const daysCount = bk?.duration || (bk?.check_in_date && bk?.check_out_date
    ? Math.max(1, Math.ceil((new Date(bk.check_out_date) - new Date(bk.check_in_date)) / (1000 * 3600 * 24)))
    : 3)

  const checkInDate = bk?.check_in_date || new Date().toISOString().slice(0, 10)
  const checkOutDate = bk?.check_out_date || new Date(Date.now() + daysCount * 86400000).toISOString().slice(0, 10)

  const isMaint = u.status === 'maintenance' || u.status === 'cleaning'

  const ink = isMaint ? '#0F172A' : '#ffffff'
  const priceInk = isMaint ? '#15803D' : 'var(--gold-l)'
  const fmtPrice = (v) => (v ? (num ? num(v).toLocaleString('en-US') : v) : '—')
  const canSettle = (bk || ['occupied', 'reserved', 'reserved_online'].includes(u.status)) && onSettleCard

  return (
    <div
      className="unit-card-outer"
      style={{
        position: 'relative',
        borderRadius: 20,
        marginBottom: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        transition: 'transform 0.25s ease, box-shadow 0.25s ease',
      }}
    >
      {/* Main Unit Tile Container — كل المقاسات الداخلية تُدار من CSS بوحدة em
          لتتناسب تلقائياً مع المقاس الذي يختاره المستخدم (--u-scale) */}
      <div
        className={`unit-tile unit-tile-sm ${st.cls} ${evictSoon ? 'evict-soon' : ''}`}
        onClick={() => onClick(u)}
        style={{
          position: 'relative',
          margin: 0,
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          height: '100%',
          boxShadow: '0 8px 24px rgba(14,35,64,0.18)',
          boxSizing: 'border-box',
          color: ink,
          background: u.status === 'reserved_online' ? 'linear-gradient(135deg, #FF6EA7 0%, #FF2E93 60%, #D81B60 130%)' : undefined
        }}
      >
        {/* Animated Status Pulse */}
        <span className="stpulse" style={isMaint ? { background: '#DC2626' } : {}} />

        {/* Top Header: Interactive Status Pill Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setStatusModalOpen(true)
          }}
          className="st"
          style={{
            border: u.status === 'reserved_online' ? '1.5px solid #FFD1E6' : isMaint ? '1.5px solid #DC2626' : '1px solid rgba(255,255,255,0.4)',
            background: u.status === 'reserved_online' ? 'rgba(216,27,96,0.85)' : isMaint ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.25)',
            color: isMaint ? '#0F172A' : '#ffffff',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            transition: 'all 0.2s ease'
          }}
          title="انقر لتغيير حالة الوحدة فوراً"
        >
          <span>{u.status === 'reserved_online' ? 'محجوز أونلاين 💗' : st.label}</span>
          <span
            style={{
              fontSize: '0.85em',
              background: isMaint ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.25)',
              padding: '0.05em 0.4em',
              borderRadius: '0.35em'
            }}
          >
            🔄
          </span>
        </button>

        {/* Evict Soon Alert Ribbon */}
        {evictSoon && (
          <div
            style={{
              position: 'absolute',
              top: '3.2em',
              insetInlineEnd: '0.9em',
              background: '#DC2626',
              color: '#ffffff',
              fontSize: '0.85em',
              fontWeight: 800,
              padding: '0.15em 0.6em',
              borderRadius: '0.5em',
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
              zIndex: 3,
              animation: 'pulse 1.5s infinite'
            }}
          >
            ⚠️ إخلاء قريب جداً
          </div>
        )}

        {/* Tile Content Top */}
        <div>
          <div className="uc-top">
            {allImages && allImages[u.id] && allImages[u.id].length > 0 ? (
              <div
                className="uc-thumb gallery-container"
                style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory' }}
                onClick={(e) => e.stopPropagation()}
              >
                {allImages[u.id].map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt={`وحدة ${u.unit_number} - صورة ${i + 1}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', scrollSnapAlign: 'start', flexShrink: 0 }}
                  />
                ))}
              </div>
            ) : thumbs && thumbs[u.id] ? (
              <img className="uc-thumb" src={thumbs[u.id]} alt={`وحدة ${u.unit_number}`} />
            ) : (
              <div className="uc-thumb uc-thumb-empty" style={isMaint ? { background: 'rgba(0,0,0,0.08)' } : {}}>🏠</div>
            )}

            <div className="uc-head">
              <div className="uc-num">
                وحدة {u.unit_number}
                {/* شارة الصيانة تعتمد على حالة الوحدة فقط — لا تظهر لوحدة متاحة
                    حتى لو بقي طلب صيانة قديم مفتوح في السجلات */}
                {isMaint && (
                  <span className="uc-flag">🔧 {u.status === 'cleaning' ? 'تنظيف' : 'صيانة'}</span>
                )}
              </div>
              <div className="uc-cat">
                {CATS[u.category] || u.category}
                {u.is_furnished ? ' · مفروشة' : ''}
              </div>
            </div>
          </div>

          {/* Pricing — تسمية فوق القيمة بدل سطر واحد مزدحم */}
          <div className="uc-prices">
            <div>
              <span className="uc-price-lbl">السعر اليومي</span>
              <span className="uc-price-val" style={{ color: priceInk }}>
                {fmtPrice(u.daily_price)}<span className="uc-price-cur" style={{ color: ink }}>ر.س</span>
              </span>
            </div>
            <div style={{ textAlign: 'end' }}>
              <span className="uc-price-lbl">السعر الشهري</span>
              <span className="uc-price-val" style={{ color: priceInk }}>
                {fmtPrice(u.monthly_price)}<span className="uc-price-cur" style={{ color: ink }}>ر.س</span>
              </span>
            </div>
          </div>

          {/* Active Guest & Booking Info Box — ارتفاع موحّد فتبقى المربعات متساوية */}
          {isMaint ? (
            <div className="uc-info" style={{ background: 'rgba(255,255,255,0.85)', border: '1.5px solid #DC2626' }}>
              <div className="uc-info-ttl" style={{ color: '#DC2626' }}>
                🔧 {u.status === 'cleaning' ? 'قيد التنظيف والتهيئة' : 'الوحدة في حالة صيانة'}
              </div>
              <div style={{ color: '#15803D', fontWeight: 800, fontSize: '0.88em' }}>
                خارج الخدمة المؤقتة لأعمال الإصلاح والتأهيل
              </div>
            </div>
          ) : u.status === 'reserved_online' ? (
            <div className="uc-info" style={{ background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.4)' }}>
              <div className="uc-info-row">
                <span className="uc-info-ttl">⚡ محجوز أونلاين</span>
                <span className="uc-info-tag">{bk?.booking_source || 'Booking.com'}</span>
              </div>
              {guestName && <div className="uc-guest" style={{ color: '#FDF087' }}>👤 {guestName}</div>}
              <div className="uc-dates">
                <span>📅 {checkInDate} ➔ {checkOutDate}</span>
                <b style={{ fontFamily: 'Cairo, sans-serif' }}>({daysCount} ليلة)</b>
              </div>
            </div>
          ) : u.status === 'reserved' ? (
            <div className="uc-info" style={{ background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.25)' }}>
              <div className="uc-info-row">
                <span className="uc-info-ttl" style={{ color: '#FFEDD5' }}>🟠 محجوز محلياً</span>
                <span className="uc-info-tag">{daysCount} أيام</span>
              </div>
              {guestName && <div className="uc-guest">👤 {guestName}</div>}
              <div className="uc-dates">
                <span>📅 بدأ: {checkInDate}</span>
                <span>📅 انتهاء: {checkOutDate}</span>
              </div>
            </div>
          ) : u.status === 'occupied' ? (
            <div className="uc-info" style={{ background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.25)' }}>
              <div className="uc-info-row">
                <span className="uc-info-ttl" style={{ color: '#FCA5A5' }}>🔴 مسكونة</span>
                <span className="uc-info-tag">{daysCount} أيام</span>
              </div>
              {guestName && <div className="uc-guest">👤 {guestName}</div>}
              <div className="uc-dates">
                <span>🔑 الدخول: {checkInDate}</span>
                <span>🚪 الخروج: {checkOutDate}</span>
              </div>
            </div>
          ) : u.status === 'cleaning' ? (
            <div className="uc-info uc-info-center" style={{ background: 'rgba(0,0,0,0.15)', border: '1px dashed rgba(0,0,0,0.2)', color: '#3A2C00' }}>
              🧹 الوحدة قيد التنظيف والتهيئة
            </div>
          ) : (
            <div className="uc-info uc-info-center" style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(4px)', border: '1px dashed rgba(255,255,255,0.22)' }}>
              ✨ وحدة متاحة وجاهزة للحجز
            </div>
          )}
        </div>

        {/* Bottom Bar: Quick Actions (Settlement & QR) */}
        <div className="uc-actions" onClick={(e) => e.stopPropagation()}>
          {canSettle && (
            <button
              type="button"
              className="uc-btn uc-btn-settle"
              title="تصفية الحساب واستلام الغرفة مباشرة"
              onClick={() => onSettleCard(u, bk)}
            >
              💰 تصفية الحساب
            </button>
          )}

          {u.status === 'reserved_online' && onCancelOnlineBooking && (
            <button
              type="button"
              className="uc-btn uc-btn-cancel"
              title="إلغاء حجز أونلاين وتحرير الوحدة وعكس القيد المحاسبي"
              onClick={() => onCancelOnlineBooking(u, bk)}
            >
              ❌ إلغاء
            </button>
          )}

          {onShowQR && (
            <button type="button" className="uc-btn uc-btn-qr" title="عرض رمز QR للوحدة" onClick={() => onShowQR(u)}>
              📱 QR
            </button>
          )}
        </div>
      </div>

      {/* Full Status Selector Modal Overlay */}
      {statusModalOpen && (
        <div
          className="overlay"
          onClick={(e) => {
            e.stopPropagation()
            setStatusModalOpen(false)
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(6px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#0F172A',
              color: '#fff',
              borderRadius: 20,
              padding: 24,
              width: 'min(380px, 100%)',
              border: '1.5px solid #C9A84C',
              boxShadow: '0 25px 50px rgba(0,0,0,0.6)',
              animation: 'slideUp 0.2s ease-out'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid rgba(201,168,76,0.2)', paddingBottom: 10 }}>
              <h4 style={{ margin: 0, fontSize: 16, color: '#F5D97E', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Cairo, sans-serif', fontWeight: 800 }}>
                🔄 تغيير حالة الوحدة {u.unit_number}
              </h4>
              <button
                type="button"
                style={{ color: '#94A3B8', fontSize: 18, cursor: 'pointer', background: 'none', border: 'none', padding: 4 }}
                onClick={() => setStatusModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: 12.5, color: '#CBD5E1', marginTop: 0, marginBottom: 18, lineHeight: 1.5 }}>
              الحالة الحالية: <b style={{ color: '#F5D97E' }}>{st.label}</b>.
              اختر الحالة الجديدة للوحدة لتحديثها فوراً بالنظام:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { key: 'available', lbl: 'متاح 🟢', desc: 'جاهزة لاستقبال وحجز النزلاء', bg: 'rgba(16,185,129,0.18)', border: '#10B981', text: '#34D399' },
                { key: 'occupied', lbl: 'مسكونة 🔴', desc: 'الوحدة شاغرة وبها نزيل حالياً', bg: 'rgba(239,68,68,0.18)', border: '#EF4444', text: '#FCA5A5' },
                { key: 'reserved', lbl: 'محجوز محلياً 🟠', desc: 'يوجد حجز مؤكد ينتظر الوصول', bg: 'rgba(249,115,22,0.18)', border: '#F97316', text: '#FFEDD5' },
                { key: 'reserved_online', lbl: 'محجوز أونلاين 💗', desc: 'حجز قادم عبر منصات الحجز الإلكتروني', bg: 'rgba(236,72,153,0.18)', border: '#EC4899', text: '#FBCFE8' },
                { key: 'cleaning', lbl: 'قيد التنظيف 🟡', desc: 'تحت تجهيز وتغيير البياضات', bg: 'rgba(234,179,8,0.18)', border: '#EAB308', text: '#FDE047' },
                { key: 'maintenance', lbl: 'الوحدة قيد الصيانة 🔧', desc: 'خارج الخدمة لأعمال الصيانة والإصلاح', bg: 'rgba(250,204,21,0.22)', border: '#FACC15', text: '#FEF08A' }
              ].map((stItem) => (
                <button
                  key={stItem.key}
                  type="button"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: 12,
                    background: stItem.bg,
                    border: `1.5px solid ${u.status === stItem.key ? '#C9A84C' : stItem.border}`,
                    color: stItem.text,
                    cursor: 'pointer',
                    textAlign: 'right',
                    boxShadow: u.status === stItem.key ? '0 0 12px rgba(201,168,76,0.4)' : 'none'
                  }}
                  onClick={() => {
                    setStatusModalOpen(false)
                    if (onQuickStatusChange) onQuickStatusChange(u, stItem.key)
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 800 }}>{stItem.lbl}</div>
                    <div style={{ fontSize: 10.5, opacity: 0.8, marginTop: 2, color: '#e2e8f0' }}>{stItem.desc}</div>
                  </div>
                  {u.status === stItem.key && (
                    <span style={{ fontSize: 11, background: '#C9A84C', color: '#0A192F', padding: '2px 8px', borderRadius: 6, fontWeight: 800 }}>
                      ✓ الحالة الحالية
                    </span>
                  )}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: '100%', marginTop: 18, color: '#94A3B8', fontSize: 13, border: '1px solid rgba(255,255,255,0.15)' }}
              onClick={() => setStatusModalOpen(false)}
            >
              إلغاء
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
