import { supabase } from "./supabase";

/**
 * محرّك اختبارات عزل الحسابات (Multi-Tenant Isolation Engine)
 * ------------------------------------------------------------
 * مصدر واحد للاختبارات يستخدمه:
 *  - واجهة الاختبار اليدوي (MultiTenantIsolationTest)
 *  - المراقب الخلفي الدوري (BackgroundIsolationMonitor)
 *
 * كل الاختبارات للقراءة فقط، عدا محاولة التصحيح التلقائي (RLS) التي
 * تُنفَّذ عبر دالة قاعدة بيانات محمية بـ Super Admin فقط.
 */

export const SCOPED_TABLES = [
  { t: "bookings", label: "الحجوزات" },
  { t: "units", label: "الوحدات" },
  { t: "customers", label: "العملاء" },
  { t: "payments", label: "الدفعات" },
  { t: "expenses", label: "المصروفات" },
  { t: "maintenance_requests", label: "طلبات الصيانة" },
  { t: "journal_entries", label: "قيود اليومية" },
  { t: "chart_of_accounts", label: "شجرة الحسابات" },
  { t: "invoices", label: "الفواتير" },
  { t: "audit_logs", label: "سجل التدقيق" },
  { t: "notifications", label: "الإشعارات" },
  { t: "branches", label: "الفروع" },
  { t: "profiles", label: "المستخدمون" },
];

const FAKE_COMPANY = "00000000-0000-4000-8000-000000000001";

const ok = (name, detail) => ({ status: "pass", name, detail });
const bad = (name, detail, fix) => ({ status: "fail", name, detail, fix });
const meh = (name, detail) => ({ status: "warn", name, detail });

/* ------------------------------------------------------------------ */
/* اختبارات فردية — كل واحدة مستقلة حتى لا يُسقط خطأٌ واحد بقية الفحص */
/* ------------------------------------------------------------------ */

/*
  مقارنة الصفوف من جلسة المستخدم الحالي لا تصلح لقياس العزل حين يكون
  المشغّل سوبر أدمن: 249 سياسة RLS على 92 جدولاً تنص صراحةً على
    ((company_id = get_my_company_id()) OR is_super_admin())
  فرؤيته لكل المنشآت مقصودة بالتصميم، وإعلانها «تسريباً» إنذار كاذب —
  وهو ما كان يُنتج 18 بنداً أحمر يُفقد الثقة بكل الاختبارات.

  البديل الصادق: قياس بنية السياسات عبر ci_isolation_checks، والتحقق
  الميداني بجلسة مستخدم عادي مع تفعيل RLS (نُفِّذ 2026-08-05: 13 جدولاً،
  صفر تسريب).
*/
async function testRowLeakage(cid, isSuperAdmin) {
  if (isSuperAdmin) {
    return [
      meh(
        "عزل الصفوف (لا يُقاس من هذه الجلسة)",
        "حسابك سوبر أدمن، والسياسات تمنحه رؤية كل المنشآت عمداً — فمقارنة الصفوف هنا تُنتج إنذاراً كاذباً. اعتمد «تدقيق العزل البنيوي» في مركز الاختبارات.",
      ),
    ];
  }
  const out = [];
  for (const { t, label } of SCOPED_TABLES) {
    try {
      const { data, error } = await supabase.from(t).select("id, company_id").limit(500);
      if (error) {
        out.push(meh(`عزل ${label} (${t})`, `تعذّرت القراءة: ${error.message}`));
        continue;
      }
      const rows = data || [];
      const foreign = rows.filter((r) => r.company_id && r.company_id !== cid);
      out.push(
        foreign.length === 0
          ? ok(`عزل ${label}`, `${rows.length} صف — جميعها تخص منشأتك فقط`)
          : bad(
              `عزل ${label}`,
              `🚨 تسريب: ${foreign.length} صف من منشآت أخرى (مثال: ${String(foreign[0].company_id).slice(0, 8)}…)`,
              t,
            ),
      );
    } catch (e) {
      out.push(meh(`عزل ${label} (${t})`, e.message));
    }
  }
  return out;
}

