import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../AuthContext'
import { supabase } from '../../lib/supabase'
import { money } from '../../lib/accountingApi'
import {
  AcctPage, AcctFilters, Field, ExcelButton, PrintButton, RefreshButton,
  SearchBox, Notice, EmptyState, Modal, useConfirm,
} from '../../components/accounting/AcctKit'
import { FileCheck2, ShieldCheck, Ban, QrCode } from 'lucide-react'

const yearStart = () => `${new Date().getFullYear()}-01-01`
const today = () => new Date().toISOString().slice(0, 10)

const KINDS = {
  invoice: 'فاتورة', voucher: 'سند', journal: 'قيد محاسبي', contract: 'عقد',
  receipt: 'سند قبض', payment: 'سند صرف', handover: 'محضر تسليم',
  settlement: 'تسوية', statement: 'كشف حساب', report: 'تقرير',
}

/**
 * سجل المستندات الرقمية — البند 20 «رقمنة النظام بالكامل».
 * كل مستند يخرج من النظام يُختم برقم تسلسلي وبصمة محتوى ورمز تحقق،
 * ويُقيَّد هنا. المستند لا يُحذف أبداً — يُلغى مع بقاء أثره، لأن الحذف
 * يُفقد التدقيق قدرته على إثبات ما صدر.
 */
