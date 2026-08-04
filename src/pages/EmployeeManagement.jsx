import React, { useEffect, useState } from 'react'
import { supabase, adminSignupClient, staffEmail, normalizeStaffUsername } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { SAR, num, today, ROLES, uploadFile } from '../lib/helpers'
import VoucherPrintModal from '../components/VoucherPrint'
import PrintableDoc, { DocGrid } from '../components/PrintableDoc'

const REQ_TYPE = { leave: 'إجازة', advance: 'سلفة', other: 'أخرى' }
const REQ_STATUS = { new: 'جديد', approved: 'مقبول', rejected: 'مرفوض' }

function explain(err) {
  const code = err?.code || ''
  const msg = err?.message || 'خطأ غير متوقع'
  if (code === '42501' || /permission denied|row-level security|policy/i.test(msg))
    return 'صلاحيات قاعدة البيانات ناقصة — نفّذ ملف supabase/POST_SETUP_FIX.sql ثم أعد المحاولة.'
  return 'خطأ: ' + msg
}

/* إدارة الموظفين — الملف الكامل: الحسابات، الصلاحيات، الرواتب والسلف،
   الطلبات، سجل النشاط، والشكاوى — كل ما يخص الموظفين من مكان واحد */
/* بوابة الصلاحية منفصلة عن جسم الصفحة حتى تبقى كل الـ hooks تُستدعى بنفس الترتيب
   في كل عملية render — الخروج المبكر قبل الـ hooks كان يكسر React عند تغيّر الصلاحية. */
export default function EmployeeManagement() {
  const { canFinance } = useAuth()
  if (!canFinance) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center', margin: '40px auto', maxWidth: 500 }}>
        <h3 style={{ color: 'var(--st-oc)', marginBottom: 12 }}>🔒 خطأ في الصلاحيات</h3>
        <p style={{ color: 'var(--muted)' }}>غير مصرح لك بالوصول لإدارة الموظفين والرواتب. هذه الصفحة مخصصة للإدارة فقط.</p>
      </div>
    )
  }
  return <EmployeeManagementPanel />
}

