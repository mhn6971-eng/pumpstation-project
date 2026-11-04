import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite و pg باید بیرون از باندل Next بمانند (فایل WASM و باینری بومی)
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // اجازهٔ دسترسی از دامنهٔ پیش‌نمایش
  allowedDevOrigins: ["*.e2b.app", "*.e2b.dev", "localhost", "127.0.0.1"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
