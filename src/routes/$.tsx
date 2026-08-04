import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";

const App = lazy(() => import("../App.jsx"));

/**
 * مسار شامل (catch-all) يسلّم التوجيه للتطبيق نفسه، حتى تعمل الصفحات العامة
 * مثل /terms و /privacy و /reset-password و /portal/:token و /u/:slug
 * بدل ظهور صفحة 404.
 */
export const Route = createFileRoute("/$")({
  head: () => ({
    meta: [
      { title: "المازن — إدارة الوحدات السكنية والشاليهات" },
      {
        name: "description",
        content:
          "شروط الاستخدام وسياسة الخصوصية وبوابة المستأجر في منصة المازن لإدارة الوحدات السكنية والشاليهات.",
      },
      { property: "og:title", content: "المازن — إدارة الوحدات السكنية والشاليهات" },
      {
        property: "og:description",
        content:
          "شروط الاستخدام وسياسة الخصوصية وبوابة المستأجر في منصة المازن لإدارة الوحدات السكنية والشاليهات.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CatchAll,
});

function CatchAll() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return (
    <Suspense fallback={null}>
      <App />
    </Suspense>
  );
}
