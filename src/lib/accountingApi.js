import { supabase } from './supabase'
import { downloadWorkbook } from './excel'

/*
  طبقة وصول واحدة للنظام المحاسبي.
  كل استدعاء يمر عبر دوال قاعدة البيانات التي تتحقق من الصلاحية بنفسها،
  فلا تعتمد الواجهة على إخفاء الأزرار كوسيلة حماية.
*/

async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}

/* ------------------------------ شجرة الحسابات ------------------------------ */

export async function fetchAccounts(companyId) {
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .select('id, code, name, account_type, parent_id, is_group, opening_balance, is_active')
    .eq('company_id', companyId)
    .order('code')
  if (error) throw new Error(error.message)
  return data || []
}

/** يحوّل قائمة مسطّحة إلى شجرة أصل/فروع مرتّبة برقم الحساب. */
export function buildAccountTree(rows) {
  const byId = new Map(rows.map(r => [r.id, { ...r, children: [] }]))
  const roots = []
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sortRec = (list) => {
    list.sort((a, b) => String(a.code).localeCompare(String(b.code), 'en'))
    list.forEach(n => sortRec(n.children))
  }
  sortRec(roots)
  return roots
}

/** يفرد الشجرة لصفوف جدول مع مستوى العمق — للعرض والطباعة والإكسيل. */
export function flattenTree(roots, level = 0, out = []) {
  for (const n of roots) {
    out.push({ ...n, level })
    if (n.children?.length) flattenTree(n.children, level + 1, out)
  }
  return out
}

export async function saveAccount(companyId, acc) {
  const row = {
    company_id: companyId,
    code: acc.code,
    name: acc.name,
    account_type: acc.account_type,
    parent_id: acc.parent_id || null,
    is_group: !!acc.is_group,
    opening_balance: Number(acc.opening_balance) || 0,
    is_active: acc.is_active !== false,
  }
  const q = acc.id
    ? supabase.from('chart_of_accounts').update(row).eq('id', acc.id).select().single()
    : supabase.from('chart_of_accounts').insert(row).select().single()
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data
}

export async function deleteAccount(id) {
  const { error } = await supabase.from('chart_of_accounts').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/* --------------------------------- القيود --------------------------------- */

export async function fetchEntries(companyId, { from, to, status, search, limit = 300 } = {}) {
  let q = supabase
    .from('journal_entries')
    .select('id, entry_number, entry_date, description, reference, status, source_type, branch_id, posted_at, reversal_of_id, reversed_by_id, journal_entry_lines(id, debit, credit)')
    .eq('company_id', companyId)
    .order('entry_date', { ascending: false })
    .order('entry_number', { ascending: false })
    .limit(limit)
  if (from) q = q.gte('entry_date', from)
  if (to) q = q.lte('entry_date', to)
  if (status && status !== 'all') q = q.eq('status', status)
  if (search) q = q.or(`entry_number.ilike.%${search}%,description.ilike.%${search}%,reference.ilike.%${search}%`)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data || []).map(e => {
    const lines = e.journal_entry_lines || []
    return {
      ...e,
      total_debit: lines.reduce((s, l) => s + Number(l.debit || 0), 0),
      total_credit: lines.reduce((s, l) => s + Number(l.credit || 0), 0),
      line_count: lines.length,
    }
  })
}

export async function fetchEntry(entryId) {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('*, journal_entry_lines(*, chart_of_accounts(id, code, name, account_type), cost_centers(id, code, name), tax_codes(id, code, name, rate))')
    .eq('id', entryId)
    .single()
  if (error) throw new Error(error.message)
  const lines = (data.journal_entry_lines || []).sort((a, b) => (a.line_order || 0) - (b.line_order || 0))
  return { ...data, lines }
}

export const saveEntry = (p) => rpc('je_save', {
  p_entry_id: p.id || null,
  p_company: p.company_id,
  p_date: p.entry_date,
  p_description: p.description || null,
  p_reference: p.reference || null,
  p_lines: p.lines,
  p_branch: p.branch_id || null,
  p_notes: p.notes || null,
})

export const postEntry = (id) => rpc('je_post', { p_entry_id: id })
export const unpostEntry = (id) => rpc('je_unpost', { p_entry_id: id })
export const reverseEntry = (id, date, reason) => rpc('je_reverse', { p_entry_id: id, p_date: date || null, p_reason: reason || null })
export const deleteEntry = (id) => rpc('je_delete', { p_entry_id: id })

/* ------------------------- دفتر الأستاذ وميزان المراجعة ------------------------- */

