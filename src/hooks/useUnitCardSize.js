import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const LS_KEY = "almazen.units.grid";

/** المقاسات الجاهزة — القيمة هي عرض عمود الشبكة بالبكسل. */
export const UNIT_SIZE_PRESETS = [
  { id: "xs", label: "مضغوط جداً", hint: "أكبر عدد وحدات في الشاشة", width: 168 },
  { id: "sm", label: "مضغوط", hint: "الافتراضي — مربعات صغيرة وواضحة", width: 190 },
  { id: "md", label: "متوسط", hint: "مساحة أوفر لكل وحدة", width: 224 },
  { id: "lg", label: "كبير", hint: "تفاصيل أوضح للشاشات الكبيرة", width: 268 },
  { id: "xl", label: "كبير جداً", hint: "أقصى وضوح للعرض والتقديم", width: 310 },
];

/** العرض المرجعي الذي يساوي مقياساً = 1 (حجم الخط الأساسي في CSS). */
const REFERENCE_WIDTH = 216;

export const DEFAULT_UNIT_GRID = { preset: "sm", width: 190, scale: 0.91 };

/** حدود التصغير/التكبير اليدوي — تمنع المقاسات التي تكسر تنسيق المربع. */
export const UNIT_WIDTH_MIN = 165;
export const UNIT_WIDTH_MAX = 340;

/**
 * يشتق مقياس المحتوى من العرض حتى ينمو الخط والمسافات مع المربع.
 * الأس 0.72 يجعل النمو أبطأ قليلاً من العرض: عند أصغر مقاس يبقى الخط
 * مقروءاً، وعند أكبر مقاس لا يصبح المربع طويلاً بإفراط.
 */
export function scaleForWidth(width) {
  const w = Math.min(UNIT_WIDTH_MAX, Math.max(UNIT_WIDTH_MIN, Number(width) || DEFAULT_UNIT_GRID.width));
  return Math.round(Math.pow(w / REFERENCE_WIDTH, 0.72) * 100) / 100;
}

function normalize(raw) {
  const merged = { ...DEFAULT_UNIT_GRID, ...(raw || {}) };
  const width = Math.min(UNIT_WIDTH_MAX, Math.max(UNIT_WIDTH_MIN, Number(merged.width) || DEFAULT_UNIT_GRID.width));
  return { preset: merged.preset || "custom", width, scale: scaleForWidth(width) };
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
      const next = normalize({ ...grid, ...patch });
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
