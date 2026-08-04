// notify-new-signup — إشعار إدارة المنصة بأي تسجيل جديد أو إيصال دفع أو طلب إحالة
// يُستدعى من الواجهة عبر supabase.functions.invoke ويرسل عبر Resend.
//
// ⚠️ سبب هذه النسخة (F-7):
//   النسخة المنشورة (v7) كانت تتجاهل مصفوفة recipients و notify_super_admins
//   بالكامل وترسل إلى بريد واحد مثبت:
//       const ADMIN_EMAIL = 'shadyabdelwahab99@gmail.com'
//       body: JSON.stringify({ ..., to: [ADMIN_EMAIL], ... })
//   فكان تسجيل أي عميل جديد يصل إلى شخص واحد فقط بدل إدارة المنصة كلها.
//
//   كذلك لم يكن مصدر الدالة محفوظاً في المستودع إطلاقاً — أي تغيير كان يضيع.
//
// السلوك المعتمد الآن:
//   المستلمون = قائمة السوبر أدمن (SUPER_ADMIN_EMAILS) + أي recipients واردة،
//   بعد استبعاد EXCLUDED_EMAILS وإزالة التكرار.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** إدارة المنصة — مطابقة لـ public.super_admin_emails() في قاعدة البيانات. */
const SUPER_ADMIN_EMAILS = [
  'shadysalahshadysalah@gmail.com',
  'info.almazen.platform@gmail.com',
  'sh.abdelwahab@nes-sa.com',
  'secondnumb11@gmail.com',
  'shadyabdelwahabksa@gmail.com',
  'shadyabdelwahab99@gmail.com',
]

/**
 * مستبعَدون من بريد الإشعارات بقرار صريح من مالك المنصة.
 * العنوانان يختلفان بحرف واحد (motaz / moataz) ويعودان لنفس الشخص،
 * فاستبعادهما معاً ضروري وإلا وصله البريد على العنوان الآخر.
 */
const EXCLUDED_EMAILS = [
  'motazsalah1016@gmail.com',
  'moatazsalah1016@gmail.com',
]

const FROM = Deno.env.get('EMAIL_FROM') ?? 'المازن <onboarding@resend.dev>'

const norm = (e: unknown) => String(e ?? '').trim().toLowerCase()

/** يبني قائمة المستلمين النهائية: السوبر أدمن + الواردون − المستبعدون، بلا تكرار. */
function buildRecipients(extra: unknown): string[] {
  const incoming = Array.isArray(extra) ? extra : []
  const excluded = new Set(EXCLUDED_EMAILS.map(norm))
  return [...new Set([...SUPER_ADMIN_EMAILS, ...incoming].map(norm))]
    .filter((e) => e.includes('@') && !excluded.has(e))
}

const escape = (v: unknown) =>
  String(v ?? '—').replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string))

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const apiKey = Deno.env.get('RESEND_API_KEY')
    if (!apiKey) return json({ error: 'RESEND_API_KEY missing' }, 500)

    const body = await req.json().catch(() => ({}))
    const kind = body.kind || 'new_signup'
    const to = buildRecipients(body.recipients)
    if (to.length === 0) return json({ error: 'no_recipients' }, 400)

    let subject = ''
    let html = ''

    if (kind === 'payment_receipt') {
      subject = `💰 إيصال دفع جديد — ${body.company_name || 'منشأة'}`
      html = `
        <div style="font-family:Tahoma,Arial;direction:rtl;line-height:1.8">
          <h2>إيصال دفع جديد لتفعيل اشتراك</h2>
          <p><b>المنشأة:</b> ${escape(body.company_name)}</p>
          <p><b>معرّف المنشأة:</b> <code>${escape(body.company_id)}</code></p>
          <p><b>المبلغ:</b> ${escape(body.amount)} ر.س</p>
          <p><b>المرجع:</b> ${escape(body.reference)}</p>
          <p><b>ملاحظات:</b> ${escape(body.notes || '—')}</p>
          <p><b>مسار الإيصال:</b> <code>${escape(body.receipt_path)}</code></p>
        </div>`
    } else if (kind === 'referral_reward_request' || kind === 'referral_status_update') {
      subject = `🎁 طلب مكافأة إحالة — ${body.request_no || ''}`
      html = `
        <div style="font-family:Tahoma,Arial;direction:rtl;line-height:1.8">
          <h2>طلب مكافأة إحالة بانتظار الاعتماد</h2>
          <p><b>رقم الطلب:</b> ${escape(body.request_no)}</p>
          <p><b>المستفيد:</b> ${escape(body.beneficiary_name || body.employee_name)}</p>
          <p><b>نوع المكافأة:</b> ${escape(body.kind === 'cash' ? 'نقدية' : 'تمديد اشتراك')}</p>
          <p><b>القيمة:</b> ${escape(body.cash_amount ? body.cash_amount + ' ر.س' : (body.months || '') + ' أشهر')}</p>
          <p><b>المنشأة المُرشَّحة:</b> ${escape(body.referred_company_name)}</p>
          <p><b>الحالة:</b> ${escape(body.new_status || 'pending_admin')}</p>
          <p><b>التاريخ:</b> ${new Date().toLocaleString('ar-SA')}</p>
        </div>`
    } else {
      subject = `🆕 تسجيل جديد على المازن — ${body.company_name || 'منشأة جديدة'}`
      html = `
        <div style="font-family:Tahoma,Arial;direction:rtl;line-height:1.8">
          <h2>تسجيل عميل جديد لفترة التجربة (7 أيام)</h2>
          <p><b>اسم العميل:</b> ${escape(body.full_name)}</p>
          <p><b>اسم المنشأة:</b> ${escape(body.company_name)}</p>
          <p><b>السجل التجاري / الهوية:</b> ${escape(body.id_or_cr)}</p>
          <p><b>الجوال:</b> ${escape(body.phone)}</p>
          <p><b>البريد الإلكتروني:</b> ${escape(body.email)}</p>
          <p><b>كود الإحالة:</b> ${escape(body.referral_code || '—')}</p>
          <p><b>اسم المُحيل:</b> ${escape(body.referrer_name || '—')}</p>
          <p><b>وقت التسجيل:</b> ${escape(body.registered_at ? new Date(body.registered_at).toLocaleString('ar-SA') : new Date().toLocaleString('ar-SA'))}</p>
        </div>`
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return json({ error: data?.message || 'send_failed', recipients: to }, 502)
    return json({ ok: true, id: data?.id ?? null, recipients: to })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
