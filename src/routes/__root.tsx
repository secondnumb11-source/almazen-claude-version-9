import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import legacyCss from "../legacy.css?url";
import legacyExtraCss from "../legacy-extra.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

/** إصدار أيقونة العلامة — يُستخدم لتجاوز الكاش عند تثبيت شعار المازن */
const BRAND_ICON_VERSION = "almazen-1";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "المازن — إدارة الوحدات السكنية والشاليهات" },
      { property: "og:title", content: "المازن — إدارة الوحدات السكنية والشاليهات" },
      { name: "twitter:title", content: "المازن — إدارة الوحدات السكنية والشاليهات" },
      { name: "description", content: "نظام المازن لإدارة الوحدات السكنية والشاليهات والحجوزات والمدفوعات وبوابة المستأجر." },
      { property: "og:description", content: "نظام المازن لإدارة الوحدات السكنية والشاليهات والحجوزات والمدفوعات وبوابة المستأجر." },
      { name: "twitter:description", content: "نظام المازن لإدارة الوحدات السكنية والشاليهات والحجوزات والمدفوعات وبوابة المستأجر." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/f1ca9b7a-6179-4ed8-96c5-b5d73fe5d052/id-preview-e12b2ba2--e414ee48-4bd2-458c-93f2-67ac1f9e9d43.lovable.app-1785602937986.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/f1ca9b7a-6179-4ed8-96c5-b5d73fe5d052/id-preview-e12b2ba2--e414ee48-4bd2-458c-93f2-67ac1f9e9d43.lovable.app-1785602937986.png" },
    ],
    links: [
      { rel: "manifest", href: "/manifest.json" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cairo:wght@600;700;800;900&family=Tajawal:wght@400;500;700&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: legacyCss },
      { rel: "stylesheet", href: legacyExtraCss },
      // ⚠️ شعار المنصة مثبَّت — لا يجوز تغييره أو إعادته لشعار أي منصة أخرى.
      // ملفات الشعار: public/favicon.png / favicon-192.png / favicon-512.png / favicon.ico
      // (اختبار الحماية: src/routes/__tests__/brand-favicon.test.js)
      { rel: "icon", href: `/favicon.png?v=${BRAND_ICON_VERSION}`, type: "image/png", sizes: "64x64" },
      {
        rel: "icon",
        href: `/favicon-192.png?v=${BRAND_ICON_VERSION}`,
        type: "image/png",
        sizes: "192x192",
      },
      { rel: "shortcut icon", href: `/favicon.ico?v=${BRAND_ICON_VERSION}` },
      { rel: "apple-touch-icon", href: `/favicon-192.png?v=${BRAND_ICON_VERSION}` },

    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">

      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
