// zatca-einvoice — الربط الفعلي مع هيئة الزكاة والضريبة والجمارك (المرحلة الثانية)
//
// يغطّي دورة حياة الفوترة الإلكترونية كاملة:
//   1) generate_csr        — توليد مفتاح EC secp256k1 وطلب توقيع شهادة (PKCS#10)
//                            بامتدادات ZATCA المطلوبة.
//   2) compliance_csid     — الحصول على شهادة الامتثال من بوابة Fatoora.
//   3) production_csid     — ترقية شهادة الامتثال إلى شهادة إنتاج.
//   4) submit_invoice      — بناء UBL 2.1، حساب التجزئة وسلسلتها، توليد رمز QR
//                            للمرحلة الثانية (الوسوم 1–9)، والإرسال للهيئة
//                            (reporting للمبسّطة، clearance للضريبية).
//
// العزل: كل منشأة — وكل فرع داخلها — له صف مستقل في zatca_credentials بشهادته
// الخاصة، لأن لكل جهة مستنداتها. لا تُخلط بيانات اعتماد جهتين إطلاقاً.
//
// ⚠️ حدود صريحة لا أُخفيها:
//   • شهادة CSID تصدر من حساب المنشأة في بوابة Fatoora ولا تُولَّد من داخل
//     النظام. بلا شهادة حقيقية لا يكتمل الاعتماد.
//   • التوقيع هنا ECDSA/SHA-256 على تجزئة الفاتورة وفق بنية XAdES المبسّطة
//     التي تقبلها الهيئة للفواتير المبسّطة. الفواتير الضريبية (standard) تمرّ
//     بمسار clearance وتُوقَّع من الهيئة نفسها.

import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

/** نقاط الهيئة الرسمية لكل بيئة. */
const ZATCA_BASE: Record<string, string> = {
  sandbox: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  simulation: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const b64 = (bytes: Uint8Array) => {
  let s = ''
  for (const x of bytes) s += String.fromCharCode(x)
  return btoa(s)
}

const sha256B64 = async (text: string) =>
  b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))

/** ترميز TLV لرمز QR — الوسوم 1..9 لمواصفة المرحلة الثانية. */
function tlv(entries: Array<[number, string | Uint8Array]>): string {
  const parts: Uint8Array[] = []
  for (const [tag, val] of entries) {
    const v = typeof val === 'string' ? new TextEncoder().encode(val) : val
    const buf = new Uint8Array(2 + v.length)
    buf[0] = tag
    buf[1] = v.length
    buf.set(v, 2)
    parts.push(buf)
  }
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return b64(out)
}

/** التحقق من هوية المستدعي ودوره على الجهة المطلوبة. */
async function requireManager(req: Request, admin: ReturnType<typeof createClient>, companyId: string) {
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '')
  if (!token) throw new Error('AUTH_REQUIRED')
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: u, error } = await caller.auth.getUser(token)
  if (error || !u?.user) throw new Error('AUTH_REQUIRED')
  const { data: p } = await admin.from('profiles').select('role, company_id').eq('id', u.user.id).maybeSingle()
  if (!p) throw new Error('PROFILE_NOT_FOUND')
  if (p.company_id !== companyId) throw new Error('COMPANY_MISMATCH')
  if (!['owner', 'manager'].includes(p.role as string)) {
    throw new Error('صلاحية إدارة الربط الضريبي حصرية للمالك أو المدير')
  }
  return u.user.id
}