function EmployeeManagementPanel() {
  const { profile, toast, isOwner } = useAuth()
  const canEdit = isOwner || profile?.role === 'accountant'
  const [staff, setStaff] = useState([])
  const [perms, setPerms] = useState({})
  const [selected, setSelected] = useState(null)
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [nu, setNu] = useState({
    full_name: '', username: '', password: '', role: 'employee',
    birth_date: '', nationality: '', id_number: '', hire_date: '', end_date: '',
    job_title: '', salary: '', address: '', iqama_expiry: ''
  })
  const [nuIdFile, setNuIdFile] = useState(null)
  const [nuContractFile, setNuContractFile] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').eq('company_id', profile.company_id).order('full_name')
    setStaff(data || [])
    const ids = (data || []).map(s => s.id)
    if (ids.length) {
      const { data: pr } = await supabase.from('staff_permissions').select('*').in('staff_id', ids)
      const map = {}; (pr || []).forEach(p => { map[p.staff_id] = p }); setPerms(map)
    }
    const { data: reqs } = await supabase.from('employee_requests')
      .select('*, profiles!employee_requests_employee_id_fkey(full_name)')
      .eq('company_id', profile.company_id).eq('status', 'new').order('created_at', { ascending: false })
    setRequests(reqs || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [profile])

  const decide = async (req, status) => {
    if (status === 'approved' && req.request_type === 'advance') {
      const { error } = await supabase.rpc('approve_advance_request', { p_request_id: req.id })
      if (error) return toast('خطأ: ' + error.message, true)
      toast('✓ اعتُمدت السلفة وسُجّلت في الحسابات تلقائياً')
    } else {
      const { error } = await supabase.from('employee_requests')
        .update({ status, decided_by: profile.id, decided_at: new Date().toISOString() }).eq('id', req.id)
      if (error) return toast('خطأ: ' + error.message, true)
      toast(status === 'approved' ? '✓ تمت الموافقة' : '✓ تم الرفض')
    }
    load()
  }

  const addStaff = async () => {
    if (!nu.full_name || !nu.username || nu.password.length < 6)
      return toast('أكمل البيانات (كلمة المرور 6 أحرف على الأقل)', true)
    setBusy(true)
    try {
      const username = normalizeStaffUsername(nu.username)
      const { data, error } = await adminSignupClient.auth.signUp({
        email: staffEmail(username),
        password: nu.password,
        options: {
          data: {
            company_id: profile.company_id,
            full_name: nu.full_name,
            role: nu.role,
            username
          }
        }
      })
      if (error) throw error
      const uid = data.user?.id
      if (!uid) throw new Error('لم يُنشأ المستخدم — تأكد من إيقاف "Confirm email" في إعدادات Supabase Auth')
      let id_photo_url = null, contract_url = null
      if (nuIdFile) id_photo_url = await uploadFile(supabase, 'documents', profile.company_id, nuIdFile)
      if (nuContractFile) contract_url = await uploadFile(supabase, 'documents', profile.company_id, nuContractFile)
      const { error: pe } = await supabase.from('profiles').upsert({
        id: uid, company_id: profile.company_id, role: nu.role,
        full_name: nu.full_name, username, created_by: profile.id,
        birth_date: nu.birth_date || null, nationality: nu.nationality || null,
        id_number: nu.id_number || null, hire_date: nu.hire_date || null, end_date: nu.end_date || null,
        job_title: nu.job_title || null, salary: num(nu.salary), address: nu.address || null,
        iqama_expiry: nu.iqama_expiry || null, id_photo_url, contract_url,
      })
      if (pe) throw pe
      const { error: permError } = await supabase.from('staff_permissions').insert({
        staff_id: uid, user_id: uid, company_id: profile.company_id,
        can_discount: false, discount_max_percent: 10, can_cancel_booking: false,
        can_edit_data: true, can_upload_media: true, can_view_accountant: false, can_export_reports: false,
      })
      if (permError) throw permError
      toast(`✓ أُنشئ حساب ${nu.full_name} — الدخول باسم المستخدم "${username}"`)
      setNu({ full_name: '', username: '', password: '', role: 'employee', birth_date: '', nationality: '', id_number: '', hire_date: '', end_date: '', job_title: '', salary: '', address: '', iqama_expiry: '' })
      setNuIdFile(null); setNuContractFile(null)
      setAdding(false); load()
    } catch (e) { toast(explain(e), true) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="pg-title"><h2>🧑‍💼 إدارة الموظفين</h2>
        {canEdit && <button className="btn btn-gold btn-sm" onClick={() => setAdding(v => !v)}>{adding ? '✕ إلغاء' : '+ إنشاء حساب موظف'}</button>}
      </div>

      {adding && canEdit && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3>حساب موظف جديد</h3>
          <div className="grid3">
            <div className="fld"><label>الاسم الكامل *</label><input value={nu.full_name} onChange={e => setNu({ ...nu, full_name: e.target.value })} /></div>
            <div className="fld"><label>اسم المستخدم *</label><input value={nu.username} onChange={e => setNu({ ...nu, username: e.target.value })} dir="ltr" placeholder="ahmad.s" /></div>
            <div className="fld"><label>كلمة المرور *</label><input type="password" value={nu.password} onChange={e => setNu({ ...nu, password: e.target.value })} /></div>
            <div className="fld"><label>الدور</label>
              <select value={nu.role} onChange={e => setNu({ ...nu, role: e.target.value })}>
                <option value="employee">موظف</option><option value="accountant">محاسب</option><option value="manager">مدير</option>
              </select></div>
            <div className="fld"><label>تاريخ الميلاد</label><input type="date" value={nu.birth_date} onChange={e => setNu({ ...nu, birth_date: e.target.value })} /></div>
            <div className="fld"><label>الجنسية</label><input value={nu.nationality} onChange={e => setNu({ ...nu, nationality: e.target.value })} placeholder="سعودي / مصري …" /></div>
            <div className="fld"><label>رقم الهوية / الإقامة</label><input value={nu.id_number} onChange={e => setNu({ ...nu, id_number: e.target.value })} dir="ltr" /></div>
            <div className="fld"><label>تاريخ بدء العمل</label><input type="date" value={nu.hire_date} onChange={e => setNu({ ...nu, hire_date: e.target.value })} /></div>
            <div className="fld"><label>المسمى الوظيفي</label><input value={nu.job_title} onChange={e => setNu({ ...nu, job_title: e.target.value })} /></div>
            <div className="fld"><label>الراتب الشهري (ر.س)</label><input type="number" value={nu.salary} onChange={e => setNu({ ...nu, salary: e.target.value })} /></div>
            <div className="fld"><label>العنوان</label><input value={nu.address} onChange={e => setNu({ ...nu, address: e.target.value })} /></div>
            <div className="fld"><label>تاريخ انتهاء الإقامة</label><input type="date" value={nu.iqama_expiry} onChange={e => setNu({ ...nu, iqama_expiry: e.target.value })} /></div>
            <div className="fld"><label>صورة الهوية/الإقامة</label><input type="file" accept="image/*,.pdf" onChange={e => setNuIdFile(e.target.files?.[0] || null)} /></div>
            <div className="fld"><label>عقد العمل</label><input type="file" accept="image/*,.pdf" onChange={e => setNuContractFile(e.target.files?.[0] || null)} /></div>
          </div>
          <button className="btn btn-blue btn-sm" disabled={busy} onClick={addStaff}>+ إنشاء الحساب</button>
        </div>
      )}

      {requests.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3>طلبات بانتظار القرار ({requests.length})</h3>
          <table className="tbl">
            <thead><tr><th>الموظف</th><th>النوع</th><th>التفاصيل</th><th>السبب</th><th></th></tr></thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.id}>
                  <td>{r.profiles?.full_name}</td>
                  <td><span className="chip chip-muted">{REQ_TYPE[r.request_type]}</span></td>
                  <td>{r.request_type === 'advance' ? SAR(r.amount) : r.request_type === 'leave' ? `${r.start_date} → ${r.end_date}` : '—'}</td>
                  <td>{r.reason || '—'}</td>
                  <td>
                    {canEdit ? <>
                      <button className="btn btn-green btn-sm" onClick={() => decide(r, 'approved')}>✓ قبول</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => decide(r, 'rejected')}>✕ رفض</button>
                    </> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>بانتظار الإدارة</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <table className="tbl">
          <thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th>المسمى الوظيفي</th><th>الجنسية</th><th>الراتب</th><th>تاريخ التعيين</th><th>انتهاء الإقامة</th><th></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)' }}>جارٍ التحميل…</td></tr>}
            {staff.map(s => (
              <tr key={s.id}>
                <td>{s.full_name}</td><td dir="ltr">{s.username || '—'}</td><td>{ROLES[s.role]}</td><td>{s.job_title || '—'}</td>
                <td>{s.nationality || '—'}</td>
                <td className="money">{SAR(s.salary)}</td><td dir="ltr">{s.hire_date || '—'}</td>
                <td dir="ltr" className={s.iqama_expiry && new Date(s.iqama_expiry) < new Date() ? 'neg' : ''}>{s.iqama_expiry || '—'}</td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => setSelected(s)}>عرض الملف</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <EmployeeProfile
          employee={selected} perms={perms[selected.id]} canEdit={canEdit}
          onClose={() => setSelected(null)} onChanged={load}
        />
      )}
    </div>
  )
}

