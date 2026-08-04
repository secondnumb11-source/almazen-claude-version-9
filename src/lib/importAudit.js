/* ============================================================================
   سجل تدقيق الاستيراد + مصدّرات متعددة الصيغ (Excel / CSV / JSON / PDF / HTML)
============================================================================ */
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'

const AUDIT_KEY = 'almazen.importAudit.v1'
const MAX_LOGS = 200

/** إضافة إدخال إلى سجل التدقيق */
export function appendAudit(entry) {
  const all = loadAudit()
  const row = {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  }
  all.unshift(row)
  const trimmed = all.slice(0, MAX_LOGS)
  try { localStorage.setItem(AUDIT_KEY, JSON.stringify(trimmed)) } catch { /* quota */ }
  return row
}

export function loadAudit() {
  try { return JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]') } catch { return [] }
}

export function clearAudit() {
  try { localStorage.removeItem(AUDIT_KEY) } catch { /* ignore */ }
}

export function deleteAuditEntry(id) {
  const next = loadAudit().filter(e => e.id !== id)
  try { localStorage.setItem(AUDIT_KEY, JSON.stringify(next)) } catch { /* ignore */ }
}

/* ============================== المصدّرات =================================== */

function slug(s) { return String(s || 'report').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60) }
function today() { return new Date().toISOString().slice(0, 10) }

function reportSheets(report) {
  const summary = [{
    'القسم': report.targetLabel, 'الجدول': report.table, 'نظام المصدر': report.vendor || '—',
    'إجمالي الصفوف': report.rowsTotal, 'مضاف': report.inserted, 'محدّث': report.updated,
    'متخطى': report.skipped, 'مرفوض': report.failed, 'نسبة النجاح %': report.successRate,
    'زمن التنفيذ (ثانية)': report.durationMs != null ? (report.durationMs / 1000).toFixed(2) : '—',
  }]
  const reasons = (report.reasons || []).map(r => ({ 'السبب': r.reason, 'عدد الصفوف': r.count }))
  const warnings = (report.warnings || []).map(r => ({ 'التنبيه': r.message, 'عدد الصفوف': r.count }))
  const autoFixes = (report.autoFixes || []).map(r => ({ 'الإصلاح': r.message, 'عدد الصفوف': r.count }))
  const failedRows = (report.failedRows || []).map(f => ({
    'رقم الصف': f.index,
    'الأخطاء': (f.errors || []).map(e => e.message).join(' | '),
    'الحل المقترح': (f.errors || []).map(e => e.suggestion).filter(Boolean).join(' | '),
    ...f.raw,
  }))
  return { summary, reasons, warnings, autoFixes, failedRows }
}

export function exportReportExcel(report) {
  const s = reportSheets(report)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.summary), 'الملخص')
  if (s.reasons.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.reasons), 'أسباب الرفض')
  if (s.warnings.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.warnings), 'التنبيهات')
  if (s.autoFixes.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.autoFixes), 'الإصلاحات')
  if (s.failedRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.failedRows), 'الصفوف المرفوضة')
  XLSX.writeFile(wb, `تقرير-استيراد-${slug(report.targetLabel)}-${today()}.xlsx`)
}

export function exportReportCsv(report) {
  const s = reportSheets(report)
  const ws = XLSX.utils.json_to_sheet(s.summary)
  const csv = XLSX.utils.sheet_to_csv(ws)
  download(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), `تقرير-استيراد-${slug(report.targetLabel)}-${today()}.csv`)
}

export function exportReportJson(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' })
  download(blob, `تقرير-استيراد-${slug(report.targetLabel)}-${today()}.json`)
}

export function exportReportPdf(report) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const M = 40
  let y = M
  doc.setFontSize(16); doc.text('Import Report / تقرير الاستيراد', M, y); y += 22
  doc.setFontSize(11); doc.setTextColor(80)
  doc.text(`Target: ${report.targetLabel} (${report.table})`, M, y); y += 16
  doc.text(`Source: ${report.vendor || '—'}`, M, y); y += 16
  doc.text(`Timestamp: ${new Date().toLocaleString('en-GB')}`, M, y); y += 22
  doc.setTextColor(0)
  const stats = [
    ['Total rows', report.rowsTotal],
    ['Inserted', report.inserted],
    ['Updated', report.updated],
    ['Skipped', report.skipped],
    ['Failed', report.failed],
    ['Success rate', report.successRate + '%'],
  ]
  stats.forEach(([k, v]) => { doc.text(`${k}: ${v}`, M, y); y += 15 })
  y += 10
  if (report.reasons?.length) {
    doc.setFontSize(13); doc.text('Rejection reasons', M, y); y += 16; doc.setFontSize(10)
    report.reasons.forEach(r => { doc.text(`• ${r.reason} — ${r.count}`, M, y); y += 13; if (y > 780) { doc.addPage(); y = M } })
    y += 8
  }
  if (report.warnings?.length) {
    doc.setFontSize(13); doc.text('Warnings', M, y); y += 16; doc.setFontSize(10)
    report.warnings.forEach(w => { doc.text(`• ${w.message} — ${w.count}`, M, y); y += 13; if (y > 780) { doc.addPage(); y = M } })
  }
  doc.save(`import-report-${slug(report.targetLabel)}-${today()}.pdf`)
}

export function exportAuditJson(logs) {
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json;charset=utf-8' })
  download(blob, `سجل-تدقيق-الاستيراد-${today()}.json`)
}

export function exportAuditCsv(logs) {
  const flat = logs.map(l => ({
    'الوقت': l.timestamp, 'المستخدم': l.userEmail || l.userId || '—', 'الشركة': l.companyId || '—',
    'المصدر': l.source, 'نظام المصدر': l.vendor || '—', 'القسم': l.targetLabel, 'الجدول': l.table,
    'إجمالي': l.rowsTotal, 'مضاف': l.inserted, 'محدّث': l.updated, 'متخطى': l.skipped, 'مرفوض': l.failed,
    'نسبة النجاح %': l.successRate,
    'الحقول المرتبطة': l.mapping ? Object.entries(l.mapping).map(([f, c]) => `${f}→${c}`).join(' | ') : '',
    'قرارات التطبيع': (l.autoFixes || []).map(f => f.message).join(' | '),
    'أسباب الرفض': (l.reasons || []).map(r => `${r.reason}(${r.count})`).join(' | '),
    'التنبيهات': (l.warnings || []).map(w => w.message).join(' | '),
  }))
  const ws = XLSX.utils.json_to_sheet(flat)
  const csv = XLSX.utils.sheet_to_csv(ws)
  download(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), `سجل-تدقيق-الاستيراد-${today()}.csv`)
}

export function exportAuditExcel(logs) {
  const wb = XLSX.utils.book_new()
  const flat = logs.map(l => ({
    'الوقت': l.timestamp, 'المستخدم': l.userEmail || l.userId || '—',
    'المصدر': l.source, 'نظام المصدر': l.vendor || '—', 'القسم': l.targetLabel,
    'إجمالي': l.rowsTotal, 'مضاف': l.inserted, 'محدّث': l.updated, 'متخطى': l.skipped, 'مرفوض': l.failed,
    'نسبة النجاح %': l.successRate,
  }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flat), 'السجل')
  XLSX.writeFile(wb, `سجل-تدقيق-الاستيراد-${today()}.xlsx`)
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 200)
}
