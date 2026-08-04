import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { SAR } from '../lib/helpers'
import { reconcileMaintenanceExpenses } from '../lib/accountingSync'
import { Wrench, CheckCircle2, ShieldCheck, RefreshCw, BarChart2 } from 'lucide-react'

export default function AutomatedMaintenanceReconciliationTool() {
  const { profile, toast } = useAuth()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)

  const handleRunReconciliation = async () => {
    if (!profile?.company_id) return
    setRunning(true)
    try {
      const res = await reconcileMaintenanceExpenses(supabase, profile.company_id)
      if (res.success) {
        setResult(res)
        if (res.autoFixedEntriesCount > 0) {
          toast(`✨ اكتملت التسوية الآلية: تم إنشاء وتوزين (${res.autoFixedEntriesCount}) قيود يومية للمصروفات وتوزيعها على الوحدات بنجاح.`, false)
        } else {
          toast('✅ مطابقة سارية 100%: جميع مصروفات الصيانة موزونة وموزعة بالكامل في الدفتر العام.', false)
        }
      } else {
        toast('خطأ أثناء تسوية الصيانة: ' + (res.error || 'عطل غير متوقع'), true)
      }
    } catch (e) {
      toast('خطأ في الاتصال بالسكربت: ' + e.message, true)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="tool-card" style={{ border: '2px solid #3B82F6', background: '#F8FAFC', borderRadius: '16px', padding: '20px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#1E40AF' }}>
            <Wrench size={22} />
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800' }}>🛠️ التسوية الآلية لمصروفات الصيانة والخدمات</h3>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748B' }}>
            تتبع أوتوماتيكي لكافة مصاريف وفواتير الصيانة وتوزيعها على الوحدات العقارية، وتأكيد التوازن المزدوج بالدفتر العام.
          </p>
        </div>
        <button
          className="btn btn-blue"
          disabled={running}
          onClick={handleRunReconciliation}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', fontWeight: '700' }}
        >
          <RefreshCw size={16} className={running ? 'spin' : ''} />
          <span>{running ? 'جاري تتبع وتسوية المصروفات...' : 'تشغيل التسوية والتوزيع الآن'}</span>
        </button>
      </div>

      {result && (
        <div style={{ background: '#FFFFFF', borderRadius: '12px', padding: '16px', border: '1px solid #E2E8F0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #F1F5F9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#166534', fontWeight: '800', fontSize: '14px' }}>
              <ShieldCheck size={18} />
              <span>الحالة: {result.generalLedgerStatus}</span>
            </div>
            <span style={{ fontSize: '12px', color: '#94A3B8' }}>تاريخ آخر تشغيل: {result.timestamp}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginBottom: '16px' }}>
            <div style={{ background: '#EFF6FF', padding: '12px', borderRadius: '8px', border: '1px solid #BFDBFE' }}>
              <span style={{ display: 'block', fontSize: '11px', color: '#1E40AF', marginBottom: '2px' }}>عدد السجلات المحللة</span>
              <span style={{ fontSize: '16px', fontWeight: '800', color: '#1E3A8A' }}>{result.totalExpensesAnalyzed}</span>
            </div>

            <div style={{ background: '#F0FDF4', padding: '12px', borderRadius: '8px', border: '1px solid #BBF7D0' }}>
              <span style={{ display: 'block', fontSize: '11px', color: '#166534', marginBottom: '2px' }}>إجمالي التكاليف المسواة</span>
              <span style={{ fontSize: '16px', fontWeight: '800', color: '#14532D' }}>{SAR(result.totalAmountAnalyzed)}</span>
            </div>

            <div style={{ background: '#FEF3C7', padding: '12px', borderRadius: '8px', border: '1px solid #FDE68A' }}>
              <span style={{ display: 'block', fontSize: '11px', color: '#92400E', marginBottom: '2px' }}>قيود تمت معالجتها آلياً</span>
              <span style={{ fontSize: '16px', fontWeight: '800', color: '#78350F' }}>{result.autoFixedEntriesCount}</span>
            </div>

            <div style={{ background: '#FAF5FF', padding: '12px', borderRadius: '8px', border: '1px solid #E9D5FF' }}>
              <span style={{ display: 'block', fontSize: '11px', color: '#6B21A8', marginBottom: '2px' }}>قيود موزونة بالدفتر</span>
              <span style={{ fontSize: '16px', fontWeight: '800', color: '#581C87' }}>{result.balancedEntriesCount}</span>
            </div>
          </div>

          <h4 style={{ margin: '12px 0 8px', fontSize: '14px', color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <BarChart2 size={16} />
            <span>بيان توزيع مصاريف الصيانة على الوحدات العقارية (Apportionment by Unit):</span>
          </h4>

          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>الوحدة العقارية</th>
                  <th>حصة الوحدة من الصيانة</th>
                  <th>عدد العمليات</th>
                  <th>حالة التوازن في الدفتر العام</th>
                </tr>
              </thead>
              <tbody>
                {result.unitApportionmentList?.length > 0 ? (
                  result.unitApportionmentList.map((item, idx) => (
                    <tr key={idx}>
                      <td data-label="الوحدة العقارية" style={{ fontWeight: '700' }}>{item.unitNumber}</td>
                      <td data-label="حصة الوحدة من الصيانة">{SAR(item.totalMaintenanceCost)}</td>
                      <td data-label="عدد العمليات">{item.entriesCount} سجلات</td>
                      <td data-label="حالة التوازن في الدفتر العام">
                        <span className="chip chip-green" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle2 size={12} />
                          <span>{item.status}</span>
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" style={{ textAlign: 'center', color: '#94A3B8', padding: '16px' }}>
                      لا توجد تكاليف صيانة مسجلة بالفترة الحالية.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
