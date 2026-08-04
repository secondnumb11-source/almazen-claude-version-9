import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../AuthContext'
import { exportCSV } from '../../lib/helpers'

/**
 * UniversalCrud — واجهة CRUD ديناميكية عامة تعمل مع أي جدول تُمرَّر إليه.
 * تعتمد على سياسات RLS في قاعدة البيانات لضبط ما يستطيع كل مستخدم رؤيته/تعديله،
 * لذا هي آمنة للعرض لجميع المستخدمين — سيرى كل مستخدم فقط ما تسمح به سياساته.
 *
 * props:
 *  - table: اسم الجدول
 *  - title: عنوان القسم
 *  - fields: [{ key, label, type: text|number|date|select|textarea|checkbox, options?, required? }]
 *  - primaryKey?: افتراضي "id"
 *  - orderBy?: افتراضي "created_at desc"
 */
export default function UniversalCrud({ table, title, fields, primaryKey = 'id', orderBy = 'created_at.desc' }) {
  const { toast } = useAuth() || {}
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null) // row or {new:true}
  const [form, setForm] = useState({})

  const [orderCol, orderDir] = orderBy.split('.')

  const load = async () => {
    setLoading(true); setErr('')
    const { data, error } = await supabase.from(table).select('*').order(orderCol, { ascending: orderDir !== 'desc' }).limit(500)
    if (error) setErr(error.message)
    setRows(data || []); setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [table])

  const filtered = useMemo(() => {
    if (!q.trim()) return rows
    const needle = q.trim().toLowerCase()
    return rows.filter(r => JSON.stringify(r).toLowerCase().includes(needle))
  }, [rows, q])

  const openNew = () => {
    const initial = {}
    fields.forEach(f => { initial[f.key] = f.type === 'checkbox' ? false : '' })
    setForm(initial); setEditing({ __new: true })
  }
  const openEdit = (r) => {
    const f = {}
    fields.forEach(x => { f[x.key] = r[x.key] ?? (x.type === 'checkbox' ? false : '') })
    setForm(f); setEditing(r)
  }
  const close = () => { setEditing(null); setForm({}) }

  const save = async () => {
    for (const f of fields) {
      if (f.required && (form[f.key] === '' || form[f.key] === null || form[f.key] === undefined)) {
        return alert(`الحقل "${f.label}" مطلوب`)
      }
    }
    const payload = {}
    fields.forEach(f => {
      let v = form[f.key]
      if (f.type === 'number' && v !== '' && v !== null) v = Number(v)
      if (v === '') v = null
      payload[f.key] = v
    })
    try {
      if (editing.__new) {
        const { error } = await supabase.from(table).insert(payload)
        if (error) throw error
        toast?.('✓ تمت الإضافة')
      } else {
        const { error } = await supabase.from(table).update(payload).eq(primaryKey, editing[primaryKey])
        if (error) throw error
        toast?.('✓ تم التعديل')
      }
      close(); load()
    } catch (e) { alert(e.message) }
  }

  const del = async (r) => {
    if (!confirm('تأكيد الحذف؟')) return
    const { error } = await supabase.from(table).delete().eq(primaryKey, r[primaryKey])
    if (error) return alert(error.message)
    toast?.('✓ حُذف'); load()
  }

  const doCSV = () => exportCSV(`${table}_${new Date().toISOString().slice(0, 10)}.csv`, filtered)

  const cell = { padding: '6px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontSize: 13 }

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <button className="btn btn-gold btn-sm" onClick={openNew}>➕ إضافة</button>
        <button className="btn btn-ghost btn-sm" onClick={load}>🔄</button>
        <button className="btn btn-ghost btn-sm" onClick={doCSV} disabled={!filtered.length}>⬇️ CSV</button>
        <input placeholder="🔍 بحث" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{filtered.length}/{rows.length}</span>
      </div>

      {err && <div style={{ color: '#B91C1C', fontSize: 13, marginBottom: 8 }}>خطأ: {err}</div>}
      {loading && <div style={{ color: 'var(--muted)', fontSize: 13 }}>… تحميل</div>}

      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'auto', maxHeight: 480 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#F8FAFC', position: 'sticky', top: 0 }}>
            <tr>
              {fields.map(f => <th key={f.key} style={cell}>{f.label}</th>)}
              <th style={cell}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={fields.length + 1} style={{ ...cell, textAlign: 'center', color: 'var(--muted)' }}>
                {rows.length ? 'لا توجد نتائج للبحث' : 'لا توجد سجلات'}
              </td></tr>
            ) : filtered.map(r => (
              <tr key={r[primaryKey]}>
                {fields.map(f => (
                  <td key={f.key} style={cell}>
                    {f.type === 'checkbox' ? (r[f.key] ? '✓' : '—') : String(r[f.key] ?? '')}
                  </td>
                ))}
                <td style={cell}>
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)}>تعديل</button>{' '}
                  <button className="btn btn-ghost btn-sm" onClick={() => del(r)}>حذف</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={close}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, minWidth: 320, maxWidth: 560, width: '90%' }}
               onClick={e => e.stopPropagation()}>
            <h4 style={{ marginTop: 0 }}>{editing.__new ? '➕ إضافة' : '✏️ تعديل'} — {title}</h4>
            <div style={{ display: 'grid', gap: 10 }}>
              {fields.map(f => (
                <label key={f.key} style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {f.label}{f.required ? ' *' : ''}
                  </span>
                  {f.type === 'textarea' ? (
                    <textarea rows="3" value={form[f.key] ?? ''} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />
                  ) : f.type === 'select' ? (
                    <select value={form[f.key] ?? ''} onChange={e => setForm({ ...form, [f.key]: e.target.value })}>
                      <option value="">—</option>
                      {(f.options || []).map(o => (
                        <option key={typeof o === 'string' ? o : o.value} value={typeof o === 'string' ? o : o.value}>
                          {typeof o === 'string' ? o : o.label}
                        </option>
                      ))}
                    </select>
                  ) : f.type === 'checkbox' ? (
                    <input type="checkbox" checked={!!form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.checked })} />
                  ) : (
                    <input
                      type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                      value={form[f.key] ?? ''} onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                    />
                  )}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={close}>إلغاء</button>
              <button className="btn btn-gold btn-sm" onClick={save}>💾 حفظ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