export const glLedger = (p) => rpc('gl_ledger', {
  p_company: p.company_id, p_account: p.account_id || null,
  p_from: p.from || null, p_to: p.to || null,
  p_cost_center: p.cost_center_id || null, p_branch: p.branch_id || null,
  p_include_draft: !!p.include_draft,
})

export const trialBalance = (p) => rpc('trial_balance', {
  p_company: p.company_id, p_from: p.from || null, p_to: p.to || null,
  p_cost_center: p.cost_center_id || null, p_branch: p.branch_id || null,
  p_include_zero: p.include_zero !== false, p_include_draft: !!p.include_draft,
})

export const tbIntegrityCheck = (companyId) => rpc('tb_integrity_check', { p_company: companyId })
export const tbRepair = (companyId, code, dry = false) => rpc('tb_repair', { p_company: companyId, p_code: code || null, p_dry: dry })

export const vatReport = (companyId, from, to) => rpc('vat_report', { p_company: companyId, p_from: from || null, p_to: to || null })

/* ------------------------------ مراكز التكلفة ------------------------------ */

export async function fetchCostCenters(companyId) {
  const { data, error } = await supabase
    .from('cost_centers')
    .select('*, branches(name), units(unit_number)')
    .eq('company_id', companyId).order('code')
  if (error) throw new Error(error.message)
  return data || []
}

export async function saveCostCenter(companyId, cc) {
  const row = {
    company_id: companyId, code: cc.code, name: cc.name, kind: cc.kind || 'department',
    parent_id: cc.parent_id || null, branch_id: cc.branch_id || null, unit_id: cc.unit_id || null,
    is_group: !!cc.is_group, is_active: cc.is_active !== false, notes: cc.notes || null,
  }
  const q = cc.id
    ? supabase.from('cost_centers').update(row).eq('id', cc.id).select().single()
    : supabase.from('cost_centers').insert(row).select().single()
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data
}

