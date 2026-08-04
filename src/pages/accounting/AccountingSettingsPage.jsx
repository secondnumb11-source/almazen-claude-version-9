import React, { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../AuthContext'
import {
  fetchAccountingSettings, saveAccountingSettings, fetchFiscalPeriods,
  saveFiscalPeriod, deleteFiscalPeriod, fetchAccounts,
} from '../../lib/accountingApi'
import {
  AcctPage, Field, Notice, Modal, useConfirm, EmptyState, RefreshButton,
} from '../../components/accounting/AcctKit'
import { Settings2, Plus, Lock, Unlock, Trash2, Save } from 'lucide-react'

/**
 * إعدادات المحاسبة: الفترة المالية والحسابات الافتراضية.
 * الحسابات الافتراضية هنا هي ما يستخدمه النظام تلقائياً عند الترحيل،
 * فتحديدها بدقة شرط لصحة الدفاتر — ولذلك يُنبَّه على الناقص منها صراحةً.
 */
export default function AccountingSettingsPage() {
  const { profile } = useAuth()
  const cid = profile?.company_id
  const { confirm, confirmNode } = useConfirm()

  const [s, setS] = useState(null)
  const [periods, setPeriods] = useState([])
  const [accounts, setAccounts] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [edit, setEdit] = useState(null)

  const load = useCallback(async () => {
    if (!cid) return
    setBusy(true); setErr('')
    try {
      const [st, ps, ac] = await Promise.all([
        fetchAccountingSettings(cid), fetchFiscalPeriods(cid), fetchAccounts(cid),
      ])
      setS(st || { company_id: cid, fiscal_year_start_month: 1, fiscal_year_start_day: 1, default_vat_rate: 15, vat_enabled: true })
      setPeriods(ps); setAccounts(ac.filter(a => !a.is_group))
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [cid])

  useEffect(() => { load() }, [load])

  const set = (k, v) => setS(p => ({ ...p, [k]: v }))

  const doSave = async () => {
    setBusy(true); setErr(''); setOk('')
    try {
      const clean = { ...s }
      delete clean.updated_at
      await saveAccountingSettings(cid, clean)
      setOk('حُفظت إعدادات المحاسبة — تُطبَّق على كل الترحيل التلقائي')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const savePeriod = async (p) => {
    setBusy(true); setErr('')
    try { await saveFiscalPeriod(cid, p); setEdit(null); setOk('حُفظت الفترة المالية'); await load() }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const togglePeriod = (p) => confirm(
    p.is_closed
      ? `إعادة فتح "${p.name}" تسمح بتسجيل قيود داخلها. متابعة؟`
      : `إقفال "${p.name}" يمنع أي قيد جديد داخلها. متابعة؟`,
    async () => {
      try { await saveFiscalPeriod(cid, { ...p, is_closed: !p.is_closed }); await load() }
      catch (e) { setErr(e.message) }
    },
  )

  const delPeriod = (p) => confirm(`حذف الفترة "${p.name}"؟`, async () => {
    try { await deleteFiscalPeriod(p.id); await load() } catch (e) { setErr(e.message) }
  })

  if (!s) return <AcctPage title="إعدادات المحاسبة" icon={<Settings2 size={20} />}><EmptyState>جارٍ التحميل…</EmptyState></AcctPage>

  const missing = DEFAULT_ACCOUNT_FIELDS.filter(f => !s[f.key]).length

  return (
    <AcctPage
      title="إعدادات المحاسبة"
      icon={<Settings2 size={20} />}
      subtitle="الفترة المالية والحسابات الافتراضية التي يستخدمها النظام في الترحيل التلقائي"
      tools={
        <>
          <RefreshButton onClick={load} busy={busy} />
          <button className="btn btn-gold btn-sm" onClick={doSave} disabled={busy}>
            <Save size={14} /> حفظ الإعدادات
          </button>
        </>
      }
    >
      <Notice kind="error" onClose={() => setErr('')}>{err}</Notice>
      <Notice kind="ok" onClose={() => setOk('')}>{ok}</Notice>
      {missing > 0 && (
        <Notice kind="warn">
          {missing} حساباً افتراضياً غير محدَّد. الترحيل التلقائي قد يتخطى هذه الحالات بصمت — حدّدها الآن.
        </Notice>
      )}

      {/* ------------- الفترات المالية ------------- */}
      <section className="acct-section">
        <div className="acct-section-head">
          <b>الفترات المالية</b>
          <span>لا يُسجَّل قيد خارج فترة مالية مفتوحة — هذا ما يضمن تأسيس الحسابات بشكل صحيح</span>
          <button className="btn btn-ghost btn-sm" onClick={() => {
            const y = new Date().getFullYear()
            setEdit({ name: `السنة المالية ${y}`, start_date: `${y}-01-01`, end_date: `${y}-12-31` })
          }}><Plus size={13} /> فترة جديدة</button>
        </div>
        {!periods.length ? <EmptyState>لا توجد فترات مالية.</EmptyState> : (
          <table className="acct-table sm">
            <thead><tr><th>الاسم</th><th>من</th><th>إلى</th><th>الحالة</th><th>إجراءات</th></tr></thead>
            <tbody>
              {periods.map(p => (
                <tr key={p.id}>
                  <td>{p.name}</td><td>{p.start_date}</td><td>{p.end_date}</td>
                  <td><span className={'acct-badge ' + (p.is_closed ? 'bad' : 'ok')}>{p.is_closed ? 'مقفلة' : 'مفتوحة'}</span></td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => togglePeriod(p)}>
                      {p.is_closed ? <Unlock size={13} /> : <Lock size={13} />} {p.is_closed ? 'فتح' : 'إقفال'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => delPeriod(p)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ------------- السنة المالية والضريبة ------------- */}
      <section className="acct-section">
        <div className="acct-section-head"><b>السنة المالية والضريبة</b></div>
        <div className="acct-form">
          <Field label="شهر بداية السنة المالية">
            <select value={s.fiscal_year_start_month} onChange={e => set('fiscal_year_start_month', Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </Field>
          <Field label="يوم البداية">
            <input type="number" min={1} max={28} value={s.fiscal_year_start_day}
              onChange={e => set('fiscal_year_start_day', Number(e.target.value))} />
          </Field>
          <Field label="نسبة الضريبة الافتراضية %">
            <input type="number" step="0.001" value={s.default_vat_rate}
              onChange={e => set('default_vat_rate', Number(e.target.value))} />
          </Field>
          <Field label="تاريخ الإقفال (لا قيد قبله)">
            <input type="date" value={s.lock_date || ''} onChange={e => set('lock_date', e.target.value || null)} />
          </Field>
          <label className="acct-chk">
            <input type="checkbox" checked={s.vat_enabled !== false} onChange={e => set('vat_enabled', e.target.checked)} />
            تفعيل ضريبة القيمة المضافة
          </label>
          <Field label="دورية الاستحقاق المؤجل">
            <select value={s.deferred_periodicity || 'monthly'} onChange={e => set('deferred_periodicity', e.target.value)}>
              <option value="monthly">شهري</option><option value="quarterly">ربع سنوي</option><option value="yearly">سنوي</option>
            </select>
          </Field>
          <Field label="طريقة احتساب الاستحقاق">
            <select value={s.deferred_computation || 'by_months'} onChange={e => set('deferred_computation', e.target.value)}>
              <option value="by_months">بالأشهر</option><option value="by_days">بالأيام</option>
            </select>
          </Field>
        </div>
      </section>

      {/* ------------- الحسابات الافتراضية ------------- */}
      <section className="acct-section">
        <div className="acct-section-head">
          <b>الحسابات الافتراضية</b>
          <span>يستخدمها النظام تلقائياً عند إنشاء القيود من الفواتير والدفعات والمصروفات</span>
        </div>
        <div className="acct-form">
          {DEFAULT_ACCOUNT_FIELDS.map(f => (
            <label key={f.key} className="wide">
              <span>{f.label}{!s[f.key] && <em className="acct-req"> غير محدَّد</em>}</span>
              <select value={s[f.key] || ''} onChange={e => set(f.key, e.target.value || null)}>
                <option value="">— اختر الحساب —</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="acct-form-actions">
          <button className="btn btn-gold btn-sm" onClick={doSave} disabled={busy}><Save size={14} /> حفظ</button>
        </div>
      </section>

      {edit && (
        <Modal title={edit.id ? 'تعديل الفترة' : 'فترة مالية جديدة'} onClose={() => setEdit(null)}>
          <PeriodForm value={edit} busy={busy} onSave={savePeriod} onCancel={() => setEdit(null)} />
        </Modal>
      )}
      {confirmNode}
    </AcctPage>
  )
}

function PeriodForm({ value, busy, onSave, onCancel }) {
  const [f, setF] = useState(value)
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  return (
    <>
      <div className="acct-form">
        <label className="wide"><span>الاسم *</span><input value={f.name} onChange={e => set('name', e.target.value)} /></label>
        <label><span>من *</span><input type="date" value={f.start_date} onChange={e => set('start_date', e.target.value)} /></label>
        <label><span>إلى *</span><input type="date" value={f.end_date} onChange={e => set('end_date', e.target.value)} /></label>
      </div>
      <div className="acct-form-actions">
        <button className="btn btn-gold btn-sm" disabled={busy || !f.name} onClick={() => onSave(f)}>حفظ</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>إلغاء</button>
      </div>
    </>
  )
}

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

export const DEFAULT_ACCOUNT_FIELDS = [
  { key: 'vat_output_account_id', label: 'ضريبة القيمة المضافة المستحقة (مخرجات)' },
  { key: 'vat_input_account_id', label: 'ضريبة القيمة المضافة القابلة للخصم (مدخلات)' },
  { key: 'suspense_bank_account_id', label: 'الحساب البنكي المعلّق' },
  { key: 'internal_transfer_account_id', label: 'الأموال قيد التحويل الداخلي' },
  { key: 'deferred_revenue_account_id', label: 'الإيرادات المؤجلة' },
  { key: 'deferred_expense_account_id', label: 'النفقة المؤجلة (مدفوعة مقدماً)' },
  { key: 'early_discount_gain_account_id', label: 'أرباح خصم الدفع المبكر' },
  { key: 'early_discount_loss_account_id', label: 'خسائر خصم الدفع المبكر' },
  { key: 'invoice_discount_customer_account_id', label: 'خصومات بند الفاتورة — فواتير العملاء' },
  { key: 'invoice_discount_vendor_account_id', label: 'خصومات بند الفاتورة — فاتورة المورد' },
  { key: 'withholding_tax_account_id', label: 'أساس ضريبة الاستقطاع (Withholding)' },
  { key: 'product_income_account_id', label: 'حساب الدخل للمنتج' },
  { key: 'product_expense_account_id', label: 'حساب النفقات للمنتج' },
]
