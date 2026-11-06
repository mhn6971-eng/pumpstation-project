#!/usr/bin/env node
/** StackBlitz cloud preview only — do not use this command on the station PC. */
import { execFileSync } from "node:child_process";
import path from "node:path";

console.error(`\n${"!".repeat(78)}\nهشدار شبکه: این فرمان فقط برای پیش‌نمایش ابری StackBlitz است.\nسرور را روی 0.0.0.0 باز می‌کند؛ روی رایانهٔ ایستگاه اجرا نکنید.\nبرای ایستگاه از راه‌انداز عادی با بایند loopback استفاده کنید.\n${"!".repeat(78)}\n`);

try {
  execFileSync(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "dev", "-H", "0.0.0.0", "-p", "3000", "--webpack"], { stdio: "inherit" });
} catch (error) {
  const status = Number.isInteger(error?.status) ? error.status : 1;
  process.exitCode = status;
}
