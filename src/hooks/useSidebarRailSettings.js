import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const LS_KEY = "almazen.sidebar.rail";

/** إصدار التصميم — رفعه يفرض تحديث الإعدادات القديمة المحفوظة لدى المستخدمين. */
export const RAIL_DESIGN_VERSION = 3;

/**
 * التصميم الفاخر المعتمد للمسطرة الطولية.
 * ⚠️ أي إعداد محفوظ بإصدار أقدم يُستبدل بهذه القيم تلقائياً عند التحميل،
 * حتى لا يعود المظهر الافتراضي القديم للمستخدمين الذين حُفظ لهم سابقاً.
 */
export const DEFAULT_RAIL = {
  accent: "#E7C765", // ذهبي المازن — أنصع قليلاً ليظهر على الكحلي الداكن
  accent2: "#0B1E3F", // لون الظل/القاعدة
  thickness: 3, // سماكة المسطرة px — خيط رفيع أنيق
  height: 68, // ارتفاع المؤشر النسبي %
  glow: 62, // شدة التوهج %
  radius: 999, // استدارة الحواف
  style: "gem", // gem | ribbon | minimal
  v: RAIL_DESIGN_VERSION,
};

/** يدمج إعداد المستخدم مع التصميم المعتمد، ويتجاهل الإعدادات الأقدم من الإصدار الحالي. */
function adopt(saved) {
  if (!saved || Number(saved.v || 0) < RAIL_DESIGN_VERSION) return DEFAULT_RAIL;
  return { ...DEFAULT_RAIL, ...saved, v: RAIL_DESIGN_VERSION };
}

function readLocal() {
  try {
    return adopt(JSON.parse(localStorage.getItem(LS_KEY) || "null"));
  } catch {
    return DEFAULT_RAIL;
  }
}

/**
 * إعدادات مسطرة الحركة الطولية — تُخزَّن في قاعدة البيانات لكل مستخدم
 * (جدول user_ui_settings) مع نسخة محلية للاستجابة الفورية وكحل بديل
 * إذا لم يكن الجدول منصّباً بعد.
 */
export function useSidebarRailSettings(userId) {
  const [rail, setRail] = useState(readLocal);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setLoaded(true);
      return;
    }
    supabase
      .from("user_ui_settings")
      .select("sidebar_rail")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data?.sidebar_rail) {
          const saved = data.sidebar_rail;
          const merged = adopt(saved);
          setRail(merged);
          try {
            localStorage.setItem(LS_KEY, JSON.stringify(merged));
          } catch {
            /* التخزين المحلي قد يكون معطّلاً */
          }
          // ترقية دائمة: الصف المحفوظ بإصدار قديم يُستبدل في قاعدة البيانات
          // مرة واحدة، فلا يعود المظهر الافتراضي القديم في أي جلسة لاحقة.
          if (Number(saved.v || 0) < RAIL_DESIGN_VERSION) {
            supabase
              .from("user_ui_settings")
              .upsert({ user_id: userId, sidebar_rail: merged }, { onConflict: "user_id" })
              .then(({ error: upErr }) => {
                if (upErr) console.warn("تعذّرت ترقية تصميم المسطرة في قاعدة البيانات:", upErr.message);
              });
          }
        }
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const save = useCallback(
    async (patch) => {
      const next = { ...rail, ...patch, v: RAIL_DESIGN_VERSION };
      setRail(next);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {}
      if (!userId) return null;
      const { error } = await supabase
        .from("user_ui_settings")
        .upsert({ user_id: userId, sidebar_rail: next }, { onConflict: "user_id" });
      return error;
    },
    [rail, userId],
  );

  const reset = useCallback(() => save(DEFAULT_RAIL), [save]);

  return { rail, loaded, save, reset };
}

/** تحويل الإعدادات إلى متغيرات CSS تُطبَّق على عنصر اللوحة الجانبية. */
export function railCssVars(rail) {
  const r = { ...DEFAULT_RAIL, ...(rail || {}) };
  return {
    "--rail-accent": r.accent,
    "--rail-accent-2": r.accent2,
    "--rail-thickness": `${r.thickness}px`,
    "--rail-height": `${r.height}%`,
    "--rail-radius": `${r.radius}px`,
    "--rail-glow": String(Math.max(0, Math.min(100, r.glow)) / 100),
  };
}
