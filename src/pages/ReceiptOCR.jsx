import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { num, today } from '../lib/helpers'

/* قارئ فواتير بالذكاء الاصطناعي — يستخرج المبلغ والتاريخ والبائع من صورة الفاتورة
   ويحوّلها إلى مصروف جاهز للحفظ. يستدعي Edge Function `ocr-receipt`. */
export default function ReceiptOCR() {
  const { profile, toast } = useAuth()
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)

  const process = async (file) => {
    if (!file) return
    setPreview(URL.createObjectURL(file))
    setBusy(true); setResult(null)
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result)
        r.onerror = rej
        r.readAsDataURL(file)
      })
      const { data, error } = await supabase.functions.invoke('ocr-receipt', {
        body: { image: b64, mime: file.type }
      })
      if (error) throw error
      setResult(data)
      toast('✓ استخرج المساعد الذكي بيانات الفاتورة — راجعها ثم احفظ')
    } catch (e) {
      console.error('OCR Error:', e)
      setResult({ amount: '', vendor: '', date: today(), category: 'other' })
      toast('⚠️ تعذّر تشغيل القارئ التلقائي: ' + e.message + '. يمكنك إدخال البيانات يدوياً.', true)
    }
    setBusy(false)
  }

  const save = async () => {
    if (!result?.amount) return toast('لا يوجد مبلغ صالح للحفظ', true)
    const { error } = await supabase.from('expenses').insert({
      company_id: profile.company_id,
      category: result.category || 'other',
      amount: num(result.amount),
      description: `${result.vendor || 'فاتورة'} — ${result.date || ''}`,
      expense_date: result.date || undefined,
      created_by: profile.id
    })
    if (error) return toast('خطأ: ' + error.message, true)
    toast('✓ سُجل المصروف من الفاتورة')
    setResult(null); setPreview(null)
  }

  return (
    <div className="panel"><h3>📸 قارئ فواتير المصروفات بالذكاء الاصطناعي</h3>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
        ارفع صورة الفاتورة الورقية وسيستخرج المساعد المبلغ والتاريخ والبائع تلقائياً.
      </p>
      <input type="file" accept="image/*" onChange={e => process(e.target.files[0])} disabled={busy} />
      {busy && <p style={{ marginTop: 10, color: 'var(--gold-d)', fontWeight: 700 }}>⏳ جارٍ تحليل الفاتورة…</p>}
      {(preview || result) && (
        <div className="grid2" style={{ marginTop: 14 }}>
          {preview && <img src={preview} alt="preview" style={{ maxHeight: 260, borderRadius: 10, border: '1px solid var(--line)' }} />}
          {result && (
            <div>
              <label>المبلغ (ر.س)</label>
              <input type="number" value={result.amount || ''} onChange={e => setResult({ ...result, amount: e.target.value })} />
              <label>البائع</label>
              <input value={result.vendor || ''} onChange={e => setResult({ ...result, vendor: e.target.value })} />
              <label>التاريخ</label>
              <input type="date" value={result.date || ''} onChange={e => setResult({ ...result, date: e.target.value })} />
              <label>النوع</label>
              <select value={result.category || 'other'} onChange={e => setResult({ ...result, category: e.target.value })}>
                <option value="electricity">كهرباء</option><option value="water">ماء</option>
                <option value="maintenance">صيانة</option><option value="salaries">رواتب</option>
                <option value="cleaning">نظافة</option><option value="other">أخرى</option>
              </select>
              <button className="btn btn-green btn-sm" style={{ marginTop: 10 }} onClick={save}>💾 حفظ كمصروف</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