export const deleteCostCenter = async (id) => {
  const { error } = await supabase.from('cost_centers').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/* ------------------------------- رموز الضريبة ------------------------------- */

export async function fetchTaxCodes(companyId) {
  const { data, error } = await supabase.from('tax_codes')
    .select('*, chart_of_accounts(code, name)').eq('company_id', companyId).order('code')
  if (error) throw new Error(error.message)
  return data || []
}

export async function saveTaxCode(companyId, t) {
  const row = {
    company_id: companyId, code: t.code, name: t.name, rate: Number(t.rate) || 0,
    kind: t.kind || 'both', account_id: t.account_id || null,
    is_default: !!t.is_default, is_active: t.is_active !== false,
  }
  const q = t.id
    ? supabase.from('tax_codes').update(row).eq('id', t.id).select().single()
    : supabase.from('tax_codes').insert(row).select().single()
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data
}

export const deleteTaxCode = async (id) => {
  const { error } = await supabase.from('tax_codes').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/* -------------------------------- الخدمات -------------------------------- */

export async function fetchServices(companyId) {
  const { data, error } = await supabase.from('services_catalog')
    .select('*, tax_codes(code, rate), income:income_account_id(code, name), expense:expense_account_id(code, name)')
    .eq('company_id', companyId).order('code')
  if (error) throw new Error(error.message)
  return data || []
}

export async function saveService(companyId, s) {
  const row = {
    company_id: companyId, code: s.code, name: s.name, category: s.category || null,
    description: s.description || null,
    unit_price: Number(s.unit_price) || 0, cost_price: Number(s.cost_price) || 0,
    uom: s.uom || 'خدمة', tax_code_id: s.tax_code_id || null,
    income_account_id: s.income_account_id || null, expense_account_id: s.expense_account_id || null,
    cost_center_id: s.cost_center_id || null, is_active: s.is_active !== false,
    updated_at: new Date().toISOString(),
  }
  const q = s.id
    ? supabase.from('services_catalog').update(row).eq('id', s.id).select().single()
    : supabase.from('services_catalog').insert(row).select().single()
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data
}

export const deleteService = async (id) => {
  const { error } = await supabase.from('services_catalog').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/* --------------------------- الإيرادات/النفقات المؤجلة --------------------------- */

export async function fetchDeferred(companyId, kind) {
  let q = supabase.from('deferred_schedules')
    .select('*, deferred_schedule_lines(id, period_date, amount, recognized, entry_id)')
    .eq('company_id', companyId).order('created_at', { ascending: false })
  if (kind) q = q.eq('kind', kind)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data || []).map(s => ({
    ...s,
    lines: (s.deferred_schedule_lines || []).sort((a, b) => a.period_date.localeCompare(b.period_date)),
    recognized_amount: (s.deferred_schedule_lines || []).filter(l => l.recognized).reduce((t, l) => t + Number(l.amount), 0),
  }))
}

export async function saveDeferred(companyId, s) {
  const row = {
    company_id: companyId, kind: s.kind, name: s.name,
    source_type: s.source_type || null, source_id: s.source_id || null,
    deferred_account_id: s.deferred_account_id || null,
    recognition_account_id: s.recognition_account_id || null,
    cost_center_id: s.cost_center_id || null,
    total_amount: Number(s.total_amount) || 0,
    periodicity: s.periodicity || 'monthly', computation: s.computation || 'by_months',
    start_date: s.start_date, end_date: s.end_date, branch_id: s.branch_id || null,
  }
  const q = s.id
    ? supabase.from('deferred_schedules').update(row).eq('id', s.id).select().single()
    : supabase.from('deferred_schedules').insert(row).select().single()
  const { data, error } = await q
  if (error) throw new Error(error.message)
  await rpc('deferred_generate', { p_schedule: data.id })
  return data
}

export const recognizeDeferredLine = (lineId) => rpc('deferred_recognize', { p_line: lineId })
export const deleteDeferred = async (id) => {
  const { error } = await supabase.from('deferred_schedules').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/* --------------------------- الفترات والإعدادات --------------------------- */

export async function fetchFiscalPeriods(companyId) {
  const { data, error } = await supabase.from('fiscal_periods')
    .select('*').eq('company_id', companyId).order('start_date', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function saveFiscalPeriod(companyId, p) {
  const row = {
    company_id: companyId, name: p.name, start_date: p.start_date, end_date: p.end_date,
    is_closed: !!p.is_closed, closed_at: p.is_closed ? new Date().toISOString() : null,
  }
  const q = p.id
    ? supabase.from('fiscal_periods').update(row).eq('id', p.id).select().single()
    : supabase.from('fiscal_periods').insert(row).select().single()
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data
}

export const deleteFiscalPeriod = async (id) => {
  const { error } = await supabase.from('fiscal_periods').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function fetchAccountingSettings(companyId) {
  const { data, error } = await supabase.from('accounting_settings')
    .select('*').eq('company_id', companyId).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function saveAccountingSettings(companyId, s) {
  const { data, error } = await supabase.from('accounting_settings')
    .upsert({ ...s, company_id: companyId, updated_at: new Date().toISOString() }, { onConflict: 'company_id' })
    .select().single()
  if (error) throw new Error(error.message)
  return data
}

/* --------------------------------- أدوات --------------------------------- */

export const money = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const ACCOUNT_TYPES = {
  asset: 'أصول', liability: 'التزامات', equity: 'حقوق ملكية',
  revenue: 'إيرادات', expense: 'مصروفات',
}

export const COST_CENTER_KINDS = {
  department: 'إدارة', branch: 'فرع', unit: 'وحدة', project: 'مشروع', other: 'أخرى',
}

export const JE_STATUS = {
  draft: { label: 'مسودة', color: '#B45309', bg: '#FEF3C7' },
  posted: { label: 'مُرحَّل', color: '#065F46', bg: '#D1FAE5' },
  void: { label: 'ملغى', color: '#991B1B', bg: '#FEE2E2' },
}

/** يصدّر أي جدول معروض إلى ملف إكسيل حقيقي بمعادلات إجمالية. */
export function exportRows(filename, sheetName, rows, numericCols = []) {
  if (!rows?.length) throw new Error('لا توجد بيانات للتصدير')
  // downloadWorkbook يبني الورقة بنفسه من rows/numeric — تمرير ws جاهزة يُهمَل
  // ويُنتج ملفاً فارغاً، فنمرّر الصفوف كما تتوقعها الدالة.
  downloadWorkbook(filename, [{ name: sheetName, rows, numeric: numericCols }])
}

/**
 * يحسب الضريبة من الأساس أو من الإجمالي.
 * الفاتورة قد تُدخل بالصافي أو شاملة الضريبة، والمحاسب يحتاج الاتجاهين.
 */
export function computeVat(amount, rate, inclusive = false) {
  const a = Number(amount) || 0
  const r = Number(rate) || 0
  if (!r) return { net: a, vat: 0, gross: a }
  if (inclusive) {
    const net = a / (1 + r / 100)
    return { net: round2(net), vat: round2(a - net), gross: round2(a) }
  }
  const vat = a * r / 100
  return { net: round2(a), vat: round2(vat), gross: round2(a + vat) }
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
