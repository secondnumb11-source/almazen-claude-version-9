import { renderToStaticMarkup } from 'react-dom/server'
import { supabase } from './supabase'

/** تهريب HTML — العنوان والبيانات تأتي من إدخال المستخدم. */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
))

/**
 * يختم المستند رقمياً قبل طباعته: رقم تسلسلي، وبصمة SHA-256 مشتقة من
 * نصّه، ورمز تحقق قصير. الغرض أن تكون الورقة الخارجة من النظام قابلة
 * للإثبات أمام طرف ثالث — عميل أو مورد أو مراجع.
 *
 * الفشل لا يمنع الطباعة أبداً: الختم خدمة توثيق مساعدة، وحجب الطباعة
 * بسببه يعطّل عملاً حقيقياً. لكنه يُسجَّل في وحدة التحكم بدل ابتلاعه
 * صامتاً — الابتلاع الصامت هو ما أخفى تعطّل الختم كاملاً من قبل.
 */
async function stampDocument({ docKind, title, payload, entityId, total, docDate }) {
  try {
    const { data, error } = await supabase.rpc('doc_stamp', {
      p_kind: docKind || 'report',
      p_title: title || null,
      p_payload: (payload || '').slice(0, 20000),
      p_table: null,
      p_id: entityId || null,
      p_total: total ?? null,
      p_date: docDate || null,
      p_meta: {},
    })
    if (error) { console.warn('تعذّر ختم المستند رقمياً:', error.message); return null }
    return data || null
  } catch (e) {
    console.warn('تعذّر ختم المستند رقمياً:', e?.message || e)
    return null
  }
}

/** كتلة الختم التي تُذيَّل بها الورقة المطبوعة. */
function stampBlock(stamp) {
  if (!stamp?.serial) return ''
  return `
<div class="dstamp">
  <div class="dstamp-col">
    <b>مستند موثّق رقمياً</b>
    <span>الرقم التسلسلي: <code>${esc(stamp.serial)}</code></span>
    <span>رمز التحقق: <code class="big">${esc(stamp.code || '')}</code></span>
  </div>
  <div class="dstamp-col dstamp-end">
    <span>بصمة المحتوى (SHA-256)</span>
    <code class="hash">${esc((stamp.hash || '').slice(0, 32))}…</code>
    <span>للتحقق: سجل المستندات الرقمية ← «تحقق من مستند»</span>
  </div>
</div>`
}

