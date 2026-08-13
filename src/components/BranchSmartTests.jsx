/**
 * BranchSmartTests — سيناريوهات الاختبار الذكي لنظام الفروع
 * ------------------------------------------------------------------
 * يظهر التبويب فقط لحسابات super admin.
 * السيناريوهات المغطاة:
 *   1) قراءة: الفروع مقروءة ضمن نطاق المنشأة
 *   2) كتابة: إنشاء/حذف فرع تجريبي (دورة كتابة كاملة)
 *   3) خرق RLS — كتابة عبر شركة أخرى (حالة فشل متوقعة: يجب أن تُرفض)
 *   4) خرق RLS — قراءة فروع خارج نطاق المستخدم (يجب أن تكون صفراً)
 *   5) خرق RLS — إسناد مستخدم لفرع غير مصرّح (حالة فشل متوقعة)
 *   6) ربط القيود بالمصدر حسب الفرع (settlement ↔ booking.branch_id)
 *   7) روابط فروع يتيمة (branch_id يشير لفرع محذوف)
 *   8) بوابة الميزة: has_feature('branches') تعمل لكل مستخدم على حدة
 * ويوفّر أزرار إصلاح مباشرة (تعبئة الفروع من المصدر، وتنظيف الروابط اليتيمة)
 * تُطبَّق شاملةً على جميع الحسابات الحالية والجديدة.
 */
import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../AuthContext'
import { useBranches } from '../BranchContext'
import BranchFilter from './BranchFilter'

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

