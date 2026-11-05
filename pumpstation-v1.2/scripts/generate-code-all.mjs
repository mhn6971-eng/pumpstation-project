/**
 * تولید pumpstation-v1.2/CODE_ALL_FA.txt — کل کد برنامه در یک فایل متنی.
 *
 *   node scripts/generate-code-all.mjs
 *
 * خروجی قطعی است (ترتیب فایل‌ها ثابت؛ اجرای دوباره = بایت‌به‌بایت یکسان،
 * به‌جز سربرگِ تاریخ/کامیت). درج نمی‌شوند: node_modules، .next، .data،
 * drizzle/meta، package-lock.json، public/ و اسناد docs/*.md.
 * خودِ همین اسکریپت هم درج نمی‌شود (ابزار تولید است، نه کد برنامه).
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const FA_NUM = ["۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

const SECTIONS = [
  { title: "پیکربندی پروژه", files: [
    "package.json", "next.config.ts", "tsconfig.json", "eslint.config.mjs",
    "postcss.config.mjs", "drizzle.config.json", ".env.example",
  ] },
  { title: "دیتابیس و مهاجرت‌ها", files: [
    "src/db/index.ts", "src/db/schema.ts", "src/db/seed.ts", "src/lib/seed-helpers.ts",
    "data/roster.sample.json",
    "drizzle/0000_woozy_omega_flight.sql", "drizzle/0001_hardening.sql",
    "drizzle/0002_resilience.sql", "drizzle/0003_two_factor.sql", "drizzle/0004_mirror_ts.sql",
  ] },
  { title: "کتابخانهٔ منطق (src/lib)", files: [
    "src/lib/version.ts", "src/lib/errors.ts", "src/lib/types.ts", "src/lib/log.ts",
    "src/lib/dblock.ts", "src/lib/pin.ts", "src/lib/secret.ts", "src/lib/totp.ts",
    "src/lib/auth.ts", "src/lib/sessions.ts", "src/lib/security.ts", "src/lib/audit.ts",
    "src/lib/jalali.ts", "src/lib/domain.ts", "src/lib/state.ts", "src/lib/reporting.ts",
    "src/lib/backup.ts", "src/lib/mirror.ts", "src/lib/archive.ts",
    "src/lib/roster.ts", "src/lib/netbind.ts", "src/lib/sqlite-cloud.ts",
  ] },
  { title: "مسیرهای API (src/app/api)", files: [
    "src/app/api/auth/route.ts", "src/app/api/actions/route.ts", "src/app/api/state/route.ts",
    "src/app/api/history/route.ts", "src/app/api/totals/route.ts",
    "src/app/api/backups/[id]/route.ts", "src/app/api/mirror/route.ts",
    "src/app/api/health/route.ts", "src/app/api/catalogs/route.ts", "src/app/api/export/route.ts",
  ] },
  { title: "صفحات، چیدمان و قلاب‌های زمان اجرا (src/app و ریشهٔ src)", files: [
    "src/app/layout.tsx", "src/app/page.tsx", "src/app/error.tsx", "src/app/loading.tsx",
    "src/app/not-found.tsx", "src/app/report/[id]/page.tsx", "src/app/totals/page.tsx",
    "src/app/globals.css", "src/proxy.ts", "src/instrumentation.ts", "src/instrumentation.node.ts",
  ] },
  { title: "رابط کاربری (src/components)", files: [
    "src/components/context.tsx", "src/components/ui.tsx", "src/components/AppShell.tsx",
    "src/components/Login.tsx", "src/components/Dashboard.tsx", "src/components/MotorCard.tsx",
    "src/components/MotorVisual.tsx", "src/components/MotorDetail.tsx",
    "src/components/AuxTab.tsx", "src/components/RegistryTab.tsx", "src/components/ServiceForm.tsx",
    "src/components/ReportsTab.tsx", "src/components/ReportsHub.tsx", "src/components/ChartModal.tsx",
    "src/components/PrintBar.tsx", "src/components/AlertsTab.tsx", "src/components/ProblemsTab.tsx",
    "src/components/TrainingTab.tsx", "src/components/AdminTab.tsx",
    "src/components/TwoFactorPanel.tsx", "src/components/MirrorPanel.tsx",
  ] },
  { title: "اسکریپت‌های عملیاتی (scripts)", files: [
    "scripts/init-db.mjs", "scripts/doctor.mjs", "scripts/reset-admin-pin.mjs",
    "scripts/mirror-backup.mjs", "scripts/pg-init.mjs", "scripts/pg-dump.mjs",
    "scripts/pg-import-json.mjs", "scripts/serve.mjs", "scripts/bulk-import.mjs",
  ] },
  { title: "آزمون‌های خودکار (audit)", files: [
    "audit/audit1.mjs", "audit/audit2.mjs", "audit/audit3.mjs", "audit/audit4.mjs",
    "audit/audit5.mjs", "audit/audit6.mjs", "audit/bulk.mjs", "audit/perf.mjs", "audit/conc.mjs",
  ] },
  { title: "استقرار و CI", files: [
    "deploy/Caddyfile", "deploy/nginx.conf", "../.github/workflows/ci.yml",
  ] },
];

const versionSrc = readFileSync("src/lib/version.ts", "utf8");
const version = versionSrc.match(/"(\d+\.\d+\.\d+)"/)?.[1] ?? "?";
const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
const commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
const today = new Date().toISOString().slice(0, 10);

const entries = SECTIONS.map((s) => ({
  title: s.title,
  files: s.files.map((f) => {
    const raw = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
    const content = raw.replace(/\n$/, "");
    return { path: f, lines: raw.split("\n").length, content };
  }),
}));
const fileCount = entries.reduce((n, s) => n + s.files.length, 0);
const lineCount = entries.reduce((n, s) => n + s.files.reduce((m, f) => m + f.lines, 0), 0);
const withComma = (n) => n.toLocaleString("en-US");

let out = "";
out += "==============================================================================\n";
out += "کد کامل برنامه — سامانهٔ پایش ایستگاه پمپاژ زیرزمینی (تونل انتقال آب گلاب)\n";
out += `نسخهٔ برنامه: ${version}   |   شاخه: ${branch}   |   کامیت: ${commit}\n`;
out += `تاریخ تولید: ${today}   |   ${fileCount} فایل   |   ${withComma(lineCount)} خط\n`;
out += "==============================================================================\n\n";
out += "این فایل، «نسخهٔ خوانا»ی کل کد برنامه است؛ هر فایل کامل و بدون حذف درج شده و\n";
out += "ترتیب بخش‌ها همان ترتیب منطقی خواندن پروژه است. هر فایل با خط زیر جدا می‌شود:\n";
out += "  ── FILE: <مسیر>  (<تعداد خط>) ──\n\n";
out += "درج نشده‌اند: node_modules، .next، .data (داده/بک‌آپ/راز)، drizzle/meta (اسنپ‌شات\n";
out += "خودکار)، package-lock.json (قفل وابستگی)، public/ (لوگو، فونت، تصویر) و اسناد که\n";
out += "فایل‌های جداگانه دارند (docs/*.md و docs/PROMPT_FINAL_FA.txt).\n\n";
out += "فهرست فایل‌ها:\n\n";
entries.forEach((s, i) => {
  out += `  ${FA_NUM[i]}) ${s.title}\n`;
  for (const f of s.files) out += `     ${f.path.padEnd(53)}${f.lines} خط\n`;
  out += "\n";
});
out += "==============================================================================\n\n";
entries.forEach((s, i) => {
  out += "##############################################################################\n";
  out += `#  ${FA_NUM[i]}) ${s.title}\n`;
  out += "##############################################################################\n\n";
  for (const f of s.files) {
    out += `── FILE: ${f.path}  (${f.lines} خط) ──\n\n${f.content}\n\n`;
  }
});

writeFileSync("CODE_ALL_FA.txt", out);
console.log(`CODE_ALL_FA.txt: ${fileCount} فایل، ${withComma(lineCount)} خط، کامیت ${commit}`);
