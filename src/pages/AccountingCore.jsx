import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { useBranches } from '../BranchContext'
import { SAR, num, today, PAY_METHODS, ROLES, uploadFile, openStoredDocument } from '../lib/helpers'
import UnitActivityPanel from '../components/UnitActivityPanel'
import VoucherPrintModal from '../components/VoucherPrint'
import PrintableDoc from '../components/PrintableDoc'

const ACCOUNT_TYPE_LABEL = { asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية', revenue: 'إيرادات', expense: 'مصروفات' }
const PARTY_LABEL = { tenant: 'مستأجر', vendor: 'مورد', employee: 'موظف', other: 'أخرى' }

/* الأساس المحاسبي — شجرة الحسابات + القيود المحاسبية + السندات */
export default function AccountingCore() {
  const [tab, setTab] = useState('tree')

  return (
    <div className="panel" style={{ gridColumn: '1 / -1' }}>
      <div className="pg-title" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>🧮 الأساس المحاسبي</h3>
      </div>
      <div className="acc-tabs">
        <button className={tab === 'tree' ? 'on' : ''} onClick={() => setTab('tree')}>🌳 شجرة الحسابات</button>
        <button className={tab === 'ledger' ? 'on' : ''} onClick={() => setTab('ledger')}>📒 القيود وكشف الحساب</button>
        <button className={tab === 'vouchers' ? 'on' : ''} onClick={() => setTab('vouchers')}>🧾 السندات</button>
        <button className={tab === 'attachments' ? 'on' : ''} onClick={() => setTab('attachments')}>📎 مركز المرفقات</button>
        <button className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>📋 النشاط والحسابات</button>
      </div>
      {tab === 'tree' && <ChartOfAccountsTab />}
      {tab === 'ledger' && <LedgerTab />}
      {tab === 'vouchers' && <VouchersTab />}
      {tab === 'attachments' && <AttachmentsCenter />}
      {tab === 'activity' && <ActivityAndAccountsTab />}
    </div>
  )
}

/* =====================================================================
   مركز المرفقات — جميع المستندات المرفوعة في النظام في مكان واحد
   ===================================================================== */
function AttachmentsCenter() {
  const { profile, company, toast } = useAuth()
  const { scopeQuery, activeBranch } = useBranches()
  const [kind, setKind] = useState('ids')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [printModal, setPrintModal] = useState(false)

  const load = async (k) => {
    setLoading(true)
    const cid = profile.company_id
    if (k === 'ids') {
      const { data } = await scopeQuery(supabase.from('customers')
        .select('full_name, id_number, id_document_url, created_at, profiles(full_name)')
        .eq('company_id', cid)).not('id_document_url', 'is', null).order('created_at', { ascending: false })
      setRows((data || []).map(c => ({
        label: c.full_name, sub: 'هوية عميل — ' + (c.id_number || ''),
        uploader: c.profiles?.full_name || '—', date: c.created_at?.slice(0, 10), url: c.id_document_url
      })))
    } else if (k === 'employee_ids') {
      const { data } = await supabase.from('profiles')
        .select('full_name, id_photo_url, contract_url, created_at')
        .eq('company_id', cid)
      const out = []
      for (const p of data || []) {
        if (p.id_photo_url) out.push({ label: p.full_name, sub: 'هوية موظف', uploader: '—', date: p.created_at?.slice(0, 10), url: p.id_photo_url })
        if (p.contract_url) out.push({ label: p.full_name, sub: 'عقد عمل', uploader: '—', date: p.created_at?.slice(0, 10), url: p.contract_url })
      }
      setRows(out)
    } else if (k === 'payment_proofs') {
      const { data } = await scopeQuery(supabase.from('payments')
        .select('amount, payment_date, payment_type, document_url, bookings(customers(full_name)), profiles!payments_received_by_fkey(full_name)')
        .eq('company_id', cid)).not('document_url', 'is', null).order('payment_date', { ascending: false })
      setRows((data || []).map(p => ({
        label: p.bookings?.customers?.full_name || 'مستأجر',
        sub: `إيصال سداد (${p.payment_type}) — ${SAR(p.amount)}`,
        uploader: p.profiles?.full_name || '—', date: p.payment_date, url: p.document_url
      })))
    } else if (k === 'invoices') {
      let data = null
      try {
        const { data: expData } = await scopeQuery(supabase.from('expenses')
          .select('description, vendor_name, expense_date, amount, invoice_url, category, units(unit_number), profiles(full_name)')
          .eq('company_id', cid)).not('invoice_url', 'is', null).order('expense_date', { ascending: false })
        data = expData
      } catch (err) {
        const { data: expData } = await scopeQuery(supabase.from('expenses')
          .select('description, vendor_name, expense_date, amount, invoice_url, category, units(unit_number)')
          .eq('company_id', cid)).not('invoice_url', 'is', null).order('expense_date', { ascending: false })
        data = expData
      }
      setRows((data || []).map(e => {
        let catLabel = e.category === 'maintenance' ? 'صيانة' : e.category;
        if (e.category === 'electricity') catLabel = 'كهرباء';
        if (e.category === 'water') catLabel = 'مياه';
        if (e.category === 'other_bill') catLabel = 'فاتورة أخرى';
        
        return {
          label: e.vendor_name || (e.units?.unit_number ? `وحدة ${e.units.unit_number}` : e.description) || 'مصروف',
          sub: `فاتورة مصروف (${catLabel}) — ${SAR(e.amount)} ${e.description ? `(${e.description})` : ''}`,
          uploader: e.profiles?.full_name || 'قسم المرفقات', date: e.expense_date, url: e.invoice_url
        }
      }))
    }
    setLoading(false)
  }
  useEffect(() => { load(kind) }, [kind, profile, activeBranch])

  return (
    <div>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>
        كل المرفقات التي يرفعها الموظفون والمحاسبون في النظام — إيصالات السداد، فواتير المصروفات، صور الهويات والعقود — في مكان واحد للمراجعة.
      </p>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="acc-tabs" style={{ marginBottom: 0 }}>
          <button className={kind === 'ids' ? 'on' : ''} onClick={() => setKind('ids')}>🪪 هويات العملاء</button>
          <button className={kind === 'employee_ids' ? 'on' : ''} onClick={() => setKind('employee_ids')}>🧑‍💼 هويات وعقود الموظفين</button>
          <button className={kind === 'payment_proofs' ? 'on' : ''} onClick={() => setKind('payment_proofs')}>🧾 إيصالات السداد</button>
          <button className={kind === 'invoices' ? 'on' : ''} onClick={() => setKind('invoices')}>📄 فواتير المصروفات</button>
        </div>
        {rows.length > 0 && (
          <button className="btn btn-blue btn-sm" onClick={() => setPrintModal(true)}>
            🖨 طباعة القائمة (التصميم الفاخر)
          </button>
        )}
      </div>
      {loading ? <p style={{ color: 'var(--muted)' }}>جارٍ التحميل…</p> : (
        <table className="tbl">
          <thead><tr><th>الجهة</th><th>سبب الرفع</th><th>رفعه</th><th>التاريخ</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا توجد مرفقات من هذا النوع بعد</td></tr>}
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.label}</td><td>{r.sub}</td><td>{r.uploader}</td><td>{r.date}</td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => openStoredDocument(supabase, r.url, {
                  onError: message => toast(message, true),
                  context: { area: 'accounting_attachments', attachment_kind: kind, label: r.label },
                })}>🔍 عرض</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {printModal && (
        <PrintableDoc
          company={company}
          title="تقرير بيان مركز المرفقات والمستندات"
          subtitle={`التصنيف: ${kind} — التاريخ: ${today()}`}
          docKind="report"
          onClose={() => setPrintModal(false)}
        >
          <table className="tbl">
            <thead><tr><th>الجهة</th><th>سبب الرفع</th><th>رفعه</th><th>التاريخ</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.label}</td><td>{r.sub}</td><td>{r.uploader}</td><td>{r.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PrintableDoc>
      )}
    </div>
  )
}

