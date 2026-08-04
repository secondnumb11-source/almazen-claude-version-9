/**
 * BranchFilter — منتقي الفرع القابل لإعادة الاستخدام
 * يظهر في الصفحات العادية للجميع، لكنه مقفول للمستخدمين غير المصرّح لهم:
 * الضغط عليه يُظهر رسالة «هذه الميزة من الباقة المتقدمة، للاستخدام تواصل مع الدعم»،
 * بينما المصرّح لهم (المُفعّلون من super admin) يستخدمونه بالكامل بلا أي رسالة.
 */
import React from 'react'
import { useBranches } from '../BranchContext'

export default function BranchFilter({ label = 'الفرع', compact = false, style }) {
  const {
    enabled, branches, activeBranch, setActiveBranch, requireFeature,
    includeUnassigned, setIncludeUnassigned,
  } = useBranches()

  if (!enabled) {
    return (
      <button
        type="button"
        className="btn ghost"
        onClick={() => requireFeature()}
        title="ميزة الفروع — الباقة المتقدمة"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...style }}
      >
        <span>🏢</span><span>{label}</span><span>🔒</span>
      </button>
    )
  }

  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, ...style }}>
      {!compact && <span style={{ fontSize: 12, opacity: .8 }}>🏢 {label}</span>}
      <select
        value={activeBranch}
        onChange={e => setActiveBranch(e.target.value)}
        aria-label="تصفية حسب الفرع"
      >
        <option value="">كل الفروع المتاحة</option>
        {branches.map(b => (
          <option key={b.id} value={b.id}>
            {b.name}{b.code ? ` (${b.code})` : ''}{b.is_active === false ? ' — موقوف' : ''}
          </option>
        ))}
      </select>

      {/* خيار المستخدم: السجلات التي أُنشئت قبل تفعيل الفروع تحمل branch_id فارغاً،
          وإخفاؤها يُفرغ الشاشة. التسامح مُفعَّل افتراضياً. */}
      {activeBranch && (
        <label
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, opacity: .85, cursor: 'pointer' }}
          title="السجلات القديمة التي أُنشئت قبل تفعيل الفروع غير موسومة بأي فرع. أوقف الخيار لعرض سجلات هذا الفرع حصراً."
        >
          <input
            type="checkbox"
            checked={includeUnassigned !== false}
            onChange={e => setIncludeUnassigned(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <span>+ غير المُسندة لفرع</span>
        </label>
      )}
    </label>
  )
}
