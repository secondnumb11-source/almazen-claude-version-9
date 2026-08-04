import React, { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../AuthContext'
import {
  fetchAccounts, fetchCostCenters, fetchTaxCodes, fetchEntry, saveEntry, postEntry,
  reverseEntry, deleteEntry, unpostEntry, money, JE_STATUS, computeVat,
} from '../../lib/accountingApi'
import { supabase } from '../../lib/supabase'
import { AcctPage, PrintButton, Notice, Modal, useConfirm } from '../../components/accounting/AcctKit'
import { FilePlus2, Save, CheckCircle2, RotateCcw, Trash2, Plus, X } from 'lucide-react'

const today = () => new Date().toISOString().slice(0, 10)
const blankLine = () => ({
  key: Math.random().toString(36).slice(2),
  account_id: '', description: '', debit: '', credit: '',
  cost_center_id: '', tax_code_id: '', tax_amount: 0, party_name: '',
})

/**
 * صفحة إضافة/تحرير القيد المحاسبي.
 * الدورة على مرحلتين بالضبط كما طُلب:
 *   الحفظ  → مسودة، التعديل مسموح.
 *   الترحيل → لا تعديل بعده؛ التصحيح يكون بقيد عكسي.
 * التوازن شرط للحفظ نفسه لا للترحيل فقط، حتى لا تتراكم مسودات مكسورة.
 */
export default function JournalEditor({ entryId, onDone, onOpenEntry }) {
  const { profile, company, isSuperAdmin } = useAuth()
  const cid = profile?.company_id
  const { confirm, confirmNode } = useConfirm()

  const [accounts, setAccounts] = useState([])
  const [centers, setCenters] = useState([])
  const [taxes, setTaxes] = useState([])
  const [branches, setBranches] = useState([])

  const [id, setId] = useState(entryId || null)
  const [status, setStatus] = useState('draft')
  const [entryNumber, setEntryNumber] = useState('')
  const [date, setDate] = useState(today)
  const [reference, setReference] = useState('')
  const [description, setDescription] = useState('')
  const [branch, setBranch] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState([blankLine(), blankLine()])
  const [reversedBy, setReversedBy] = useState(null)

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [vatBox, setVatBox] = useState(null)

  useEffect(() => {
    if (!cid) return
    fetchAccounts(cid).then(a => setAccounts(a.filter(x => !x.is_group))).catch(e => setErr(e.message))
    fetchCostCenters(cid).then(setCenters).catch(() => {})
    fetchTaxCodes(cid).then(t => setTaxes(t.filter(x => x.is_active))).catch(() => {})
    supabase.from('branches').select('id, name').eq('company_id', cid).then(({ data }) => setBranches(data || []))
  }, [cid])

  useEffect(() => {
    if (!entryId) return
    setBusy(true)
    fetchEntry(entryId).then(e => {
      setId(e.id); setStatus(e.status); setEntryNumber(e.entry_number)
      setDate(e.entry_date); setReference(e.reference || ''); setDescription(e.description || '')
      setBranch(e.branch_id || ''); setNotes(e.notes || ''); setReversedBy(e.reversed_by_id || null)
      setLines((e.lines || []).map(l => ({
        key: l.id, account_id: l.account_id, description: l.description || '',
        debit: Number(l.debit) || '', credit: Number(l.credit) || '',
        cost_center_id: l.cost_center_id || '', tax_code_id: l.tax_code_id || '',
        tax_amount: Number(l.tax_amount) || 0, party_name: l.party_name || '',
      })))
    }).catch(e => setErr(e.message)).finally(() => setBusy(false))
  }, [entryId])

  const totals = useMemo(() => lines.reduce((t, l) => ({
    d: t.d + (Number(l.debit) || 0),
    c: t.c + (Number(l.credit) || 0),
    v: t.v + (Number(l.tax_amount) || 0),
  }), { d: 0, c: 0, v: 0 }), [lines])

  const diff = Math.round((totals.d - totals.c) * 100) / 100
  const locked = status !== 'draft'

  const setLine = (key, patch) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)))
  const addLine = () => setLines(ls => [...ls, blankLine()])
  const removeLine = (key) => setLines(ls => (ls.length > 2 ? ls.filter(l => l.key !== key) : ls))

  /* عند اختيار رمز ضريبي تُحسب الضريبة تلقائياً من مبلغ السطر، ويبقى التعديل اليدوي متاحاً */
  const onTaxPick = (key, taxId) => {
    const tax = taxes.find(t => t.id === taxId)
    const line = lines.find(l => l.key === key)
    const base = Number(line?.debit) || Number(line?.credit) || 0
    const { vat } = computeVat(base, tax?.rate || 0, false)
    setLine(key, { tax_code_id: taxId, tax_amount: taxId ? vat : 0 })
  }

  /** يضيف سطري الضريبة تلقائياً إلى القيد بحساب الضريبة المرتبط بالرمز. */
  const applyVatLines = () => {
    const taxed = lines.filter(l => l.tax_code_id && Number(l.tax_amount) > 0)
    if (!taxed.length) { setErr('لا يوجد سطر عليه ضريبة محسوبة'); return }
    const extra = []
    for (const l of taxed) {
      const tax = taxes.find(t => t.id === l.tax_code_id)
      if (!tax?.account_id) { setErr(`الرمز الضريبي ${tax?.code || ''} بلا حساب مرتبط — عرّفه في مركز الضريبة`); return }
      const onDebit = Number(l.debit) > 0
      extra.push({
        ...blankLine(),
        account_id: tax.account_id,
        description: `ضريبة القيمة المضافة ${tax.rate}% — ${l.description || description || ''}`,
        debit: onDebit ? Number(l.tax_amount) : '',
        credit: onDebit ? '' : Number(l.tax_amount),
        cost_center_id: l.cost_center_id,
      })
    }
    setLines(ls => [...ls, ...extra])
    setVatBox(null)
    setOk('أُضيفت سطور الضريبة — راجع التوازن قبل الحفظ')
  }

  const payload = () => ({
    id, company_id: cid, entry_date: date, description, reference, branch_id: branch || null, notes,
    lines: lines
      .filter(l => l.account_id && (Number(l.debit) || Number(l.credit)))
      .map(l => ({
        account_id: l.account_id, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
        description: l.description || null, cost_center_id: l.cost_center_id || null,
        tax_code_id: l.tax_code_id || null, tax_amount: Number(l.tax_amount) || 0,
        party_name: l.party_name || null,
      })),
  })

  const doSave = async () => {
    setBusy(true); setErr(''); setOk('')
    try {
      const newId = await saveEntry(payload())
      setId(newId)
      const fresh = await fetchEntry(newId)
      setEntryNumber(fresh.entry_number); setStatus(fresh.status)
      setOk(`حُفظ القيد ${fresh.entry_number} كمسودة — يمكنك تعديله قبل الترحيل`)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const doPost = async () => {
    setBusy(true); setErr(''); setOk('')
    try {
      let eid = id
      if (!eid) eid = await saveEntry(payload())
      else await saveEntry(payload())
      await postEntry(eid)
      const fresh = await fetchEntry(eid)
      setId(eid); setEntryNumber(fresh.entry_number); setStatus(fresh.status)
      setOk(`رُحّل القيد ${fresh.entry_number} — لا يقبل التعديل بعد الآن`)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const doReverse = () => confirm(
    'سيُنشأ قيد عكسي مُرحَّل بنفس المبالغ في الاتجاه المعاكس. متابعة؟',
    async () => {
      setBusy(true); setErr('')
      try {
        const revId = await reverseEntry(id, today(), 'عكس يدوي من شاشة القيد')
        setOk('أُنشئ القيد العكسي بنجاح')
        setReversedBy(revId)
        onOpenEntry?.(revId)
      } catch (e) { setErr(e.message) } finally { setBusy(false) }
    },
  )

  const doDelete = () => confirm(
    'سيُحذف القيد وسطوره نهائياً. متابعة؟',
    async () => {
      setBusy(true); setErr('')
      try { await deleteEntry(id); onDone?.() }
      catch (e) { setErr(e.message) } finally { setBusy(false) }
    },
  )

  const doUnpost = () => confirm(
    'إعادة القيد إلى مسودة إجراء استثنائي للسوبر أدمن. متابعة؟',
    async () => {
      setBusy(true); setErr('')
      try { await unpostEntry(id); setStatus('draft'); setOk('أُعيد القيد إلى مسودة') }
      catch (e) { setErr(e.message) } finally { setBusy(false) }
    },
  )

  const st = JE_STATUS[status] || JE_STATUS.draft

  return (
    <AcctPage
      title={id ? `القيد المحاسبي ${entryNumber}` : 'قيد محاسبي جديد'}
      icon={<FilePlus2 size={20} />}
      subtitle="الحفظ يُبقي القيد مسودة قابلة للتعديل — والترحيل يثبّته نهائياً"
      tools={
        <>
          <span className="acct-badge" style={{ background: st.bg, color: st.color }}>{st.label}</span>
          {!locked && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={doSave} disabled={busy}>
                <Save size={14} /> حفظ كمسودة
              </button>
              <button className="btn btn-gold btn-sm" onClick={doPost} disabled={busy || diff !== 0 || totals.d === 0}>
                <CheckCircle2 size={14} /> ترحيل
              </button>
            </>
          )}
          {locked && status === 'posted' && !reversedBy && (
            <button className="btn btn-ghost btn-sm" onClick={doReverse} disabled={busy}>
              <RotateCcw size={14} /> قيد عكسي
            </button>
          )}
          {locked && isSuperAdmin && (
            <button className="btn btn-ghost btn-sm" onClick={doUnpost} disabled={busy}>إلغاء الترحيل</button>
          )}
          {id && (!locked || isSuperAdmin) && (
            <button className="btn btn-danger btn-sm" onClick={doDelete} disabled={busy}>
              <Trash2 size={14} /> حذف
            </button>
          )}
          <PrintButton docKind="journal" entityId={id} total={totals.d} docDate={date} targetId="je-print" title={`قيد محاسبي ${entryNumber || ''} — ${company?.name || ''}`} />
          {onDone && <button className="btn btn-ghost btn-sm" onClick={onDone}>رجوع للقائمة</button>}
        </>
      }
    >
      <Notice kind="error" onClose={() => setErr('')}>{err}</Notice>
      <Notice kind="ok" onClose={() => setOk('')}>{ok}</Notice>
      {reversedBy && <Notice kind="warn">هذا القيد مَعكوس بقيد آخر — لا يقبل عكساً ثانياً.</Notice>}

      <div id="je-print" className="je-doc">
        <div className="je-head">
          <label><span>التاريخ</span>
            <input type="date" value={date} disabled={locked} onChange={e => setDate(e.target.value)} />
          </label>
          <label><span>المرجع</span>
            <input value={reference} disabled={locked} onChange={e => setReference(e.target.value)} placeholder="رقم مستند / مرجع" />
          </label>
          <label><span>الفرع</span>
            <select value={branch} disabled={locked} onChange={e => setBranch(e.target.value)}>
              <option value="">—</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="je-desc"><span>الشرح</span>
            <input value={description} disabled={locked} onChange={e => setDescription(e.target.value)} placeholder="شرح القيد" />
          </label>
        </div>

        <table className="acct-table je-table">
          <thead>
            <tr>
              <th style={{ width: '22%' }}>الحساب</th>
              <th>البيان</th>
              <th style={{ width: 110 }}>مدين</th>
              <th style={{ width: 110 }}>دائن</th>
              <th style={{ width: 130 }}>الرمز الضريبي</th>
              <th style={{ width: 100 }}>الضريبة</th>
              <th style={{ width: 150 }}>مركز التكلفة</th>
              <th className="no-print" style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.key}>
                <td>
                  <select value={l.account_id} disabled={locked} onChange={e => setLine(l.key, { account_id: e.target.value })}>
                    <option value="">— اختر الحساب —</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </td>
                <td><input value={l.description} disabled={locked} onChange={e => setLine(l.key, { description: e.target.value })} /></td>
                <td>
                  <input type="number" step="0.01" className="num" value={l.debit} disabled={locked}
                    onChange={e => setLine(l.key, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
                </td>
                <td>
                  <input type="number" step="0.01" className="num" value={l.credit} disabled={locked}
                    onChange={e => setLine(l.key, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
                </td>
                <td>
                  <select value={l.tax_code_id} disabled={locked} onChange={e => onTaxPick(l.key, e.target.value)}>
                    <option value="">لا توجد ضريبة</option>
                    {taxes.map(t => <option key={t.id} value={t.id}>{t.code} ({t.rate}%)</option>)}
                  </select>
                </td>
                <td>
                  <input type="number" step="0.01" className="num" value={l.tax_amount || ''} disabled={locked}
                    onChange={e => setLine(l.key, { tax_amount: e.target.value })} title="محسوبة تلقائياً — يمكن تعديلها يدوياً" />
                </td>
                <td>
                  <select value={l.cost_center_id} disabled={locked} onChange={e => setLine(l.key, { cost_center_id: e.target.value })}>
                    <option value="">—</option>
                    {centers.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                  </select>
                </td>
                <td className="no-print">
                  {!locked && lines.length > 2 && (
                    <button type="button" className="je-x" onClick={() => removeLine(l.key)} title="حذف السطر"><X size={13} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>الإجمالي</td>
              <td className="num">{money(totals.d)}</td>
              <td className="num">{money(totals.c)}</td>
              <td>إجمالي الضريبة</td>
              <td className="num">{money(totals.v)}</td>
              <td colSpan={2} className={diff === 0 ? 'je-ok' : 'je-bad'}>
                {diff === 0 ? '✓ متوازن' : `فارق ${money(Math.abs(diff))} ر.س`}
              </td>
            </tr>
            <tr>
              <td colSpan={2}>الإجمالي شامل الضريبة</td>
              <td className="num" colSpan={2}>{money(totals.d + totals.v)}</td>
              <td colSpan={4} />
            </tr>
          </tfoot>
        </table>

        {!locked && (
          <div className="je-actions no-print">
            <button type="button" className="btn btn-ghost btn-sm" onClick={addLine}><Plus size={13} /> إضافة سطر</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVatBox(true)}>
              إضافة سطور الضريبة تلقائياً
            </button>
            <label className="je-notes">
              <span>ملاحظات</span>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="ملاحظة داخلية (اختياري)" />
            </label>
          </div>
        )}
      </div>

      {vatBox && (
        <Modal title="إضافة سطور ضريبة القيمة المضافة" onClose={() => setVatBox(null)}>
          <p>
            سيُضاف لكل سطر عليه ضريبة محسوبة سطرٌ مقابل بحساب الضريبة المرتبط بالرمز،
            في نفس اتجاه السطر الأصلي. راجع التوازن بعدها ثم احفظ.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-gold btn-sm" onClick={applyVatLines}>أضف السطور</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setVatBox(null)}>إلغاء</button>
          </div>
        </Modal>
      )}

      {confirmNode}
    </AcctPage>
  )
}