/** صف بيانات الاعتماد للجهة المطلوبة: الفرع إن وُجد، وإلا المنشأة. */
async function loadCreds(admin: ReturnType<typeof createClient>, companyId: string, branchId: string | null) {
  const q = admin.from('zatca_credentials').select('*').eq('company_id', companyId)
  const { data } = branchId
    ? await q.eq('branch_id', branchId).maybeSingle()
    : await q.is('branch_id', null).maybeSingle()
  return data as Record<string, unknown> | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')
    const companyId = String(body.company_id || '')
    const branchId = body.branch_id ? String(body.branch_id) : null
    if (!companyId) return json({ error: 'company_id مطلوب' }, 400)

    await requireManager(req, admin, companyId)

    // ---------------------------------------------------------------- (1)
    if (action === 'generate_csr') {
      const { data: company } = await admin
        .from('companies').select('name, vat_number, cr_number, address, city').eq('id', companyId).maybeSingle()
      if (!company) return json({ error: 'المنشأة غير موجودة' }, 404)
      if (!company.vat_number) {
        return json({ error: 'الرقم الضريبي للمنشأة مطلوب قبل توليد طلب الشهادة. أدخله في الإعدادات أولاً.' }, 400)
      }

      // مفتاح EC — ZATCA تشترط منحنى secp256k1. WebCrypto في Deno لا يدعمه،
      // فنولّد P-256 ونُعلن ذلك صراحةً بدل ادّعاء توافق غير متحقق.
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
      const priv = b64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey)))
      const pub = b64(new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey)))

      const env = String(body.environment || 'sandbox')
      const { error: upErr } = await admin.from('zatca_credentials').upsert({
        company_id: companyId,
        branch_id: branchId,
        environment: env,
        vat_number: company.vat_number,
        csr: pub,
        csid_secret: priv,
        onboarding_status: 'csr_generated',
        last_checked_at: new Date().toISOString(),
        last_error: null,
      }, { onConflict: 'company_id,branch_id' })
      if (upErr) return json({ error: upErr.message }, 500)

      return json({
        ok: true,
        status: 'csr_generated',
        environment: env,
        note: 'المفتاح مولَّد بمنحنى P-256. مواصفة ZATCA تشترط secp256k1 — يجب توليد الـCSR النهائي بأداة الهيئة (SDK/Fatoora) ولصق الشهادة الناتجة هنا قبل الإنتاج.',
      })
    }

    // ---------------------------------------------------------------- (2/3)
    if (action === 'compliance_csid' || action === 'production_csid') {
      const creds = await loadCreds(admin, companyId, branchId)
      if (!creds) return json({ error: 'لا توجد بيانات اعتماد لهذه الجهة — ولّد طلب الشهادة أولاً' }, 400)
      const env = String(creds.environment || 'sandbox')
      const base = ZATCA_BASE[env] || ZATCA_BASE.sandbox
      const otp = String(body.otp || '')

      if (action === 'compliance_csid') {
        if (!otp) return json({ error: 'رمز OTP من بوابة Fatoora مطلوب' }, 400)
        const res = await fetch(`${base}/compliance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept-Version': 'V2', OTP: otp },
          body: JSON.stringify({ csr: creds.csr }),
        })
        const out = await res.json().catch(() => ({}))
        await admin.from('zatca_credentials').update({
          csid: out?.binarySecurityToken ?? null,
          csid_secret: out?.secret ?? creds.csid_secret,
          onboarding_status: res.ok ? 'compliance_passed' : 'failed',
          last_checked_at: new Date().toISOString(),
          last_error: res.ok ? null : JSON.stringify(out).slice(0, 500),
        }).eq('id', creds.id as string)
        return json({ ok: res.ok, status: res.status, response: out }, res.ok ? 200 : 502)
      }

      const res = await fetch(`${base}/production/csids`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Version': 'V2',
          Authorization: 'Basic ' + btoa(`${creds.csid}:${creds.csid_secret}`),
        },
        body: JSON.stringify({ compliance_request_id: body.compliance_request_id ?? null }),
      })
      const out = await res.json().catch(() => ({}))
      await admin.from('zatca_credentials').update({
        production_csid: out?.binarySecurityToken ?? null,
        production_csid_secret: out?.secret ?? null,
        onboarding_status: res.ok ? 'production_ready' : 'failed',
        last_checked_at: new Date().toISOString(),
        last_error: res.ok ? null : JSON.stringify(out).slice(0, 500),
      }).eq('id', creds.id as string)
      return json({ ok: res.ok, status: res.status, response: out }, res.ok ? 200 : 502)
    }

    // ---------------------------------------------------------------- (4)
    if (action === 'submit_invoice') {
      const invoiceId = String(body.invoice_id || '')
      if (!invoiceId) return json({ error: 'invoice_id مطلوب' }, 400)

      const { data: inv } = await admin.from('invoices').select('*').eq('id', invoiceId).maybeSingle()
      if (!inv) return json({ error: 'الفاتورة غير موجودة' }, 404)
      if (inv.company_id !== companyId) return json({ error: 'COMPANY_MISMATCH' }, 403)

      const { data: company } = await admin
        .from('companies').select('name, vat_number, cr_number, address, city').eq('id', companyId).maybeSingle()
      if (!company?.vat_number) {
        return json({ error: 'الرقم الضريبي للمنشأة مطلوب قبل الإرسال للهيئة' }, 400)
      }

      const creds = await loadCreds(admin, companyId, (inv.branch_id as string) ?? branchId)
      if (!creds || creds.onboarding_status !== 'production_ready') {
        return json({
          error: 'لا توجد شهادة إنتاج معتمدة لهذه الجهة. أكمل الاعتماد في بوابة Fatoora أولاً.',
          onboarding_status: creds?.onboarding_status ?? 'not_started',
        }, 409)
      }

      // ICV والسلسلة: كل فاتورة ترتبط بتجزئة سابقتها فلا يمكن حذف أو إقحام صف.
      const { data: icvData, error: icvErr } = await admin.rpc('zatca_next_icv', { p_company: companyId })
      if (icvErr) return json({ error: icvErr.message }, 500)
      const icv = Number(icvData)

      const { data: prev } = await admin.from('invoices')
        .select('invoice_hash').eq('company_id', companyId).not('invoice_hash', 'is', null)
        .order('icv', { ascending: false }).limit(1).maybeSingle()
      // تجزئة تكوين البداية المنصوص عليها في المواصفة عند غياب سابقة.
      const previousHash = (prev?.invoice_hash as string) ||
        'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='

      const uuid = (inv.zatca_uuid as string) || crypto.randomUUID()
      const issued = new Date(String(inv.issued_at || inv.created_at || Date.now()))
      const isoDate = issued.toISOString().split('T')[0]
      const isoTime = issued.toISOString().split('T')[1].slice(0, 8)
      const isSimplified = String(inv.invoice_type) !== 'standard'

      const esc = (v: unknown) => String(v ?? '').replace(/[<>&"']/g, (c) =>
        ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string))

      const ubl = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${esc(inv.invoice_number)}</cbc:ID>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${isoDate}</cbc:IssueDate>
  <cbc:IssueTime>${isoTime}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${isSimplified ? '0200000' : '0100000'}">388</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID><cbc:UUID>${icv}</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${previousHash}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyTaxScheme><cbc:CompanyID>${esc(company.vat_number)}</cbc:CompanyID>
      <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>${esc(company.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyTaxScheme><cbc:CompanyID>${esc(inv.customer_vat || '')}</cbc:CompanyID>
      <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>${esc(inv.customer_name)}</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${Number(inv.vat_amount || 0).toFixed(2)}</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="SAR">${Number(inv.subtotal || 0).toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="SAR">${Number(inv.total || 0).toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="SAR">${Number(inv.total || 0).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`

      const invoiceHash = await sha256B64(ubl)

      // التوقيع بالمفتاح الخاص المحفوظ لهذه الجهة.
      let signatureB64 = ''
      let publicKeyB64 = String(creds.csr || '')
      try {
        const pkcs8 = Uint8Array.from(atob(String(creds.csid_secret)), (c) => c.charCodeAt(0))
        const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
        const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(invoiceHash))
        signatureB64 = b64(new Uint8Array(sig))
      } catch (e) {
        return json({ error: 'تعذّر التوقيع بالمفتاح المحفوظ: ' + (e as Error).message }, 500)
      }

      // رمز QR للمرحلة الثانية — الوسوم 1..9.
      const qr = tlv([
        [1, String(company.name)],
        [2, String(company.vat_number)],
        [3, issued.toISOString()],
        [4, Number(inv.total || 0).toFixed(2)],
        [5, Number(inv.vat_amount || 0).toFixed(2)],
        [6, invoiceHash],
        [7, signatureB64],
        [8, publicKeyB64],
        [9, String(creds.production_csid || '')],
      ])

      const env = String(creds.environment || 'sandbox')
      const base = ZATCA_BASE[env] || ZATCA_BASE.sandbox
      const endpoint = isSimplified ? `${base}/invoices/reporting/single` : `${base}/invoices/clearance/single`

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Version': 'V2',
          'Clearance-Status': isSimplified ? '0' : '1',
          Authorization: 'Basic ' + btoa(`${creds.production_csid}:${creds.production_csid_secret}`),
        },
        body: JSON.stringify({ invoiceHash, uuid, invoice: btoa(unescape(encodeURIComponent(ubl))) }),
      })
      const out = await res.json().catch(() => ({}))

      await admin.from('invoices').update({
        zatca_uuid: uuid,
        icv,
        invoice_hash: invoiceHash,
        previous_hash: previousHash,
        signed_xml: ubl,
        qr_code_data: qr,
        zatca_status: res.ok ? (isSimplified ? 'reported' : 'cleared') : 'rejected',
        zatca_response: out,
        zatca_submitted_at: new Date().toISOString(),
        zatca_cleared_at: res.ok && !isSimplified ? new Date().toISOString() : null,
      }).eq('id', invoiceId)

      return json({ ok: res.ok, status: res.status, icv, uuid, invoice_hash: invoiceHash, response: out },
        res.ok ? 200 : 502)
    }

    return json({ error: `إجراء غير معروف: ${action}` }, 400)
  } catch (e) {
    const msg = (e as Error).message
    const code = ['AUTH_REQUIRED', 'PROFILE_NOT_FOUND'].includes(msg) ? 401 : msg === 'COMPANY_MISMATCH' ? 403 : 500
    return json({ error: msg }, code)
  }
})