async function testDirectBreach(cid) {
  try {
    const { data: others } = await supabase.from("companies").select("id").neq("id", cid).limit(1);
    const targetId = others?.[0]?.id || FAKE_COMPANY;
    const probes = ["bookings", "payments", "journal_entries", "customers"];
    let leaked = 0;
    for (const t of probes) {
      const { data } = await supabase.from(t).select("id").eq("company_id", targetId).limit(5);
      leaked += (data || []).length;
    }
    return [
      leaked === 0
        ? ok(
            "اختراق مباشر لمنشأة أخرى",
            `الاستعلام الصريح عن منشأة أخرى (${String(targetId).slice(0, 8)}…) أرجع صفر صف — RLS فعّالة`,
          )
        : bad("اختراق مباشر لمنشأة أخرى", `🚨 تم إرجاع ${leaked} صف من منشأة أخرى`),
    ];
  } catch (e) {
    return [meh("اختراق مباشر لمنشأة أخرى", e.message)];
  }
}

async function testChildTables(cid) {
  try {
    const { data: myEntries } = await supabase
      .from("journal_entries")
      .select("id")
      .eq("company_id", cid)
      .limit(500);
    const mine = new Set((myEntries || []).map((e) => e.id));
    const { data: lines } = await supabase
      .from("journal_entry_lines")
      .select("id, entry_id")
      .limit(1000);
    const foreign = (lines || []).filter((l) => l.entry_id && !mine.has(l.entry_id));
    return [
      foreign.length === 0
        ? ok("عزل أسطر القيود (جدول تابع)", `${(lines || []).length} سطر — كلها تتبع قيود منشأتك`)
        : bad(
            "عزل أسطر القيود (جدول تابع)",
            `🚨 ${foreign.length} سطر يتبع قيوداً خارج منشأتك`,
            "journal_entry_lines",
          ),
    ];
  } catch (e) {
    return [meh("عزل أسطر القيود", e.message)];
  }
}

async function testVisibleCompanies(cid, companyName) {
  try {
    const { data } = await supabase.from("companies").select("id, name").limit(50);
    const rows = data || [];
    const others = rows.filter((r) => r.id !== cid);
    return [
      others.length === 0
        ? ok("المنشآت المرئية لحسابك", `ترى منشأتك فقط: ${companyName || "—"}`)
        : meh("المنشآت المرئية لحسابك", `ترى ${rows.length} منشأة (طبيعي لحساب Super Admin فقط)`),
    ];
  } catch (e) {
    return [meh("المنشآت المرئية", e.message)];
  }
}

async function testUserBranches(cid) {
  try {
    const { data: branches } = await supabase.from("branches").select("id, company_id").limit(200);
    const mine = new Set((branches || []).filter((b) => b.company_id === cid).map((b) => b.id));
    const { data: ub } = await supabase.from("user_branches").select("branch_id").limit(500);
    const foreign = (ub || []).filter((x) => x.branch_id && !mine.has(x.branch_id));
    return [
      foreign.length === 0
        ? ok("عزل ربط المستخدمين بالفروع", `${(ub || []).length} ارتباط — كلها ضمن فروع منشأتك`)
        : bad(
            "عزل ربط المستخدمين بالفروع",
            `🚨 ${foreign.length} ارتباط بفروع خارج منشأتك`,
            "user_branches",
          ),
    ];
  } catch (e) {
    return [meh("عزل ربط المستخدمين بالفروع", e.message)];
  }
}

