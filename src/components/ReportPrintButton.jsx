import React, { useState } from 'react'
import { useAuth } from '../AuthContext'
import PrintableDoc, { DocGrid } from './PrintableDoc'

/*
  زر طباعة موحّد لتقارير قسم المحاسبة.

  يعيد استخدام PrintableDoc نفسه المعتمد في إدارة الوحدات — ترويسة المنشأة
  بالشعار والرقم الضريبي والسجل التجاري، ورمز QR للتحقق، ونافذة طباعة معزولة
  عن التطبيق — فتخرج مطبوعات المحاسبة بنفس الهوية الفاخرة بدل تصميم ثانٍ.

  الغرض من هذا الغلاف أن تسقطه أي صفحة بسطر واحد بدل أن تدير حالة النافذة
  وتكرّر بناء المستند في كل مكان:

    <ReportPrintButton
      title="ميزان المراجعة"
      subtitle={`من ${from} إلى ${to}`}
      docPrefix="TB"
      columns={['الحساب', 'مدين', 'دائن']}
      rows={data.map(r => [r.name, SAR(r.debit), SAR(r.credit)])}
      summary={[['إجمالي المدين', SAR(totalD)], ['إجمالي الدائن', SAR(totalC)]]}
    />

  rows تُمرَّر كمصفوفة صفوف جاهزة للعرض — التنسيق (SAR، التواريخ) مسؤولية
  الصفحة، لأنها وحدها تعرف سياق أرقامها.
*/
export default function ReportPrintButton({
  title,
  subtitle,
  docPrefix = 'RPT',
  columns = [],
  rows = [],
  summary = [],
  disabled = false,
  label = '🖨 طباعة التقرير',
  className = 'btn btn-outline btn-sm',
}) {
  const { company } = useAuth()
  const [open, setOpen] = useState(false)

  const empty = !rows || rows.length === 0
  // الرقم يصدر الآن من قاعدة البيانات (document_registry) — docPrefix يبقى
  // كوسم داخلي في بيانات المستند لتتبّع نوع التقرير فقط.

  return (
    <>
      <button
        className={className}
        disabled={disabled || empty}
        title={empty ? 'لا توجد بيانات لطباعتها — استخرج التقرير أولاً' : 'طباعة بترويسة المنشأة ورمز التحقق'}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>

      {open && (
        <PrintableDoc
          company={company}
          title={title}
          subtitle={subtitle}
          docKind="report"
          qrValue={JSON.stringify({ report: docPrefix, title })}
          onClose={() => setOpen(false)}
        >
          {summary.length > 0 && <DocGrid items={summary} />}

          <table className="tbl" style={{ marginTop: summary.length ? 16 : 0 }}>
            <thead>
              <tr>{columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => <td key={j}>{cell ?? '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </PrintableDoc>
      )}
    </>
  )
}
