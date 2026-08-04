import React from 'react'
import Units from './Units'
import BranchFilter from '../components/BranchFilter'
import { useBranches } from '../BranchContext'

export default function Dashboard({ editMode, setEditMode }) {
  // تغيير الفرع من الهيدر (أو من هذا المنتقي) يعيد بناء الشاشة فعلياً
  // فتُعاد جميع الاستعلامات المقيّدة بـ scopeQuery داخل Units.
  const { enabled, activeBranchName, activeBranch } = useBranches()

  return (
    <div>
      {enabled && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          marginBottom: 12, padding: '8px 12px', border: '1px solid var(--border)',
          borderRadius: 10, background: 'var(--soft)',
        }}>
          <BranchFilter label="الفرع" compact />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            البيانات المعروضة مقيّدة بـ: <b>{activeBranchName || 'كل الفروع'}</b>
          </span>
        </div>
      )}
      <Units key={activeBranch || 'all'} />
    </div>
  )
}

