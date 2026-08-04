/*
  مولّد PDF عربي فاخر — يعتمد نافذة طباعة HTML بدل jsPDF
  لأن jsPDF لا يدعم العربية بدون embed خطوط ضخم. المتصفح يتعامل
  مع RTL + خطوط Google تلقائياً وينتج PDF مطابق للتصميم.
*/

function escapeHtml(v) {
  if (v == null) return ''
  return String(v).replace(/[&<>"']/g, s => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[s]))
}

function fmt(v) {
  if (typeof v === 'number') return v.toLocaleString('ar-SA', { maximumFractionDigits: 2 })
  return escapeHtml(v)
}

/**
 * downloadPDF({title, subtitle, company, filters, sheets, summaryCards, autoPrint})
 * sheets: [{ name, rows: [{col:val,...}], numeric?: [colNames] }]
 */
export function downloadPDF({ title, subtitle, company, filters = {}, sheets = [], summaryCards = [], autoPrint = true }) {
  const now = new Date().toLocaleString('ar-SA', {
    dateStyle: 'full', timeStyle: 'short'
  })

  const filterChips = Object.entries(filters)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<span class="chip">${escapeHtml(k)}: <b>${escapeHtml(v)}</b></span>`).join('')

  const summaryCardsHtml = (summaryCards || []).length ? `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px">
      ${summaryCards.map(c => `
        <div style="background:#FAF9F5;border:1px solid #E0D5B0;border-radius:10px;padding:12px 14px;border-top:3px solid ${c.borderColor || '#C9A84C'}">
          <div style="font-size:11px;color:#6B7280;font-weight:700;margin-bottom:4px">${escapeHtml(c.label)}</div>
          <div style="font-size:18px;font-weight:900;color:${c.color || '#0A192F'};font-family:'Tajawal',sans-serif">${escapeHtml(c.value)}</div>
          ${c.sub ? `<div style="font-size:10px;color:#9CA3AF;margin-top:2px">${escapeHtml(c.sub)}</div>` : ''}
        </div>
      `).join('')}
    </div>
  ` : ''

  const sheetsHtml = sheets.map(s => {
    if (!s.rows?.length) return `
      <section class="sec">
        <h2>${escapeHtml(s.name)}</h2>
        <div class="empty">لا توجد بيانات في هذه الورقة</div>
      </section>`
    const heads = Object.keys(s.rows[0])
    const numeric = new Set(s.numeric || [])
    const totals = {}
    heads.forEach(h => { if (numeric.has(h)) totals[h] = s.rows.reduce((t, r) => t + Number(r[h] || 0), 0) })

    return `
      <section class="sec">
        <h2>${escapeHtml(s.name)} <span class="count">(${s.rows.length} سجل)</span></h2>
        <table>
          <thead><tr>${heads.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
          <tbody>
            ${s.rows.map((r, i) => `<tr class="${i % 2 ? 'alt' : ''}">${
              heads.map(h => `<td class="${numeric.has(h) ? 'num' : ''}">${fmt(r[h])}</td>`).join('')
            }</tr>`).join('')}
          </tbody>
          ${Object.keys(totals).length ? `<tfoot><tr>${
            heads.map((h, i) => i === 0
              ? `<td><b>الإجمالي</b></td>`
              : `<td class="num"><b>${h in totals ? fmt(totals[h]) : ''}</b></td>`).join('')
          }</tr></tfoot>` : ''}
        </table>
      </section>`
  }).join('')

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(JSON.stringify({ doc: title, company: company?.name || 'المازن', date: now }))}`

  const html = `<!doctype html>
<html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><title>${escapeHtml(title || 'تقرير المازن')}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact }
  body { font-family: 'Tajawal','Cairo',sans-serif; margin:0; padding:24px; color:#0A192F; background:#fff }
  .hd { display:flex; justify-content:space-between; align-items:center; gap:16px; padding-bottom:14px;
        border-bottom:3px solid #C9A84C; margin-bottom:18px }
  .hd .brand { display:flex; align-items:center; gap:12px }
  .hd .mark { width:52px; height:52px; border-radius:12px; display:grid; place-items:center;
              background:linear-gradient(140deg,#F5D97E,#B8862F); color:#0A192F; font-weight:900; font-size:26px;
              font-family:'Cairo'; box-shadow:0 4px 10px rgba(184,134,47,.3) }
  .hd h1 { font-family:'Cairo'; font-size:20px; margin:0; color:#0A192F; font-weight:900 }
  .hd .co { font-size:12px; color:#6b7280; margin-top:2px }
  .hd .meta { text-align:left; font-size:11px; color:#6b7280 }
  .hd .meta div { margin-bottom:2px }
  .hd .qr-box { display:flex; flex-direction:column; align-items:center; font-size:10px; color:#6b7280 }
  .hd .qr-box img { width:72px; height:72px; border:1px solid #E0D5B0; padding:2px; border-radius:6px }
  h2.stitle { font-family:'Cairo'; font-size:18px; margin:0 0 6px 0 }
  .subt { font-size:13px; color:#6b7280; margin-bottom:12px }
  .filters { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:16px }
  .chip { background:#f5f0e0; color:#8b6f2c; padding:4px 10px; border-radius:999px; font-size:12px }
  .sec { margin-bottom:24px; page-break-inside:avoid }
  .sec h2 { font-family:'Cairo'; font-size:15px; margin:0 0 8px 0; padding:8px 12px;
            background:linear-gradient(90deg,#0A192F,#1e3a5f); color:#F5D97E; border-radius:8px }
  .sec h2 .count { font-size:11px; opacity:.75; font-weight:500 }
  table { width:100%; border-collapse:collapse; font-size:11.5px; background:#fff }
  th { background:#f5f0e0; color:#0A192F; padding:8px 6px; text-align:right; font-weight:800; border:1px solid #e0d5b0 }
  td { padding:6px; border:1px solid #eee; text-align:right }
  tr.alt td { background:#fafaf7 }
  td.num { font-family:'Tajawal'; font-variant-numeric: tabular-nums; font-weight:600 }
  tfoot td { background:#0A192F; color:#F5D97E; padding:8px 6px }
  .empty { padding:20px; text-align:center; color:#9ca3af; background:#fafafa; border-radius:8px }
  .signatures { display:flex; justify-content:space-between; margin-top:32px; padding-top:16px; border-top:1px dashed #C9A84C; font-size:12px; text-align:center }
  .signatures div { width:30% }
  .ft { margin-top:20px; padding-top:12px; border-top:1px solid #e5e7eb; font-size:11px; color:#6b7280;
        display:flex; justify-content:space-between }
  @media print {
    body { padding:12px }
    .noprint { display:none !important }
    .sec { page-break-inside: auto }
    table { page-break-inside: auto }
    tr { page-break-inside: avoid }
  }
  .toolbar { position:fixed; top:12px; left:12px; background:#0A192F; color:#F5D97E;
             padding:10px 16px; border-radius:10px; box-shadow:0 6px 20px rgba(0,0,0,.25); z-index:99 }
  .toolbar button { background:#F5D97E; color:#0A192F; border:0; padding:8px 16px; border-radius:6px;
                    font-weight:800; cursor:pointer; margin-inline-end:6px; font-family:inherit }
</style>
</head><body>
  <div class="toolbar noprint">
    <button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
    <button onclick="window.close()">إغلاق</button>
  </div>
  <div class="hd">
    <div class="brand">
      ${company?.logo_url
        ? `<img src="${escapeHtml(company.logo_url)}" style="width:52px;height:52px;border-radius:12px;object-fit:cover">`
        : `<div class="mark">م</div>`}
      <div>
        <h1>${escapeHtml(title || 'تقرير')}</h1>
        <div class="co">${escapeHtml(company?.name || 'منصة المازن')}${company?.vat_number ? ' — الرقم الضريبي: ' + escapeHtml(company.vat_number) : ''}${company?.cr_number ? ' — السجل التجاري: ' + escapeHtml(company.cr_number) : ''}</div>
      </div>
    </div>
    <div class="qr-box">
      <img src="${qrUrl}" alt="QR Code" />
      <span>رمز التحقق المحاسبي</span>
    </div>
    <div class="meta">
      <div>📅 ${now}</div>
      <div>منصة المازن — لإدارة العقارات والوحدات</div>
    </div>
  </div>
  ${subtitle ? `<div class="subt">${escapeHtml(subtitle)}</div>` : ''}
  ${filterChips ? `<div class="filters">${filterChips}</div>` : ''}
  ${summaryCardsHtml}
  ${sheetsHtml}
  <div class="signatures">
    <div><b>المحاسب المسؤول</b><br/><br/>...........................</div>
    <div><b>المدير المالي</b><br/><br/>...........................</div>
    <div><b>اعتماد الإدارة</b><br/><br/>...........................</div>
  </div>
  <div class="ft">
    <span>مستند رسمي صادر آلياً من منصة المازن — رمز الـ QR للتحقق المالي</span>
    <span>© ${new Date().getFullYear()} — جميع الحقوق محفوظة</span>
  </div>
  ${autoPrint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),400))</script>' : ''}
</body></html>`

  const w = window.open('', '_blank', 'width=1100,height=800')
  if (!w) {
    // FALLBACK: استخدام iframe خفي للطباعة إذا تم حظر النوافذ المنبثقة
    let frame = document.getElementById('pdf-print-frame')
    if (!frame) {
      frame = document.createElement('iframe')
      frame.id = 'pdf-print-frame'
      frame.style.display = 'none'
      document.body.appendChild(frame)
    }
    const fd = frame.contentWindow.document
    fd.open(); fd.write(html); fd.close()
    
    // الانتظار قليلاً للتحميل ثم تشغيل الطباعة من الـ iframe
    setTimeout(() => {
      frame.contentWindow.print()
    }, 1000)
    
    return
  }
  w.document.write(html); w.document.close()
}
