import React, { useState } from 'react'
import { runSelfRepair, reportIssue } from '../lib/systemMonitor'
import { useAuth } from '../AuthContext'

/**
 * SelfRepairButton — زر «تصليح وتصحيح» متاح لجميع المستخدمين (حاليين وجدد).
 * ينفّذ إصلاحات آمنة فقط على بيانات منشأة المستخدم:
 *  • ربط الحجوزات بفروعها  • توليد أرقام عقود ناقصة  • تصحيح حالات وحدات عالقة
 * لا يحذف أي بيانات ولا يعدّل مبالغ — ويُسجّل في system_repair_log.
 */
export default function SelfRepairButton({ compact = false }) {
  const { toast, session } = useAuth()
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState(null)
  const [failure, setFailure] = useState(null)
  const [open, setOpen] = useState(false)

  if (!session) return null

  const run = async () => {
    if (busy) return
    setBusy(true); setFailure(null)
    try {
      const r = await runSelfRepair()
      setLast(r)
      if (r?.ok) {
        const total = r.total ?? ((r.branch_fixed || 0) + (r.contract_fixed || 0) + (r.status_fixed || 0))
        toast?.(total
          ? `تم التصحيح: ${r.branch_fixed || 0} حجز/فرع · ${r.contract_fixed || 0} رقم عقد · ${r.status_fixed || 0} حالة وحدة`
          : 'تم الفحص — لا توجد أخطاء تحتاج تصحيحاً ✅')
        if (total || (r.errors?.length)) setOpen(true)
      } else {
        setFailure({ message: r?.message || 'تعذّر تنفيذ الإصلاح' })
        setOpen(true)
        toast?.(r?.message || 'تعذّر تنفيذ الإصلاح', true)
      }
    } catch (e) {
      // تفاصيل الخطأ تُعرض للمستخدم وتُسجّل في تنبيهات النظام
      const detail = {
        message: e?.message || String(e),
        code: e?.code || null,
        details: e?.details || null,
        hint: e?.hint || null,
      }
      setFailure(detail); setOpen(true)
      await reportIssue('app', e, { step: 'self_repair_button' }, { severity: 'critical' })
      toast?.('تعذّر تنفيذ الإصلاح: ' + detail.message, true)
    } finally { setBusy(false) }
  }

  const conflicts = Array.isArray(last?.errors) ? last.errors : []

  return (
    <>
      <button
        className={'btn btn-ghost ' + (compact ? 'btn-sm' : '')}
        onClick={run}
        disabled={busy}
        title="فحص وتصحيح آمن لبيانات منشأتك (الحجوزات، الفروع، حالات الوحدات)"
      >
        {busy ? '⏳ جارٍ التصحيح…' : '🩺 تصليح وتصحيح'}
        {failure && !busy && <span style={{ marginInlineStart: 6, fontSize: 11 }}>⚠</span>}
        {!failure && last?.ok && !busy && <span className="muted" style={{ marginInlineStart: 6, fontSize: 11 }}>✓</span>}
      </button>

      {open && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal" style={{ width: 'min(560px,100%)' }}>
            <div className="modal-h">
              <h3>{failure ? '⚠ تفاصيل فشل الإصلاح' : '🩺 نتيجة الفحص والتصحيح'}</h3>
              <button className="x" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="modal-b">
              {failure ? (
                <div style={{ fontSize: 13, lineHeight: 1.9 }}>
                  <div><b>الرسالة:</b> {failure.message}</div>
                  {failure.code && <div><b>الرمز:</b> <span dir="ltr">{failure.code}</span></div>}
                  {failure.details && <div><b>التفاصيل:</b> <span dir="ltr">{String(failure.details)}</span></div>}
                  {failure.hint && <div><b>اقتراح:</b> {String(failure.hint)}</div>}
                  <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                    تم تسجيل الخطأ في تنبيهات النظام لمراجعته من إدارة المنصة.
                  </p>
                </div>
              ) : (
                <div style={{ fontSize: 13, lineHeight: 1.9 }}>
                  <div>🔗 ربط الحجوزات بفروعها: <b>{last?.branch_fixed || 0}</b></div>
                  <div>📄 أرقام عقود مُولّدة: <b>{last?.contract_fixed || 0}</b></div>
                  <div>🏠 حالات وحدات مُصحّحة: <b>{last?.status_fixed || 0}</b></div>
                  {conflicts.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <b>تعارضات تحتاج مراجعة يدوية ({conflicts.length}):</b>
                      <ul style={{ margin: '6px 18px 0 18px', fontSize: 12 }}>
                        {conflicts.slice(0, 10).map((c, i) => (
                          <li key={i}>{typeof c === 'string' ? c : JSON.stringify(c)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                    الإصلاح يعمل على بيانات منشأتك فقط، ولا يحذف بيانات ولا يعدّل أي مبالغ.
                  </p>
                </div>
              )}
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}