/* ============================================================================
   موفّرات الاستيراد الخارجية — Hostaway / Guesty
   يوفّر: حفظ/جلب بيانات الاعتماد (لكل شركة أو فرع)، الحصول على Access Token،
   وسحب الوحدات والحجوزات كصفوف جاهزة للـ Import Engine.
   ملاحظة: الاستدعاءات المباشرة من المتصفح قد ترفض بسبب CORS —
   نحاول أولاً استدعاءً مباشراً، وإن فشل نعطي المستخدم رسالة واضحة +
   الأمر البديل (curl / تشغيل عبر Supabase Edge Function).
============================================================================ */

import { supabase } from './supabase'

const STORAGE_KEY = 'almazen.importProviders.v1'

/* ---------------------------------------------------------------------------
   الوسيط (Edge Function) — ينفّذ الطلبات من الخادم لتجاوز CORS في الإنتاج.
   نحاول الوسيط أولاً، وإن تعذّر نعود للاستدعاء المباشر من المتصفح.
--------------------------------------------------------------------------- */
export async function proxyFetch(provider, path, credentials, params = {}) {
  const { data, error } = await supabase.functions.invoke('import-proxy', {
    body: { provider, path, params, credentials },
  })
  if (error) throw new Error(error.message || 'تعذّر الاتصال بوسيط الاستيراد')
  if (data?.error) throw new Error(data.error)
  return data?.rows || []
}