export default function BranchSmartTests() {
  const { profile, isSuperAdmin, toast } = useAuth()
  const { enabled, activeBranch, reload } = useBranches()
  const [running, setRunning] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [results, setResults] = useState([])

  if (!isSuperAdmin) {
    return <div className="panel"><p>🔒 اختبارات الفروع متاحة لحسابات super admin فقط.</p></div>
  }

  const run = async () => {
    setRunning(true)
    const out = []
    const push = (name, ok, detail, expectFail = false) =>
      out.push({ name, ok, detail, expectFail })
    const companyId = profile?.company_id

    try {
      // 1) قراءة الفروع
      // هذه اللوحة لا تُتاح إلا لسوبر أدمن، وسياسة branches تنص على
      // (company_id = get_my_company_id() OR is_super_admin()) — فرؤيته لفروع
      // كل المنشآت مقصودة بالتصميم. عدّ «الصفوف خارج المنشأة» هنا يُنتج
      // فشلاً دائماً للدور الوحيد المسموح له بالتشغيل، وهو إنذار كاذب.
      try {
        const { data, error } = await supabase.from('branches').select('id, name, company_id')
        if (error) throw error
        const foreign = (data || []).filter(b => companyId && b.company_id !== companyId)
        push('قراءة الفروع ضمن نطاق المنشأة', 'na',
          `مقروء: ${data?.length ?? 0} فرع (منها ${foreign.length} خارج منشأتك). لا يُقاس من جلسة سوبر أدمن: السياسة تمنحه رؤية كل المنشآت عمداً — اعتمد «اختبار عزل الحسابات» بحساب عادي.`)
      } catch (e) { push('قراءة الفروع ضمن نطاق المنشأة', false, e.message) }

      // 2) دورة كتابة كاملة (إنشاء ثم حذف)
      let tempId = null
      try {
        const code = 'CI-' + Math.random().toString(36).slice(2, 7).toUpperCase()
        const { data, error } = await supabase.from('branches')
          .insert({ company_id: companyId, name: 'فرع اختبار CI', code }).select('id').single()
        if (error) throw error
        tempId = data.id
        push('كتابة: إنشاء فرع تجريبي', true, 'أُنشئ الفرع ' + code)
      } catch (e) { push('كتابة: إنشاء فرع تجريبي', false, e.message) }

      // 3) خرق RLS — كتابة تحت شركة أخرى (يجب أن تفشل)
      try {
        const { error } = await supabase.from('branches')
          .insert({ company_id: ZERO_UUID, name: 'RLS breach attempt' }).select('id').single()
        push('خرق RLS: كتابة فرع لشركة أخرى (فشل متوقع)', !!error,
          error ? 'رُفضت كما هو متوقع: ' + error.code : '⚠️ نجحت الكتابة — ثغرة!', true)
      } catch (e) { push('خرق RLS: كتابة فرع لشركة أخرى (فشل متوقع)', true, 'رُفضت: ' + e.message, true) }

      // 4) خرق RLS — قراءة صفوف خارج فروع المستخدم
      try {
        const { data, error } = await supabase.rpc('ci_check_branch_rls')
        if (error) throw error
        const leaked = data?.leaked_rows ?? 0
        push('خرق RLS: تسرّب صفوف من فروع غير مصرّحة', leaked === 0,
          data?.unscoped_user
            ? 'المستخدم غير مقيّد بفرع (يرى منشأته كاملة) — لا ينطبق'
            : `صفوف مسرّبة: ${leaked} عبر ${data?.tables_scanned ?? 0} جدول`)
      } catch (e) { push('خرق RLS: تسرّب صفوف من فروع غير مصرّحة', false, e.message) }

      // 5) خرق RLS — إسناد مستخدم لفرع غير موجود/غير مصرّح (يجب أن تفشل)
      try {
        const { error } = await supabase.from('user_branches')
          .insert({ user_id: ZERO_UUID, branch_id: ZERO_UUID })
        push('خرق RLS: إسناد مستخدم لفرع غير مصرّح (فشل متوقع)', !!error,
          error ? 'رُفض كما هو متوقع: ' + error.code : '⚠️ نجح الإسناد — ثغرة!', true)
      } catch (e) { push('خرق RLS: إسناد مستخدم لفرع غير مصرّح (فشل متوقع)', true, 'رُفض: ' + e.message, true) }

      // 6) ربط القيود بالمصدر حسب الفرع
      try {
        const { data, error } = await supabase.rpc('ci_check_branch_source_link')
        if (error) throw error
        const bad = (data?.branch_mismatch ?? 0) + (data?.missing_branch_link ?? 0)
        push('ربط القيود بالمصدر حسب الفرع', bad === 0,
          `عدم تطابق: ${data?.branch_mismatch ?? 0}، قيود بلا فرع رغم وجوده بالمصدر: ${data?.missing_branch_link ?? 0}`)
        push('روابط فروع يتيمة (فرع محذوف)', (data?.orphan_branch_links ?? 0) === 0,
          `روابط يتيمة: ${data?.orphan_branch_links ?? 0}`)
      } catch (e) { push('ربط القيود بالمصدر حسب الفرع', false, e.message) }

      // 7) الفحص الجاهز في قاعدة البيانات لسلامة روابط الفروع
      try {
        const { data, error } = await supabase.rpc('ci_check_branch_link_integrity')
        if (error) throw error
        const txt = typeof data === 'object' ? JSON.stringify(data) : String(data)
        const ok = !/"?(broken|invalid|orphan)[^:]*"?:\s*[1-9]/.test(txt)
        push('سلامة روابط الفروع (فحص قاعدة البيانات)', ok, txt.slice(0, 240))
      } catch (e) { push('سلامة روابط الفروع (فحص قاعدة البيانات)', false, e.message) }

      // 8) بوابة الميزة لكل مستخدم
      try {
        const { data, error } = await supabase.rpc('has_feature', { _feature: 'branches' })
        if (error) throw error
        push('بوابة الميزة has_feature(branches)', data === true,
          data === true ? 'الميزة مفعّلة لهذا الحساب' : 'الميزة غير مفعّلة — يجب تفعيلها من (الإعدادات ← التحكم بالميزات)')
      } catch (e) { push('بوابة الميزة has_feature(branches)', false, e.message) }

      // 9) الفلتر النشط لا يُظهر بيانات فروع أخرى
      if (activeBranch) {
        try {
          const { data, error } = await supabase.from('units')
            .select('id, branch_id').eq('branch_id', activeBranch).limit(200)
          if (error) throw error
          const bad = (data || []).filter(r => r.branch_id !== activeBranch).length
          push('فلتر الفرع النشط يعيد بيانات الفرع فقط', bad === 0,
            `وحدات: ${data?.length ?? 0}، مخالفة: ${bad}`)
        } catch (e) { push('فلتر الفرع النشط يعيد بيانات الفرع فقط', false, e.message) }
      }

      // تنظيف الفرع التجريبي
      if (tempId) {
        const { error } = await supabase.from('branches').delete().eq('id', tempId)
        push('كتابة: حذف الفرع التجريبي (تنظيف)', !error, error ? error.message : 'تم الحذف')
      }
    } finally {
      setResults(out)
      setRunning(false)
      reload()
    }
  }

  const applyFixes = async () => {
    setFixing(true)
    try {
      const [{ data: back, error: e1 }, { data: orph, error: e2 }, { data: boot, error: e3 }] = await Promise.all([
        supabase.rpc('ci_fix_branch_backfill'),
        supabase.rpc('ci_fix_branch_orphan_links'),
        supabase.rpc('ci_fix_branch_feature_bootstrap'),
      ])
      const err = e1 || e2 || e3
      if (err) throw err
      toast(`✓ الإصلاح الشامل: تعبئة ${back ?? 0} سجل، تنظيف ${orph ?? 0} رابط يتيم، تهيئة الميزة ${typeof boot === 'number' ? boot : ''}`)
      await run()
    } catch (e) {
      toast('تعذّر الإصلاح: ' + (e.message || e), true)
    } finally { setFixing(false) }
  }

  const passed = results.filter(r => r.ok === true).length
  const naCount = results.filter(r => r.ok === 'na').length
  const scored = results.length - naCount

  return (
    <div className="panel" style={{ padding: 18 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>🏢 اختبارات نظام الفروع الذكية</h3>
        <BranchFilter label="نطاق الاختبار" />
        <button className="btn btn-gold btn-sm" onClick={run} disabled={running}>
          {running ? '⏳ جارٍ التشغيل…' : '▶ تشغيل السيناريوهات'}
        </button>
        <button className="btn btn-sm" onClick={applyFixes} disabled={fixing || running}>
          {fixing ? '⏳ جارٍ الإصلاح…' : '🛠️ تطبيق الإصلاحات الشاملة'}
        </button>
        {results.length > 0 && (
          <span style={{ fontSize: 13 }}>
            النتيجة: <b>{passed}/{scored}</b> ناجح{naCount > 0 && <> · <b>{naCount}</b> غير قابل للقياس</>}
          </span>
        )}
      </div>

      {!enabled && (
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
          ملاحظة: ميزة الفروع غير مفعّلة لهذا الحساب — بعض السيناريوهات ستفشل عمداً حتى يتم التفعيل.
        </p>
      )}

      {results.length === 0 && !running && (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          يغطي: القراءة والكتابة، محاولات خرق RLS (حالات فشل متوقعة)، ربط القيود بالمصدر حسب الفرع،
          الروابط اليتيمة، وبوابة تفعيل الميزة لكل مستخدم.
        </p>
      )}

      {results.map((r, i) => (
        <div key={i} style={{
          display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px',
          borderInlineStart: '3px solid ' + (r.ok === 'na' ? '#d97706' : r.ok ? '#16a34a' : '#dc2626'),
          background: 'var(--card2, rgba(127,127,127,.06))', borderRadius: 6, marginBottom: 6,
        }}>
          <span>{r.ok === 'na' ? 'ℹ️' : r.ok ? '✅' : '❌'}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              {r.name} {r.expectFail && <span style={{ fontSize: 11, opacity: .7 }}>(حالة فشل متوقعة)</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.detail}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
