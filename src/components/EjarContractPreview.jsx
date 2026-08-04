import React, { useMemo } from 'react'
import { buildEjarPreviewRows, isPreviewValid } from '../lib/ejarValidation'

/*
  EjarContractPreview — Modal يعرض خريطة الحقول التي ستُرسل لمنصة إيجار
  مع نتيجة التحقق لكل حقل. زر الإرسال يبقى معطّلاً حتى تنطبق جميع الشروط.
*/
export default function EjarContractPreview({ company, unit, customer, booking, onClose, onConfirm, busy }) {
  const rows = useMemo(() => buildEjarPreviewRows({ company, unit, customer, booking }), [company, unit, customer, booking])
  const valid = isPreviewValid(rows)
  const failed = rows.filter(r => !r.check.ok).length

  const grouped = rows.reduce((acc, r) => {
    (acc[r.section] = acc[r.section] || []).push(r); return acc
  }, {})

  return (
    <div className="ejar-preview-backdrop" onClick={onClose}>
      <div className="ejar-preview" onClick={e => e.stopPropagation()}>
        <header className="ep-head">
          <div>
            <h3>🏛️ معاينة الحقول قبل الإرسال إلى منصة إيجار</h3>
            <p>هذه هي الحقول الفعلية التي سيرسلها النظام. لن يُسمح بالإرسال إلا بعد اجتياز كل عمليات التحقق.</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕ إغلاق</button>
        </header>

        <div className={'ep-status ' + (valid ? 'ok' : 'err')}>
          {valid
            ? '✓ جميع الحقول مطابقة لمتطلبات إيجار — يمكن الإرسال بأمان'
            : `⚠️ يوجد ${failed} حقل/حقول لا تنطبق عليها المتطلبات — أكملها قبل الإرسال`}
        </div>

        <div className="ep-body">
          {Object.entries(grouped).map(([section, items]) => (
            <section key={section} className="ep-section">
              <h4>{section}</h4>
              <table className="ep-tbl">
                <thead><tr><th>الحقل</th><th>القيمة المُرسلة</th><th>الحالة</th></tr></thead>
                <tbody>
                  {items.map((r, i) => (
                    <tr key={i} className={r.check.ok ? 'ok' : 'err'}>
                      <td>{r.label}</td>
                      <td dir="ltr" className="ep-val">{r.value == null || r.value === '' ? '—' : String(r.value)}</td>
                      <td>
                        {r.check.ok
                          ? <span className="ep-badge ok">✅ مطابق</span>
                          : <span className="ep-badge err">❌ {r.check.reason}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>

        <footer className="ep-foot">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
          <button className="btn btn-gold" disabled={!valid || busy} onClick={onConfirm}
            title={valid ? 'إرسال إلى إيجار' : 'أكمل الحقول الناقصة أولاً'}>
            {busy ? '...جارٍ الإرسال' : '📤 إرسال إلى إيجار الآن'}
          </button>
        </footer>
      </div>
    </div>
  )
}