/*
  يطبع عنصر React واحد في نافذة منبثقة معزولة تماماً عن صفحة التطبيق،
  بدل الاعتماد على @media print لإخفاء بقية الصفحة — وهو ما كان يطبع
  محتوى الصفحة كاملاً (القائمة الجانبية + أي نوافذ أخرى مفتوحة) بدل
  المستند المطلوب فقط. النافذة الجديدة تحتوي حصراً على العنصر الممرَّر.
*/
export async function printElement(reactElement, opts = {}) {
  const {
    title = 'مستند',
    // نوع المستند يحدّد سلسلة ترقيمه في السجل الرقمي
    docKind = 'report',
    entityId = null, total = null, docDate = null,
    stamp: doStamp = true,
  } = opts

  // يقبل عنصر React، أو معرّف عنصر في الصفحة الحالية. تمرير معرّف كان
  // يُمرَّر إلى renderToStaticMarkup فيُطبع النص حرفياً بدل المحتوى —
  // وهو ما كان يحدث فعلاً في ملصق QR للوحدة.
  const bodyHtml = typeof reactElement === 'string'
    ? (document.getElementById(reactElement)?.outerHTML
       ?? `<p>تعذّر العثور على المحتوى المطلوب طباعته (${esc(reactElement)})</p>`)
    : renderToStaticMarkup(reactElement)

  // البصمة تُشتق من نصّ المستند لا من ترميزه، فلا يغيّرها اختلاف تنسيق
  const plain = bodyHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const stamp = doStamp
    ? await stampDocument({ docKind, title, payload: plain, entityId, total, docDate })
    : null

  const html = `<!doctype html>
<html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact }
  body { font-family:'Tajawal','Cairo',sans-serif; margin:0; padding:26px; color:#0E2340; background:#fff; line-height:1.7; font-size:15px }
  h1,h2,h3,h4 { font-family:'Cairo','Tajawal',sans-serif }
  img { max-width:100% }

  /* ختم التوثيق الرقمي — يُذيَّل به كل مستند يخرج من النظام */
  .dstamp{margin-top:22px;padding:10px 14px;border:1.5px dashed #C6A24B;border-radius:10px;
    background:#FEFBF2;display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap;font-size:11px}
  .dstamp-col{display:flex;flex-direction:column;gap:3px}
  .dstamp-end{text-align:left;align-items:flex-start}
  .dstamp b{font-size:12px;color:#7A5B12}
  .dstamp code{font-family:ui-monospace,Consolas,monospace;direction:ltr;unicode-bidi:embed}
  .dstamp code.big{font-size:15px;font-weight:800;letter-spacing:1.5px;color:#0E2340}
  .dstamp code.hash{font-size:10px;color:#64748B;word-break:break-all}

  /* ===== مستند العقود/التقارير العامة (PrintableDoc, RentalContract) ===== */
  .contract-doc{border:1px solid #E2E9F2;border-radius:14px;padding:26px;font-size:14px;background:linear-gradient(180deg,#fff,#fffdf7)}
  .contract-head{display:flex;align-items:center;gap:16px;border-bottom:3px double #C6A24B;padding-bottom:16px;margin-bottom:18px}
  .contract-head img{width:56px;height:56px;object-fit:contain;border-radius:8px}
  .contract-head-info{flex:1}
  .contract-head-info h2{margin:0;font-size:19px;color:#1A3A63}
  .contract-head-info div{font-size:11.5px;color:#5B6B7C;margin-top:2px}
  .contract-qr{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:10px;color:#5B6B7C}
  .contract-title{text-align:center;color:#1A3A63;margin:0 0 18px;font-size:17px;letter-spacing:.3px}
  .contract-h4{margin:18px 0 10px;color:#8b6f2c;font-size:14px;border-bottom:1px dashed #E2E9F2;padding-bottom:6px}
  .contract-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;margin-bottom:8px}
  .contract-grid div{display:flex;flex-direction:column;gap:2px}
  .contract-grid b{font-size:11px;color:#5B6B7C;font-weight:700}
  .contract-grid span{font-size:14px;font-weight:700;color:#1A3A63}
  .contract-note{font-size:11.5px;color:#5B6B7C;border-top:1px dashed #E2E9F2;padding-top:10px;margin:18px 0 22px;line-height:1.7}
  .contract-terms{margin:6px 0 18px;padding-inline-start:20px;font-size:12.5px;line-height:1.9;color:#1A3A63}
  .contract-terms li{margin-bottom:6px}

  /* ===== سند قبض/صرف (VoucherPrint) ===== */
  .voucher-doc{border:1px solid #E2E9F2;border-radius:14px;padding:24px;background:linear-gradient(180deg,#fff,#fffdf7)}
  .voucher-head{display:flex;align-items:center;gap:14px;border-bottom:3px double #C6A24B;padding-bottom:14px;margin-bottom:16px}
  .voucher-head img{width:52px;height:52px;object-fit:contain;border-radius:8px}
  .voucher-head-info{flex:1}
  .voucher-head-info h2{margin:0;font-size:18px;color:#1A3A63}
  .voucher-head-info div{font-size:11px;color:#5B6B7C;margin-top:2px}
  .voucher-badge{padding:8px 14px;border-radius:10px;font-weight:800;font-size:13px}
  .voucher-badge.in{background:#e8f7ee;color:#16803d}
  .voucher-badge.out{background:#fdeceb;color:#b3261e}
  .voucher-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 18px;margin-bottom:14px}
  .voucher-grid div{display:flex;flex-direction:column;gap:2px}
  .voucher-grid b{font-size:11px;color:#5B6B7C;font-weight:700}
  .voucher-grid span{font-size:13.5px;font-weight:700;color:#1A3A63}
  .voucher-amount{text-align:center;padding:14px;margin-bottom:12px;background:#faf6ea;border-radius:10px}
  .voucher-amount span{display:block;font-size:12px;color:#5B6B7C;margin-bottom:4px}
  .voucher-amount b{font-size:22px}
  .voucher-desc{font-size:13px;color:#1A3A63;margin-bottom:14px}
  .voucher-sign{display:flex;justify-content:space-between;gap:30px;margin-top:20px}
  .voucher-sign>div{flex:1;text-align:center}
  .voucher-sign span{display:block;font-size:12px;color:#5B6B7C;margin-bottom:28px}
  .voucher-sign i{display:block;border-top:1px solid #E2E9F2;font-style:normal}

  /* ===== ملخص إيجار المستأجر (TenantSummary) ===== */
  .ts-header{display:flex;align-items:center;gap:14px;border-bottom:3px double #C6A24B;padding-bottom:14px;margin-bottom:18px}
  .ts-header img{width:52px;height:52px;object-fit:contain;border-radius:8px}
  .ts-header h2{margin:0;font-size:19px;color:#1A3A63}
  .ts-sub{font-size:11.5px;color:#5B6B7C;margin-top:2px}
  .ts-badge{margin-inline-start:auto;background:#faf6ea;color:#8b6f2c;padding:8px 14px;border-radius:10px;font-weight:800;font-size:13px}
  .ts-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;margin-bottom:18px}
  .ts-grid div{display:flex;flex-direction:column;gap:2px}
  .ts-grid b{font-size:11px;color:#5B6B7C;font-weight:700}
  .ts-grid span{font-size:14px;font-weight:700;color:#1A3A63}
  .ts-h4{margin:18px 0 10px;color:#8b6f2c;font-size:14px;border-bottom:1px dashed #E2E9F2;padding-bottom:6px}
  .ts-sign{display:flex;justify-content:space-between;gap:30px;margin-top:26px}
  .ts-sign div{flex:1;text-align:center}
  .ts-sign b{display:block;font-size:12px;color:#5B6B7C;margin-bottom:30px}
  .ts-furn{margin:6px 0 14px;padding-inline-start:20px;font-size:13px;line-height:1.9}

  /* ===== الفاتورة الضريبية الفاخرة (InvoiceView / ZATCA) ===== */
  .lux-inv{background:#fff;border:1px solid #E2E9F2;border-radius:14px;padding:0;overflow:hidden;box-shadow:0 6px 20px rgba(10,25,47,.08)}
  .lux-inv-head{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:18px 22px;background:linear-gradient(120deg,#0A192F 0%,#1e3a5f 100%);color:#fff;border-bottom:4px solid #C6A24B;position:relative}
  .lux-inv-brand{display:flex;align-items:center;gap:12px}
  .lux-inv-brand img{width:62px;height:62px;border-radius:12px;object-fit:cover;background:#fff;padding:3px}
  .lux-inv-logo-fallback{width:62px;height:62px;border-radius:12px;background:linear-gradient(135deg,#F5D97E,#C6A24B);display:grid;place-items:center;font-size:30px}
  .lux-inv-brand h2{font-family:'Cairo';font-size:20px;color:#F5D97E;margin:0}
  .lux-inv-meta{font-size:11.5px;opacity:.9;margin-top:2px}
  .lux-inv-title{text-align:end}
  .lux-inv-title-ar{font-family:'Cairo';font-size:17px;font-weight:900;color:#F5D97E}
  .lux-inv-title-en{font-size:10.5px;letter-spacing:2px;opacity:.75;margin-top:2px}
  .lux-inv-no{margin-top:8px;font-size:13px;background:rgba(255,255,255,.14);border:1px solid rgba(245,217,126,.4);padding:5px 10px;border-radius:8px;display:inline-block}
  .lux-inv-info{display:grid;grid-template-columns:repeat(3,1fr);gap:0;padding:0;border-bottom:1px solid #E2E9F2;background:#F4F7FB}
  .lux-inv-info > div{padding:12px 14px;border-inline-end:1px solid #E2E9F2}
  .lux-inv-info > div:last-child{border-inline-end:none}
  .lux-inv-info span{display:block;font-size:11px;color:#5B6B7C;font-weight:700;margin-bottom:3px}
  .lux-inv-info b{font-size:13.5px;color:#1A3A63}
  .lux-inv-table{width:100%;border-collapse:collapse;margin:0}
  .lux-inv-table th{background:linear-gradient(135deg,#F5D97E,#C6A24B);color:#0A192F;padding:10px 12px;font-family:'Cairo';font-size:12.5px;font-weight:900;text-align:start}
  .lux-inv-table td{padding:12px;border-bottom:1px solid #E2E9F2;font-size:13px}
  .lux-inv-foot{display:grid;grid-template-columns:1fr 1.2fr;gap:16px;padding:18px 22px;background:#F4F7FB}
  .lux-inv-qr{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
  .lux-inv-qr > div{font-size:10.5px;color:#5B6B7C;text-align:center;max-width:160px}
  .lux-inv-totals{display:flex;flex-direction:column;gap:6px}
  .lux-inv-totals > div{display:flex;justify-content:space-between;padding:8px 12px;background:#fff;border:1px solid #E2E9F2;border-radius:8px;font-size:13px}
  .lux-inv-totals .grand{background:linear-gradient(135deg,#0A192F,#1e3a5f);color:#F5D97E;border-color:#C6A24B;font-family:'Cairo';font-size:16px;font-weight:900;padding:12px 14px}
  .lux-inv-terms{padding:12px 22px;font-size:11.5px;color:#5B6B7C;text-align:center;border-top:1px dashed #E2E9F2}

  /* ===== عناصر مشتركة ===== */
  table.tbl{width:100%;border-collapse:collapse;font-size:12.5px;margin-bottom:14px}
  .tbl th{background:#F4F7FB;color:#1A3A63;padding:8px 10px;text-align:start;font-size:11.5px}
  .tbl td{padding:7px 10px;border-bottom:1px solid #E2E9F2}
  .money{font-family:'Cairo';font-weight:800;color:#16406E}
  .neg{color:#D93636}
  .chip{display:inline-block;background:#faf6ea;color:#8b6f2c;padding:3px 10px;border-radius:99px;font-size:11px}

  .print-toolbar{position:fixed;top:12px;left:12px;background:#0E2340;color:#E7C873;
    padding:10px 16px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:99}
  .print-toolbar button{background:#E7C873;color:#0E2340;border:0;padding:8px 16px;border-radius:6px;
    font-weight:800;cursor:pointer;margin-inline-end:6px;font-family:inherit}

  @media print { .print-toolbar{ display:none !important } body{ padding:12px } }
</style>
</head><body>
  <div class="print-toolbar">
    <button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
    <button onclick="window.close()">إغلاق</button>
  </div>
  ${bodyHtml}
  ${stampBlock(stamp)}
</body></html>`

  const w = window.open('', '_blank', 'width=1000,height=800')
  if (w) {
    w.document.write(html)
    w.document.close()
    w.addEventListener('load', () => setTimeout(() => w.print(), 350))
  } else {
    // Fallback: Use a hidden iframe to bypass popup blockers and print directly
    let iframe = document.getElementById('print-iframe-fallback')
    if (!iframe) {
      iframe = document.createElement('iframe')
      iframe.id = 'print-iframe-fallback'
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = '0'
      iframe.style.zIndex = '-1000'
      document.body.appendChild(iframe)
    }
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document
    iframeDoc.open()
    iframeDoc.write(html)
    iframeDoc.close()
    
    setTimeout(() => {
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
    }, 500)
  }
}
