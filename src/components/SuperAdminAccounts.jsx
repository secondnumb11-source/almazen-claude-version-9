import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../AuthContext';
import IsolationMonitorAdmin from './admin/IsolationMonitorAdmin';

/** تحويل تاريخ ISO إلى صيغة حقل <input type="date"> */
const toInputDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('ar-SA') : '—');

/** الأيام المتبقية على انتهاء الاشتراك (سالب = منتهٍ) */
const daysLeft = (iso) => {
  if (!iso) return null;
  return Math.ceil((new Date(iso) - new Date()) / 86400000);
};

export default function SuperAdminAccounts() {
  const { isSuperAdmin, toast } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // تاريخ انتهاء مخصص لكل شركة (تقويم) — { [companyId]: 'YYYY-MM-DD' }
  const [dates, setDates] = useState({});

  useEffect(() => {
    if (isSuperAdmin) {
      loadCompanies();
    } else {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  const loadCompanies = async () => {
    setLoading(true);
    let { data, error } = await supabase.rpc('super_admin_get_all_companies');
    if (error || !data) {
      const res = await supabase.from('companies').select('*, profiles(*)').order('created_at', { ascending: false });
      if (res.data) {
        data = res.data.map(c => {
          const ownerProfile = c.profiles?.find(p => p.role === 'owner') || c.profiles?.[0];
          const resolvedEmail = c.email || ownerProfile?.email || (ownerProfile?.username ? `${ownerProfile.username}@almazen.sa` : null) || '—';
          return { ...c, email: resolvedEmail };
        });
        error = null;
      }
    } else {
      data = data.map(c => ({ ...c, email: c.email && c.email !== '—' ? c.email : '—' }));
    }
    if (error) {
      toast('خطأ في جلب الحسابات: ' + error.message, true);
    } else {
      const rows = data || [];
      setCompanies(rows);
      setDates(Object.fromEntries(rows.map(c => [c.id, toInputDate(c.subscription_ends_at)])));
    }
    setLoading(false);
  };

  /**
   * كل إجراءات الاشتراك تمر عبر RPC واحد يضمن اتساق البيانات:
   * تاريخ البداية، تاريخ الانتهاء، حالة الاشتراك، وإزالة عدّاد التجربة عند التفعيل.
   */
  const runAction = async (company, action, opts = {}) => {
    setBusy(true);
    const { error } = await supabase.rpc('super_admin_set_subscription', {
      p_company_id: company.id,
      p_action: action,
      p_months: opts.months ?? null,
      p_ends_at: opts.endsAt ?? null,
      p_reason: opts.reason ?? null,
    });
    setBusy(false);
    if (error) {
      toast('تعذّر تنفيذ العملية: ' + error.message, true);
      return false;
    }
    toast(opts.successMessage || '✓ تم تحديث الاشتراك بنجاح');
    await loadCompanies();
    return true;
  };

  const renew = (c, months, label) =>
    runAction(c, 'renew', { months, successMessage: `✓ تم تجديد اشتراك "${c.name || ''}" ${label}` });

  const setExactDate = (c) => {
    const val = dates[c.id];
    if (!val) return toast('اختر تاريخ انتهاء أولاً من التقويم', true);
    const endsAt = new Date(`${val}T23:59:59`).toISOString();
    runAction(c, 'set_date', { endsAt, successMessage: `✓ تم ضبط انتهاء الاشتراك في ${fmt(endsAt)}` });
  };

  const pauseAccount = (c) => {
    if (!confirm(`إيقاف حساب "${c.name || ''}" مؤقتاً؟\nسيفقد الوصول حتى يُستأنف، وتُعوَّض مدة الإيقاف عند الاستئناف.`)) return;
    const reason = prompt('سبب الإيقاف (اختياري):') || null;
    runAction(c, 'pause', { reason, successMessage: `⏸️ أُوقف حساب "${c.name || ''}" مؤقتاً` });
  };

  const resumeAccount = (c) =>
    runAction(c, 'resume', { successMessage: `▶️ استُؤنف حساب "${c.name || ''}" مع تعويض مدة الإيقاف` });

  // إلغاء التجربة أو التمديد — يحوّل الحساب لصفحة انتهاء الاشتراك
  const cancelSubscription = async (c) => {
    if (!confirm(
      `إلغاء اشتراك "${c.name || ''}"؟\n\n` +
      'سيفقد الحساب الوصول فوراً وتظهر له صفحة انتهاء الاشتراك ' +
      'مع خيارَي السداد أو التواصل مع خدمة العملاء.'
    )) return;
    const reason = prompt('سبب الإلغاء (اختياري):') || null;
    setBusy(true);
    const { error } = await supabase.rpc('super_admin_cancel_subscription', {
      p_company_id: c.id,
      p_reason: reason,
    });
    setBusy(false);
    if (error) toast('تعذّر الإلغاء: ' + error.message, true);
    else {
      toast(`تم إلغاء اشتراك "${c.name || ''}" — أصبح الحساب على صفحة انتهاء الاشتراك`);
      loadCompanies();
    }
  };

  /**
   * مزامنة شاملة فورية لكل الحسابات (حالية وجديدة):
   * إغلاق تذاكر الصيانة المعلّقة والمكرّرة وإعادة ضبط عرض حالة الوحدات.
   * تُنفَّذ عبر RPC محمي بـ is_super_admin في قاعدة البيانات.
   */
  const runGlobalSync = async () => {
    setSyncing(true);
    const { data, error } = await supabase.rpc('super_admin_global_sync');
    setSyncing(false);
    if (error) { toast('تعذّرت المزامنة: ' + error.message, true); return; }
    const stale = data?.stale_closed ?? 0;
    const dupes = data?.duplicates_closed ?? 0;
    toast(`✓ تمت المزامنة الشاملة — تذاكر معلّقة: ${stale} • مكرّرة: ${dupes}`);
    loadCompanies();
  };

  if (!isSuperAdmin) {
    return <div style={{ padding: 20 }}>غير مصرح لك بالوصول لهذه الصفحة.</div>;
  }

  const btn = { padding: '4px 8px', fontSize: 11 };

  return (
    <div className="panel" style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', padding: 20, borderRadius: 12 }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 16px', color: 'var(--gold-l)' }}>
        👑 قائمة الحسابات المسجلة (Super Admin)
      </h3>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>
        تحكّم كامل في مدة الاشتراك: تمديد التجربة، التجديد لسنة أو سنتين أو ثلاث أو غير محدود،
        تحديد تاريخ انتهاء يدوي من التقويم، والإيقاف المؤقت للحساب. عند التجديد يختفي عدّاد التجربة
        من حساب العميل فوراً ويظهر تاريخ الاشتراك الصحيح في إعداداته.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <button className="btn btn-gold" disabled={syncing} onClick={runGlobalSync}>
          {syncing ? '...جارٍ التنفيذ' : '🔄 مزامنة شاملة الآن (كل الحسابات)'}
        </button>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
          تُغلق تذاكر الصيانة المعلّقة والمكرّرة لكل الحسابات الحالية والجديدة فوراً — وتعمل تلقائياً كل ساعة.
        </span>
      </div>


      {loading ? (
        <div>جاري تحميل الحسابات...</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 1100 }}>
            <thead>
              <tr>
                <th>معرف الشركة</th>
                <th>اسم الشركة</th>
                <th>البريد الإلكتروني</th>
                <th>بداية الاشتراك</th>
                <th>الباقة / الحالة</th>
                <th>تاريخ الانتهاء</th>
                <th>المتبقي</th>
                <th>الإجراءات (تمديد / تجديد / إيقاف)</th>
              </tr>
            </thead>
            <tbody>
              {companies.map(c => {
                const left = daysLeft(c.subscription_ends_at || c.trial_ends_at);
                const paused = c.plan === 'suspended';
                return (
                  <tr key={c.id}>
                    <td style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{c.id.slice(0, 8)}</td>
                    <td style={{ fontWeight: 'bold' }}>{c.name || 'بدون اسم'}</td>
                    <td>{c.email || '—'}</td>
                    <td>{fmt(c.subscription_start || c.trial_started_at || c.created_at)}</td>
                    <td>
                      <span className="chip" style={{
                        background: c.plan === 'active' ? 'var(--green-soft)' : (paused ? 'var(--warn-soft)' : 'var(--blue-soft)'),
                        color: c.plan === 'active' ? 'var(--green)' : (paused ? 'var(--warn)' : 'var(--blue)')
                      }}>
                        {c.plan === 'active' ? 'نشط' : (c.plan === 'trial' ? 'تجربة' : (c.plan === 'expired' ? 'منتهي' : 'موقوف مؤقتاً'))}
                      </span>
                    </td>
                    <td>{c.subscription_ends_at ? fmt(c.subscription_ends_at) : (c.trial_ends_at ? fmt(c.trial_ends_at) : '—')}</td>
                    <td style={{ fontSize: 12, color: left != null && left <= 7 ? 'var(--warn)' : 'inherit' }}>
                      {left == null ? '—' : (left > 3650 ? 'غير محدود' : (left > 0 ? `${left} يوم` : 'منتهٍ'))}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button className="btn btn-outline btn-sm" style={btn} disabled={busy}
                          onClick={() => runAction(c, 'trial_extend', { months: 1, successMessage: '✓ مُدّدت الفترة التجريبية شهراً' })}>
                          تمديد التجربة شهر
                        </button>
                        <button className="btn btn-outline btn-sm" style={btn} disabled={busy} onClick={() => renew(c, 1, 'لمدة شهر')}>تجديد شهر</button>
                        <button className="btn btn-outline btn-sm" style={btn} disabled={busy} onClick={() => renew(c, 12, 'لمدة سنة')}>سنة</button>
                        <button className="btn btn-outline btn-sm" style={btn} disabled={busy} onClick={() => renew(c, 24, 'لمدة سنتين')}>سنتان</button>
                        <button className="btn btn-outline btn-sm" style={btn} disabled={busy} onClick={() => renew(c, 36, 'لمدة 3 سنوات')}>3 سنوات</button>
                        <button className="btn btn-gold btn-sm" style={btn} disabled={busy}
                          onClick={() => runAction(c, 'unlimited', { successMessage: '✓ اشتراك غير محدود' })}>غير محدود</button>

                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <input
                            type="date"
                            value={dates[c.id] || ''}
                            disabled={busy}
                            onChange={e => setDates(d => ({ ...d, [c.id]: e.target.value }))}
                            style={{ fontSize: 11, padding: '2px 4px' }}
                            title="اختيار تاريخ انتهاء الاشتراك يدوياً"
                          />
                          <button className="btn btn-blue btn-sm" style={btn} disabled={busy} onClick={() => setExactDate(c)}>
                            حفظ التاريخ
                          </button>
                        </span>

                        {paused ? (
                          <button className="btn btn-green btn-sm" style={btn} disabled={busy} onClick={() => resumeAccount(c)}>
                            ▶️ استئناف الحساب
                          </button>
                        ) : (
                          <button className="btn btn-sm" style={{ ...btn, background: 'var(--warn)', color: '#fff', border: 'none' }}
                            disabled={busy} onClick={() => pauseAccount(c)}>
                            ⏸️ إيقاف مؤقت
                          </button>
                        )}

                        {c.plan !== 'expired' && (
                          <button
                            className="btn btn-sm"
                            style={{ ...btn, background: 'var(--danger, #c0392b)', color: '#fff', border: 'none' }}
                            onClick={() => cancelSubscription(c)}
                            disabled={busy}
                            title="إلغاء التجربة أو التمديد وتحويل الحساب لصفحة انتهاء الاشتراك"
                          >
                            إلغاء التجربة/التمديد
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {companies.length === 0 && (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: 20 }}>لا توجد حسابات مسجلة</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* لوحة مراقب عزل الحسابات — Super Admin فقط */}
      <IsolationMonitorAdmin />
    </div>
  );
}
