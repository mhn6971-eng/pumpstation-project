import nextConfig from "eslint-config-next";

/**
 * پیکربندی ESLint (نسخهٔ ۹ — flat config).
 * پیش از ۱.۴ فایل پیکربندی وجود نداشت و `npm run lint` با خطای
 * "couldn't find eslint.config" متوقف می‌شد؛ این فایل آن شکاف را می‌بندد.
 */
export default [
  ...nextConfig,
  {
    // این دو قاعده در نسخهٔ ۱۶ پیکربندی Next سخت‌گیرانه اضافه شده‌اند.
    // الگوی رایج این پروژه «بارگذاری داده در effect سپس setState» است (بدون
    // منبع خارجی مشترک)؛ قانون React آن را به‌عنوان هشدار می‌پذیرد، نه خطا.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
  {
    ignores: [".next/**", ".data/**", "node_modules/**", "next-env.d.ts", "public/**"],
  },
];
