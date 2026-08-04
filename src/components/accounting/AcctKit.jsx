import React, { useState } from 'react'
import { Printer, FileSpreadsheet, RefreshCw, Search } from 'lucide-react'
import { exportRows } from '../../lib/accountingApi'

/*
  مكوّنات مشتركة لكل صفحات المحاسبة.
  الغرض: صفحة واحدة نظيفة بترويسة موحّدة وأدوات طباعة وتصدير في مكان واحد،
  بدل تكرار الأزرار داخل كل صفحة كما كان سابقاً.
*/

/** ترويسة صفحة محاسبية: العنوان، الشرح، ثم الأدوات على اليسار. */
export function AcctPage({ title, icon, subtitle, tools, children }) {
  return (
    <div className="acct-page">
      <div className="acct-page-head">
        <div className="acct-page-ttl">
          <span className="acct-page-ico">{icon}</span>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
        </div>
        {tools && <div className="acct-page-tools">{tools}</div>}
      </div>
      {children}
    </div>
  )
}

/** شريط مرشّحات موحّد. */
export function AcctFilters({ children }) {
  return <div className="acct-filters">{children}</div>
}

export function Field({ label, children, wide }) {
  return (
    <label className={'acct-field' + (wide ? ' wide' : '')}>
      <span>{label}</span>
      {children}
    </label>
  )
}

/** زر تصدير إكسيل — يبني الصفوف من نفس البيانات المعروضة، لا من استعلام آخر. */
export function ExcelButton({ filename, sheet, rows, numericCols, disabled, onError }) {
  return (
    <button
      type="button" className="btn btn-ghost btn-sm" disabled={disabled || !rows?.length}
      title="تصدير ما هو معروض إلى ملف إكسيل بمعادلات إجمالية"
      onClick={() => {
        try { exportRows(filename, sheet, rows, numericCols) }
        catch (e) { onError?.(e.message) }
      }}
    >
      <FileSpreadsheet size={14} /> إكسيل
    </button>
  )
}

/** زر طباعة — يطبع منطقة محددة فقط في نافذة معزولة. */
export function PrintButton({ targetId, title, disabled }) {
  return (
    <button
      type="button" className="btn btn-ghost btn-sm" disabled={disabled}
      title="طباعة التقرير المعروض"
      onClick={() => printRegion(targetId, title)}
    >
      <Printer size={14} /> طباعة
    </button>
  )
}

export function RefreshButton({ onClick, busy }) {
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={onClick} disabled={busy} title="تحديث البيانات">
      <RefreshCw size={14} className={busy ? 'spin' : ''} /> تحديث
    </button>
  )
}

/**
 * يطبع عنصراً في الصفحة داخل نافذة مستقلة.
 * سبب النافذة المستقلة: إخفاء بقية الصفحة عبر @media print كان يطبع
 * القائمة الجانبية وأي نافذة مفتوحة مع التقرير.
 */
export function printRegion(targetId, title = 'تقرير محاسبي') {
  const el = document.getElementById(targetId)
  if (!el) return
  const w = window.open('', '_blank', 'width=1100,height=800')
  if (!w) return
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>${title}</title>
<style>
 *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
 body{font-family:'Tajawal','Cairo',system-ui,sans-serif;margin:0;padding:22px;color:#0E2340;font-size:13px}
 h1{font-size:19px;margin:0 0 4px;border-bottom:3px double #C6A24B;padding-bottom:8px}
 .meta{color:#64748B;font-size:12px;margin-bottom:14px}
 table{width:100%;border-collapse:collapse;margin-top:8px}
 th,td{border:1px solid #CBD5E1;padding:5px 7px;text-align:right}
 th{background:#0E2340;color:#fff;font-weight:700}
 tbody tr:nth-child(even){background:#F8FAFC}
 tfoot td{background:#FEF9E7;font-weight:800;border-top:2px solid #C6A24B}
 .num{text-align:left;font-variant-numeric:tabular-nums}
 .acct-lvl-pad{display:inline-block}
 button,.no-print{display:none!important}
</style></head><body>
<h1>${title}</h1>
<div class="meta">${document.title || 'منصة المازن'} — طُبع في ${new Date().toLocaleString('ar-SA')}</div>
${el.innerHTML}
</body></html>`)
  w.document.close()
  w.focus()
  setTimeout(() => { w.print() }, 350)
}

/** بحث نصي صغير موحّد. */
export function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="acct-search">
      <Search size={14} />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder || 'بحث…'} />
    </div>
  )
}

/** رسالة حالة موحّدة: خطأ أو نجاح أو فراغ. */
export function Notice({ kind = 'info', children, onClose }) {
  if (!children) return null
  return (
    <div className={'acct-notice ' + kind}>
      <span>{children}</span>
      {onClose && <button type="button" onClick={onClose} aria-label="إغلاق">✕</button>}
    </div>
  )
}

export function EmptyState({ children }) {
  return <div className="acct-empty">{children}</div>
}

/** نافذة منبثقة بسيطة للنماذج. */
export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="acct-modal-back" onClick={onClose}>
      <div className={'acct-modal' + (wide ? ' wide' : '')} onClick={e => e.stopPropagation()}>
        <div className="acct-modal-head">
          <b>{title}</b>
          <button type="button" onClick={onClose} aria-label="إغلاق">✕</button>
        </div>
        <div className="acct-modal-body">{children}</div>
      </div>
    </div>
  )
}

/** تأكيد حذف — الحذف فعل لا رجعة فيه فيجب أن يُسأل عنه صراحةً. */
export function useConfirm() {
  const [ask, setAsk] = useState(null)
  const confirm = (message, onYes) => setAsk({ message, onYes })
  const node = ask ? (
    <Modal title="تأكيد" onClose={() => setAsk(null)}>
      <p style={{ margin: '4px 0 16px' }}>{ask.message}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-start' }}>
        <button className="btn btn-danger btn-sm" onClick={() => { const f = ask.onYes; setAsk(null); f() }}>نعم، نفّذ</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setAsk(null)}>إلغاء</button>
      </div>
    </Modal>
  ) : null
  return { confirm, confirmNode: node }
}
