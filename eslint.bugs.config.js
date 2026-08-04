// فاحص الأخطاء الحقيقية لملفات .js/.jsx (كل كود التطبيق تقريباً).
//
// السبب: `eslint.config.js` يطبّق قواعد js/typescript-eslint على `**/*.{ts,tsx}` فقط،
// فبقيت ملفات .jsx بلا أي فحص منطقي — وهكذا مرّت أخطاء مثل متغيّر غير معرّف
// أو استدعاء hook بعد return مبكّر دون أن يلتقطها أحد.
//
// هذا الملف يفحص الأخطاء فقط (بدون قواعد التنسيق) حتى تبقى النتيجة قابلة للقراءة:
//   npm run lint:bugs
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist", ".output", ".vinxi", "node_modules", ".vercel"] },
  {
    ...js.configs.recommended,
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // `catch {}` المتعمّد منتشر في الكود لتجاهل أخطاء localStorage وغيرها.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // مُعطّلة عمداً: بدون eslint-plugin-react لا يرى ESLint استخدام المكوّن داخل JSX،
      // فيبلّغ خطأً عن كل مكوّن مستورد (<ConfigErrorScreen /> مثلاً) وكأنه غير مستخدم.
      "no-unused-vars": "off",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
