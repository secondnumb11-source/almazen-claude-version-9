import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const LS_KEY = "almazen.units.grid";

/** أنماط العرض: البطاقة التفصيلية الكاملة، أو البطاقة المختصرة. */
export const UNIT_VIEWS = [
  { id: "detailed", label: "تفصيلي", hint: "البطاقة الكاملة: الصورة والأسعار والنزيل والإجراءات" },
  { id: "compact",  label: "مختصر",  hint: "رقم الوحدة والتصنيف والحالة فقط — أكبر عدد في الشاشة" },
];

export const UNIT_SIZE_PRESETS = [
  { id: "xs", label: "مضغوط جداً", hint: "أكبر عدد وحدات في الشاشة", width: 148 },
  { id: "sm", label: "مضغوط", hint: "الافتراضي — مربعات صغيرة وواضحة", width: 170 },
  { id: "md", label: "متوسط", hint: "مساحة أوفر لكل وحدة", width: 200 },
  { id: "lg", label: "كبير", hint: "تفاصيل أوضح للشاشات الكبيرة", width: 240 },
  { id: "xl", label: "كبير جداً", hint: "أقصى وضوح للعرض والتقديم", width: 290 },
];

/** مقاسات النمط المختصر — أصغر لأن المحتوى ثلاثة أسطر فقط. */
export const UNIT_COMPACT_PRESETS = [
  { id: "xs", label: "مضغوط جداً", hint: "أقصى كثافة — 12 مربعاً فأكثر", width: 84 },
  { id: "sm", label: "مضغوط", hint: "الافتراضي — عشرة مربعات عرضياً", width: 96 },
  { id: "md", label: "متوسط", hint: "خط أوضح", width: 115 },
  { id: "lg", label: "كبير", hint: "قراءة مريحة من بعيد", width: 140 },
  { id: "xl", label: "كبير جداً", hint: "للعرض والتقديم", width: 175 },
];

/** العرض المرجعي الذي يساوي مقياساً = 1 (حجم الخط الأساسي في CSS). */
const REFERENCE_WIDTH = 216;
const COMPACT_REFERENCE_WIDTH = 112;

export const DEFAULT_UNIT_GRID = { view: "detailed", preset: "sm", width: 170, scale: 0.84 };

/** حدود التصغير/التكبير اليدوي لكل نمط. */
export const UNIT_WIDTH_MIN = 142;
export const UNIT_WIDTH_MAX = 320;
export const UNIT_COMPACT_WIDTH_MIN = 78;
export const UNIT_COMPACT_WIDTH_MAX = 200;

/** حدود ومقاسات النمط الحالي — تُستخدم في الواجهة بلا شروط متناثرة. */
export function viewLimits(view) {
  return view === "compact"
    ? { min: UNIT_COMPACT_WIDTH_MIN, max: UNIT_COMPACT_WIDTH_MAX, presets: UNIT_COMPACT_PRESETS, def: 96 }
    : { min: UNIT_WIDTH_MIN, max: UNIT_WIDTH_MAX, presets: UNIT_SIZE_PRESETS, def: 170 };
}

/**
 * يشتق مقياس المحتوى من العرض حتى ينمو الخط والمسافات مع المربع.
 * الأس 0.72 يجعل النمو أبطأ قليلاً من العرض: عند أصغر مقاس يبقى الخط
 * مقروءاً، وعند أكبر مقاس لا يصبح المربع طويلاً بإفراط.
 */
export function scaleForWidth(width, view = "detailed") {
  const L = viewLimits(view);
  const ref = view === "compact" ? COMPACT_REFERENCE_WIDTH : REFERENCE_WIDTH;
  const w = Math.min(L.max, Math.max(L.min, Number(width) || L.def));
  return Math.round(Math.pow(w / ref, 0.72) * 100) / 100;
}

function normalize(raw) {
  const merged = { ...DEFAULT_UNIT_GRID, ...(raw || {}) };
  const view = merged.view === "compact" ? "compact" : "detailed";
  const L = viewLimits(view);
  // عند تبديل النمط يُضبط العرض داخل حدود النمط الجديد تلقائياً
  const width = Math.min(L.max, Math.max(L.min, Number(merged.width) || L.def));
  return { view, preset: merged.preset || "custom", width, scale: scaleForWidth(width, view) };
}

function readLocal() {
  try {
    return normalize(JSON.parse(localStorage.getItem(LS_KEY) || "null"));
  } catch {
    return DEFAULT_UNIT_GRID;
  }
}

/**
 * مقاس مربعات الوحدات — يُحفظ لكل مستخدم في جدول user_ui_settings (عمود units_grid)
 * مع نسخة محلية للاستجابة الفورية وكحل بديل إن لم يكن العمود منصّباً بعد.
 * الهدف: ألا يعود المستخدم لضبط المقاس من جديد عند كل تسجيل دخول.
 */
export function useUnitCardSize(userId) {
  const [grid, setGrid] = useState(readLocal);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from("user_ui_settings")
      .select("units_grid")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error || !data?.units_grid) return;
        const next = normalize(data.units_grid);
        setGrid(next);
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(next));
        } catch {
          /* التخزين المحلي قد يكون معطّلاً — لا يمنع تطبيق الإعداد */
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const save = useCallback(
    async (patch) => {
      // تبديل النمط يُعيد العرض إلى افتراضي النمط الجديد ما لم يُحدَّد صراحةً،
      // وإلا بقي عرض النمط السابق خارج حدود النمط الجديد.
      const switching = patch?.view && patch.view !== grid.view;
      const base = switching
        ? { ...grid, ...patch, width: patch.width ?? viewLimits(patch.view).def, preset: patch.preset ?? 'sm' }
        : { ...grid, ...patch };
      const next = normalize(base);
      setGrid(next);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* كما سبق */
      }
      if (!userId) return;
      // الحفظ في الخلفية: فشله لا يُفقد المستخدم إعداده لوجود النسخة المحلية.
      const { error } = await supabase
        .from("user_ui_settings")
        .upsert({ user_id: userId, units_grid: next }, { onConflict: "user_id" });
      if (error) console.warn("units_grid: تعذّر الحفظ في قاعدة البيانات، حُفظ محلياً.", error.message);
    },
    [grid, userId],
  );

  const reset = useCallback(() => save(DEFAULT_UNIT_GRID), [save]);

  return { grid, save, reset };
}

/** متغيّرات CSS تُطبَّق على شبكة الوحدات فتتحكم في العرض والمقياس معاً. */
export function unitGridCssVars(grid) {
  const g = normalize(grid);
  return {
    "--u-card-w": `${g.width}px`,
    "--u-scale": String(g.scale),
  };
}
