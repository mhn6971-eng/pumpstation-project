import type { NextConfig } from "next";

/** هدرهای امنیتی (H6) — قبلاً هیچ‌کدام ست نمی‌شد */
const securityHeaders: { key: string; value: string }[] = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

// HSTS فقط وقتی سایت واقعاً روی HTTPS سرو می‌شود فرستاده می‌شود؛
// وگرنه کوکی secure و اجبار HTTPS می‌تواند دسترسی محلی را قطع کند.
if (process.env.COOKIE_SECURE === "1" || process.env.FORCE_HTTPS === "1") {
  securityHeaders.push({ key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" });
}

const nextConfig: NextConfig = {
  // PGlite و pg باید بیرون از باندل Next بمانند (فایل WASM و باینری بومی)
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // اجازهٔ دسترسی از دامنهٔ پیش‌نمایش
  allowedDevOrigins: ["*.e2b.app", "*.e2b.dev", "localhost", "127.0.0.1"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
