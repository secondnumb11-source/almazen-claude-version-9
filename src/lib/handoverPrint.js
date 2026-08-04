/**
 * طباعة محضر وتسليم محتويات الوحدة السكنية (Check List)
 * تصميم تنفيذي فاخر بالترويسة الرسمية وتوقيع المستأجر والموظف المسلّم
 */

function escapeHtml(v) {
  if (v == null) return ''
  return String(v).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]))
}

export function printHandoverChecklist({
  unit,
  booking,
  company,
  employee, // profile object of current logged-in user
  checklistItems = [],
  kind = 'check_in',
  notes = '',
  signedBy = '',
  serial = ''
}) {
  const nowStr = new Date().toLocaleString('ar-SA', {
    dateStyle: 'full',
    timeStyle: 'short'
  })

  const tenantName = booking?.customers?.full_name || booking?.guest_name || signedBy || 'غير محدد'
  const tenantId = booking?.customers?.id_number || '—'
  const tenantPhone = booking?.customers?.phone || '—'
  const ejarContract = booking?.ejar_contract_number || '—'
  const checkInDate = booking?.check_in_date || '—'
  const checkOutDate = booking?.check_out_date || '—'

  const employeeName = employee?.full_name || employee?.email || 'موظف الاستقبال'
  const employeeRole = employee?.role === 'admin' ? 'مدير النظام' : employee?.role === 'accountant' ? 'محاسب' : 'مسؤول تسليم وحدات'

  const docTitle = kind === 'check_in'
    ? 'محضر تسليم محتويات وحدة إيجارية (Check-In List)'
    : 'محضر استلام محتويات وحدة إيجارية (Check-Out List)'

  const itemsRows = checklistItems.length > 0
    ? checklistItems.map((it, idx) => {
        let condText = 'سليم ✓'
        let condClass = 'cond-ok'
        if (it.condition === 'damaged' || it.condition === 'used') {
          condText = it.condition === 'damaged' ? 'متضرر ⚠' : 'مستخدم (جيد)'
          condClass = 'cond-warn'
        } else if (it.condition === 'missing' || it.condition === 'damaged_bad') {
          condText = 'مفقود / تالف ✕'
          condClass = 'cond-danger'
        }

        return `
          <tr>
            <td style="text-align:center; font-weight:bold;">${idx + 1}</td>
            <td style="font-weight:600;">${escapeHtml(it.name || it.item_name)}</td>
            <td style="text-align:center;"><span class="tag ${condClass}">${condText}</span></td>
            <td>${escapeHtml(it.note || it.condition_note || '—')}</td>
          </tr>
        `
      }).join('')
    : `<tr><td colSpan="4" style="text-align:center; padding: 20px; color: #888;">لا توجد عناصر أثاث مسجلة بهذه الوحدة</td></tr>`

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${docTitle} — وحدة ${escapeHtml(unit?.unit_number || '')}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Tajawal', 'Cairo', sans-serif; margin: 0; padding: 20px; color: #0A192F; background: #fff; line-height: 1.5; }

  /* Letterhead / Header */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 16px;
    border-bottom: 3px double #C9A84C;
    margin-bottom: 20px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .logo-box {
    width: 64px;
    height: 64px;
    border-radius: 12px;
    background: linear-gradient(135deg, #0A192F, #1e3a5f);
    color: #F5D97E;
    display: grid;
    place-items: center;
    font-size: 28px;
    font-weight: 900;
    font-family: 'Cairo', sans-serif;
    border: 2px solid #C9A84C;
  }
  .company-info h1 {
    margin: 0;
    font-family: 'Cairo', sans-serif;
    font-size: 20px;
    font-weight: 800;
    color: #0A192F;
  }
  .company-info div {
    font-size: 12px;
    color: #555;
    margin-top: 2px;
  }
  .doc-meta {
    text-align: left;
    font-size: 11px;
    color: #444;
  }
  .doc-meta b {
    color: #0A192F;
  }

  /* Document Title Ribbon */
  .doc-banner {
    background: linear-gradient(90deg, #0A192F, #1e3a5f);
    color: #F5D97E;
    text-align: center;
    padding: 10px 16px;
    border-radius: 8px;
    margin-bottom: 20px;
    border: 1px solid #C9A84C;
  }
  .doc-banner h2 {
    margin: 0;
    font-family: 'Cairo', sans-serif;
    font-size: 17px;
    font-weight: 800;
  }
  .doc-banner p {
    margin: 2px 0 0;
    font-size: 11px;
    color: #e2e8f0;
  }

  /* Info Cards Grid */
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 20px;
  }
  .info-box {
    border: 1px solid #CBD5E1;
    border-radius: 8px;
    padding: 12px 14px;
    background: #F8FAFC;
  }
  .info-box h3 {
    margin: 0 0 10px;
    font-size: 13px;
    font-family: 'Cairo', sans-serif;
    color: #0A192F;
    border-bottom: 2px solid #C9A84C;
    padding-bottom: 4px;
    display: flex;
    justify-content: space-between;
  }
  .info-row {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    margin-bottom: 6px;
  }
  .info-row:last-child { margin-bottom: 0; }
  .info-label { color: #64748B; font-weight: 500; }
  .info-val { color: #0F172A; font-weight: 700; }

  /* Checklist Table */
  .table-sec {
    margin-bottom: 20px;
  }
  .table-title {
    font-family: 'Cairo', sans-serif;
    font-size: 14px;
    font-weight: 800;
    color: #0A192F;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  table.checklist-tbl {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    background: #fff;
  }
  table.checklist-tbl th {
    background: #0A192F;
    color: #F5D97E;
    padding: 8px 10px;
    text-align: right;
    font-family: 'Cairo', sans-serif;
    font-weight: 700;
    border: 1px solid #0A192F;
  }
  table.checklist-tbl td {
    padding: 8px 10px;
    border: 1px solid #E2E8F0;
    vertical-align: middle;
  }
  table.checklist-tbl tr:nth-child(even) td {
    background: #F8FAFC;
  }

  /* Tags */
  .tag {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
  }
  .cond-ok { background: #DCFCE7; color: #166534; border: 1px solid #86EFAC; }
  .cond-warn { background: #FEF9C3; color: #854D0E; border: 1px solid #FDE047; }
  .cond-danger { background: #FEE2E2; color: #991B1B; border: 1px solid #FCA5A5; }

  /* Declaration Box */
  .declaration-box {
    border: 1px solid #CBD5E1;
    background: #FFFBEB;
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 11.5px;
    color: #78350F;
    margin-bottom: 24px;
    line-height: 1.6;
  }
  .declaration-box b {
    color: #451A03;
  }

  /* Signatures Section */
  .signatures-sec {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 16px;
    margin-top: 30px;
    page-break-inside: avoid;
  }
  .sig-box {
    border: 1px solid #CBD5E1;
    border-radius: 8px;
    padding: 12px;
    text-align: center;
    background: #fff;
  }
  .sig-title {
    font-family: 'Cairo', sans-serif;
    font-size: 12px;
    font-weight: 800;
    color: #0A192F;
    margin-bottom: 6px;
  }
  .sig-name {
    font-size: 12px;
    font-weight: 700;
    color: #1E293B;
    min-height: 20px;
  }
  .sig-line {
    border-bottom: 1px dashed #94A3B8;
    margin: 30px 10px 8px;
  }
  .stamp-space {
    height: 50px;
    border: 1px dashed #CBD5E1;
    border-radius: 6px;
    margin-top: 10px;
    display: grid;
    place-items: center;
    color: #CBD5E1;
    font-size: 11px;
  }

  /* Footer */
  .footer {
    margin-top: 30px;
    padding-top: 12px;
    border-top: 1px solid #E2E8F0;
    font-size: 10px;
    color: #64748B;
    display: flex;
    justify-content: space-between;
  }

  .noprint-bar {
    position: fixed;
    top: 12px;
    left: 12px;
    background: #0A192F;
    padding: 10px 16px;
    border-radius: 10px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.3);
    z-index: 999;
  }
  .noprint-bar button {
    background: #C9A84C;
    color: #0A192F;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    font-weight: 800;
    cursor: pointer;
    font-family: 'Cairo', sans-serif;
    margin-inline-end: 8px;
  }

  @media print {
    body { padding: 10px; }
    .noprint-bar { display: none !important; }
  }
</style>
</head>
<body>

  <div class="noprint-bar">
    <button onclick="window.print()">🖨️ طباعة نموذج التسليم / حفظ PDF</button>
    <button onclick="window.close()" style="background:#64748B; color:#fff;">إغلاق</button>
  </div>

  <!-- Header / Letterhead -->
  <div class="header">
    <div class="brand">
      ${company?.logo_url
        ? `<img src="${escapeHtml(company.logo_url)}" style="width:64px; height:64px; border-radius:12px; object-fit:cover; border:2px solid #C9A84C;">`
        : `<div class="logo-box">م</div>`}
      <div class="company-info">
        <h1>${escapeHtml(company?.name || 'منصة المازن لإدارة العقارات والوحدات')}</h1>
        <div>${company?.vat_number ? 'الرقم الضريبي: ' + escapeHtml(company.vat_number) : 'إدارة الضيافة والتشغيل العقاري'} ${company?.phone ? ' | هاتف: ' + escapeHtml(company.phone) : ''}</div>
        <div>${escapeHtml(company?.address || 'المملكة العربية السعودية')}</div>
      </div>
    </div>
    <div class="doc-meta">
      ${serial ? `<div><b>رقم المستند:</b> <span dir="ltr">${escapeHtml(serial)}</span></div>` : ''}
      <div><b>تاريخ التحرير:</b> ${nowStr}</div>
      <div><b>حالة النموذج:</b> ${kind === 'check_in' ? 'تسليم ابتدائي (Check-In)' : 'استلام إخلاء (Check-Out)'}</div>
      <div><b>نظام التشغيل:</b> المازن للخدمات العقارية</div>
    </div>
  </div>

  <!-- Title Banner -->
  <div class="doc-banner">
    <h2>${docTitle}</h2>
    <p>وثيقة رسمية لتوثيق جرد ومحتويات وأثاث الوحدة السكنية المسلّمة للمستأجر</p>
  </div>

  <!-- Info Grid -->
  <div class="info-grid">
    <!-- Unit Details -->
    <div class="info-box">
      <h3>🏠 بيانات الوحدة السكنية</h3>
      <div class="info-row">
        <span class="info-label">رقم الوحدة:</span>
        <span class="info-val">وحدة ${escapeHtml(unit?.unit_number || '—')}</span>
      </div>
      <div class="info-row">
        <span class="info-label">نوع العقار / التصنيف:</span>
        <span class="info-val">${escapeHtml(unit?.category || 'وحدة سكنية')}</span>
      </div>
      <div class="info-row">
        <span class="info-label">حالة الفرش:</span>
        <span class="info-val">${unit?.is_furnished ? 'مفروشة بالكامل' : 'غير مفروشة'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">تاريخ التسليم / الدخول:</span>
        <span class="info-val">${escapeHtml(checkInDate)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">تاريخ الخروج المتوقع:</span>
        <span class="info-val">${escapeHtml(checkOutDate)}</span>
      </div>
    </div>

    <!-- Tenant Details -->
    <div class="info-box">
      <h3>👤 بيانات المستأجر والموظف المسلّم</h3>
      <div class="info-row">
        <span class="info-label">اسم المستأجر:</span>
        <span class="info-val">${escapeHtml(tenantName)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">رقم الهوية / الإقامة:</span>
        <span class="info-val">${escapeHtml(tenantId)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">رقم الجوال:</span>
        <span class="info-val">${escapeHtml(tenantPhone)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">رقم عقد إيجار:</span>
        <span class="info-val">${escapeHtml(ejarContract)}</span>
      </div>
      <div class="info-row" style="background: #FEF3C7; padding: 2px 6px; border-radius: 4px; margin-top: 4px;">
        <span class="info-label" style="color:#92400E;">👨‍💼 الموظف المسلّم (النظام):</span>
        <span class="info-val" style="color:#78350F;">${escapeHtml(employeeName)} (${escapeHtml(employeeRole)})</span>
      </div>
    </div>
  </div>

  <!-- Checklist Table -->
  <div class="table-sec">
    <div class="table-title">📋 جدول الفحص التفصيلي لمحتويات وأثاث الوحدة (${checklistItems.length} عنصر)</div>
    <table class="checklist-tbl">
      <thead>
        <tr>
          <th style="width: 40px; text-align:center;">#</th>
          <th style="width: 40%;">اسم القطعة / المحتوى</th>
          <th style="width: 25%; text-align:center;">الحالة عند التسليم</th>
          <th>الملاحظات والوصف</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>
  </div>

  ${notes ? `
    <div style="background:#F1F5F9; border-radius:8px; padding:10px 14px; margin-bottom:20px; border:1px solid #CBD5E1; font-size:12px;">
      <b>📝 ملاحظات وقراءات إضافية (عدادات الكهرباء / المفاتيح):</b> ${escapeHtml(notes)}
    </div>
  ` : ''}

  <!-- Declaration Legal Box -->
  <div class="declaration-box">
    <b>📜 إقرار وتعهد المستأجر:</b>
    أقر أنا المستأجر الموضح بياناته أعلاه بأنني قمت بلمس وفحص كافة المحتويات والأجهزة والأثاث الموضح في الجدول أعلاه، واستلمتها كاملة بحالة سليمة وجاهزة للاستخدام، وأتعهد بالحفاظ عليها وسداد قيمة أي تلفيات أو مفقودات تنتج أثناء فترة إقامتي بالوحدة، مع إعادتها بنفس الحالة عند إخلاء الوحدة.
  </div>

  <!-- Signatures Section -->
  <div class="signatures-sec">
    <!-- Tenant Signature -->
    <div class="sig-box">
      <div class="sig-title">توقيع المستأجر (المستلم)</div>
      <div class="sig-name">${escapeHtml(tenantName)}</div>
      <div class="sig-line"></div>
      <div style="font-size:10px; color:#64748B;">التوقيع: ................................</div>
    </div>

    <!-- Handover Officer Signature -->
    <div class="sig-box">
      <div class="sig-title">الموظف المسلّم (منسق التسليم)</div>
      <div class="sig-name">${escapeHtml(employeeName)}</div>
      <div class="sig-line"></div>
      <div style="font-size:10px; color:#64748B;">التوقيع: ................................</div>
    </div>

    <!-- Official Stamp -->
    <div class="sig-box">
      <div class="sig-title">ختم المؤسسة / المنشأة الرسمية</div>
      <div class="stamp-space">موضع الختم الرسمي</div>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <span>تم إنشاء وتحرير هذه الوثيقة آلياً بواسطة منصة المازن التشغيلية</span>
    <span>الموظف المُحرر: ${escapeHtml(employeeName)}</span>
    <span>صفحة 1 من 1</span>
  </div>

  <script>
    window.addEventListener("load", () => {
      setTimeout(() => {
        window.print();
      }, 500);
    });
  </script>
</body>
</html>`

  const w = window.open('', '_blank', 'width=1100,height=850')
  if (!w) {
    alert('السماح للنوافذ المنبثقة مطلوب لطباعة النموذج')
    return
  }
  w.document.write(html)
  w.document.close()
}
