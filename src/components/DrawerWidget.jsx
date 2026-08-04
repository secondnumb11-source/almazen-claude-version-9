import React, { useState, useEffect } from 'react'

const NOTES_KEY = 'almazen:quick_notes'

function toHijri(date) {
  try {
    return new Intl.DateTimeFormat('ar-SA-u-ca-islamic', {
      day: 'numeric', month: 'long', year: 'numeric'
    }).format(date)
  } catch {
    return '—'
  }
}

function toGregorian(hijriStr) {
  // hijriStr بصيغة yyyy-mm-dd هجري
  // نحاول تحويله باستخدام Intl
  try {
    const [y, m, d] = hijriStr.split('-').map(Number)
    if (!y || !m || !d) return '—'
    // إنشاء تاريخ بالتقويم الإسلامي ثم تحويله ميلادي
    const formatter = new Intl.DateTimeFormat('en-US', {
      calendar: 'gregory',
      year: 'numeric', month: '2-digit', day: '2-digit'
    })
    const islamicDate = new Date(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`)
    return islamicDate.toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return '—'
  }
}

export default function DrawerWidget() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('notes')
  const [notes, setNotes] = useState(() => {
    try { return localStorage.getItem(NOTES_KEY) || '' } catch { return '' }
  })
  const [gregDate, setGregDate] = useState('')
  const [hijriDate, setHijriDate] = useState('')
  const [gregResult, setGregResult] = useState('')
  const [hijriResult, setHijriResult] = useState('')

  const saveNotes = () => {
    try { localStorage.setItem(NOTES_KEY, notes) } catch {}
    const el = document.querySelector('.drawer-note-save')
    if (el) { el.textContent = '✓ حُفظ'; setTimeout(() => { el.textContent = 'حفظ' }, 1500) }
  }

  const clearNotes = () => {
    if (confirm('مسح جميع الملاحظات؟')) {
      setNotes('')
      try { localStorage.removeItem(NOTES_KEY) } catch {}
    }
  }

  const convertGreg = () => {
    if (!gregDate) return setGregResult('أدخل تاريخاً ميلادياً')
    const d = new Date(gregDate)
    if (isNaN(d)) return setGregResult('تاريخ غير صالح')
    setGregResult(toHijri(d))
  }

  const convertHijri = () => {
    if (!hijriDate) return setHijriResult('أدخل تاريخاً هجرياً')
    setHijriResult(toGregorian(hijriDate))
  }

  return (
    <div className="drawer-widget">
      <button className={'drawer-handle' + (open ? ' open' : '')} onClick={() => setOpen(o => !o)} title="ملاحظات · تاريخ">
        <span className="dh-icon">{open ? '◀' : '▶'}</span>
        <span className="dh-text">ملاحظات · محول التاريخ</span>
      </button>

      <div className={'drawer-body' + (open ? ' open' : '')}>
        <div className="drawer-inner">
          <div className="drawer-tabs">
            <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>📝 ملاحظات</button>
            <button className={tab === 'date' ? 'on' : ''} onClick={() => setTab('date')}>🗓 محول التاريخ</button>
          </div>

          {tab === 'notes' && (
            <>
              <textarea
                className="drawer-notes-area"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="اكتب ملاحظاتك السريعة هنا…"
                dir="auto"
              />
              <div className="drawer-note-actions">
                <button className="drawer-note-save" onClick={saveNotes}>حفظ</button>
                <button className="drawer-note-clear" onClick={clearNotes}>مسح</button>
              </div>
            </>
          )}

          {tab === 'date' && (
            <div className="date-conv">
              <div className="date-conv-row">
                <label>ميلادي ← هجري</label>
                <input type="date" value={gregDate} onChange={e => setGregDate(e.target.value)} />
                <button className="btn btn-gold btn-sm" style={{ marginTop: 5 }} onClick={convertGreg}>تحويل</button>
                {gregResult && <div className="date-conv-result">{gregResult}</div>}
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid #eee' }} />
              <div className="date-conv-row">
                <label>هجري ← ميلادي (يوم-شهر-سنة)</label>
                <input
                  type="text"
                  placeholder="مثال: 1446-01-15"
                  value={hijriDate}
                  onChange={e => setHijriDate(e.target.value)}
                  dir="ltr"
                />
                <button className="btn btn-gold btn-sm" style={{ marginTop: 5 }} onClick={convertHijri}>تحويل</button>
                {hijriResult && <div className="date-conv-result">{hijriResult}</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
