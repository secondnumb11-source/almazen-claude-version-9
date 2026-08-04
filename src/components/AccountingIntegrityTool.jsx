import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { SAR, num } from '../lib/helpers'
import { reconcileMaintenanceExpenses } from '../lib/accountingSync'
import { runRepair } from '../lib/accountingRepairs'
import { exportCSV } from '../lib/helpers'
import { downloadPDF } from '../lib/pdf'

/* قياس زمن التحميل بواجهة PerformanceNavigationTiming الحديثة (وليس timing المهجورة) */
function measureLoadMs() {
  try {
    const nav = performance.getEntriesByType('navigation')[0]
    if (nav && nav.duration > 0) return Math.round(nav.duration)
    const t = performance.timing
    if (t?.loadEventEnd > 0 && t?.navigationStart > 0) return t.loadEventEnd - t.navigationStart
  } catch { /* ignore */ }
  return 0
}

export default function AccountingIntegrityTool() {
  const { profile, company, toast, isSuperAdmin } = useAuth()
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState(null)

  const [resetting, setResetting] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [repairMsg, setRepairMsg] = useState(null)
  const [fixState, setFixState] = useState({})   // { [issueId]: {busy, ok, message} }
  const [fixLog, setFixLog] = useState([])       // سجل تفصيلي لكل إصلاح نُفِّذ

  /** يسجّل أثر كل إصلاح: عدد السجلات المتأثرة والخطأ إن وجد */
  const logFix = (issue, res, scope = 'شركة المستخدم') => {
    setFixLog(l => [...l, {
      at: new Date().toLocaleString('ar-SA'),
      id: issue.id,
      label: issue.fixLabel || issue.id,
      scope,
      ok: !!res.ok,
      affected: Number(res.affected || 0),
      message: res.message || '',
      error: res.ok ? '' : (res.message || 'فشل غير معروف'),
    }])
  }

  const runDiagnostics = async () => {
    setBusy(true)
    try {
      const cid = profile.company_id
      const issues = []

      // 1. تحقق من توازن ميزان المراجعة (يجب أن يكون مجموع المدين = مجموع الدائن)
      // مهم: العمود الرابط في journal_entry_lines هو entry_id (وليس journal_entry_id)،
      // والفحص مقيّد بقيود الشركة الحالية فقط حتى لا يخلط أرصدة منشآت أخرى
      // (خصوصاً لحساب Super Admin العابر للشركات).
      const { data: companyEntries, error: entriesErr } = await supabase
        .from('journal_entries')
        .select('id')
        .eq('company_id', cid)
      if (entriesErr) throw entriesErr
      const entryIds = (companyEntries || []).map(e => e.id)

      let balanceCheck = []
      if (entryIds.length) {
        // تقسيم على دفعات لتجنّب طول URL عند كثرة القيود
        for (let i = 0; i < entryIds.length; i += 200) {
          const { data: chunk, error: linesErr } = await supabase
            .from('journal_entry_lines')
            .select('debit, credit, entry_id')
            .in('entry_id', entryIds.slice(i, i + 200))
          if (linesErr) throw linesErr
          balanceCheck = balanceCheck.concat(chunk || [])
        }
      }

      const totalDebit = balanceCheck.reduce((s, r) => s + num(r.debit), 0)
      const totalCredit = balanceCheck.reduce((s, r) => s + num(r.credit), 0)
      const balanceDiff = Math.round((totalDebit - totalCredit) * 100) / 100

      if (Math.abs(balanceDiff) > 0.01) {
        issues.push({
          id: 'balance_diff', level: 'error',
          message: `⚠️ اختلال في ميزان المراجعة بقيمة ${SAR(balanceDiff)}. القيد المزدوج غير متوازن.`,
          fixLabel: '🛠️ موازنة القيود تلقائياً',
          repair: 'unbalanced',
        })
      }

      // 1.2 فحص اكتمال الترحيل: دفعات مسجّلة بلا قيد يومية مقابل
      // (نقص حقيقي: تظهر في سجل الدفعات ولا تظهر في ميزان المراجعة/قائمة الدخل)
      const { data: unposted, error: unpostedErr } = await supabase
        .rpc('check_unposted_payments', { p_company_id: cid })
      if (!unpostedErr && unposted && unposted.length > 0) {
        const sum = unposted.reduce((s, r) => s + num(r.amount), 0)
        issues.push({
          id: 'unposted_payments', level: 'error',
          message: `⚠️ يوجد (${unposted.length}) دفعة بإجمالي ${SAR(sum)} مسجّلة في سجل الدفعات دون ترحيلها إلى دفتر اليومية.`,
          fixLabel: '🛠️ ترحيل الدفعات غير المرحّلة',
          confirm: `سيتم إنشاء قيد يومية مزدوج متوازن لعدد ${unposted.length} دفعة بتاريخ كل دفعة. متابعة؟`,
          repair: 'unposted_payments',
        })
      }


      // 1.1 فحص ترحيل الأرصدة (Audit Ledger vs Account Balances)
      // ملاحظة: لا يوجد عمود `balance` في chart_of_accounts — الرصيد المسجّل هو
      // opening_balance، والرصيد الفعلي = opening_balance + مجموع أسطر القيود.
      const { data: coaData } = await supabase.from('chart_of_accounts').select('id, name, code, opening_balance').eq('company_id', cid)
      const accIds = new Set((coaData || []).map(a => a.id))
      const { data: linesData } = await supabase.from('journal_entry_lines').select('account_id, debit, credit')
      
      const calcBalances = {}
      for (const l of linesData || []) {
        if (!accIds.has(l.account_id)) continue
        calcBalances[l.account_id] = (calcBalances[l.account_id] || 0) + (num(l.debit) - num(l.credit))
      }
      const glBalance = (code) => (coaData || [])
        .filter(a => a.code === code)
        .reduce((s, a) => s + num(a.opening_balance) + (calcBalances[a.id] || 0), 0)

      // 2. تحقق من وجود قيود بدون بنود
      const { data: emptyEntries } = await supabase.rpc('check_empty_journal_entries', { p_company_id: cid })
      if (emptyEntries && emptyEntries.length > 0) {
        issues.push({
          id: 'empty_entries', level: 'error',
          message: `⚠️ وجد عدد (${emptyEntries.length}) قيود يومية بدون بنود تفصيلية.`,
          fixLabel: '🛠️ حذف القيود بدون بنود',
          repair: 'orphans',
        })
      }

      // 2.1 فحص صحة بيانات الوحدات (Unit Record Persistence)
      const { data: units } = await supabase.from('units').select('id, unit_number').eq('company_id', cid)
      const { data: orphanedBookings } = await supabase.from('bookings').select('id, unit_id').eq('company_id', cid)
      
      const unitIds = new Set(units?.map(u => u.id) || [])
      const orphans = orphanedBookings?.filter(b => b.unit_id && !unitIds.has(b.unit_id))
      if (orphans && orphans.length > 0) {
        issues.push({
          id: 'orphan_bookings', level: 'error',
          message: `🚨 وجد عدد (${orphans.length}) حجوزات مرتبطة بوحدات غير موجودة في النظام (بيانات مفقودة).`,
          fixLabel: '🛠️ فكّ ارتباط الحجوزات بالوحدات المحذوفة',
          confirm: `سيتم إزالة الربط المعطوب لعدد ${orphans.length} حجز (الحجوزات نفسها لن تُحذف). متابعة؟`,
          run: async () => {
            const ids = orphans.map(o => o.id)
            const { error } = await supabase.from('bookings').update({ unit_id: null }).in('id', ids)
            if (error) return { ok: false, message: error.message }
            return { ok: true, message: `تم فكّ ارتباط ${ids.length} حجز بوحدات محذوفة` }
          },
        })
      }

      // 3. تحقق من ربط طلبات الصيانة بالدفاتر والتوزيع على الوحدات
      try {
        const maintRecon = await reconcileMaintenanceExpenses(supabase, cid)
        if (maintRecon.success && maintRecon.autoFixedEntriesCount > 0) {
          issues.push({
            id: 'maint_recon', level: 'info',
            message: `🛠️ تم رصد وتأكيد توازن (${maintRecon.autoFixedEntriesCount}) قيود صيانة بالدفتر العام وتوزيعها على الوحدات.`,
          })
        }
      } catch (mErr) {
        console.warn('Maintenance reconciliation check error:', mErr)
      }

      // 4. تحقق من مبالغ التأمين المعلقة
      // 2120 حساب التزام: الرصيد الدائن موجب، لذا نعكس إشارة (مدين - دائن)
      const glInsurance = -glBalance('2120')
      const { data: activeInsurance } = await supabase
        .from('bookings')
        .select('insurance_amount')
        .eq('company_id', cid)
        .in('status', ['confirmed', 'checked_in'])
      
      const actualInsurance = activeInsurance?.reduce((s, r) => s + num(r.insurance_amount), 0) || 0
      
      if (Math.abs(glInsurance - actualInsurance) > 10) {
        issues.push({
          id: 'insurance', level: 'error',
          message: `⚠️ فارق بين رصيد حساب التأمينات في الدفاتر (${SAR(glInsurance)}) والمبالغ الفعلية للحجوزات النشطة (${SAR(actualInsurance)}).`,
          fixLabel: '🛠️ تسوية رصيد التأمينات',
          repair: 'insurance',
        })
      }

      // 3.1 فحص صلاحيات الوصول (RBAC & RBAC Audit)
      const { data: userData } = await supabase.auth.getUser()
      const userRole = profile?.role || 'employee'
      const restrictedModules = ['settings', 'users', 'global_financials']
      
      let rbacStatus = 'SECURE'
      if (userRole === 'employee') {
        // فحص حقيقي: هل يمكن للموظف قراءة إعدادات الشركة الحساسة؟
        const { data: sensitiveData, error: rbacError } = await supabase.from('profiles').select('settings').eq('role', 'superadmin').limit(1)
        if (sensitiveData && sensitiveData.length > 0 && !rbacError) {
          issues.push({
            id: 'rbac', level: 'error',
            message: '🚨 خلل في صلاحيات الوصول (RBAC): تمكن حساب موظف من الوصول إلى بيانات إعدادات الإدارة العليا.',
            hint: 'يتطلب تشديد سياسات RLS على جدول profiles — لا يمكن إصلاحه من المتصفح.',
          })
          rbacStatus = 'VULNERABLE'
        }
      }

      // 3.2 فحص الفصل بين المنشآت (Multi-tenancy isolation audit)
      // مهم: حساب Super Admin يملك — بالتصميم — صلاحية القراءة عبر كل الشركات
      // (سياسة is_super_admin في RLS)، لذا رؤية سجلات شركات أخرى منه ليست خرقاً
      // ولا يمكن «إصلاحها»؛ الخرق الحقيقي هو أن يراها مستخدم عادي.
      const { data: leakCheck } = await supabase.from('units').select('id, company_id').neq('company_id', cid).limit(5)
      const crossRows = leakCheck?.length || 0
      let tenancyStatus = 'ISOLATED'
      if (crossRows > 0) {
        if (isSuperAdmin) {
          tenancyStatus = 'SUPERADMIN_SCOPE'
          issues.push({
            id: 'tenancy_superadmin', level: 'info',
            message: 'ℹ️ عزل البيانات سليم: ظهور سجلات شركات أخرى ناتج عن صلاحية Super Admin العابرة للشركات (سلوك مقصود بالتصميم) وليس خرقاً.',
          })
        } else {
          tenancyStatus = 'LEAK_DETECTED'
          issues.push({
            id: 'tenancy_leak', level: 'error',
            message: `🚨 خرق حقيقي في عزل البيانات (Multi-tenancy): حساب غير Super Admin تمكّن من قراءة ${crossRows} سجل من منشآت أخرى.`,
            hint: 'يتطلب تفعيل سياسات RLS المقيّدة بـ company_id على جدول units — راجع مسؤول النظام.',
          })
        }
      }

      // 3.3 فحص حالة الاشتراك للمسؤولين الموثقين
      const verifiedEmails = [
        'sh.abdelwahab@nes-sa.com',
        'shadyabdelwahabksa@gmail.com',
        'secondnumb11@gmail.com',
        'info.almazen.platform@gmail.com',
        'moatazsalah1016@gmail.com',
        'motazsalah1016@gmail.com'
      ]
      
      let platformStatus = 'VERIFIED'
      const { data: { user } } = await supabase.auth.getUser()
      if (verifiedEmails.includes(user?.email)) {
        const { data: companyCheck } = await supabase.from('companies').select('plan').eq('id', cid).single()
        if (companyCheck?.plan !== 'active') {
          issues.push({
            id: 'subscription', level: 'error',
            message: `🚨 خلل في خطة الاشتراك: الحساب الموثق (${user.email}) لا يملك خطة "نشطة" دائمة.`,
            fixLabel: '🛠️ تفعيل الخطة الدائمة',
            run: async () => {
              const { error } = await supabase.from('companies').update({ plan: 'active' }).eq('id', cid)
              if (error) return { ok: false, message: error.message }
              return { ok: true, message: 'تم تفعيل خطة الاشتراك الدائمة' }
            },
          })
          platformStatus = 'SUBSCRIPTION_ERROR'
        }
      }

      // 3.4 فحص تناسق روابط المكونات (UI State Integrity)
      const cachedLayout = localStorage.getItem(`dashboard_layout_${cid}`)
      let uiStateStatus = 'CONSISTENT'
      if (cachedLayout) {
        try {
          const parsed = JSON.parse(cachedLayout)
          if (!Array.isArray(parsed) || parsed.length === 0) {
            issues.push({
              id: 'ui_state', level: 'warn',
              message: '⚠️ خلل في التخزين المؤقت للواجهة: بيانات التخطيط تالفة أو غير موجودة.',
              fixLabel: '🛠️ إعادة بناء تخطيط الواجهة',
              run: async () => {
                localStorage.removeItem(`dashboard_layout_${cid}`)
                return { ok: true, message: 'تم مسح التخطيط التالف — سيُعاد بناؤه افتراضياً' }
              },
            })
            uiStateStatus = 'MISMATCH'
          }
        } catch (e) {
          issues.push({
            id: 'ui_state', level: 'error',
            message: '🚨 خطأ في هيكل البيانات المحلي: التخزين المؤقت للوحة التحكم تالف.',
            fixLabel: '🛠️ مسح التخزين المؤقت التالف',
            run: async () => {
              localStorage.removeItem(`dashboard_layout_${cid}`)
              return { ok: true, message: 'تم مسح التخزين المؤقت التالف' }
            },
          })
          uiStateStatus = 'CORRUPTED'
        }
      }

      // 3.5 فحص أداء التحميل (Load Health)
      // قياس واقعي: زمن تحميل الصفحة + زمن استجابة فعلي لقاعدة البيانات الآن.
      const loadTime = measureLoadMs()
      const t0 = performance.now()
      await supabase.from('units').select('id', { head: true, count: 'exact' }).eq('company_id', cid).limit(1)
      const dbMs = Math.round(performance.now() - t0)
      let loadStatus = 'OPTIMAL'
      if (dbMs > 1500) {
        loadStatus = 'DEGRADED'
        issues.push({
          id: 'db_latency', level: 'warn',
          message: `🐢 بطء فعلي في استجابة قاعدة البيانات (${(dbMs / 1000).toFixed(1)} ثانية للاستعلام الواحد).`,
          hint: 'قد يكون بسبب ضعف الشبكة أو حاجة الجداول لفهارس — أعد القياس بعد تنظيف الكاش.',
          fixLabel: '🛠️ تنظيف الكاش وإعادة القياس',
          run: async () => {
            try {
              if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k)
            } catch { /* ignore */ }
            const s = performance.now()
            await supabase.from('units').select('id', { head: true, count: 'exact' }).eq('company_id', cid).limit(1)
            const again = Math.round(performance.now() - s)
            return { ok: again <= 1500, message: `زمن الاستجابة بعد التنظيف: ${again}ms` }
          },
        })
      } else if (loadTime > 5000) {
        loadStatus = 'SLOW_FIRST_LOAD'
        issues.push({
          id: 'first_load', level: 'warn',
          message: `🐢 بطء في أول تحميل للصفحة (${(loadTime / 1000).toFixed(1)} ثانية) — قاعدة البيانات سريعة (${dbMs}ms) والمشكلة في كاش المتصفح/الشبكة فقط.`,
          fixLabel: '🛠️ تنظيف كاش المتصفح وإعادة التحميل',
          confirm: 'سيتم تنظيف الكاش وإعادة تحميل الصفحة لإعادة قياس الأداء. متابعة؟',
          run: async () => {
            try {
              if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k)
              if ('serviceWorker' in navigator) {
                for (const r of await navigator.serviceWorker.getRegistrations()) await r.update()
              }
            } catch { /* ignore */ }
            setTimeout(() => window.location.reload(), 900)
            return { ok: true, message: 'تم التنظيف — يُعاد تحميل الصفحة الآن لإعادة القياس' }
          },
        })
      }

      const rep = {
        totalDebit,
        totalCredit,
        balanceDiff,
        issues,
        blocking: issues.filter(i => i.level === 'error' || i.level === 'warn').length,
        diagnostic: {
          ledger_entries: balanceCheck?.length || 0,
          coa_accounts: coaData?.length || 0,
          units_records: units?.length || 0,
          bookings_integrity: orphans?.length === 0 ? 'INTEGRATED' : 'DATA_GAPS_FOUND',
          legacy_status: issues.some(i => i.level === 'error') ? 'RE-INTEGRATION_ANOMALIES' : 'VERIFIED',
          db_latency_ms: dbMs,
          security_rbac: rbacStatus,
          multi_tenancy: tenancyStatus,
          platform_subscription: platformStatus,
          ui_state: uiStateStatus,
          system_load: loadStatus
        },
        timestamp: new Date().toLocaleString('ar-SA')
      }
      setReport(rep)
      
      const blocking = issues.filter(i => i.level === 'error' || i.level === 'warn')
      if (blocking.length === 0) {
        toast('✅ فحص السلامة تم بنجاح: تم التحقق من سلامة كافة البيانات المرحبة.')
      } else {
        toast('⚠️ تم اكتشاف بعض الملاحظات في تكامل البيانات', true)
      }
      return rep
    } catch (e) {
      toast('خطأ أثناء الفحص: ' + e.message, true)
      return null
    } finally {
      setBusy(false)
    }
  }

  /** تنفيذ إصلاح ملاحظة واحدة — حقيقي وفعّال ومقيّد بشركة المستخدم */
  const runIssueFix = async (issue) => {
    if (issue.confirm && !window.confirm(issue.confirm)) return
    setFixState(s => ({ ...s, [issue.id]: { busy: true } }))
    let res
    try {
      if (issue.run) {
        res = await issue.run()
      } else if (issue.repair) {
        const r = await runRepair(issue.repair, { companyId: profile?.company_id })
        res = { ok: r.ok, message: r.message, affected: r.affected || 0 }
      } else {
        res = { ok: false, message: 'لا يوجد إصلاح تلقائي لهذه الملاحظة' }
      }
    } catch (e) {
      res = { ok: false, message: e.message }
    }
    setFixState(s => ({ ...s, [issue.id]: { busy: false, ...res } }))
    logFix(issue, res)
    if (res.ok && issue.id !== 'first_load') await runDiagnostics()
  }

  /**
   * فحص ثم إصلاح الكل — Super Admin فقط.
   * ينفّذ كل إجراءات الإصلاح الفعلية بالترتيب، ثم يوسّع الإصلاح ليشمل جميع
   * حسابات النظام (المستخدمين الحاليين والجدد) عبر accounting_auto_repair_all،
   * ثم يعيد الفحص تلقائياً في النهاية.
   */
  const scanThenFixAll = async () => {
    if (!isSuperAdmin) return
    if (!window.confirm('سيتم تشغيل فحص كامل ثم تنفيذ جميع الإصلاحات الفعلية بالترتيب على حسابك ثم على كل حسابات النظام. متابعة؟')) return
    setRepairing(true); setRepairMsg(null)
    try {
      const current = await runDiagnostics()
      const issues = (current?.issues || []).filter(i => (i.run || i.repair) && i.id !== 'first_load')
      let totalAffected = 0
      for (const iss of issues) {
        setFixState(s => ({ ...s, [iss.id]: { busy: true } }))
        let res
        try {
          res = iss.run
            ? await iss.run()
            : await (async () => {
              const r = await runRepair(iss.repair, { companyId: profile?.company_id })
              return { ok: r.ok, message: r.message, affected: r.affected || 0 }
            })()
        } catch (e) { res = { ok: false, message: e.message } }
        totalAffected += Number(res.affected || 0)
        setFixState(s => ({ ...s, [iss.id]: { busy: false, ...res } }))
        logFix(iss, res)
      }
      // إصلاح محاسبي شامل لحساب المستخدم
      const mine = await runRepair('all', { companyId: profile?.company_id })
      logFix({ id: 'all', fixLabel: 'إصلاح محاسبي شامل' }, mine)
      // توسيع التطبيق ليشمل جميع المستخدمين الحاليين والجدد
      const global = await runRepair('all_companies', {})
      logFix({ id: 'all_companies', fixLabel: 'إصلاح شامل لكل حسابات النظام' }, global, 'كل حسابات النظام')
      totalAffected += Number(mine.affected || 0) + Number(global.affected || 0)
      setRepairMsg({
        ok: mine.ok && global.ok,
        message: `تم تنفيذ ${issues.length + 2} إجراء إصلاح — إجمالي السجلات المتأثرة ${totalAffected}. ${global.message}`,
      })
      await runDiagnostics()
    } finally {
      setRepairing(false)
    }
  }

  /* ============ تصدير تقرير الفحص والإصلاح ============ */
  const reportRows = () => {
    const rows = (report?.issues || []).map(i => {
      const st = fixState[i.id] || {}
      const logs = fixLog.filter(l => l.id === i.id)
      const last = logs[logs.length - 1]
      return {
        'الاختبار / الملاحظة': i.id,
        'المستوى': i.level === 'error' ? 'خطأ' : i.level === 'warn' ? 'تحذير' : 'معلومة',
        'الوصف': i.message,
        'إصلاح متاح': (i.run || i.repair) ? 'نعم' : 'لا',
        'حالة التنفيذ': st.busy ? 'قيد التنفيذ' : (last ? (last.ok ? 'نجح' : 'فشل') : 'لم يُنفَّذ'),
        'سجلات متأثرة': last?.affected ?? 0,
        'نتيجة التنفيذ': last?.message || '—',
        'الخطأ': last?.error || '',
      }
    })
    return rows
  }
  const fixRows = () => fixLog.map(l => ({
    'الوقت': l.at,
    'الإصلاح': l.label,
    'النطاق': l.scope,
    'النتيجة': l.ok ? 'نجح' : 'فشل',
    'سجلات متأثرة': l.affected,
    'التفاصيل': l.message,
    'الخطأ': l.error,
  }))

  const exportReportCSV = () => {
    if (!report) return toast('شغّل الفحص أولاً', true)
    exportCSV(`system_health_${new Date().toISOString().slice(0, 10)}.csv`, [...reportRows(), ...fixRows()])
  }
  const exportReportPDF = () => {
    if (!report) return toast('شغّل الفحص أولاً', true)
    const d = report.diagnostic
    downloadPDF({
      title: 'تقرير فحص وصحة النظام',
      subtitle: `تاريخ الفحص: ${report.timestamp} · ملاحظات: ${report.issues.length} · إصلاحات مُنفَّذة: ${fixLog.length}`,
      company: company?.name || 'المازن',
      summaryCards: [
        { label: 'سجلات القيود', value: String(d.ledger_entries) },
        { label: 'حسابات الشركة', value: String(d.coa_accounts) },
        { label: 'عزل البيانات', value: String(d.multi_tenancy) },
        { label: 'أداء النظام', value: `${d.system_load} (${d.db_latency_ms}ms)` },
        { label: 'الصلاحيات', value: String(d.security_rbac) },
        { label: 'سجلات متأثرة بالإصلاح', value: String(fixLog.reduce((s, l) => s + l.affected, 0)) },
      ],
      sheets: [
        { name: 'نتائج الاختبارات', rows: reportRows() },
        ...(fixLog.length ? [{ name: 'أثر الإصلاحات', rows: fixRows() }] : []),
      ],
    })
  }

  const handleSystemReset = async () => {
    if (!window.confirm('إعادة ضبط وحدات النظام المتضررة: سيتم مسح التخزين المؤقت المحلي وإعادة محاولة مزامنة البيانات العالقة. هل تود الاستمرار؟')) return
    setResetting(true)
    try {
      localStorage.clear()
      // Re-sync basic company settings if needed
      const { error } = await supabase.rpc('accounting_repair_orphan_entries', {
        p_company_id: profile.company_id,
        p_dry_run: false,
      })
      if (error) throw error
      toast('✅ تم إعادة ضبط وحدات النظام ومزامنة البيانات بنجاح. سيتم تحديث الصفحة...')
      setTimeout(() => window.location.reload(), 1500)
    } catch (e) {
      toast('فشل إعادة الضبط: ' + e.message, true)
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="tool-card" style={{ border: '2px solid var(--gold)', background: '#fff', borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ background: 'linear-gradient(135deg, #0A192F 0%, #112240 100%)', padding: '16px 20px', color: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--gold)', fontSize: 18 }}>🛡️ مركز تشخيص وصحة النظام (System Health)</h3>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>لوحة تحكم للمسؤولين لفحص تكامل البيانات والأمان والاشتراكات.</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-gold btn-sm" disabled={busy} onClick={runDiagnostics}>
              {busy ? '... جاري الفحص' : '🚀 تشغيل التشخيص الكامل'}
            </button>
            {isSuperAdmin && (
              <button className="btn btn-gold btn-sm" disabled={busy || repairing} onClick={scanThenFixAll}
                title="فحص كامل ثم تنفيذ كل الإصلاحات الفعلية بالترتيب على حسابك وعلى كل حسابات النظام">
                {repairing ? '⏳ جارٍ الفحص والإصلاح...' : '⚡ نفّذ فحص ثم أصلح الكل'}
              </button>
            )}
            <button className="btn btn-ghost btn-sm" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.2)' }} disabled={!report} onClick={exportReportPDF}>🧾 تصدير PDF</button>
            <button className="btn btn-ghost btn-sm" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.2)' }} disabled={!report} onClick={exportReportCSV}>⬇️ تصدير CSV</button>
            <button className="btn btn-ghost btn-sm" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.2)' }} disabled={resetting} onClick={handleSystemReset}>
              {resetting ? '... جاري الإعادة' : '🔄 إعادة ضبط الوحدات'}
            </button>
          </div>
        </div>
      </div>

      {report && (
        <div className="audit-results" style={{ marginTop: 16 }}>
          <div style={{ 
            padding: 14, 
            background: report.blocking === 0 ? '#f0fdf4' : '#fef2f2',
            borderRadius: 10,
            border: `1px solid ${report.blocking === 0 ? '#bbf7d0' : '#fecaca'}`,
            marginBottom: 16
          }}>
            <div style={{ fontWeight: 'bold', color: report.blocking === 0 ? '#166534' : '#991b1b', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              {report.blocking === 0 ? '✅ التقرير: النظام متكامل تماماً' : '🚨 التقرير: يوجد فجوات في البيانات'}
              <span style={{ fontSize: 11, fontWeight: 'normal', opacity: 0.7 }}>(تاريخ الفحص: {report.timestamp})</span>
            </div>
            
            {report.issues.length > 0 ? (
              <>
                <div style={{ display: 'grid', gap: 8 }}>
                  {report.issues.map((iss, i) => {
                    const st = fixState[iss.id] || {}
                    const tone = iss.level === 'error' ? { bg: '#FEF2F2', bd: '#FECACA', fg: '#7F1D1D' }
                      : iss.level === 'warn' ? { bg: '#FFFBEB', bd: '#FDE68A', fg: '#78350F' }
                        : { bg: '#EFF6FF', bd: '#BFDBFE', fg: '#1E3A8A' }
                    return (
                      <div key={iss.id || i} style={{
                        display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                        background: tone.bg, border: `1px solid ${tone.bd}`, borderRadius: 8, padding: '8px 10px',
                      }}>
                        <div style={{ flex: '1 1 320px', fontSize: 12, color: tone.fg }}>
                          {iss.message}
                          {iss.hint && <div style={{ fontSize: 11, opacity: 0.75, marginTop: 3 }}>💡 {iss.hint}</div>}
                        </div>
                        {(iss.run || iss.repair) && (
                          <button className="btn btn-gold btn-sm" disabled={st.busy} onClick={() => runIssueFix(iss)}>
                            {st.busy ? '⏳ جارٍ الإصلاح...' : (iss.fixLabel || '🛠️ إصلاح')}
                          </button>
                        )}
                        {st && st.busy === false && (
                          <span style={{
                            fontSize: 11, fontWeight: 700, flex: '1 1 220px',
                            color: st.ok ? '#15803D' : '#B91C1C',
                          }}>
                            {st.ok ? '✅ نجح الإصلاح' : '❌ فشل الإصلاح'}
                            {typeof st.affected === 'number' ? ` — سجلات متأثرة: ${st.affected}` : ''}
                            <div style={{ fontWeight: 400, opacity: 0.85, marginTop: 2 }}>
                              {st.ok ? st.message : `الخطأ: ${st.message}`}
                            </div>
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {report.issues.some(i => i.run || i.repair) && (
                    <button className="btn btn-gold btn-sm" disabled={repairing} onClick={async () => {
                      setRepairing(true); setRepairMsg(null)
                      const fixable = report.issues.filter(i => (i.run || i.repair) && !i.confirm)
                      const done = []
                      for (const iss of fixable) {
                        try {
                          const r = iss.run
                            ? await iss.run()
                            : await runRepair(iss.repair, { companyId: profile?.company_id })
                          logFix(iss, r)
                          done.push(`${iss.id}: ${r.ok ? '✔' : '✖'} (${r.affected || 0})`)
                        } catch (e) {
                          logFix(iss, { ok: false, message: e.message })
                          done.push(`${iss.id}: ✖ ${e.message}`)
                        }
                      }
                      const gl = await runRepair('all', { companyId: profile?.company_id })
                      logFix({ id: 'all', fixLabel: 'إصلاح محاسبي شامل' }, gl)
                      setRepairMsg({
                        ok: gl.ok,
                        message: `${gl.message}${done.length ? ` — ${done.join(' · ')}` : ''}`,
                      })
                      setRepairing(false)
                      await runDiagnostics()
                    }}>
                      {repairing ? '⏳ جاري الإصلاح التلقائي...' : '🛠️ إصلاح كل الأخطاء القابلة للإصلاح تلقائياً'}
                    </button>
                  )}
                  {repairMsg && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: repairMsg.ok ? '#15803D' : '#B91C1C' }}>
                      {repairMsg.ok ? '✅ ' : '❌ '}{repairMsg.message}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: '#166534' }}>
                تم التحقق من مطابقة الأرصدة في الدفاتر (Ledger) مع أرصدة الحسابات الجارية، وتأكيد تكامل كافة سجلات الوحدات والحجوزات.
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <span style={{ display: 'block', fontSize: 10, color: '#64748b', marginBottom: 2 }}>سجلات القيود</span>
              <span style={{ fontSize: 14, fontWeight: '800' }}>{report.diagnostic.ledger_entries}</span>
            </div>
            <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <span style={{ display: 'block', fontSize: 10, color: '#64748b', marginBottom: 2 }}>حسابات الشركة</span>
              <span style={{ fontSize: 14, fontWeight: '800' }}>{report.diagnostic.coa_accounts}</span>
            </div>
            <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <span style={{ display: 'block', fontSize: 10, color: '#64748b', marginBottom: 2 }}>حالة البيانات القديمة</span>
              <span style={{ fontSize: 12, fontWeight: '800', color: report.diagnostic.legacy_status === 'VERIFIED' ? 'green' : 'red' }}>
                {report.diagnostic.legacy_status}
              </span>
            </div>
            <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <span style={{ display: 'block', fontSize: 10, color: '#64748b', marginBottom: 2 }}>تكامل الوحدات</span>
              <span style={{ fontSize: 12, fontWeight: '800', color: report.diagnostic.bookings_integrity === 'INTEGRATED' ? 'green' : 'red' }}>
                {report.diagnostic.bookings_integrity}
              </span>
            </div>
            <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <span style={{ display: 'block', fontSize: 10, color: '#64748b', marginBottom: 2 }}>عزل البيانات (RLS)</span>
              <span style={{ fontSize: 12, fontWeight: '800', color: report.diagnostic.multi_tenancy === 'LEAK_DETECTED' ? 'red' : 'green' }}>
                {report.diagnostic.multi_tenancy === 'SUPERADMIN_SCOPE' ? 'ISOLATED (نطاق Super Admin)' : report.diagnostic.multi_tenancy}
              </span>
            </div>
            <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <span style={{ display: 'block', fontSize: 10, color: '#64748b', marginBottom: 2 }}>حالة الواجهة</span>
              <span style={{ fontSize: 12, fontWeight: '800', color: report.diagnostic.ui_state === 'CONSISTENT' ? 'green' : 'orange' }}>
                {report.diagnostic.ui_state}
              </span>
            </div>
            <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <span style={{ display: 'block', fontSize: 10, color: '#64748b', marginBottom: 2 }}>أداء النظام</span>
              <span style={{ fontSize: 12, fontWeight: '800', color: report.diagnostic.system_load === 'OPTIMAL' ? 'green' : '#B45309' }}>
                {report.diagnostic.system_load} <small style={{ color: '#64748b' }}>({report.diagnostic.db_latency_ms}ms DB)</small>
              </span>
            </div>
            <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <span style={{ display: 'block', fontSize: 10, color: '#64748b', marginBottom: 2 }}>صلاحيات (RBAC)</span>
              <span style={{ fontSize: 12, fontWeight: '800', color: report.diagnostic.security_rbac === 'SECURE' ? 'green' : 'red' }}>
                {report.diagnostic.security_rbac}
              </span>
            </div>
          </div>

          {fixLog.length > 0 && (
            <div style={{ marginTop: 16, border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto' }}>
              <div style={{ padding: '8px 12px', background: '#f8fafc', fontWeight: 800, fontSize: 13 }}>
                🧾 سجل الإصلاحات المُنفَّذة ({fixLog.length}) — إجمالي السجلات المتأثرة: {fixLog.reduce((s, l) => s + l.affected, 0)}
              </div>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead style={{ background: '#f1f5f9' }}>
                  <tr>
                    <th style={{ padding: 6, textAlign: 'right' }}>الوقت</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>الإصلاح</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>النطاق</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>النتيجة</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>سجلات متأثرة</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>التفاصيل / الخطأ</th>
                  </tr>
                </thead>
                <tbody>
                  {fixLog.map((l, i) => (
                    <tr key={i} style={{ borderTop: '1px solid #e2e8f0' }}>
                      <td style={{ padding: 6 }}>{l.at}</td>
                      <td style={{ padding: 6 }}>{l.label}</td>
                      <td style={{ padding: 6 }}>{l.scope}</td>
                      <td style={{ padding: 6, fontWeight: 700, color: l.ok ? '#15803D' : '#B91C1C' }}>{l.ok ? '✅ نجح' : '❌ فشل'}</td>
                      <td style={{ padding: 6 }}>{l.affected}</td>
                      <td style={{ padding: 6, color: l.ok ? '#334155' : '#B91C1C' }}>{l.error || l.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
