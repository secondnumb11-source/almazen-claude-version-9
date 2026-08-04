import React, { useState, useEffect, useRef } from 'react'
import jsQR from 'jsqr'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { SAR } from '../lib/helpers'
import { QrCode, Camera, Upload, CheckCircle2, User, Home, Calendar, CreditCard, AlertCircle, RefreshCw, X } from 'lucide-react'

export default function BookingQRScannerModal({ onClose, onCheckInComplete }) {
  const { profile, toast } = useAuth()
  const [mode, setMode] = useState('camera') // 'camera' | 'upload' | 'manual'
  const [manualInput, setManualInput] = useState('')
  const [scanning, setScanning] = useState(false)
  const [loadingBooking, setLoadingBooking] = useState(false)
  const [bookingData, setBookingData] = useState(null)
  const [checkInBusy, setCheckInBusy] = useState(false)
  const [scanError, setScanError] = useState(null)

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const animFrameRef = useRef(null)

  // Start video stream when in camera mode
  useEffect(() => {
    let stream = null
    if (mode === 'camera' && !bookingData) {
      setScanError(null)
      navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
        .then((s) => {
          stream = s
          if (videoRef.current) {
            videoRef.current.srcObject = s
            videoRef.current.setAttribute('playsinline', 'true')
            videoRef.current.play()
            setScanning(true)
            requestAnimationFrame(tick)
          }
        })
        .catch((err) => {
          console.warn('Camera access error:', err)
          setScanError('تعذّر الوصول للكاميرا — يرجى رفع صورة الـ QR أو إدخال الرقم يدوياً')
          setMode('manual')
        })
    }

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      if (stream) {
        stream.getTracks().forEach(t => t.stop())
      }
    }
  }, [mode, bookingData])

  // Canvas tick scanner loop using jsQR
  const tick = () => {
    if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
      const video = videoRef.current
      const canvas = canvasRef.current || document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert'
      })

      if (code && code.data) {
        handleRawQrCode(code.data)
        return
      }
    }
    animFrameRef.current = requestAnimationFrame(tick)
  }

  // Handle uploaded QR image file
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        canvas.width = img.width
        canvas.height = img.height
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height)
        if (code && code.data) {
          handleRawQrCode(code.data)
        } else {
          toast('لم يتم التعرف على رمز QR صالح في الصورة المرفوقة', true)
        }
      }
      img.src = evt.target.result
    }
    reader.readAsDataURL(file)
  }

  // Parse raw QR payload and retrieve booking from Supabase
  const handleRawQrCode = async (rawText) => {
    setScanning(false)
    setLoadingBooking(true)
    setScanError(null)

    try {
      let bookingId = null
      let contractNo = null
      let idNumber = null

      // Check if JSON payload
      if (rawText.startsWith('{')) {
        try {
          const parsed = JSON.parse(rawText)
          bookingId = parsed.booking_id || parsed.id || parsed.bookingId
          contractNo = parsed.contract_number || parsed.contractNo || parsed.doc
          idNumber = parsed.id_number || parsed.id
        } catch (_) {}
      }

      if (!bookingId && !contractNo && !idNumber) {
        // Plain string fallback (could be UUID, contract number, or customer ID number)
        const clean = rawText.trim()
        if (clean.length > 5) {
          contractNo = clean
          bookingId = clean
          idNumber = clean
        }
      }

      // Query Supabase for matching booking
      let query = supabase.from('bookings').select(`
        *,
        units (id, unit_number, category, status, floor),
        customers (id, full_name, id_number, phone, nationality),
        payments (id, amount, payment_type, payment_date)
      `).eq('company_id', profile.company_id)

      if (bookingId && bookingId.length > 20) {
        query = query.or(`id.eq.${bookingId},contract_number.eq.${contractNo || bookingId}`)
      } else if (contractNo) {
        query = query.or(`contract_number.eq.${contractNo},id.eq.${contractNo}`)
      } else if (idNumber) {
        const { data: custData } = await supabase.from('customers')
          .select('id').eq('company_id', profile.company_id).eq('id_number', idNumber).maybeSingle()
        if (custData) {
          query = query.eq('customer_id', custData.id)
        }
      }

      const { data: bData, error } = await query.order('created_at', { ascending: false }).limit(1)

      if (error) throw error

      if (bData && bData.length > 0) {
        setBookingData(bData[0])
        toast('✨ تم العثور على حجز النزيل بنجاح!', false)
      } else {
        setScanError(`لم يتم العثور على حجز متطابق للرمز المفحوص: (${rawText.slice(0, 30)})`)
      }
    } catch (err) {
      console.error('Error fetching scanned booking:', err)
      setScanError('خطأ أثناء جلب تفاصيل الحجز من النظام: ' + err.message)
    } finally {
      setLoadingBooking(false)
    }
  }

  // Execute instant check-in
  const executeCheckIn = async () => {
    if (!bookingData) return
    setCheckInBusy(true)
    try {
      // 1. Update booking status to checked_in
      const { error: bkErr } = await supabase.from('bookings')
        .update({ status: 'checked_in', check_in_date: new Date().toISOString().slice(0, 10) })
        .eq('id', bookingData.id)

      if (bkErr) throw bkErr

      // 2. Update unit status to occupied
      if (bookingData.unit_id) {
        await supabase.from('units')
          .update({ status: 'occupied' })
          .eq('id', bookingData.unit_id)
      }

      // 3. Log audit event
      await supabase.from('audit_logs').insert({
        company_id: profile.company_id,
        user_id: profile.id,
        action: 'qr_instant_checkin',
        entity: 'bookings',
        entity_id: bookingData.id,
        new_data: { unit_number: bookingData.units?.unit_number, customer: bookingData.customers?.full_name }
      })

      toast(`✅ تم تسليم الوحدة (${bookingData.units?.unit_number || ''}) للنزيل (${bookingData.customers?.full_name || ''}) بنجاح!`, false)
      if (onCheckInComplete) onCheckInComplete()
      onClose()
    } catch (err) {
      toast('تعذّر تسليم الحجز: ' + err.message, true)
    } finally {
      setCheckInBusy(false)
    }
  }

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(580px, 100%)', borderRadius: '16px', overflow: 'hidden' }}>
        <div className="modal-h" style={{ background: '#1E3A8A', color: '#fff', padding: '16px 20px' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px' }}>
            <QrCode size={22} color="#F59E0B" />
            <span>ماسح الـ QR للتسكين واستلام الوحدة</span>
          </h3>
          <button className="x" onClick={onClose} style={{ color: '#fff' }}>✕</button>
        </div>

        <div className="modal-b" style={{ padding: '20px' }}>
          {/* Mode Switcher Tabs */}
          {!bookingData && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', background: '#F1F5F9', padding: '4px', borderRadius: '10px' }}>
              <button
                className={`btn btn-sm ${mode === 'camera' ? 'btn-blue' : ''}`}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                onClick={() => { setMode('camera'); setBookingData(null); setScanError(null) }}
              >
                <Camera size={16} /> مسح بالكاميرا
              </button>
              <button
                className={`btn btn-sm ${mode === 'upload' ? 'btn-blue' : ''}`}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                onClick={() => { setMode('upload'); setBookingData(null); setScanError(null) }}
              >
                <Upload size={16} /> رفع صورة الـ QR
              </button>
              <button
                className={`btn btn-sm ${mode === 'manual' ? 'btn-blue' : ''}`}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                onClick={() => { setMode('manual'); setBookingData(null); setScanError(null) }}
              >
                📝 إدخال يدوياً
              </button>
            </div>
          )}

          {/* Camera View */}
          {!bookingData && mode === 'camera' && (
            <div style={{ textAlign: 'center', position: 'relative', background: '#0F172A', borderRadius: '12px', overflow: 'hidden', minHeight: '260px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <video ref={videoRef} style={{ width: '100%', maxHeight: '300px', objectFit: 'cover' }} />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '180px',
                height: '180px',
                border: '3px dashed #3B82F6',
                borderRadius: '16px',
                boxShadow: '0 0 0 4000px rgba(0,0,0,0.5)',
                pointerEvents: 'none'
              }} />
              <div style={{ position: 'absolute', bottom: '12px', color: '#CBD5E1', fontSize: '13px', background: 'rgba(0,0,0,0.6)', padding: '4px 12px', borderRadius: '20px' }}>
                وجه كاميرا الجهاز نحو رمز الـ QR الموجود في عقد أو تذكرة حجز النزيل
              </div>
            </div>
          )}

          {/* Upload File View */}
          {!bookingData && mode === 'upload' && (
            <div style={{
              border: '2px dashed #94A3B8',
              borderRadius: '12px',
              padding: '36px 20px',
              textAlign: 'center',
              background: '#F8FAFC',
              cursor: 'pointer'
            }}>
              <Upload size={36} color="#64748B" style={{ marginBottom: '10px' }} />
              <p style={{ margin: '0 0 12px', fontWeight: '700', color: '#334155' }}>اضغط لرفع صورة رمز הـ QR الخاص بالحجز</p>
              <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'inline-block' }} />
            </div>
          )}

          {/* Manual Input View */}
          {!bookingData && mode === 'manual' && (
            <div>
              <div className="fld">
                <label style={{ fontWeight: '700', fontSize: '13px', color: '#334155' }}>رقم العقد / رقم الحجز / أو رمز הـ QR النصي *</label>
                <input
                  type="text"
                  value={manualInput}
                  onChange={e => setManualInput(e.target.value)}
                  placeholder="أدخل رقم الحجز أو رمز العقد..."
                  style={{ fontSize: '15px', padding: '10px' }}
                />
              </div>
              <button
                className="btn btn-blue"
                style={{ width: '100%', marginTop: '12px', padding: '10px', fontWeight: 'bold' }}
                onClick={() => handleRawQrCode(manualInput)}
                disabled={!manualInput.trim()}
              >
                بحث واسترجاع تفاصيل الحجز 🔍
              </button>
            </div>
          )}

          {/* Loading Indicator */}
          {loadingBooking && (
            <div style={{ textAlign: 'center', padding: '30px' }}>
              <RefreshCw size={28} className="spin" color="#3B82F6" />
              <p style={{ marginTop: '10px', color: '#64748B', fontWeight: '600' }}>جاري استرجاع بيانات الحجز والنزيل من النظام...</p>
            </div>
          )}

          {/* Scan Error Message */}
          {scanError && !loadingBooking && (
            <div style={{
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              color: '#991B1B',
              borderRadius: '10px',
              padding: '12px 16px',
              marginTop: '16px',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <AlertCircle size={18} />
              <span>{scanError}</span>
            </div>
          )}

          {/* Booking Retrieved Result Card */}
          {bookingData && !loadingBooking && (
            <div style={{ background: '#F0FDF4', border: '2px solid #22C55E', borderRadius: '14px', padding: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #BBF7D0', paddingBottom: '12px', marginBottom: '14px' }}>
                <span className="chip chip-green" style={{ fontSize: '13px', fontWeight: '800' }}>
                  ✓ تم التعرف على الحجز برقم ({bookingData.contract_number || bookingData.id.slice(0, 8)})
                </span>
                <span style={{ fontSize: '12px', color: '#166534', fontWeight: 'bold' }}>
                  الحالة: {{ pending: 'معلق', confirmed: 'محجوز مؤكد', checked_in: 'ساكن بالفعل', checked_out: 'منتهي' }[bookingData.status] || bookingData.status}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                <div style={{ background: '#fff', padding: '10px', borderRadius: '8px', border: '1px solid #DCFCE7' }}>
                  <div style={{ fontSize: '11px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <User size={13} /> اسم النزيل
                  </div>
                  <div style={{ fontWeight: '800', fontSize: '15px', color: '#0F172A', marginTop: '2px' }}>
                    {bookingData.customers?.full_name || '—'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>
                    هوية: {bookingData.customers?.id_number || '—'}
                  </div>
                </div>

                <div style={{ background: '#fff', padding: '10px', borderRadius: '8px', border: '1px solid #DCFCE7' }}>
                  <div style={{ fontSize: '11px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Home size={13} /> الوحدة العقارية
                  </div>
                  <div style={{ fontWeight: '800', fontSize: '15px', color: '#1E40AF', marginTop: '2px' }}>
                    وحدة {bookingData.units?.unit_number || '—'} ({bookingData.units?.category || ''})
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>
                    حالة الوحدة: {bookingData.units?.status || 'متاحة'}
                  </div>
                </div>

                <div style={{ background: '#fff', padding: '10px', borderRadius: '8px', border: '1px solid #DCFCE7' }}>
                  <div style={{ fontSize: '11px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Calendar size={13} /> فترة الحجز
                  </div>
                  <div style={{ fontWeight: '700', fontSize: '13px', color: '#334155', marginTop: '2px' }}>
                    من {bookingData.check_in_date || '—'} إلى {bookingData.check_out_date || '—'}
                  </div>
                </div>

                <div style={{ background: '#fff', padding: '10px', borderRadius: '8px', border: '1px solid #DCFCE7' }}>
                  <div style={{ fontSize: '11px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CreditCard size={13} /> الموقف المالي
                  </div>
                  <div style={{ fontWeight: '800', fontSize: '14px', color: '#166534', marginTop: '2px' }}>
                    الإجمالي: {SAR(bookingData.total_amount)}
                  </div>
                </div>
              </div>

              {/* Instant Check-In Action Button */}
              {bookingData.status !== 'checked_in' ? (
                <button
                  className="btn btn-green"
                  style={{ width: '100%', padding: '12px', fontWeight: '800', fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                  disabled={checkInBusy}
                  onClick={executeCheckIn}
                >
                  <CheckCircle2 size={18} />
                  <span>{checkInBusy ? 'جاري تسليم الوحدة...' : '⚡ تأكيد التسكين واستليم الوحدة للنزيل الآن'}</span>
                </button>
              ) : (
                <div style={{ textAlign: 'center', color: '#15803D', fontWeight: '800', padding: '8px', background: '#DCFCE7', borderRadius: '8px' }}>
                  ✓ النزيل مسجل كـ (ساكن) حالياً بالوحدة {bookingData.units?.unit_number}
                </div>
              )}

              <button
                className="btn btn-outline"
                style={{ width: '100%', marginTop: '8px' }}
                onClick={() => setBookingData(null)}
              >
                مسح رمز QR آخر 🔄
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
