# نشر التطبيق للإنتاج (Production Deployment)

## 1) متغيرات البيئة المطلوبة

انسخ `.env.example` إلى `.env` محلياً، وأضف نفس القيم في مزوّد الاستضافة
(Vercel: Project → Settings → Environment Variables — اختر Production + Preview + Development).

| المتغير | مطلوب | الوصف |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | ✅ | رابط مشروع قاعدة البيانات |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | المفتاح العام (آمن للمتصفح) |
| `VITE_SUPABASE_PROJECT_ID` | ✅ | معرّف المشروع |
| `NITRO_PRESET` | على Vercel فقط | مضبوط مسبقاً في `vercel.json` بقيمة `vercel` |
| `SUPABASE_SERVICE_ROLE_KEY` | اختياري (خادم فقط) | لا يبدأ بـ `VITE_` حتى لا يُكشف للمتصفح |

> ⚠️ لا تضع أي مفتاح سري في متغير يبدأ بـ `VITE_` — كل ما يبدأ بهذه البادئة يُحقن في حزمة المتصفح.

## 2) أوامر البناء والتشغيل

```bash
bun install            # أو: npm install --legacy-peer-deps
bun run build          # بناء الإنتاج
bun run start          # تشغيل نسخة الإنتاج محلياً (المنفذ من PORT، الافتراضي 3000)
```

على Vercel:

- Install Command: `npm install --legacy-peer-deps`
- Build Command: `npm run vercel-build`
- Node.js: 22 (مضبوط في `vercel.json`)

## 3) فحص ما قبل النشر

```bash
bun run lint           # فحص جودة الكود
bunx vitest run        # الاختبارات الآلية (تشمل اختبارات حالة الوحدة)
bun run build          # التأكد من نجاح بناء الإنتاج
```

ومن داخل التطبيق: **الاختبارات الذكية → 🔁 انتقالات حالة الوحدة** للتحقق من عدم عودة
خطأ `invalid input value for enum unit_status` بعد النشر.

## 4) قاعدة البيانات

ملفات SQL في مجلد `supabase/` يجب تطبيقها على قاعدة بيانات الإنتاج قبل النشر،
وآخرها `supabase/FIX_UNIT_STATUS_ENUM_TRIGGER.sql` (إصلاح تريجر حالة الوحدة).
