import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { logActivity } from '../lib/helpers'
import { printHandoverChecklist } from '../lib/handoverPrint'
import { issueSerial } from '../lib/documentSerial'



/* مودال التسليم/الاستلام مع فحص Check List الأثاث — يُستدعى من مودال الوحدة */
export default function HandoverModal({ unit, booking, kind, onClose }) {
  const { profile, company, toast } = useAuth()

  const initial = Array.isArray(unit.furniture_checklist) ? unit.furniture_checklist : []
  const [items, setItems] = useState(
    initial.map(it => ({ name: it.name, note: it.note || '', condition: 'ok' }))
  )
  const [notes, setNotes] = useState('')
  const [signedBy, setSignedBy] = useState(booking?.customers?.full_name || '')
  const [busy, setBusy] = useState(false)

  const update = (i, patch) => setItems(items.map((it, idx) => idx === i ? { ...it, ...patch } : it))
  const damaged = items.filter(x => x.condition !== 'ok').length

  const save = async () => {
    if (!signedBy.trim()) return toast('اكتب اسم المستلم/المسلّم', true)
    setBusy(true)
    const { error } = await supabase.from('handovers').insert({
      company_id: profile.company_id, unit_id: unit.id,
      booking_id: booking?.id || null, kind,
      checklist: items, notes, signed_by: signedBy, created_by: profile.id
    })
    setBusy(false)
    if (error) return toast('خطأ: ' + error.message, true)
    // إشعار داخلي
    await supabase.from('notifications').insert({
      company_id: profile.company_id, channel: 'in_app',
      event_type: 'handover',
      title: kind === 'check_in' ? 'تسليم وحدة' : 'استلام وحدة',
      body: `الوحدة ${unit.unit_number} — ${kind === 'check_in' ? 'تم التسليم' : 'تم الاستلام'} بواسطة ${profile.full_name}${damaged ? ` — ${damaged} عنصر بحاجة مراجعة` : ''}`,
      unit_id: unit.id, booking_id: booking?.id || null, status: 'sent'
    })
    await logActivity(supabase, profile, {
      action: 'handover', entity: 'handovers', entity_id: unit.id,
      summary: `${kind === 'check_in' ? 'تسليم' : 'استلام'} الوحدة ${unit.unit_number}${damaged ? ` — ${damaged} عنصر بحاجة مراجعة` : ''}`,
      sensitive: damaged > 0
    })
    toast(kind === 'check_in' ? '✓ تم توثيق التسليم' : '✓ تم توثيق الاستلام')
    onClose(true)
  }

  const cls = c => c === 'ok' ? 'hc-ok' : c === 'missing' ? 'hc-miss' : 'hc-dmg'

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose(false)}>
      <div className="modal" style={{ width: 'min(760px,100%)' }}>
        <div className="modal-h">
          <h3>{kind === 'check_in' ? '🔑 تسليم الوحدة للمستأجر' : '📥 استلام الوحدة من المستأجر'} — {unit.unit_number}</h3>
          <button className="x" onClick={() => onClose(false)}>✕</button>
        </div>
        <div className="modal-b">
          {items.length === 0
            ? <p style={{ color: 'var(--muted)' }}>لا توجد قائمة أثاث مسجلة لهذه الوحدة — يمكنك إضافة ملاحظات فقط.</p>
            : (
              <>
                <div className="ho-toolbar">
                  <b>عناصر الأثاث ({items.length}) — راجع كل عنصر</b>
                  {damaged > 0 && <span className="chip" style={{ background: 'rgba(217,54,54,.14)', color: 'var(--st-oc)' }}>{damaged} عنصر بحاجة مراجعة</span>}
                </div>
                <div className="ho-list">
                  {items.map((it, i) => (
                    <div key={i} className={'ho-row ' + cls(it.condition)}>
                      <div className="ho-name">{it.name}</div>
                      <div className="ho-conds">
                        {[['ok','سليم ✓'],['damaged','متضرر ⚠'],['missing','مفقود ✕']].map(([k,l]) => (
                          <label key={k}><input type="radio" name={'c'+i} checked={it.condition===k}
                            onChange={()=>update(i,{condition:k})} />{l}</label>
                        ))}
                      </div>
                      <input placeholder="ملاحظة…" value={it.note}
                        onChange={e=>update(i,{note:e.target.value})} />
                    </div>
                  ))}
                </div>
              </>
            )}
          <div className="grid2" style={{ marginTop: 14 }}>
            <div className="fld"><label>اسم المستلم/المسلّم (توقيع نصّي) *</label>
              <input value={signedBy} onChange={e=>setSignedBy(e.target.value)} /></div>
            <div className="fld"><label>ملاحظات عامة</label>
              <input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="حالة عامة، عداد الكهرباء، مفاتيح…" /></div>
          </div>
          <div style={{ display:'flex', gap:10, marginTop:16, flexWrap:'wrap' }}>
            <button className="btn btn-green" disabled={busy} onClick={save}>
              {kind === 'check_in' ? 'توثيق التسليم' : 'توثيق الاستلام'}
            </button>
            <button className="btn btn-gold" onClick={async () => {
              const serial = await issueSerial('handover', {
                table: 'units', id: unit?.id || null,
                meta: { kind, booking_id: booking?.id || null },
              })
              printHandoverChecklist({
                serial,
                unit,
                booking,
                company,
                employee: profile,
                checklistItems: items,
                kind,
                notes,
                signedBy
              })
            }}>🖨️ طباعة نموذج التسليم الفاخر (Check List)</button>
            <button className="btn btn-ghost" onClick={() => onClose(false)}>إلغاء</button>
          </div>

        </div>
      </div>
    </div>
  )
}