/** اختبار الاتصال عبر الوسيط (يتحقق من صحة بيانات الاعتماد فقط) */
export async function testProviderConnection(provider, credentials) {
  const { data, error } = await supabase.functions.invoke('import-proxy', {
    body: { provider, credentials, mode: 'test' },
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  return true
}

/** @typedef {'hostaway'|'guesty'} ProviderId */
/** @typedef {'global'|string} ScopeKey  // 'global' أو معرف الفرع */

/** جلب كل بيانات الاعتماد المخزّنة محلياً */
export function loadAllCredentials() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

/** جلب اعتماد محدّد */
export function getCredentials(provider, scope = 'global') {
  const all = loadAllCredentials()
  return all?.[provider]?.[scope] || null
}

/** حفظ اعتماد */
export function saveCredentials(provider, scope, creds) {
  const all = loadAllCredentials()
  all[provider] = all[provider] || {}
  all[provider][scope] = { ...creds, savedAt: new Date().toISOString() }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  return all[provider][scope]
}

/** حذف اعتماد */
export function deleteCredentials(provider, scope) {
  const all = loadAllCredentials()
  if (all?.[provider]?.[scope]) {
    delete all[provider][scope]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  }
}

/* ============================== Hostaway ================================== */
/**
 * Hostaway OAuth2 client_credentials
 * POST https://api.hostaway.com/v1/accessTokens
 * body: grant_type=client_credentials&client_id=..&client_secret=..&scope=general
 */
export async function hostawayGetToken({ accountId, apiKey }) {
  if (!accountId || !apiKey) throw new Error('Hostaway: معرّف الحساب ومفتاح API إلزاميان')
  const form = new URLSearchParams()
  form.set('grant_type', 'client_credentials')
  form.set('client_id', accountId)
  form.set('client_secret', apiKey)
  form.set('scope', 'general')

  const res = await fetch('https://api.hostaway.com/v1/accessTokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: form.toString(),
  }).catch(e => { throw new Error('تعذّر الوصول لـ Hostaway (قد يكون بسبب CORS): ' + e.message) })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Hostaway auth failed (${res.status}): ${txt.slice(0, 200)}`)
  }
  const j = await res.json()
  if (!j.access_token) throw new Error('Hostaway: لم يُرجع النظام Access Token')
  return j.access_token
}

async function hostawayGet(token, path, params = {}, creds = null) {
  if (creds) {
    try { return await proxyFetch('hostaway', path, creds, params) } catch (e) { console.warn('proxy fallback:', e.message) }
  }
  const url = new URL('https://api.hostaway.com/v1' + path)
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' } })
  if (!res.ok) throw new Error(`Hostaway ${path} failed (${res.status})`)
  const j = await res.json()
  return j?.result || []
}

/** جلب الوحدات (Listings) من Hostaway وتحويلها لصفوف مطابقة لهدف units */
export async function hostawayFetchListings(creds) {
  let list
  try { list = await proxyFetch('hostaway', '/listings', creds, { limit: 500 }) }
  catch { list = await hostawayGet(await hostawayGetToken(creds), '/listings', { limit: 500 }) }
  return list.map(x => ({
    'اسم الوحدة': x.name || x.internalListingName || x.externalListingName,
    'رقم الوحدة': x.internalListingName || x.id,
    'التصنيف': x.propertyTypeName || x.propertyType || 'شقة',
    'الدور': x.floor,
    'غرف النوم': x.bedroomsNumber,
    'دورات المياه': x.bathroomsNumber,
    'المساحة (م²)': x.squareMeters,
    'السعر اليومي': x.price,
    'العقار': x.propertyName || x.address || '',
    'العنوان': [x.address, x.city, x.country].filter(Boolean).join('، '),
    'الوصف': (x.description || '').slice(0, 500),
  }))
}

/** جلب الحجوزات من Hostaway وتحويلها لصفوف مطابقة لهدف bookings */
export async function hostawayFetchReservations(creds) {
  let list
  try { list = await proxyFetch('hostaway', '/reservations', creds, { limit: 500 }) }
  catch { list = await hostawayGet(await hostawayGetToken(creds), '/reservations', { limit: 500 }) }
  return list.map(x => ({
    'رقم الحجز': x.reservationId || x.id || x.confirmationCode,
    'العميل': x.guestName || `${x.guestFirstName || ''} ${x.guestLastName || ''}`.trim(),
    'الوحدة': x.listingName || x.listingId,
    'تاريخ الدخول': x.arrivalDate,
    'تاريخ الخروج': x.departureDate,
    'عدد الليالي': x.nights,
    'عدد الضيوف': x.numberOfGuests || x.adults,
    'الإجمالي': x.totalPrice,
    'القناة': x.channelName || x.channel,
    'الحالة': x.status,
    'ملاحظات': x.guestNote || x.hostNote || '',
  }))
}

/** جلب الفواتير (invoices/payments) — Hostaway يوفّر consolidatedInvoice على مستوى الحجز */
export async function hostawayFetchInvoices(creds) {
  const rows = await hostawayFetchReservations(creds)
  return rows.filter(r => Number(r['الإجمالي']) > 0).map(r => ({
    'رقم الفاتورة': `HA-${r['رقم الحجز']}`,
    'العميل': r['العميل'],
    'رقم الحجز': r['رقم الحجز'],
    'تاريخ الفاتورة': r['تاريخ الدخول'],
    'الإجمالي': r['الإجمالي'],
    'الحالة': r['الحالة'],
  }))
}

/* ================================ Guesty ================================== */
/**
 * Guesty OAuth2 client_credentials
 * POST https://open-api.guesty.com/oauth2/token
 */
export async function guestyGetToken({ clientId, clientSecret }) {
  if (!clientId || !clientSecret) throw new Error('Guesty: Client ID و Client Secret إلزاميان')
  const form = new URLSearchParams()
  form.set('grant_type', 'client_credentials')
  form.set('client_id', clientId)
  form.set('client_secret', clientSecret)
  form.set('scope', 'open-api')

  const res = await fetch('https://open-api.guesty.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
  }).catch(e => { throw new Error('تعذّر الوصول لـ Guesty (قد يكون بسبب CORS): ' + e.message) })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Guesty auth failed (${res.status}): ${txt.slice(0, 200)}`)
  }
  const j = await res.json()
  if (!j.access_token) throw new Error('Guesty: لم يُرجع النظام Access Token')
  return j.access_token
}

