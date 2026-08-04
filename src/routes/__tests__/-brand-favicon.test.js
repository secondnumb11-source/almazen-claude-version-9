import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * حماية دائمة لشعار منصة المازن:
 * أي تغيير يحاول إزالة أيقونة المنصة أو إرجاع شعار افتراضي آخر يُفشل البناء هنا.
 */
const root = resolve(import.meta.dirname, "../../..");
const ICONS = ["favicon.ico", "favicon.png", "favicon-192.png", "favicon-512.png"];

describe("تثبيت شعار المنصة", () => {
  it("ملفات الأيقونة موجودة وبحجم حقيقي", () => {
    for (const f of ICONS) {
      const s = statSync(resolve(root, "public", f));
      expect(s.size).toBeGreaterThan(1000);
    }
  });

  it("الصفحة الجذرية تربط أيقونات المازن فقط", () => {
    const src = readFileSync(resolve(root, "src/routes/__root.tsx"), "utf8");
    expect(src).toContain("/favicon.ico");
    expect(src).toContain("/favicon.png");
    expect(src).toContain("/favicon-192.png");
    expect(src.toLowerCase()).not.toContain("gpteng.co");
    expect(src.toLowerCase()).not.toContain("lovable.dev/favicon");
    expect(src.toLowerCase()).not.toContain("lovable-uploads");
  });

  it("ملف manifest يستعمل أيقونات المازن", () => {
    const man = JSON.parse(readFileSync(resolve(root, "public/manifest.json"), "utf8"));
    const srcs = man.icons.map((i) => i.src);
    expect(srcs).toContain("/favicon.ico");
    expect(srcs).toContain("/favicon-192.png");
    expect(srcs).toContain("/favicon-512.png");
  });
});
