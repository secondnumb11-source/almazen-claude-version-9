import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DEFAULT_RAIL, RAIL_DESIGN_VERSION } from "../../hooks/useSidebarRailSettings";

/**
 * حماية دائمة لتصميم مسطرة الحركة الطولية.
 *
 * الخلفية: منذ Chromium 121 يتجاهل المتصفح كل قواعد `::-webkit-scrollbar`
 * على عنصر عُرّف عليه `scrollbar-width` أو `scrollbar-color`، ويرسم شريط
 * النظام الرمادي بدلاً منها. لذلك أي محاولة لإعادة تنسيق شريط المتصفح على
 * ‎.sb-nav‎ تُرجع المظهر الافتراضي القديم — وهذه الاختبارات تُفشل البناء عندها.
 */
const root = resolve(import.meta.dirname, "../../..");

/** التعليقات تُزال أولاً: بعضها يذكر القواعد الممنوعة كتحذير للمطوّر. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const legacy = stripComments(readFileSync(resolve(root, "src/legacy.css"), "utf8"));
const extra = stripComments(readFileSync(resolve(root, "src/legacy-extra.css"), "utf8"));
const sidebar = readFileSync(resolve(root, "src/components/AppSidebar.jsx"), "utf8");

/** يستخرج كتل CSS التي يظهر فيها المحدد المطلوب. */
function blocksFor(css, selectorFragment) {
  return css
    .split("}")
    .filter((b) => b.includes(selectorFragment))
    .map((b) => b + "}");
}

/**
 * الكتل التي تستهدف .sb-nav فعلاً — مع استبعاد ما ينفيه مثل
 * `*:not(.sb-nav)` (قاعدة شريط تمرير الصفحة العام، وهي مقصودة وسليمة).
 */
function blocksTargetingNav(css) {
  return blocksFor(css, ".sb-nav").filter((b) => {
    const selector = b.slice(0, b.indexOf("{") === -1 ? b.length : b.indexOf("{"));
    return /(^|[\s,>])[^,]*\.sb-nav/.test(selector.replace(/:not\([^)]*\)/g, ""));
  });
}

describe("مسطرة الحركة الطولية — تثبيت التصميم الفاخر", () => {
  it("لا يُعاد تفعيل شريط تمرير النظام على .sb-nav", () => {
    for (const css of [legacy, extra]) {
      for (const block of blocksTargetingNav(css)) {
        // يُسمح فقط بإخفائه (none)، ويُمنع thin/auto التي تُعيد شريط النظام.
        expect(block).not.toMatch(/scrollbar-width:\s*(thin|auto)/);
        expect(block).not.toMatch(/scrollbar-color:\s*rgba?\(/);
      }
    }
  });

  it("شريط النظام مخفي صراحةً على .sb-nav", () => {
    expect(extra).toMatch(/\.sb-nav[^{]*\{[^}]*scrollbar-width:\s*none/);
    expect(extra).toMatch(/\.sb-nav::-webkit-scrollbar[^{]*\{[^}]*display:\s*none/);
  });

  it("المسطرة المخصّصة معرَّفة ومخفية عند السكون وتظهر عند التحويم", () => {
    expect(extra).toContain(".sb-sbar-thumb");
    // مخفية تماماً في الحالة الساكنة
    expect(extra).toMatch(/\.app-sidebar \.sb-sbar \{[^}]*opacity:\s*0;/);
    // تظهر عند التحويم على اللوحة وأثناء التمرير والسحب
    expect(extra).toContain(".app-sidebar:hover .sb-sbar");
    expect(extra).toContain(".sb-sbar.awake");
    expect(extra).toContain(".sb-sbar.dragging");
  });

  it("اللوحة الجانبية تركّب المسطرة المخصّصة", () => {
    expect(sidebar).toContain("useLuxuryScrollbar");
    expect(sidebar).toContain("sb-sbar-thumb");
  });

  it("التصميم المعتمد يحمل رقم الإصدار حتى تُرقّى الإعدادات القديمة", () => {
    expect(DEFAULT_RAIL.v).toBe(RAIL_DESIGN_VERSION);
    expect(RAIL_DESIGN_VERSION).toBeGreaterThanOrEqual(3);
  });

  it("اللوحة تبقى ثابتة عند التمرير (sticky وليس relative)", () => {
    for (const block of blocksFor(extra, ".app-sidebar {")) {
      expect(block).not.toMatch(/position:\s*relative/);
    }
    expect(extra).toMatch(/\.app-sidebar \{[^}]*position:\s*sticky/);
  });
});
