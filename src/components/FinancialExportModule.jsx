import React, { useState } from 'react'
import { useAuth } from '../AuthContext'

export default function FinancialExportModule({ moduleTitle = 'تصدير التقارير المالية (Export Module)', data, onExport }) {
  const { toast } = useAuth()
  const [exportFormat, setExportFormat] = useState('pdf')
  const [reportType, setReportType] = useState('balances') // balances, transactions, settlements

  const handleExport = () => {
    if (onExport) {
      onExport({ format: exportFormat, type: reportType })
    }
  }

  return (
    <div className="panel" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
      <h4 style={{ marginBottom: 16 }}>📥 {moduleTitle}</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <div>
          <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '8px' }}>نوع التقرير المراد تصديره</label>
          <select value={reportType} onChange={e => setReportType(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}>
            <option value="balances">أرصدة شجرة الحسابات</option>
            <option value="transactions">سجل القيود والعمليات</option>
            <option value="settlements">تقارير تسويات خروج الوحدات</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '8px' }}>صيغة التصدير</label>
          <select value={exportFormat} onChange={e => setExportFormat(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}>
            <option value="pdf">ملف PDF للطباعة (أفضل للقراءة)</option>
            <option value="csv">جدول بيانات CSV (أفضل للتحليل)</option>
          </select>
        </div>
      </div>
      <button className="btn btn-blue" style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }} onClick={handleExport}>
        <span>تصدير التقرير الآن</span>
        <b style={{ background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: '4px', fontSize: '11px' }}>{exportFormat.toUpperCase()}</b>
      </button>
      <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '12px', textAlign: 'center' }}>
        يتم جلب البيانات الحالية من النظام مباشرة لحظة التصدير لضمان دقة التقارير.
      </p>
    </div>
  )
}
