import React from 'react'

/*
  حدّ خطأ حول الصفحات المحمَّلة كسولاً.

  السبب: كل صفحات النظام تُحمَّل بـ lazy() داخل Suspense بلا أي حدّ خطأ.
  حين يفشل تحميل حزمة الصفحة — وهو أمر حتمي لكل تبويب مفتوح بعد أي نشر
  جديد، لأن أسماء الحزم مُبصمة بالمحتوى فتختفي القديمة — كان React يرمي
  الخطأ لأعلى فيُفرَّغ التطبيق بالكامل وتظهر صفحة خطأ المستضيف البيضاء.
  العَرَض المُبلَّغ: النظام يتوقف عند دخول أي قسم، لكل المستخدمين.

  العلاج هنا مزدوج:
  (1) فشل تحميل حزمة = نسخة قديمة → إعادة تحميل واحدة تجلب الفهرس الجديد.
      علم في sessionStorage يمنع حلقة إعادة تحميل لا تنتهي.
  (2) أي خطأ آخر يُعرَض داخل الصفحة مع زر عودة — دون إسقاط النظام كله.
*/

const RELOAD_FLAG = 'almazen_chunk_reload'

const isChunkError = (err) => {
  const s = `${err?.name || ''} ${err?.message || ''}`
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported|error loading dynamically imported|Importing a module script failed/i.test(s)
}

export default class PageBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { err: null }
  }

  static getDerivedStateFromError(err) {
    return { err }
  }

  componentDidCatch(err) {
    if (!isChunkError(err)) return
    let already = false
    try { already = sessionStorage.getItem(RELOAD_FLAG) === '1' } catch { /* تخزين محجوب */ }
    if (already) return
    try { sessionStorage.setItem(RELOAD_FLAG, '1') } catch { /* تخزين محجوب */ }
    window.location.reload()
  }

  componentDidUpdate(prevProps) {
    // العودة لصفحة سليمة تُنهي حالة الخطأ
    if (this.state.err && prevProps.pageKey !== this.props.pageKey) {
      this.setState({ err: null })
    }
  }

  render() {
    const { err } = this.state
    if (!err) return this.props.children

    const chunk = isChunkError(err)
    return (
      <div style={{
        margin: '2rem auto', maxWidth: 560, textAlign: 'center', padding: '2rem 1.5rem',
        border: '1px solid #E5E7EB', borderRadius: 16, background: '#fff', direction: 'rtl',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>{chunk ? '🔄' : '⚠️'}</div>
        <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800, color: '#0F172A' }}>
          {chunk ? 'صدر تحديث جديد للنظام' : 'تعذّر عرض هذا القسم'}
        </h3>
        <p style={{ margin: '0 0 18px', color: '#475569', fontSize: 14, lineHeight: 1.8 }}>
          {chunk
            ? 'نسخة الصفحة المفتوحة قديمة. أعد التحميل لمتابعة العمل — بياناتك محفوظة ولن تفقد شيئاً.'
            : 'حدث خطأ داخل هذا القسم فقط، وبقية النظام تعمل. أعد المحاولة أو انتقل لقسم آخر.'}
        </p>
        <button
          onClick={() => { try { sessionStorage.removeItem(RELOAD_FLAG) } catch { /* محجوب */ } window.location.reload() }}
          style={{
            padding: '10px 22px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: '#1E3A5F', color: '#fff', fontWeight: 700, fontSize: 14,
          }}>
          إعادة تحميل النظام
        </button>
        <div style={{ marginTop: 14, fontSize: 11, color: '#94A3B8', wordBreak: 'break-word' }}>
          {String(err?.message || err).slice(0, 140)}
        </div>
      </div>
    )
  }
}