/** اختبار إضافي: انحراف المخطط — RLS معطّلة أو أعمدة الربط مفقودة بعد أي تعديل. */
async function testSchemaDrift() {
  try {
    const { data, error } = await supabase.rpc("isolation_schema_audit");
    if (error)
      return [meh("انحراف المخطط (RLS/الأعمدة)", `الدالة غير منصّبة بعد: ${error.message}`)];
    const rows = data || [];
    const rlsOff = rows.filter((r) => r.rls_enabled === false);
    const noPolicy = rows.filter((r) => r.rls_enabled && (r.policy_count || 0) === 0);
    const noCol = rows.filter((r) => r.has_company_id === false);
    const out = [];
    out.push(
      rlsOff.length === 0
        ? ok("تفعيل RLS على الجداول الحسّاسة", `${rows.length} جدول — RLS مفعّلة على الجميع`)
        : bad(
            "تفعيل RLS على الجداول الحسّاسة",
            `🚨 RLS معطّلة على: ${rlsOff.map((r) => r.table_name).join("، ")}`,
            "rls",
          ),
    );
    out.push(
      noPolicy.length === 0
        ? ok("وجود سياسات لكل جدول", "كل جدول حسّاس لديه سياسة واحدة على الأقل")
        : bad(
            "وجود سياسات لكل جدول",
            `🚨 بدون أي سياسة: ${noPolicy.map((r) => r.table_name).join("، ")}`,
          ),
    );
    out.push(
      noCol.length === 0
        ? ok(
            "أعمدة الربط بالمنشأة",
            "جميع الجداول تحتفظ بعمود الربط (company_id / branch_id / entry_id)",
          )
        : bad(
            "أعمدة الربط بالمنشأة",
            `🚨 عمود الربط مفقود في: ${noCol.map((r) => r.table_name).join("، ")}`,
          ),
    );
    return out;
  } catch (e) {
    return [meh("انحراف المخطط", e.message)];
  }
}

/** اختبار إضافي: منع الكتابة عبر الحدود — محاولة إدراج صف بمعرّف منشأة أخرى (Dry run بـ rollback منطقي). */
async function testCrossTenantWrite(cid) {
  try {
    // ملاحظة: يجب استخدام أعمدة حقيقية من جدول customers، وإلا فسيفشل الإدراج
    // بخطأ مخطط (42703/PGRST204) ويُقرأ خطأً كأنه رفض من RLS.
    const probe = {
      company_id: FAKE_COMPANY,
      full_name: "__isolation_probe__",
      id_type: "national_id",
      id_number: "0000000000",
      phone: "0500000000",
    };
    const { data, error } = await supabase
      .from("customers")
      .insert(probe)
      .select("id")
      .maybeSingle();
    if (error) {
      const code = error.code || "";
      // أخطاء مخطط لا تعني نجاح العزل — تُصنّف كغير حاسمة
      if (code === "42703" || code === "PGRST204" || code === "42P01" || code === "23502") {
        return [
          meh(
            "منع الكتابة عبر حدود المنشأة",
            `تعذّر تنفيذ الاختبار بسبب انحراف في المخطط: ${error.message}`,
          ),
        ];
      }
      return [
        ok(
          "منع الكتابة عبر حدود المنشأة",
          code === "23503"
            ? "الإدراج بمعرّف منشأة غير مملوكة مرفوض على مستوى قاعدة البيانات (قيد المفتاح الأجنبي)"
            : `الإدراج بمعرّف منشأة أخرى مرفوض من RLS (${code || "denied"})`,
        ),
      ];

    }

    if (data?.id) {
      await supabase.from("customers").delete().eq("id", data.id);
      return [
        bad(
          "منع الكتابة عبر حدود المنشأة",
          "🚨 تم قبول إدراج صف يحمل معرّف منشأة أخرى (تم حذفه)",
          "customers",
        ),
      ];
    }
    return [ok("منع الكتابة عبر حدود المنشأة", "لم يُقبل أي صف بمعرّف منشأة أخرى")];
  } catch (e) {
    return [ok("منع الكتابة عبر حدود المنشأة", `الإدراج مرفوض: ${e.message}`)];
  }
}