async function guestyGet(token, path, params = {}, creds = null) {
  if (creds) {
    try { return await proxyFetch('guesty', path, creds, params) } catch (e) { console.warn('proxy fallback:', e.message) }
  }
  const url = new URL('https://open-api.guesty.com' + path)
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Guesty ${path} failed (${res.status})`)
  const j = await res.json()
  return j?.results || j?.data || (Array.isArray(j) ? j : [])
}

export async function guestyFetchListings(creds) {
  let list
  try { list = await proxyFetch('guesty', '/v1/listings', creds, { limit: 100 }) }
  catch { list = await guestyGet(await guestyGetToken(creds), '/v1/listings', { limit: 100 }) }
  return list.map(x => ({
    'اسم الوحدة': x.nickname || x.title,
    'رقم الوحدة': x.nickname || x._id,
    'التصنيف': x.propertyType || 'شقة',
    'غرف النوم': x.bedrooms,
    'دورات المياه': x.bathrooms,
    'المساحة (م²)': x.areaSquareMeters,
    'السعر اليومي': x.prices?.basePrice,
    'العقار': x.title,
    'العنوان': x.address?.full || [x.address?.street, x.address?.city, x.address?.country].filter(Boolean).join('، '),
    'الوصف': (x.publicDescription?.summary || '').slice(0, 500),
  }))
}

export async function guestyFetchReservations(creds) {
  let list
  try { list = await proxyFetch('guesty', '/v1/reservations', creds, { limit: 100 }) }
  catch { list = await guestyGet(await guestyGetToken(creds), '/v1/reservations', { limit: 100 }) }
  return list.map(x => ({
    'رقم الحجز': x.confirmationCode || x._id,
    'العميل': x.guest?.fullName || `${x.guest?.firstName || ''} ${x.guest?.lastName || ''}`.trim(),
    'الوحدة': x.listing?.nickname || x.listingId,
    'تاريخ الدخول': x.checkIn,
    'تاريخ الخروج': x.checkOut,
    'عدد الليالي': x.nightsCount,
    'عدد الضيوف': x.guestsCount,
    'الإجمالي': x.money?.hostPayout || x.money?.totalPaid,
    'القناة': x.source,
    'الحالة': x.status,
    'ملاحظات': x.notes || '',
  }))
}

export async function guestyFetchInvoices(creds) {
  const rows = await guestyFetchReservations(creds)
  return rows.filter(r => Number(r['الإجمالي']) > 0).map(r => ({
    'رقم الفاتورة': `GY-${r['رقم الحجز']}`,
    'العميل': r['العميل'],
    'رقم الحجز': r['رقم الحجز'],
    'تاريخ الفاتورة': r['تاريخ الدخول'],
    'الإجمالي': r['الإجمالي'],
    'الحالة': r['الحالة'],
  }))
}

/* ============================================================================
   PROVIDER REGISTRY — يستخدمها DataImport لبناء التبويبات ديناميكياً
============================================================================ */
export const PROVIDERS = {
  hostaway: {
    id: 'hostaway',
    name: 'Hostaway',
    icon: '🏝️',
    color: '#059669',
    docs: 'https://api.hostaway.com/documentation',
    auth: 'OAuth2 Client Credentials',
    fields: [
      { key: 'accountId', label: 'Account ID', type: 'text', placeholder: '81234', required: true },
      { key: 'apiKey', label: 'API Key (Client Secret)', type: 'password', placeholder: 'xxxxxxxxxxxx', required: true },
    ],
    entities: {
      units: { label: 'الوحدات (Listings)', fetch: hostawayFetchListings, target: 'units' },
      bookings: { label: 'الحجوزات', fetch: hostawayFetchReservations, target: 'bookings' },
      invoices: { label: 'الفواتير', fetch: hostawayFetchInvoices, target: 'invoices' },
    },
  },
  guesty: {
    id: 'guesty',
    name: 'Guesty',
    icon: '🏘️',
    color: '#7c3aed',
    docs: 'https://open-api-docs.guesty.com/',
    auth: 'OAuth2 Client Credentials',
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', placeholder: '0oaXXXXXXX', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'xxxxxxxxxxxx', required: true },
    ],
    entities: {
      units: { label: 'الوحدات (Listings)', fetch: guestyFetchListings, target: 'units' },
      bookings: { label: 'الحجوزات', fetch: guestyFetchReservations, target: 'bookings' },
      invoices: { label: 'الفواتير', fetch: guestyFetchInvoices, target: 'invoices' },
    },
  },
}