export default function DigitalDocsPage({ focusRecord }) {
  const { profile, company } = useAuth()
  const cid = profile?.company_id
  const { confirm, confirmNode } = useConfirm()

  const [rows, setRows] = useState([])
  const [coverage, setCoverage] = useState([])
  const [kind, setKind] = useState('')
  const [from, setFrom] = useState(yearStart)
  const [to, setTo] = useState(today)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [verifyBox, setVerifyBox] = useState(null)

  const load = useCallback(async () => {
    if (!cid) return
    setBusy(true); setErr('')
    try {
      const [{ data: list, error: e1 }, { data: cov, error: e2 }] = await Promise.all([
        supabase.rpc('doc_registry_list', {
          p_company: cid, p_kind: kind || null, p_from: from, p_to: to,
          p_search: search || null, p_limit: 500,
        }),
        supabase.rpc('doc_coverage', { p_company: cid }),
      ])
      if (e1) throw new Error(e1.message)
      if (e2) throw new Error(e2.message)
      setRows(list || []); setCoverage(cov || [])
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [cid, kind, from, to, search])

  useEffect(() => { load() }, [load])

  /* السجل القادم من البحث الشامل: تُرشَّح عليه الصفحة فور فتحها
     بدل ترك المستخدم يبحث عنه مرة أخرى داخلها. */
  useEffect(() => {
    if (focusRecord?.title) setSearch(String(focusRecord.title).split(' — ')[0])
  }, [focusRecord])


  const excelRows = useMemo(() => rows.map(r => ({
    'الرقم التسلسلي': r.o_serial, 'النوع': KINDS[r.o_kind] || r.o_kind,
    'العنوان': r.o_title || '', 'رمز التحقق': r.o_code || '',
    'التاريخ': r.o_date || '', 'المبلغ': Number(r.o_total || 0),
    'أصدره': r.o_issued_by, 'وقت الإصدار': new Date(r.o_issued_at).toLocaleString('ar-SA'),
    'الحالة': r.o_revoked ? 'ملغى' : 'ساري',
  })), [rows])

  const doRevoke = (r) => confirm(
    `إلغاء المستند ${r.o_serial}؟ لن يُحذف — سيبقى في السجل معلَّماً كملغى، وأي تحقق منه سيُرجع "ملغى".`,
    async () => {
      try {
        const { error } = await supabase.rpc('doc_revoke', { p_id: r.o_id, p_reason: 'إلغاء يدوي من سجل المستندات' })
        if (error) throw new Error(error.message)
        setOk('أُلغي المستند وبقي أثره في السجل')
        await load()
      } catch (e) { setErr(e.message) }
    },
  )

  const totalDocs = coverage.reduce((t, c) => t + Number(c.o_total || 0), 0)
  const totalStamped = coverage.reduce((t, c) => t + Number(c.o_stamped || 0), 0)
  const pct = totalDocs ? Math.round((totalStamped / totalDocs) * 1000) / 10 : 0

  return (
    <AcctPage
      title="سجل المستندات الرقمية"
      icon={<FileCheck2 size={20} />}
      subtitle="كل مستند برقم تسلسلي وبصمة محتوى ورمز تحقق يمكن لأي طرف التأكد منه"
      tools={
        <>
          <button className="btn btn-ghost btn-sm" onClick={() => setVerifyBox({ code: '', res: null })}>
            <ShieldCheck size={14} /> تحقق من مستند
          </button>
          <RefreshButton onClick={load} busy={busy} />
          <ExcelButton filename="سجل-المستندات-الرقمية.xlsx" sheet="المستندات"
            rows={excelRows} numericCols={['المبلغ']} onError={setErr} />
          <PrintButton docKind="report" targetId="dd-print" title={`سجل المستندات الرقمية — ${company?.name || ''}`} />
        </>
      }
    >
      <Notice kind="error" onClose={() => setErr('')}>{err}</Notice>
      <Notice kind="ok" onClose={() => setOk('')}>{ok}</Notice>

      <div className="acct-kpis">
        <div><span>مستندات موثّقة رقمياً</span><b>{totalStamped}</b></div>
        <div><span>إجمالي مستندات النظام</span><b>{totalDocs}</b></div>
        <div className={pct >= 99 ? '' : 'due'}><span>نسبة الرقمنة</span><b>{pct}%</b></div>
      </div>

      {coverage.length > 0 && (
        <section className="acct-section">
          <div className="acct-section-head">
            <b>تغطية الرقمنة حسب نوع المستند</b>
            <span>المستندات القديمة تُختم عند أول طباعة لها — الختم يُصدر مرة واحدة ويُعاد استخدامه</span>
          </div>
          <table className="acct-table sm">
            <thead><tr><th>النوع</th><th>الإجمالي</th><th>موثّق</th><th>النسبة</th></tr></thead>
            <tbody>
              {coverage.map(c => (
                <tr key={c.o_kind}>
                  <td>{KINDS[c.o_kind] || c.o_kind}</td>
                  <td className="num">{c.o_total}</td>
                  <td className="num">{c.o_stamped}</td>
                  <td className="num">
                    <span className={'acct-badge ' + (Number(c.o_pct) >= 99 ? 'ok' : 'warn')}>{c.o_pct}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <AcctFilters>
        <Field label="بحث" wide>
          <SearchBox value={search} onChange={setSearch} placeholder="رقم تسلسلي أو رمز تحقق أو عنوان…" />
        </Field>
        <Field label="النوع">
          <select value={kind} onChange={e => setKind(e.target.value)}>
            <option value="">كل الأنواع</option>
            {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="من تاريخ"><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="إلى تاريخ"><input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
      </AcctFilters>

      <div id="dd-print" className="acct-table-wrap">
        {!rows.length && !busy ? (
          <EmptyState>لا مستندات مختومة في هذه الفترة. تُختم المستندات تلقائياً عند طباعتها أو إصدارها.</EmptyState>
        ) : (
          <table className="acct-table">
            <thead>
              <tr><th>الرقم التسلسلي</th><th>النوع</th><th>العنوان</th><th>رمز التحقق</th>
                <th>التاريخ</th><th>المبلغ</th><th>أصدره</th><th>الحالة</th>
                <th className="no-print">إجراء</th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.o_id} className={r.o_revoked ? 'grp' : ''}>
                  <td className="num">{r.o_serial}</td>
                  <td>{KINDS[r.o_kind] || r.o_kind}</td>
                  <td>{r.o_title || '—'}</td>
                  <td className="num"><code>{r.o_code || '—'}</code></td>
                  <td>{r.o_date || '—'}</td>
                  <td className="num">{r.o_total ? money(r.o_total) : '—'}</td>
                  <td>{r.o_issued_by}</td>
                  <td>
                    <span className={'acct-badge ' + (r.o_revoked ? 'bad' : 'ok')}>
                      {r.o_revoked ? 'ملغى' : 'ساري'}
                    </span>
                  </td>
                  <td className="no-print">
                    <button className="btn btn-ghost btn-sm" title="تحقق"
                      onClick={() => setVerifyBox({ code: r.o_code || '', res: null })}>
                      <QrCode size={13} />
                    </button>
                    {!r.o_revoked && (
                      <button className="btn btn-ghost btn-sm" title="إلغاء المستند" onClick={() => doRevoke(r)}>
                        <Ban size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {verifyBox && (
        <Modal title="التحقق من مستند" onClose={() => setVerifyBox(null)}>
          <VerifyForm state={verifyBox} setState={setVerifyBox} />
        </Modal>
      )}
      {confirmNode}
    </AcctPage>
  )
}

function VerifyForm({ state, setState }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('doc_verify', { p_code: state.code, p_hash: null })
      setState(s => ({ ...s, res: error ? { valid: false, reason: error.message } : data }))
    } finally { setBusy(false) }
  }
  const r = state.res
  return (
    <>
      <div className="acct-form">
        <label className="wide"><span>رمز التحقق المطبوع على المستند</span>
          <input value={state.code} dir="ltr" placeholder="مثال: A3F91C7D2B"
            onChange={e => setState(s => ({ ...s, code: e.target.value.toUpperCase(), res: null }))} />
        </label>
      </div>
      <div className="acct-form-actions">
        <button className="btn btn-gold btn-sm" onClick={run} disabled={busy || state.code.length < 6}>
          {busy ? 'جارٍ التحقق…' : 'تحقّق'}
        </button>
      </div>
      {r && (
        <div className={'acct-notice ' + (r.valid ? 'ok' : 'error')} style={{ marginTop: 12 }}>
          <span>
            {r.valid
              ? `✓ مستند صحيح — ${r.title || r.kind} رقم ${r.serial}، صادر عن ${r.issuer} بتاريخ ${r.doc_date || '—'}${r.total ? ` بمبلغ ${money(r.total)} ر.س` : ''}`
              : `✗ ${r.reason}`}
          </span>
        </div>
      )}
      <p className="sbset-hint" style={{ marginTop: 10 }}>
        هذا التحقق متاح لأي طرف خارجي دون دخول للنظام، ولا يكشف محتوى المستند — يُثبت صدوره وسلامته فقط.
      </p>
    </>
  )
}