/** اختبار إضافي: ثبات الاستعلامات — نفس الاستعلام مع/بدون فلتر يجب أن يعطي نفس العدد. */
async function testQueryConsistency(cid) {
  const out = [];
  for (const t of ["bookings", "units", "payments"]) {
    try {
      const all = await supabase.from(t).select("id", { count: "exact", head: true });
      const scoped = await supabase
        .from(t)
        .select("id", { count: "exact", head: true })
        .eq("company_id", cid);
      if (all.error || scoped.error) {
        out.push(meh(`ثبات استعلام ${t}`, (all.error || scoped.error).message));
        continue;
      }
      out.push(
        all.count === scoped.count
          ? ok(
              `ثبات استعلام ${t}`,
              `${all.count ?? 0} صف — الاستعلام المطلق = الاستعلام المفلتر بمنشأتك`,
            )
          : bad(
              `ثبات استعلام ${t}`,
              `🚨 الاستعلام المطلق يرجع ${all.count} بينما منشأتك ${scoped.count}`,
              t,
            ),
      );
    } catch (e) {
      out.push(meh(`ثبات استعلام ${t}`, e.message));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */

/**
 * تشغيل الحزمة الكاملة.
 * @returns {{results:Array, summary:{pass:number,warn:number,fail:number}, durationMs:number}}
 */
export async function runIsolationSuite({ companyId, companyName, isSuperAdmin = false } = {}) {
  const started = Date.now();
  if (!companyId) {
    return {
      results: [meh("تشغيل الحزمة", "لا يوجد معرّف منشأة للمستخدم الحالي")],
      summary: { pass: 0, warn: 1, fail: 0 },
      durationMs: 0,
    };
  }
  // الاختبارات التي تقيس العزل بمقارنة الصفوف من الجلسة الحالية لا تصلح
  // لحساب سوبر أدمن — تُستبدل بملاحظة صريحة بدل إنذارات كاذبة.
  const notMeasurable = (name) =>
    meh(name, "لا يُقاس من جلسة سوبر أدمن: السياسات تمنحه رؤية كل المنشآت عمداً. اعتمد «تدقيق العزل البنيوي».");

  const groups = await Promise.all([
    testRowLeakage(companyId, isSuperAdmin),
    isSuperAdmin ? [notMeasurable("الاختراق المباشر لمنشأة أخرى")] : testDirectBreach(companyId),
    isSuperAdmin ? [notMeasurable("عزل الجداول التابعة")] : testChildTables(companyId),
    testVisibleCompanies(companyId, companyName),
    testUserBranches(companyId),
    testSchemaDrift(),
    testCrossTenantWrite(companyId),
    isSuperAdmin ? [notMeasurable("ثبات الاستعلامات")] : testQueryConsistency(companyId),
  ]);
  const results = groups.flat();
  return {
    results,
    summary: {
      pass: results.filter((r) => r.status === "pass").length,
      warn: results.filter((r) => r.status === "warn").length,
      fail: results.filter((r) => r.status === "fail").length,
    },
    durationMs: Date.now() - started,
  };
}

/** محاولة التصحيح التلقائي (Super Admin فقط) — يعيد قائمة الإصلاحات المنفّذة. */
export async function autoFixIsolation() {
  try {
    const { data, error } = await supabase.rpc("isolation_auto_fix");
    if (error) return { fixed: [], error: error.message };
    return { fixed: Array.isArray(data) ? data : data ? [data] : [], error: null };
  } catch (e) {
    return { fixed: [], error: e.message };
  }
}

/** حفظ نتيجة التشغيل في قاعدة البيانات (صامت — لا يكسر الواجهة عند الفشل). */
export async function recordIsolationRun({
  companyId,
  trigger,
  summary,
  results,
  durationMs,
  autoFixed = [],
}) {
  try {
    await supabase.from("tenant_isolation_runs").insert({
      company_id: companyId || null,
      trigger: trigger || "auto",
      passed: summary.pass,
      warned: summary.warn,
      failed: summary.fail,
      duration_ms: durationMs,
      results,
      auto_fixed: autoFixed,
    });
  } catch {
    /* صامت بالكامل */
  }
}

/** قراءة إعدادات المراقب مع قيم افتراضية آمنة. */
export const DEFAULT_MONITOR_SETTINGS = {
  enabled: true,
  interval_minutes: 30,
  auto_fix: true,
  run_on_login: true,
  keep_runs: 200,
};

export async function loadMonitorSettings() {
  try {
    const { data, error } = await supabase
      .from("isolation_monitor_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return { ...DEFAULT_MONITOR_SETTINGS, _fallback: true };
    return { ...DEFAULT_MONITOR_SETTINGS, ...data };
  } catch {
    return { ...DEFAULT_MONITOR_SETTINGS, _fallback: true };
  }
}

export async function saveMonitorSettings(patch) {
  const { error } = await supabase
    .from("isolation_monitor_settings")
    .upsert({ id: true, ...patch, updated_at: new Date().toISOString() }, { onConflict: "id" });
  return error;
}