const PERM_FIELDS = {
  can_discount: 'السماح بالخصم', discount_max_percent: 'حد الخصم الأقصى %',
  can_cancel_booking: 'إلغاء الحجوزات', can_edit_data: 'تعديل البيانات',
  can_upload_media: 'رفع صور/فيديو', can_view_accountant: 'الاطلاع على قسم الحسابات',
  can_export_reports: 'إصدار التقارير',
}

function EmployeeProfile({ employee, perms, canEdit, onClose, onChanged }) {
  const { profile, company, toast } = useAuth()
  const [f, setF] = useState({
    job_title: employee.job_title || '', address: employee.address || '', salary: employee.salary || 0,
    manager_id: employee.manager_id || '', iqama_expiry: employee.iqama_expiry || '', hr_notes: employee.hr_notes || '',
    birth_date: employee.birth_date || '', nationality: employee.nationality || '', id_number: employee.id_number || '',
    hire_date: employee.hire_date || '', end_date: employee.end_date || '', role: employee.role,
  })
  const [p, setP] = useState(perms || {
    staff_id: employee.id, user_id: employee.id, company_id: profile.company_id,
    can_discount: false, discount_max_percent: 10, can_cancel_booking: false,
    can_edit_data: true, can_upload_media: true, can_view_accountant: false, can_export_reports: false,
  })
  const [managers, setManagers] = useState([])
  const [advances, setAdvances] = useState([])
  const [requests, setRequests] = useState([])
  const [activity, setActivity] = useState([])
  const [complaints, setComplaints] = useState(0)
  const [saving, setSaving] = useState(false)
  const [payAmount, setPayAmount] = useState(employee.salary || 0)
  const [advAmount, setAdvAmount] = useState('')
  const [advReason, setAdvReason] = useState('')
  const [idFile, setIdFile] = useState(null)
  const [contractFile, setContractFile] = useState(null)
  const [printVoucher, setPrintVoucher] = useState(null)
  const [showReport, setShowReport] = useState(false)
  const [vch, setVch] = useState({ kind: 'salary', amount: employee.salary || '', note: '' })
  const [newUsername, setNewUsername] = useState(employee.username || '')
  const [newPassword, setNewPassword] = useState('')

  const loadAdvances = () => supabase.from('employee_advances').select('*').eq('employee_id', employee.id).order('advance_date', { ascending: false }).then(({ data }) => setAdvances(data || []))

  useEffect(() => {
    supabase.from('profiles').select('id, full_name').eq('company_id', profile.company_id).neq('id', employee.id)
      .then(({ data }) => setManagers(data || []))
    loadAdvances()
    supabase.from('employee_requests').select('*').eq('employee_id', employee.id).order('created_at', { ascending: false })
      .then(({ data }) => setRequests(data || []))
    supabase.from('audit_logs').select('*').eq('user_id', employee.id).order('created_at', { ascending: false }).limit(15)
      .then(({ data }) => setActivity(data || []))
    supabase.from('service_requests').select('id', { count: 'exact', head: true }).eq('handled_by', employee.id).eq('request_type', 'complaint')
      .then(({ count }) => setComplaints(count || 0))
  }, [employee, profile])

  const save = async () => {
    setSaving(true)
    let id_photo_url = employee.id_photo_url, contract_url = employee.contract_url
    if (idFile) id_photo_url = await uploadFile(supabase, 'documents', profile.company_id, idFile)
    if (contractFile) contract_url = await uploadFile(supabase, 'documents', profile.company_id, contractFile)
    const { error } = await supabase.from('profiles').update({
      job_title: f.job_title || null, address: f.address || null, salary: num(f.salary),
      manager_id: f.manager_id || null, iqama_expiry: f.iqama_expiry || null, hr_notes: f.hr_notes || null,
      birth_date: f.birth_date || null, nationality: f.nationality || null, id_number: f.id_number || null,
      hire_date: f.hire_date || null, end_date: f.end_date || null, role: f.role,
      id_photo_url, contract_url
    }).eq('id', employee.id)
    if (error) { setSaving(false); return toast('خطأ: ' + error.message, true) }
    const { error: pe } = await supabase.from('staff_permissions')
      .upsert({ ...p, user_id: employee.id, staff_id: employee.id, updated_at: new Date().toISOString() }, { onConflict: 'staff_id' })
    setSaving(false)
    if (pe) return toast('حُفظت بيانات الموظف، لكن فشلت الصلاحيات: ' + pe.message, true)
    toast('✓ حُفظ ملف الموظف والصلاحيات')
    onChanged(); onClose()
  }

  const deactivate = async () => {
    if (!confirm('تعطيل الحساب بتحديد تاريخ ترك العمل اليوم؟')) return
    const { error } = await supabase.from('profiles').update({ end_date: today() }).eq('id', employee.id)
    if (error) return toast('خطأ: ' + error.message, true)
    toast('✓ عُطِّل الحساب'); onChanged(); onClose()
  }

  const paySalary = async () => {
    if (!num(payAmount)) return toast('أدخل مبلغ الراتب', true)
    const { error } = await supabase.rpc('pay_employee_salary', { p_employee_id: employee.id, p_amount: num(payAmount), p_pay_date: today() })
    if (error) return toast('خطأ: ' + error.message, true)
    toast('✓ صُرف الراتب وسُجّل في الحسابات والقيود تلقائياً')
    onChanged()
  }

  const giveAdvance = async () => {
    if (!num(advAmount)) return toast('أدخل مبلغ السلفة', true)
    const { error } = await supabase.from('employee_advances').insert({
      company_id: profile.company_id, employee_id: employee.id, amount: num(advAmount), reason: advReason, created_by: profile.id
    })
    if (error) return toast('خطأ: ' + error.message, true)
    toast('✓ سُجّلت السلفة وأُنشئ قيد وسند صرف تلقائياً')
    setAdvAmount(''); setAdvReason('')
    loadAdvances()
  }

  // إصدار سند قبض للموظف (راتب/سلفة/أخرى) قابل للطباعة
  const issueVoucher = async () => {
    if (!num(vch.amount)) return toast('أدخل المبلغ', true)
    const label = { salary: 'راتب', advance: 'سلفة', other: 'أخرى' }[vch.kind]
    const { data: vid, error } = await supabase.rpc('issue_manual_voucher', {
      p_voucher_type: 'receipt', p_amount: num(vch.amount), p_party_type: 'employee',
      p_party_name: employee.full_name, p_description: `${label} — ${employee.full_name}${vch.note ? ' — ' + vch.note : ''}`,
      p_payment_method: 'cash', p_reference_number: null, p_employee_id: employee.id
    })
    if (error) return toast('خطأ: ' + error.message, true)
    const { data: v } = await supabase.from('vouchers').select('*').eq('id', vid).single()
    toast('✓ صدر سند القبض — يمكنك طباعته الآن')
    setVch({ kind: 'salary', amount: employee.salary || '', note: '' })
    if (v) setPrintVoucher(v)
  }

  const resetPassword = async () => {
    if (newPassword.length < 6) return toast('كلمة المرور 6 أحرف على الأقل', true)
    const { error } = await supabase.rpc('admin_reset_staff_password', { p_staff_id: employee.id, p_new_password: newPassword })
    if (error) return toast('خطأ: ' + error.message, true)
    toast('✓ تم تغيير كلمة المرور')
    setNewPassword('')
  }

  const changeUsername = async () => {
    const u = normalizeStaffUsername(newUsername)
    if (u === employee.username) return toast('لم يتغير اسم المستخدم', true)
    const { error } = await supabase.rpc('admin_change_staff_username', { p_staff_id: employee.id, p_new_username: u })
    if (error) return toast('خطأ: ' + error.message, true)
    toast('✓ تم تغيير اسم المستخدم')
    onChanged()
  }

  const isEmp = f.role === 'employee'
  const ro = !canEdit // للعرض فقط عندما لا تتوفر صلاحية التعديل
  const leaves = requests.filter(r => r.request_type === 'leave')
  const advReqs = requests.filter(r => r.request_type === 'advance')
  const totalLeaveDays = leaves.filter(r => r.status === 'approved').reduce((s, r) => {
    if (!r.start_date || !r.end_date) return s
    return s + Math.max(0, Math.round((new Date(r.end_date) - new Date(r.start_date)) / 86400000) + 1)
  }, 0)
  const totalAdvances = advances.reduce((s, a) => s + num(a.amount), 0)
  // مؤشرات أداء بسيطة (0-100) لرسم بياني شريطي
  const perfBars = [
    { label: 'الالتزام (عكس الشكاوى)', value: Math.max(0, 100 - complaints * 20), color: 'var(--green)' },
    { label: 'النشاط المسجّل', value: Math.min(100, activity.length * 7), color: 'var(--blue)' },
    { label: 'انضباط السلف', value: Math.max(0, 100 - advances.length * 15), color: 'var(--gold-d,#8b6f2c)' },
  ]

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(920px,100%)' }}>
        <div className="modal-h"><h3>ملف الموظف — {employee.full_name}</h3><button className="x" onClick={onClose}>✕</button></div>
        <div className="modal-b">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <button className="btn btn-blue btn-sm" onClick={() => setShowReport(true)}>🖨 طباعة تقرير الموظف الشامل</button>
            {employee.id_photo_url && <a className="btn btn-ghost btn-sm" href={employee.id_photo_url} target="_blank" rel="noreferrer">🪪 عرض الهوية/الإقامة</a>}
            {employee.contract_url && <a className="btn btn-ghost btn-sm" href={employee.contract_url} target="_blank" rel="noreferrer">📄 عرض عقد العمل</a>}
          </div>

          <h4 className="ts-h4">البيانات الشخصية والوظيفية</h4>
          <div className="grid3" style={{ marginBottom: 16 }}>
            <div className="fld"><label>الدور</label>
              <select disabled={ro} value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>
                <option value="employee">موظف</option><option value="accountant">محاسب</option><option value="manager">مدير</option>
              </select></div>
            <div className="fld"><label>المسمى الوظيفي</label><input disabled={ro} value={f.job_title} onChange={e => setF({ ...f, job_title: e.target.value })} /></div>
            <div className="fld"><label>الراتب الشهري (ر.س)</label><input disabled={ro} type="number" value={f.salary} onChange={e => setF({ ...f, salary: e.target.value })} /></div>
            <div className="fld"><label>تاريخ الميلاد</label><input disabled={ro} type="date" value={f.birth_date} onChange={e => setF({ ...f, birth_date: e.target.value })} /></div>
            <div className="fld"><label>الجنسية</label><input disabled={ro} value={f.nationality} onChange={e => setF({ ...f, nationality: e.target.value })} /></div>
            <div className="fld"><label>رقم الهوية/الإقامة</label><input disabled={ro} dir="ltr" value={f.id_number} onChange={e => setF({ ...f, id_number: e.target.value })} /></div>
            <div className="fld"><label>العنوان</label><input disabled={ro} value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></div>
            <div className="fld"><label>المدير المباشر</label>
              <select disabled={ro} value={f.manager_id} onChange={e => setF({ ...f, manager_id: e.target.value })}>
                <option value="">— بدون —</option>
                {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select></div>
            <div className="fld"><label>تاريخ بدء العمل</label><input disabled={ro} type="date" value={f.hire_date} onChange={e => setF({ ...f, hire_date: e.target.value })} /></div>
            <div className="fld"><label>تاريخ ترك العمل</label><input disabled={ro} type="date" value={f.end_date} onChange={e => setF({ ...f, end_date: e.target.value })} /></div>
            <div className="fld"><label>تاريخ انتهاء الإقامة</label><input disabled={ro} type="date" value={f.iqama_expiry} onChange={e => setF({ ...f, iqama_expiry: e.target.value })} /></div>
            {canEdit && <div className="fld"><label>صورة الهوية/الإقامة</label><input type="file" accept="image/*,.pdf" onChange={e => setIdFile(e.target.files?.[0] || null)} /></div>}
            {canEdit && <div className="fld"><label>عقد العمل</label><input type="file" accept="image/*,.pdf" onChange={e => setContractFile(e.target.files?.[0] || null)} /></div>}
            <div className="fld" style={{ gridColumn: '1 / -1' }}><label>ملاحظات</label><input disabled={ro} value={f.hr_notes} onChange={e => setF({ ...f, hr_notes: e.target.value })} /></div>
          </div>

          {isEmp && (
            <div className="panel" style={{ marginBottom: 16, background: 'var(--soft)' }}>
              <b>الصلاحيات التفصيلية</b>
              <div className="grid2" style={{ marginTop: 8 }}>
                {Object.entries(PERM_FIELDS).map(([k, lbl]) => k === 'discount_max_percent' ? (
                  <div className="fld" key={k}><label>{lbl}</label>
                    <input disabled={ro} type="number" min="0" max="100" value={p.discount_max_percent ?? 10}
                      onChange={e => setP({ ...p, discount_max_percent: Number(e.target.value) })} /></div>
                ) : (
                  <label key={k}><input disabled={ro} type="checkbox" checked={!!p[k]} onChange={e => setP({ ...p, [k]: e.target.checked })} /> {lbl}</label>
                ))}
              </div>
            </div>
          )}

          {canEdit && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <button className="btn btn-gold btn-sm" disabled={saving} onClick={save}>{saving ? '…' : 'حفظ البيانات والصلاحيات'}</button>
              <button className="btn btn-ghost btn-sm" onClick={deactivate}>تعطيل الحساب</button>
            </div>
          )}

          {canEdit && employee.username && (
            <>
              <h4 className="ts-h4">بيانات دخول بوابة الموظف</h4>
              <div className="panel" style={{ marginBottom: 16, background: 'var(--soft)' }}>
                <div className="grid2">
                  <div style={{ display: 'flex', gap: 6, alignItems: 'end' }}>
                    <div className="fld" style={{ flex: 1 }}><label>اسم المستخدم</label><input dir="ltr" value={newUsername} onChange={e => setNewUsername(e.target.value)} /></div>
                    <button className="btn btn-ghost btn-sm" onClick={changeUsername}>تغيير</button>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'end' }}>
                    <div className="fld" style={{ flex: 1 }}><label>كلمة مرور جديدة</label><input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="6 أحرف على الأقل" /></div>
                    <button className="btn btn-ghost btn-sm" onClick={resetPassword}>تعيين</button>
                  </div>
                </div>
              </div>
            </>
          )}

          <h4 className="ts-h4">مؤشرات ورسم أداء الموظف</h4>
          <div className="kpis" style={{ marginBottom: 12 }}>
            <div className="kpi"><div className="v">{complaints}</div><div className="l">شكاوى المستأجرين</div></div>
            <div className="kpi"><div className="v">{advances.length}</div><div className="l">عدد السلف</div></div>
            <div className="kpi"><div className="v">{SAR(totalAdvances)}</div><div className="l">إجمالي السلف</div></div>
            <div className="kpi"><div className="v">{totalLeaveDays}</div><div className="l">أيام الإجازات المعتمدة</div></div>
          </div>
          <div className="perf-chart" style={{ marginBottom: 20 }}>
            {perfBars.map((b, i) => (
              <div key={i} className="perf-row">
                <span className="perf-lbl">{b.label}</span>
                <div className="perf-track"><div className="perf-fill" style={{ width: b.value + '%', background: b.color }} /></div>
                <span className="perf-val">{b.value}%</span>
              </div>
            ))}
          </div>

          {canEdit && <>
            <h4 className="ts-h4">صرف الراتب</h4>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'end' }}>
              <div className="fld" style={{ flex: 1 }}><label>المبلغ</label><input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} /></div>
              <button className="btn btn-green btn-sm" onClick={paySalary}>💰 صرف الراتب الآن</button>
            </div>

            <h4 className="ts-h4">تسجيل سلفة</h4>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'end', flexWrap: 'wrap' }}>
              <div className="fld"><label>المبلغ</label><input type="number" value={advAmount} onChange={e => setAdvAmount(e.target.value)} /></div>
              <div className="fld" style={{ flex: 1 }}><label>السبب</label><input value={advReason} onChange={e => setAdvReason(e.target.value)} /></div>
              <button className="btn btn-blue btn-sm" onClick={giveAdvance}>تسجيل السلفة</button>
            </div>

            <h4 className="ts-h4">إصدار سند قبض للموظف</h4>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'end', flexWrap: 'wrap' }}>
              <div className="fld"><label>الغرض</label>
                <select value={vch.kind} onChange={e => setVch({ ...vch, kind: e.target.value })}>
                  <option value="salary">راتب</option><option value="advance">سلفة</option><option value="other">أخرى</option>
                </select></div>
              <div className="fld"><label>المبلغ</label><input type="number" value={vch.amount} onChange={e => setVch({ ...vch, amount: e.target.value })} /></div>
              <div className="fld" style={{ flex: 1 }}><label>ملاحظة</label><input value={vch.note} onChange={e => setVch({ ...vch, note: e.target.value })} /></div>
              <button className="btn btn-gold btn-sm" onClick={issueVoucher}>🧾 إصدار سند القبض</button>
            </div>
          </>}
          <table className="tbl" style={{ marginBottom: 16 }}>
            <thead><tr><th>تاريخ السلفة</th><th>المبلغ</th><th>السبب</th></tr></thead>
            <tbody>
              {advances.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا توجد سلف</td></tr>}
              {advances.map(a => <tr key={a.id}><td>{a.advance_date}</td><td className="neg">{SAR(a.amount)}</td><td>{a.reason || '—'}</td></tr>)}
            </tbody>
          </table>

          <h4 className="ts-h4">طلبات الإجازات ({leaves.length})</h4>
          <table className="tbl" style={{ marginBottom: 16 }}>
            <thead><tr><th>من</th><th>إلى</th><th>الأيام</th><th>السبب</th><th>الحالة</th></tr></thead>
            <tbody>
              {leaves.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا توجد طلبات إجازة</td></tr>}
              {leaves.map(r => (
                <tr key={r.id}>
                  <td dir="ltr">{r.start_date}</td><td dir="ltr">{r.end_date}</td>
                  <td>{r.start_date && r.end_date ? Math.round((new Date(r.end_date) - new Date(r.start_date)) / 86400000) + 1 : '—'}</td>
                  <td>{r.reason || '—'}</td>
                  <td><span className={'chip ' + (r.status === 'approved' ? 'chip-ok' : r.status === 'rejected' ? 'chip-danger' : 'chip-warn')}>{REQ_STATUS[r.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 className="ts-h4">طلبات السلف ({advReqs.length})</h4>
          <table className="tbl" style={{ marginBottom: 16 }}>
            <thead><tr><th>التاريخ</th><th>المبلغ</th><th>السبب</th><th>الحالة</th></tr></thead>
            <tbody>
              {advReqs.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا توجد طلبات سلف</td></tr>}
              {advReqs.map(r => (
                <tr key={r.id}>
                  <td>{r.created_at?.slice(0, 10)}</td><td className="neg">{SAR(r.amount)}</td><td>{r.reason || '—'}</td>
                  <td><span className={'chip ' + (r.status === 'approved' ? 'chip-ok' : r.status === 'rejected' ? 'chip-danger' : 'chip-warn')}>{REQ_STATUS[r.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 className="ts-h4">سجل النشاط (آخر 15 عملية)</h4>
          <table className="tbl">
            <thead><tr><th>التاريخ</th><th>الإجراء</th><th>التفاصيل</th></tr></thead>
            <tbody>
              {activity.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--muted)' }}>لا يوجد نشاط مسجل</td></tr>}
              {activity.map(a => <tr key={a.id}><td>{a.created_at?.slice(0, 16).replace('T', ' ')}</td><td>{a.action} / {a.entity}</td><td>{a.new_data?.summary || '—'}</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>

      {printVoucher && <VoucherPrintModal voucher={printVoucher} company={company} onClose={() => setPrintVoucher(null)} />}
      {showReport && (
        <PrintableDoc
          company={company} title={`تقرير الموظف — ${employee.full_name}`}
          docKind="employee" docTable="profiles" docId={employee.id}
          qrValue={JSON.stringify({ emp: employee.full_name, id: employee.id_number, role: employee.role })}
          onClose={() => setShowReport(false)}
        >
          <h4 className="contract-h4">البيانات الشخصية والوظيفية</h4>
          <DocGrid items={[
            ['الاسم الكامل', employee.full_name],
            ['اسم المستخدم', employee.username || '—'],
            ['الدور', ROLES[employee.role]],
            ['المسمى الوظيفي', f.job_title || '—'],
            ['رقم الهوية/الإقامة', f.id_number || '—'],
            ['الجنسية', f.nationality || '—'],
            ['تاريخ الميلاد', f.birth_date || '—'],
            ['العنوان', f.address || '—'],
            ['تاريخ التعيين', f.hire_date || '—'],
            ['انتهاء الإقامة', f.iqama_expiry || '—'],
            ['الراتب الشهري', SAR(f.salary)],
            ['حالة الحساب', f.end_date ? 'معطّل (' + f.end_date + ')' : 'نشط'],
          ]} />
          <h4 className="contract-h4">ملخص الأداء والمستحقات</h4>
          <DocGrid items={[
            ['عدد الشكاوى', complaints],
            ['عدد السلف', advances.length],
            ['إجمالي السلف', SAR(totalAdvances)],
            ['أيام الإجازات المعتمدة', totalLeaveDays],
          ]} />
          {f.hr_notes && <><h4 className="contract-h4">ملاحظات</h4><p style={{ fontSize: 13 }}>{f.hr_notes}</p></>}
          <div className="voucher-sign" style={{ marginTop: 20 }}>
            <div><span>توقيع الموظف</span><i /></div>
            <div><span>توقيع الإدارة</span><i /></div>
          </div>
        </PrintableDoc>
      )}
    </div>
  )
}
