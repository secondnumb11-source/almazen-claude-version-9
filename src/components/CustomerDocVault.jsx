import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { uploadFile, today, openStoredDocument } from '../lib/helpers'
import { FileText, Upload, Trash2, Eye, ExternalLink, Plus, CheckCircle, ShieldAlert } from 'lucide-react'

export const DOC_TYPES = {
  national_id: 'هوية وطنية',
  iqama: 'إقامة مقيم',
  passport: 'جواز سفر',
  driving_license: 'رخصة قيادة',
  family_card: 'كرت عائلة',
  contract: 'عقد ورقي موثق',
  other: 'مستند آخر'
}

export default function CustomerDocVault({ customer, onUpdated }) {
  const { profile, toast } = useAuth()
  const [docs, setDocs] = useState(() => {
    try {
      if (Array.isArray(customer?.documents)) return customer.documents
      if (customer?.documents_json) return JSON.parse(customer.documents_json)
      // Check embedded tags in notes
      const match = customer?.notes?.match(/\[DOCUMENTS:(.*?)\]/)
      if (match?.[1]) return JSON.parse(match[1])
    } catch (_) {}
    
    // Default fallback if main id_document_url exists
    if (customer?.id_document_url) {
      return [{
        id: 'main_id_' + customer.id,
        title: 'صورة الإثبات الرئيسي (' + (DOC_TYPES[customer.id_type] || 'هوية') + ')',
        type: customer.id_type || 'national_id',
        url: customer.id_document_url,
        uploaded_at: customer.created_at?.slice(0, 10) || today(),
        notes: 'تم الرفع عند التسجيل الأول'
      }]
    }
    return []
  })

  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({
    title: '',
    type: 'national_id',
    doc_number: '',
    expiry_date: '',
    notes: ''
  })
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)

  const saveDocuments = async (newDocsList) => {
    setDocs(newDocsList)
    const jsonStr = JSON.stringify(newDocsList)

    // Save directly to database
    try {
      // 1. Try column update
      const { error: errCol } = await supabase
        .from('customers')
        .update({
          documents_json: jsonStr,
          // Also set primary id_document_url if first document available
          id_document_url: newDocsList[0]?.url || customer.id_document_url
        })
        .eq('id', customer.id)

      if (errCol) {
        // Fallback: Embed inside notes field if column not created
        let currentNotes = customer.notes || ''
        currentNotes = currentNotes.replace(/\[DOCUMENTS:.*?\]/g, '').trim()
        const updatedNotes = `${currentNotes} [DOCUMENTS:${jsonStr}]`.trim()

        await supabase
          .from('customers')
          .update({ notes: updatedNotes })
          .eq('id', customer.id)
      }

      if (onUpdated) onUpdated()
      toast('✓ تم تحديث أرشيف المستندات بنجاح')
    } catch (err) {
      toast('خطأ أثناء حفظ المستندات: ' + err.message, true)
    }
  }

  const handleAdd = async () => {
    if (!f.title.trim()) return toast('يرجى أدخال عنوان المستند', true)
    if (!file) return toast('يرجى اختيار ملف الصورة أو المستند', true)

    setUploading(true)
    try {
      const url = await uploadFile(supabase, 'documents', profile.company_id, file)
      const newDoc = {
        id: 'doc_' + Date.now(),
        title: f.title.trim(),
        type: f.type,
        doc_number: f.doc_number.trim(),
        expiry_date: f.expiry_date || null,
        notes: f.notes.trim(),
        url,
        uploaded_at: today(),
        uploaded_by: profile.full_name || 'الموظف'
      }

      const updated = [newDoc, ...docs]
      await saveDocuments(updated)

      setF({ title: '', type: 'national_id', doc_number: '', expiry_date: '', notes: '' })
      setFile(null)
      setAdding(false)
    } catch (err) {
      toast('فشل رفع المستند: ' + err.message, true)
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (docId) => {
    if (!confirm('هل أنت متأكد من حذف هذا المستند من أرشيف العميل؟')) return
    const updated = docs.filter(d => d.id !== docId)
    await saveDocuments(updated)
  }

  return (
    <div style={{ background: '#ffffff', borderRadius: '14px', border: '1px solid #E2E8F0', padding: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '800', color: '#0A192F', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={20} color="#C9A84C" />
            أرشيف المستندات والوثائق الرسمية ({docs.length})
          </h4>
          <span style={{ fontSize: '12px', color: '#64748B' }}>
            تُحفظ الوثائق مرة واحدة ويتم استدعاؤها تلقائياً في كل حجز جديد دون الحاجة لإعادة الرفع
          </span>
        </div>
        {!adding && (
          <button
            className="btn btn-gold btn-sm"
            onClick={() => setAdding(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700' }}
          >
            <Plus size={16} /> رفع وثيقة جديدة
          </button>
        )}
      </div>

      {/* Upload New Document Box */}
      {adding && (
        <div style={{
          background: '#FEFCE8',
          border: '1px solid #FDE047',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '20px',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <h5 style={{ margin: '0 0 12px', fontSize: '14px', color: '#854D0E', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Upload size={16} /> رفع وثيقة رسمية جديدة للعميل
          </h5>
          <div className="grid2" style={{ gap: '12px', marginBottom: '12px' }}>
            <div className="fld">
              <label>عنوان المستند (مثال: الهوية الوطنية - الوجه الأمامي) *</label>
              <input
                value={f.title}
                onChange={e => setF({ ...f, title: e.target.value })}
                placeholder="أدخل مسمى واضح للوثيقة..."
              />
            </div>
            <div className="fld">
              <label>نوع الوثيقة</label>
              <select value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>
                {Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="fld">
              <label>رقم الوثيقة / الهوية (اختياري)</label>
              <input
                value={f.doc_number}
                onChange={e => setF({ ...f, doc_number: e.target.value })}
                placeholder="10XXXXX"
                dir="ltr"
              />
            </div>
            <div className="fld">
              <label>تاريخ الانتهاء (اختياري)</label>
              <input
                type="date"
                value={f.expiry_date}
                onChange={e => setF({ ...f, expiry_date: e.target.value })}
              />
            </div>
            <div className="fld" style={{ gridColumn: '1 / -1' }}>
              <label>ملف الصورة أو PDF *</label>
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={e => setFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="fld" style={{ gridColumn: '1 / -1' }}>
              <label>ملاحظات إضافية (اختياري)</label>
              <input
                value={f.notes}
                onChange={e => setF({ ...f, notes: e.target.value })}
                placeholder="مثال: مطابقة للأصل، سارية المفعول..."
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setAdding(false); setFile(null) }}
            >
              إلغاء
            </button>
            <button
              className="btn btn-gold btn-sm"
              disabled={uploading}
              onClick={handleAdd}
              style={{ fontWeight: '800' }}
            >
              {uploading ? 'جاري الرفع والحفظ...' : 'حفظ الوثيقة في أرشيف العميل'}
            </button>
          </div>
        </div>
      )}

      {/* Documents Gallery Grid */}
      {docs.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '30px 20px',
          background: '#F8FAFC',
          borderRadius: '12px',
          border: '1px dashed #CBD5E1',
          color: '#64748B'
        }}>
          <FileText size={36} color="#CBD5E1" style={{ marginBottom: '8px' }} />
          <div style={{ fontSize: '14px', fontWeight: '700' }}>لا توجد وثائق مخزنة في أرشيف العميل حتى الآن</div>
          <p style={{ fontSize: '12px', marginTop: '4px' }}>قم برفع صورة الهوية أو الإقامة لحفظها واستدعاؤها آلياً عند إجراء أي حجز جديد.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' }}>
          {docs.map(doc => (
            <div
              key={doc.id}
              style={{
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: '12px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                justify: 'space-between',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                position: 'relative'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <span className="chip chip-gold" style={{ fontSize: '10px' }}>
                    {DOC_TYPES[doc.type] || 'وثيقة'}
                  </span>
                  <span style={{ fontSize: '10px', color: '#94A3B8' }}>{doc.uploaded_at}</span>
                </div>

                <strong style={{ display: 'block', fontSize: '13px', color: '#0A192F', marginBottom: '4px', lineHeight: '1.4' }}>
                  {doc.title}
                </strong>

                {doc.doc_number && (
                  <div style={{ fontSize: '11px', color: '#475569', marginBottom: '4px' }}>
                    رقم المستند: <span dir="ltr" style={{ fontWeight: '700' }}>{doc.doc_number}</span>
                  </div>
                )}

                {doc.notes && (
                  <div style={{ fontSize: '11px', color: '#64748B', fontStyle: 'italic', marginBottom: '8px' }}>
                    "{doc.notes}"
                  </div>
                )}
              </div>

              <div style={{
                display: 'flex',
                gap: '6px',
                marginTop: '10px',
                paddingTop: '10px',
                borderTop: '1px solid #E2E8F0',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <button
                  type="button"
                  onClick={() => openStoredDocument(supabase, doc.url, {
                    onError: message => toast(message, true),
                    context: { area: 'customer_document_vault', customer_id: customer?.id || null, document_id: doc.id },
                  })}
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: '11px', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Eye size={14} /> معاينة / فتح
                </button>

                <button
                  onClick={() => handleDelete(doc.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#EF4444',
                    cursor: 'pointer',
                    padding: '4px',
                    borderRadius: '4px'
                  }}
                  title="حذف الوثيقة"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
