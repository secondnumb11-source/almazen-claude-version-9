import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";

const App = lazy(() => import("../App.jsx"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "المازن — إدارة الوحدات السكنية والشاليهات" },
      {
        name: "description",
        content:
          "نظام المازن لإدارة الوحدات السكنية والشاليهات والحجوزات والمدفوعات وبوابة المستأجر.",
      },
      { property: "og:title", content: "المازن — إدارة الوحدات السكنية والشاليهات" },
      {
        property: "og:description",
        content:
          "نظام المازن لإدارة الوحدات السكنية والشاليهات والحجوزات والمدفوعات وبوابة المستأجر.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return (
    <Suspense fallback={null}>
      <App />
    </Suspense>
  );
}
