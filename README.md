# نظام إدارة العقارات — دليل النشر على Vercel

تطبيق TanStack Start (React 19 + Vite + Tailwind v4) بواجهة عربية RTL، يعمل بوضع SSR على Vercel.

---

## 1) التشغيل محليًا

```bash
npm install --legacy-peer-deps
cp .env.example .env      # ثم املأ القيم
npm run dev               # http://localhost:8080
```

> ملف `.npmrc` يحتوي `legacy-peer-deps=true` لحل تعارض `date-fns@4` مع `react-day-picker@8`.
> لا تحذفه، وإلا سيفشل `npm install` على Vercel.

---

## 2) متغيرات البيئة المطلوبة

انسخها من `.env.example` وأضفها في:
**Vercel → Project → Settings → Environment Variables** (فعّلها لـ Production و Preview و Development).

| المتغير | مطلوب | الوصف |
|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | رابط مشروع قاعدة البيانات |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | المفتاح العام (anon / publishable) |
| `VITE_SUPABASE_PROJECT_ID` | ✅ | معرّف المشروع |
| `NITRO_PRESET=vercel` | تلقائي | مضبوط داخل `vercel.json` |

⚠️ أي متغير يبدأ بـ `VITE_` يظهر في المتصفح — لا تضع فيه مفاتيح سرية.
المفاتيح السرية (مثل `SUPABASE_SERVICE_ROLE_KEY`) تُضاف بدون بادئة `VITE_`.

---

## 3) الأوامر

| الأمر | الوظيفة |
|---|---|
| `npm run dev` | التطوير |
| `npm run build` | بناء الإنتاج |
| `npm run vercel-build` | الأمر الذي تستدعيه Vercel |
| `npm start` | تشغيل معاينة الإنتاج محليًا |
| `npm run lint` | فحص الكود |

---

## 4) النشر

### الطريقة الأسهل (Git)
ارفع المستودع إلى GitHub ثم Import في Vercel. الإعدادات كلها مقروءة من `vercel.json`:
- Framework Preset: **Other** (`framework: null`)
- Install: `npm install --legacy-peer-deps`
- Build: `npm run vercel-build`
- Output: يُكتشف تلقائيًا (`.vercel/output` عبر Build Output API)

### عبر CMD
```bash
npm i -g vercel
vercel login
vercel build --prod     # للتأكد من نجاح البناء محليًا
vercel deploy --prebuilt --prod
```

---

## 5) المسارات (Routing) و RTL

التطبيق **ليس SPA ثابتًا**، بل SSR عبر Nitro. لذلك:

- **لا تضف `rewrites` تشير إلى `/index.html`** — هذا يكسر المسارات لأن الدوال الخادمية هي من يتولى التوجيه.
- التوجيه يُولَّد تلقائيًا في `.vercel/output/config.json`، لذا التحديث (Refresh) والروابط العميقة مثل `/tenants` تعمل مباشرة.
- في `vercel.json` ضبطنا فقط `cleanUrls` و `trailingSlash: false` لتوحيد شكل الروابط.
- اتجاه RTL مضبوط عبر `<html dir="rtl" lang="ar">` في `src/routes/__root.tsx` ولا يتأثر بالنشر.

إذا ظهر 404 بعد النشر، تأكد أن ملف المسار موجود داخل `src/routes/` وأن `createFileRoute("/path")` يطابق الرابط. لا تعدّل `src/routeTree.gen.ts` يدويًا.

---

## 6) التخزين المؤقت (Caching) وتسريع البناء

- **تبعيات البناء:** Vercel تخزّن `node_modules` تلقائيًا اعتمادًا على `package-lock.json`. الملف موجود ومثبّت في المستودع — هذا أهم عامل لتسريع البناء وتفادي أخطاء الإصدارات.
- **لا تضف `.vercel` أو `node_modules` إلى Git** (مضافة في `.gitignore`).
- **أصول الواجهة:** ملفات `/assets/*` و `/_build/*` والصور والخطوط تُخدَّم بترويسة
  `Cache-Control: public, max-age=31536000, immutable` عبر قسم `headers` في `vercel.json`.
- لتفريغ الكاش عند مشكلة بناء: Vercel → Deployments → ⋯ → **Redeploy** مع إلغاء تفعيل *Use existing Build Cache*.

---

## 7) مشاكل شائعة

| الخطأ | الحل |
|---|---|
| `ERESOLVE could not resolve` | تأكد من وجود `.npmrc` و `installCommand` بـ `--legacy-peer-deps` |
| `No Output Directory named "dist"` | Framework Preset يجب أن يكون **Other**، والبناء ينتج `.vercel/output` |
| صفحة بيضاء بعد النشر | متغيرات `VITE_*` غير مضافة في Vercel |
| 404 عند تحديث الصفحة | تحقق من ملف المسار في `src/routes/` ولا تضف rewrites يدوية |