/* =====================================================================
   النشاط والحسابات — نسخة داخل قسم الحسابات (نفس المحتوى الموجود في
   إدارة الموظفين، مُتاحة هنا أيضاً لتسهيل مراجعة المحاسب)
   ===================================================================== */
function ActivityAndAccountsTab() {
  const { profile, company } = useAuth()
  const [staff, setStaff] = useState([])
  const [printModal, setPrintModal] = useState(false)
  useEffect(() => {
    supabase.from('profiles').select('full_name, role, username, job_title, salary, hire_date')
      .eq('company_id', profile.company_id).order('full_name')
      .then(({ data }) => setStaff(data || []))
  }, [profile])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h4 className="ts-h4" style={{ margin: 0 }}>قائمة الحسابات (ملخص)</h4>
        {staff.length > 0 && (
          <button className="btn btn-blue btn-sm" onClick={() => setPrintModal(true)}>
            🖨 طباعة قائمة حسابات الموظفين (التصميم الفاخر)
          </button>
        )}
      </div>
      <table className="tbl" style={{ marginBottom: 20 }}>
        <thead><tr><th>الاسم</th><th>الدور</th><th>اسم المستخدم</th><th>المسمى الوظيفي</th><th>الراتب</th><th>تاريخ التعيين</th></tr></thead>
        <tbody>
          {staff.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا يوجد موظفون</td></tr>}
          {staff.map((s, i) => (
            <tr key={i}>
              <td>{s.full_name}</td><td>{ROLES[s.role]}</td><td dir="ltr">{s.username || '—'}</td>
              <td>{s.job_title || '—'}</td><td className="money">{SAR(s.salary)}</td><td dir="ltr">{s.hire_date || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4 className="ts-h4">نشاط الوحدات</h4>
      <UnitActivityPanel />

      {printModal && (
        <PrintableDoc
          company={company}
          title="تقرير ملخص حسابات الموظفين وطاقم العمل"
          subtitle={`تاريخ المستند: ${today()} — منشأة: ${company?.name || 'المازن'}`}
          docKind="report"
          onClose={() => setPrintModal(false)}
        >
          <table className="tbl">
            <thead><tr><th>الاسم</th><th>الدور</th><th>اسم المستخدم</th><th>المسمى الوظيفي</th><th>الراتب</th><th>تاريخ التعيين</th></tr></thead>
            <tbody>
              {staff.map((s, i) => (
                <tr key={i}>
                  <td>{s.full_name}</td><td>{ROLES[s.role]}</td><td dir="ltr">{s.username || '—'}</td>
                  <td>{s.job_title || '—'}</td><td className="money">{SAR(s.salary)}</td><td dir="ltr">{s.hire_date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PrintableDoc>
      )}
    </div>
  )
}

/* =====================================================================
   شجرة الحسابات
   ===================================================================== */
function ChartOfAccountsTab() {
  const { profile, company, toast, canFinance } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [printCoA, setPrintCoA] = useState(false)
  const [na, setNa] = useState({ code: '', name: '', account_type: 'expense', parent_id: '' })
  const [editing, setEditing] = useState(null)   // { id, code, name, account_type, parent_id }
  const [verify, setVerify] = useState(null)     // نتيجة الفحص الخلفي بعد الحذف

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('chart_of_accounts_with_balances', { p_company_id: profile.company_id })
    if (!error) setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [profile])
  const initializeStandardChart = async () => {
    if (!confirm('سيتم إنشاء الدليل المحاسبي القياسي (أصول، خصوم، إيرادات، مصروفات). متابعة؟')) return;
    setLoading(true);
    // Real standard chart for real estate / property management
    const standardAccounts = [
      // Assets
      { code: '1000', name: 'الأصول', account_type: 'asset', parent_id: null },
      { code: '1100', name: 'الأصول المتداولة', account_type: 'asset', parent_code: '1000' },
      { code: '1110', name: 'النقدية بالصندوق', account_type: 'asset', parent_code: '1100' },
      { code: '1101', name: 'الصندوق - كاش', account_type: 'asset', parent_code: '1110' },
      { code: '1120', name: 'البنوك', account_type: 'asset', parent_code: '1100' },
      { code: '1102', name: 'البنك - تحويل', account_type: 'asset', parent_code: '1120' },
      { code: '1130', name: 'العملاء (ذمم مدينة)', account_type: 'asset', parent_code: '1100' },
      { code: '1200', name: 'الأصول الثابتة', account_type: 'asset', parent_code: '1000' },
      { code: '1210', name: 'المباني والإنشاءات', account_type: 'asset', parent_code: '1200' },
      { code: '1220', name: 'الأثاث والمفروشات', account_type: 'asset', parent_code: '1200' },
      
      // Liabilities
      { code: '2000', name: 'الخصوم (الالتزامات)', account_type: 'liability', parent_id: null },
      { code: '2100', name: 'الخصوم المتداولة', account_type: 'liability', parent_code: '2000' },
      { code: '2110', name: 'الموردين (ذمم دائنة)', account_type: 'liability', parent_code: '2100' },
      { code: '2120', name: 'تأمينات المستأجرين', account_type: 'liability', parent_code: '2100' },
      { code: '2130', name: 'الضرائب المستحقة (ZATCA)', account_type: 'liability', parent_code: '2100' },
      
      // Equity
      { code: '3000', name: 'حقوق الملكية', account_type: 'equity', parent_id: null },
      { code: '3100', name: 'رأس المال', account_type: 'equity', parent_code: '3000' },
      { code: '3200', name: 'الأرباح المبقاة', account_type: 'equity', parent_code: '3000' },
      { code: '3300', name: 'جاري المالك', account_type: 'equity', parent_code: '3000' },
      
      // Revenue
      { code: '4000', name: 'الإيرادات', account_type: 'revenue', parent_id: null },
      { code: '4100', name: 'إيرادات الإيجارات', account_type: 'revenue', parent_code: '4000' },
      { code: '4110', name: 'إيرادات إيجار يومي', account_type: 'revenue', parent_code: '4100' },
      { code: '4120', name: 'إيرادات إيجار شهري', account_type: 'revenue', parent_code: '4100' },
      { code: '4200', name: 'إيرادات أخرى', account_type: 'revenue', parent_code: '4000' },
      
      // Expenses
      { code: '5000', name: 'المصروفات', account_type: 'expense', parent_id: null },
      { code: '5100', name: 'مصروفات التشغيل', account_type: 'expense', parent_code: '5000' },
      { code: '5110', name: 'مصروفات الصيانة والنظافة', account_type: 'expense', parent_code: '5100' },
      { code: '5120', name: 'الكهرباء', account_type: 'expense', parent_code: '5100' },
      { code: '5130', name: 'المياه', account_type: 'expense', parent_code: '5100' },
      { code: '5140', name: 'فواتير ومصاريف أخرى', account_type: 'expense', parent_code: '5100' },
      { code: '5150', name: 'الإنترنت والاتصالات', account_type: 'expense', parent_code: '5100' },
      { code: '5200', name: 'مصروفات إدارية وعمومية', account_type: 'expense', parent_code: '5000' },
      { code: '5210', name: 'الرواتب والأجور', account_type: 'expense', parent_code: '5200' },
      { code: '5220', name: 'الرسوم الحكومية (إيجار/رخص)', account_type: 'expense', parent_code: '5200' }
    ];

    try {
      // First pass: parent accounts
      const rootAccs = standardAccounts.filter(a => !a.parent_code);
      const accMap = {};
      for (const a of rootAccs) {
        const { data, error } = await supabase.from('chart_of_accounts').insert({
          company_id: profile.company_id,
          code: a.code,
          name: a.name,
          account_type: a.account_type
        }).select().single();
        if (data) accMap[a.code] = data.id;
      }

      // Second pass: level 1 children
      const l1Accs = standardAccounts.filter(a => a.parent_code && !standardAccounts.find(x => x.code === a.parent_code)?.parent_code);
      for (const a of l1Accs) {
        const pid = accMap[a.parent_code];
        if (pid) {
          const { data } = await supabase.from('chart_of_accounts').insert({
            company_id: profile.company_id,
            code: a.code,
            name: a.name,
            account_type: a.account_type,
            parent_id: pid
          }).select().single();
          if (data) accMap[a.code] = data.id;
        }
      }

      // Third pass: level 2 children
      const l2Accs = standardAccounts.filter(a => a.parent_code && standardAccounts.find(x => x.code === a.parent_code)?.parent_code);
      for (const a of l2Accs) {
        const pid = accMap[a.parent_code];
        if (pid) {
          await supabase.from('chart_of_accounts').insert({
            company_id: profile.company_id,
            code: a.code,
            name: a.name,
            account_type: a.account_type,
            parent_id: pid
          });
        }
      }
      
      toast('تم بناء الدليل المحاسبي بنجاح');
      load();
    } catch (err) {
      toast('حدث خطأ أثناء الإنشاء', true);
    }
    setLoading(false);
  };

  const byParent = useMemo(() => {
    const m = {}
    for (const r of rows) { const k = r.parent_id || 'root'; (m[k] = m[k] || []).push(r) }
    return m
  }, [rows])

  const addAccount = async () => {
    if (!na.code.trim() || !na.name.trim()) return toast('أدخل الرمز والاسم', true)
    const { error } = await supabase.from('chart_of_accounts').insert({
      company_id: profile.company_id, code: na.code.trim(), name: na.name.trim(),
      account_type: na.account_type, parent_id: na.parent_id || null
    })
    if (error) return toast('خطأ: ' + error.message, true)
    toast('✓ أُضيف الحساب لشجرة الحسابات')
    setNa({ code: '', name: '', account_type: 'expense', parent_id: '' })
    setAdding(false); load()
  }

  /* ---- تعديل حساب ---- */
  const saveEdit = async () => {
    if (!editing?.code?.trim() || !editing?.name?.trim()) return toast('أدخل الرمز والاسم', true)
    const { error } = await supabase.rpc('acct_update_account', {
      p_account_id: editing.id,
      p_code: editing.code.trim(),
      p_name: editing.name.trim(),
      p_account_type: editing.account_type,
      p_parent_id: editing.parent_id || null,
      p_clear_parent: !editing.parent_id,
    })
    if (error) return toast('تعذّر التعديل: ' + error.message, true)
    toast('✓ تم تعديل الحساب ومزامنته في شجرة الحسابات')
    setEditing(null); load()
  }

  /* ---- حذف حساب + فحص خلفي للمزامنة ---- */
  const deleteAccount = async (r) => {
    if (!confirm(`حذف الحساب ${r.code} — ${r.name}؟\nستُرفع حساباته الفرعية إلى الحساب الأب.`)) return
    let { data, error } = await supabase.rpc('acct_delete_account', { p_account_id: r.id, p_force: false })
    if (error) return toast('تعذّر الحذف: ' + error.message, true)
    if (data?.status === 'blocked') {
      const ok = confirm(
        `الحساب مستخدم في ${data.lines} سطر قيد محاسبي.\n` +
        'المتابعة ستنقل هذه الأسطر إلى حساب التسوية المؤقت (3999) ثم تحذف الحساب. متابعة؟'
      )
      if (!ok) return
      const forced = await supabase.rpc('acct_delete_account', { p_account_id: r.id, p_force: true })
      if (forced.error) return toast('تعذّر الحذف: ' + forced.error.message, true)
      data = forced.data
    }
    toast(`✓ حُذف الحساب ${r.code}${data?.moved_lines ? ` — نُقل ${data.moved_lines} سطر قيد إلى 3999` : ''}`)
    await load()
    // فحص خلفي: التأكد من اختفاء الحساب من كل الأقسام المحاسبية
    setVerify({ code: r.code, running: true })
    const { data: v, error: ve } = await supabase.rpc('acct_verify_account_removed', {
      p_company_id: profile.company_id, p_account_id: r.id,
    })
    setVerify({ code: r.code, running: false, result: ve ? { status: 'error', message: ve.message } : v })
  }

  const Node = ({ r, depth, print = false }) => (
    <>
      <tr className={r.is_group ? 'coa-group' : ''}>
        <td style={{ paddingRight: depth * 20 }} dir="ltr">{r.code}</td>
        <td>{r.name}</td>
        <td>{ACCOUNT_TYPE_LABEL[r.account_type]}</td>
        <td className={r.balance < 0 ? 'neg' : 'money'}>{r.is_group ? '—' : SAR(r.balance)}</td>
        {!print && canFinance && (
          <td style={{ whiteSpace: 'nowrap' }}>
            <button className="btn btn-sm btn-ghost" title="تعديل"
              onClick={() => setEditing({ id: r.id, code: r.code, name: r.name, account_type: r.account_type, parent_id: r.parent_id || '' })}>✏️</button>
            <button className="btn btn-sm btn-ghost" title="حذف" style={{ color: 'var(--danger, #B91C1C)' }}
              onClick={() => deleteAccount(r)}>🗑</button>
          </td>
        )}
      </tr>
      {(byParent[r.id] || []).map(c => <Node key={c.id} r={c} depth={depth + 1} print={print} />)}
    </>
  )

  if (loading) return <p style={{ color: 'var(--muted)' }}>جارٍ التحميل…</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10, gap: 10 }}>
        <button className="btn btn-blue btn-sm" onClick={() => setPrintCoA(true)}>
          🖨 طباعة شجرة الحسابات (التصميم الفاخر)
        </button>
        {rows.length === 0 && (
          <button className="btn btn-blue btn-sm" onClick={initializeStandardChart}>
            إعداد دليل محاسبي قياسي
          </button>
        )}
        <button className="btn btn-gold btn-sm" onClick={() => setAdding(v => !v)}>
          {adding ? '✕ إلغاء' : '+ إضافة حساب فرعي'}
        </button>
      </div>
      {adding && (
        <div className="grid3" style={{ marginBottom: 14, background: 'var(--soft)', padding: 10, borderRadius: 8 }}>
          <div><label>رمز الحساب</label><input dir="ltr" value={na.code} onChange={e => setNa({ ...na, code: e.target.value })} placeholder="1103" /></div>
          <div><label>اسم الحساب</label><input value={na.name} onChange={e => setNa({ ...na, name: e.target.value })} /></div>
          <div><label>النوع</label>
            <select value={na.account_type} onChange={e => setNa({ ...na, account_type: e.target.value })}>
              {Object.entries(ACCOUNT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div style={{ gridColumn: '1 / -1' }}><label>الحساب الرئيسي (اختياري)</label>
            <select value={na.parent_id} onChange={e => setNa({ ...na, parent_id: e.target.value })}>
              <option value="">— بدون (حساب رئيسي جديد) —</option>
              {rows.filter(r => r.is_group).map(r => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
            </select></div>
          <div><button className="btn btn-green btn-sm" onClick={addAccount}>حفظ الحساب</button></div>
        </div>
      )}
      {editing && (
        <div className="grid3" style={{ marginBottom: 14, background: 'var(--soft)', padding: 10, borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ gridColumn: '1 / -1', fontWeight: 700 }}>✏️ تعديل الحساب</div>
          <div><label>رمز الحساب</label><input dir="ltr" value={editing.code} onChange={e => setEditing({ ...editing, code: e.target.value })} /></div>
          <div><label>اسم الحساب</label><input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
          <div><label>النوع</label>
            <select value={editing.account_type} onChange={e => setEditing({ ...editing, account_type: e.target.value })}>
              {Object.entries(ACCOUNT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div style={{ gridColumn: '1 / -1' }}><label>الحساب الرئيسي</label>
            <select value={editing.parent_id} onChange={e => setEditing({ ...editing, parent_id: e.target.value })}>
              <option value="">— بدون (حساب رئيسي) —</option>
              {rows.filter(r => r.id !== editing.id).map(r => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
            </select></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-green btn-sm" onClick={saveEdit}>حفظ التعديل</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>إلغاء</button>
          </div>
        </div>
      )}

      {verify && (
        <div style={{
          marginBottom: 12, padding: '8px 12px', borderRadius: 8, fontSize: 13,
          border: '1px solid var(--border)',
          background: verify.running ? '#F1F5F9' : verify.result?.status === 'clean' ? '#DCFCE7' : '#FEE2E2',
        }}>
          {verify.running
            ? `⏳ فحص خلفي جارٍ للتأكد من مزامنة حذف الحساب ${verify.code} في كل الأقسام المحاسبية…`
            : verify.result?.status === 'clean'
              ? `✅ تم التحقق: الحساب ${verify.code} لم يعد له أي أثر في شجرة الحسابات أو القيود أو أي قسم محاسبي.`
              : `⚠️ الحساب ${verify.code}: ${verify.result?.dangling_refs ?? '—'} مرجع معلّق — ${JSON.stringify(verify.result?.details || verify.result?.message || {})}`}
          <button className="btn btn-sm btn-ghost" style={{ marginInlineStart: 8 }} onClick={() => setVerify(null)}>إخفاء</button>
        </div>
      )}

      <table className="tbl">
        <thead><tr><th>الرمز</th><th>اسم الحساب</th><th>التصنيف</th><th>الرصيد</th>{canFinance && <th>إجراءات</th>}</tr></thead>
        <tbody>
          {(byParent['root'] || []).map(r => <Node key={r.id} r={r} depth={0} />)}
        </tbody>
      </table>

      {printCoA && (
        <PrintableDoc
          company={company}
          title="دليل شجرة الحسابات المحاسبية"
          subtitle={`تاريخ المستند: ${today()} — منشأة: ${company?.name || 'المازن'}`}
          docKind="report"
          onClose={() => setPrintCoA(false)}
        >
          <table className="tbl">
            <thead><tr><th>الرمز</th><th>اسم الحساب</th><th>التصنيف</th><th>الرصيد</th></tr></thead>
            <tbody>
              {(byParent['root'] || []).map(r => <Node key={r.id} r={r} depth={0} print />)}
            </tbody>
          </table>
        </PrintableDoc>
      )}
    </div>
  )
}

/* =====================================================================
   القيود المحاسبية + كشف الحساب (مدين / دائن / رصيد)
   ===================================================================== */
function LedgerTab() {
  const { profile, company, toast } = useAuth()
  const { scopeQuery, activeBranch } = useBranches()
  const [accounts, setAccounts] = useState([])
  const [entries, setEntries] = useState([])
  const [selAccount, setSelAccount] = useState('')
  const [range, setRange] = useState({ from: today().slice(0, 8) + '01', to: today() })
  const [statement, setStatement] = useState(null)
  const [showManual, setShowManual] = useState(false)
  const [printStmtModal, setPrintStmtModal] = useState(false)
  const [printEntriesModal, setPrintEntriesModal] = useState(false)
  const [manual, setManual] = useState({ date: today(), description: '', lines: [{ account_id: '', debit: '', credit: '' }, { account_id: '', debit: '', credit: '' }] })

  useEffect(() => {
    supabase.rpc('chart_of_accounts_with_balances', { p_company_id: profile.company_id })
      .then(({ data }) => setAccounts((data || []).filter(a => !a.is_group)))
    loadEntries()
  }, [profile, activeBranch])

  const loadEntries = async () => {
    const { data } = await scopeQuery(supabase.from('journal_entries')
      .select('*, journal_entry_lines(debit, credit)')
      .eq('company_id', profile.company_id))
      .order('entry_date', { ascending: false }).order('entry_number', { ascending: false })
      .limit(50)
    setEntries(data || [])
  }

  const loadStatement = async () => {
    if (!selAccount) return toast('اختر حساباً أولاً', true)
    const { data, error } = await supabase.rpc('account_statement', { p_account_id: selAccount, p_from: range.from, p_to: range.to })
    if (error) return toast('خطأ: ' + error.message, true)
    setStatement(data || [])
  }

  const addLine = () => setManual(m => ({ ...m, lines: [...m.lines, { account_id: '', debit: '', credit: '' }] }))
  const setLine = (i, patch) => setManual(m => ({ ...m, lines: m.lines.map((l, idx) => idx === i ? { ...l, ...patch } : l) }))
  const removeLine = (i) => setManual(m => ({ ...m, lines: m.lines.filter((_, idx) => idx !== i) }))

  const totalDebit = manual.lines.reduce((s, l) => s + num(l.debit), 0)
  const totalCredit = manual.lines.reduce((s, l) => s + num(l.credit), 0)
  const balanced = manual.lines.length >= 2 && totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.01

  const postManual = async () => {
    if (!balanced) return toast('القيد غير متوازن — تأكد أن إجمالي المدين = إجمالي الدائن', true)
    if (manual.lines.some(l => !l.account_id)) return toast('اختر الحساب لكل سطر', true)
    const { error } = await supabase.rpc('post_manual_journal_entry', {
      p_company_id: profile.company_id, p_entry_date: manual.date, p_description: manual.description,
      p_lines: manual.lines.map(l => ({ account_id: l.account_id, debit: num(l.debit), credit: num(l.credit), description: manual.description }))
    })
    if (error) return toast('خطأ: ' + error.message, true)
    toast('✓ تم ترحيل القيد بنجاح')
    setManual({ date: today(), description: '', lines: [{ account_id: '', debit: '', credit: '' }, { account_id: '', debit: '', credit: '' }] })
    setShowManual(false); loadEntries()
  }

  return (
    <div>
      {/* كشف الحساب */}
      <h4 className="ts-h4">كشف حساب (مدين / دائن / رصيد متحرك)</h4>
      <div className="grid3" style={{ marginBottom: 10 }}>
        <div><label>الحساب</label>
          <select value={selAccount} onChange={e => setSelAccount(e.target.value)}>
            <option value="">اختر حساباً…</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select></div>
        <div><label>من</label><input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></div>
        <div><label>إلى</label><input type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <button className="btn btn-blue btn-sm" onClick={loadStatement}>عرض كشف الحساب</button>
        {statement && statement.length > 0 && (
          <button className="btn btn-gold btn-sm" onClick={() => setPrintStmtModal(true)}>
            🖨 طباعة كشف الحساب (التصميم الفاخر)
          </button>
        )}
      </div>

      {statement && (
        <table className="tbl" style={{ marginBottom: 20 }}>
          <thead><tr><th>التاريخ</th><th>رقم القيد</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
          <tbody>
            {statement.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا توجد حركات في هذه الفترة</td></tr>}
            {statement.map((s, i) => (
              <tr key={i}>
                <td>{s.entry_date}</td><td dir="ltr">{s.entry_number}</td><td>{s.description}</td>
                <td className="money">{s.debit > 0 ? SAR(s.debit) : '—'}</td>
                <td className="neg">{s.credit > 0 ? SAR(s.credit) : '—'}</td>
                <td className={s.running_balance < 0 ? 'neg' : 'money'}>{SAR(s.running_balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* آخر القيود */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 className="ts-h4" style={{ marginBottom: 0 }}>آخر القيود المحاسبية</h4>
        <div style={{ display: 'flex', gap: 8 }}>
          {entries.length > 0 && (
            <button className="btn btn-blue btn-sm" onClick={() => setPrintEntriesModal(true)}>
              🖨 طباعة دفتر القيود
            </button>
          )}
          <button className="btn btn-gold btn-sm" onClick={() => setShowManual(v => !v)}>
            {showManual ? '✕ إلغاء' : '+ إضافة قيد يدوي'}
          </button>
        </div>
      </div>

      {showManual && (
        <div className="panel" style={{ margin: '10px 0', background: 'var(--soft)' }}>
          <div className="grid2" style={{ marginBottom: 8 }}>
            <div><label>التاريخ</label><input type="date" value={manual.date} onChange={e => setManual({ ...manual, date: e.target.value })} /></div>
            <div><label>بيان القيد</label><input value={manual.description} onChange={e => setManual({ ...manual, description: e.target.value })} placeholder="وصف القيد أو التسوية" /></div>
          </div>
          {manual.lines.map((l, i) => (
            <div key={i} className="grid3" style={{ marginBottom: 6, alignItems: 'end' }}>
              <div><label>الحساب</label>
                <select value={l.account_id} onChange={e => setLine(i, { account_id: e.target.value })}>
                  <option value="">اختر حساباً…</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select></div>
              <div><label>مدين</label><input type="number" value={l.debit} onChange={e => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></div>
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ flex: 1 }}><label>دائن</label><input type="number" value={l.credit} onChange={e => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></div>
                {manual.lines.length > 2 && <button className="btn btn-ghost btn-sm" onClick={() => removeLine(i)}>✕</button>}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={addLine}>+ سطر جديد</button>
            <div style={{ fontSize: 13 }}>
              إجمالي مدين: <b className="money">{SAR(totalDebit)}</b> — إجمالي دائن: <b className="neg">{SAR(totalCredit)}</b>
              {balanced ? <span style={{ color: 'var(--green)', marginRight: 8 }}>✓ متوازن</span> : <span className="neg" style={{ marginRight: 8 }}>غير متوازن</span>}
            </div>
          </div>
          <button className="btn btn-green btn-sm" style={{ marginTop: 10 }} disabled={!balanced} onClick={postManual}>ترحيل القيد</button>
        </div>
      )}

      <table className="tbl">
        <thead><tr><th>التاريخ</th><th>رقم القيد</th><th>البيان</th><th>المصدر</th><th>الإجمالي</th></tr></thead>
        <tbody>
          {entries.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا توجد قيود بعد</td></tr>}
          {entries.map(e => {
            const total = (e.journal_entry_lines || []).reduce((s, l) => s + num(l.debit), 0)
            const srcLabel = { manual: 'يدوي', payment: 'دفعة', expense: 'مصروف', payroll: 'رواتب', voucher: 'سند' }[e.source_type] || e.source_type
            return (
              <tr key={e.id}>
                <td>{e.entry_date}</td><td dir="ltr">{e.entry_number}</td><td>{e.description}</td>
                <td><span className="chip chip-muted">{srcLabel}</span></td><td className="money">{SAR(total)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {printStmtModal && statement && (
        <PrintableDoc
          company={company}
          title={`كشف حساب: ${accounts.find(a => a.id === selAccount)?.name || 'حساب'}`}
          subtitle={`الفترة من ${range.from} إلى ${range.to}`}
          docKind="statement"
          onClose={() => setPrintStmtModal(false)}
        >
          <table className="tbl">
            <thead><tr><th>التاريخ</th><th>رقم القيد</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
            <tbody>
              {statement.map((s, i) => (
                <tr key={i}>
                  <td>{s.entry_date}</td><td dir="ltr">{s.entry_number}</td><td>{s.description}</td>
                  <td className="money">{s.debit > 0 ? SAR(s.debit) : '—'}</td>
                  <td className="neg">{s.credit > 0 ? SAR(s.credit) : '—'}</td>
                  <td className={s.running_balance < 0 ? 'neg' : 'money'}>{SAR(s.running_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PrintableDoc>
      )}

      {printEntriesModal && (
        <PrintableDoc
          company={company}
          title="دفتر القيود المحاسبية اليومية"
          subtitle={`تاريخ الاستخراج: ${today()} — منشأة: ${company?.name || 'المازن'}`}
          docKind="report"
          onClose={() => setPrintEntriesModal(false)}
        >
          <table className="tbl">
            <thead><tr><th>التاريخ</th><th>رقم القيد</th><th>البيان</th><th>المصدر</th><th>الإجمالي</th></tr></thead>
            <tbody>
              {entries.map(e => {
                const total = (e.journal_entry_lines || []).reduce((s, l) => s + num(l.debit), 0)
                const srcLabel = { manual: 'يدوي', payment: 'دفعة', expense: 'مصروف', payroll: 'رواتب', voucher: 'سند' }[e.source_type] || e.source_type
                return (
                  <tr key={e.id}>
                    <td>{e.entry_date}</td><td dir="ltr">{e.entry_number}</td><td>{e.description}</td>
                    <td><span className="chip chip-muted">{srcLabel}</span></td><td className="money">{SAR(total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </PrintableDoc>
      )}
    </div>
  )
}

/* =====================================================================
   السندات — قبض وصرف بتصميم فاخر مع الترويسة
   ===================================================================== */
function VouchersTab() {
  const { profile, company } = useAuth()
  const { scopeQuery, activeBranch } = useBranches()
  const [type, setType] = useState('receipt')
  const [rows, setRows] = useState([])
  const [printing, setPrinting] = useState(null)
  const [printListModal, setPrintListModal] = useState(false)

  useEffect(() => {
    scopeQuery(supabase.from('vouchers').select('*')
      .eq('company_id', profile.company_id).eq('voucher_type', type))
      .order('voucher_date', { ascending: false }).limit(100)
      .then(({ data }) => setRows(data || []))
  }, [profile, type, activeBranch])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="acc-tabs" style={{ marginBottom: 0 }}>
          <button className={type === 'receipt' ? 'on' : ''} onClick={() => setType('receipt')}>💰 سندات القبض</button>
          <button className={type === 'payment' ? 'on' : ''} onClick={() => setType('payment')}>💸 سندات الصرف</button>
        </div>
        {rows.length > 0 && (
          <button className="btn btn-blue btn-sm" onClick={() => setPrintListModal(true)}>
            🖨 طباعة قائمة السندات
          </button>
        )}
      </div>
      <table className="tbl">
        <thead><tr><th>الرقم</th><th>التاريخ</th><th>الجهة</th><th>البيان</th><th>طريقة الدفع</th><th>المبلغ</th><th></th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا توجد سندات بعد — تُصدر تلقائياً عند تسجيل دفعة أو مصروف</td></tr>}
          {rows.map(v => (
            <tr key={v.id}>
              <td dir="ltr">{v.voucher_number}</td><td>{v.voucher_date}</td>
              <td>{v.party_name} <small style={{ color: 'var(--muted)' }}>({PARTY_LABEL[v.party_type]})</small></td>
              <td>{v.description}</td><td>{PAY_METHODS[v.payment_method]}</td>
              <td className="money">{SAR(v.amount)}</td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => setPrinting(v)}>🖨 طباعة السند</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      {printing && <VoucherPrintModal voucher={printing} company={company} onClose={() => setPrinting(null)} />}
      {printListModal && (
        <PrintableDoc
          company={company}
          title={`تقرير ${type === 'receipt' ? 'سندات القبض' : 'سندات الصرف'}`}
          subtitle={`تاريخ الاستخراج: ${today()} — منشأة: ${company?.name || 'المازن'}`}
          docKind="report"
          onClose={() => setPrintListModal(false)}
        >
          <table className="tbl">
            <thead><tr><th>الرقم</th><th>التاريخ</th><th>الجهة</th><th>البيان</th><th>المبلغ</th></tr></thead>
            <tbody>
              {rows.map((v, i) => (
                <tr key={i}>
                  <td dir="ltr">{v.voucher_number}</td><td>{v.voucher_date}</td>
                  <td>{v.party_name} <small>({PARTY_LABEL[v.party_type]})</small></td>
                  <td>{v.description}</td><td className="money">{SAR(v.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PrintableDoc>
      )}
    </div>
  )
}
