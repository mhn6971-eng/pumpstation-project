/**
 * تولید pumpstation-v1.2/CODE_ALL_FA.txt — کل کد برنامه در یک فایل متنی.
 *
 *   node scripts/generate-code-all.mjs
 *
 * خروجی قطعی است (ترتیب فایل‌ها ثابت؛ اجرای دوباره = بایت‌به‌بایت یکسان،
 * به‌جز سربرگِ تاریخ/کامیت). درج نمی‌شوند: node_modules، .next، .data،
 * drizzle/meta (اسنپ‌شات خودکار)، public/ (باینری)، docs/*.md (اسناد جدا)،
 * فایل‌های تولیدی (next-env.d.ts و tsconfig.tsbuildinfo) و یادداشت قدیمی
 * پیش‌نمایش (README_PREVIEW_FA.md). ریشهٔ ریپو (.batها) بیرون از محدودهٔ
 * بسته است؛ تحویل ایستگاه با git/zip است، نه با این فایل.
 *
 * خودآزمایی (۱٫۴٫۴): پیش از نوشتن خروجی، بسته در پوشهٔ موقت استخراج و
 * بایت‌به‌بایت با منبع مقایسه می‌شود + فایل‌های حیاتی نصب + shebang +
 * کنترل افتادگی فایل رهگیری‌شده. سپس (مگر GENERATE_SKIP_FRESH_TEST=1)
 * آزمون کامل نصب تازه روی بستهٔ تازه اجرا می‌شود. اگر هر کدام شکست
 * بخورد، خروجی نوشته نمی‌شود (فایل قبلی دست‌نخورده می‌ماند).
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractBundle } from "./extract-code-all.mjs";

const FA_NUM = ["۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

const SECTIONS = [
  { title: "پیکربندی پروژه", files: [
    "package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "eslint.config.mjs",
    "postcss.config.mjs", "drizzle.config.json", ".env.example", ".gitignore",
  ] },
  { title: "دیتابیس و مهاجرت‌ها", files: [
    "src/db/index.ts", "src/db/schema.ts", "src/db/seed.ts", "src/lib/seed-helpers.ts",
    "data/roster.sample.json",
    "drizzle/0000_woozy_omega_flight.sql", "drizzle/0001_hardening.sql",
    "drizzle/0002_resilience.sql", "drizzle/0003_two_factor.sql", "drizzle/0004_mirror_ts.sql",
    "drizzle/0005_megger_pi.sql", "drizzle/0006_alerts_open_unique.sql",
  ] },
  { title: "کتابخانهٔ منطق (src/lib)", files: [
    "src/lib/version.ts", "src/lib/errors.ts", "src/lib/types.ts", "src/lib/log.ts",
    "src/lib/dblock.ts", "src/lib/pin.ts", "src/lib/secret.ts", "src/lib/totp.ts",
    "src/lib/auth.ts", "src/lib/sessions.ts", "src/lib/security.ts", "src/lib/audit.ts",
    "src/lib/jalali.ts", "src/lib/domain.ts", "src/lib/state.ts", "src/lib/motor-history.ts", "src/lib/reporting.ts",
    "src/lib/backup.ts", "src/lib/backup-validation.ts", "src/lib/backup-bundle.ts", "src/lib/mirror.ts", "src/lib/archive.ts",
    "src/lib/roster.ts", "src/lib/netbind.ts", "src/lib/sqlite-cloud.ts",
    "src/lib/bot.ts", "src/lib/zip.ts",
  ] },
  { title: "مسیرهای API (src/app/api)", files: [
    "src/app/api/auth/route.ts", "src/app/api/actions/route.ts", "src/app/api/state/route.ts",
    "src/app/api/history/route.ts", "src/app/api/totals/route.ts",
    "src/app/api/backups/[id]/route.ts", "src/app/api/mirror/route.ts",
    "src/app/api/health/route.ts", "src/app/api/export/route.ts",
    "src/app/api/report-archives/route.ts",
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
    "src/components/AuxTab.tsx", "src/components/RegistryTab.tsx", "src/components/PmTab.tsx", "src/components/ServiceForm.tsx",
    "src/components/ReportsTab.tsx", "src/components/ReportsHub.tsx", "src/components/ChartModal.tsx",
    "src/components/PrintBar.tsx", "src/components/AlertsTab.tsx", "src/components/ProblemsTab.tsx",
    "src/components/TrainingTab.tsx", "src/components/AdminTab.tsx",
    "src/components/TwoFactorPanel.tsx", "src/components/MirrorPanel.tsx",
  ] },
  { title: "اسکریپت‌های عملیاتی (scripts)", files: [
    "scripts/init-db.mjs", "scripts/doctor.mjs", "scripts/reset-admin-pin.mjs",
    "scripts/mirror-backup.mjs", "scripts/pg-init.mjs", "scripts/pg-dump.mjs",
    "scripts/pg-import-json.mjs", "scripts/serve.mjs", "scripts/bulk-import.mjs",
    "scripts/generate-code-all.mjs", "scripts/extract-code-all.mjs", "scripts/test-fresh-install.mjs", "scripts/stackblitz-warning.mjs",
  ] },
  { title: "آزمون‌های خودکار (audit)", files: [
    "audit/audit1.mjs", "audit/audit2.mjs", "audit/audit3.mjs", "audit/audit4.mjs",
    "audit/audit5.mjs", "audit/audit6.mjs", "audit/bulk.mjs", "audit/perf.mjs", "audit/conc.mjs",
    "audit/db-inspect.mjs", "audit/jalali.test.mjs", "audit/probe.mjs", "audit/sess.mjs", "audit/writeperf.mjs",
    "audit/README.md",
  ] },
  { title: "استقرار و CI", files: [
    "deploy/Caddyfile", "deploy/nginx.conf", "../.github/workflows/ci.yml",
  ] },
];

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
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
out += "خودکار)، public/ (لوگو، فونت، تصویر: باینری) و اسناد که\n";
out += "فایل‌های جداگانه دارند (docs/*.md و docs/PROMPT_FINAL_FA.txt).\n";
out += "ریشهٔ ریپو (.batهای ویندوز) بیرون از محدودهٔ این بسته است.\n\n";
out += "فهرست فایل‌ها:\n\n";
entries.forEach((s, i) => {
  out += `  ${FA_NUM[i]}) ${s.title}\n`;
  for (const f of s.files) out += `     ${f.path.padEnd(53)}${f.lines} خط\n`;
  out += "\n";
});
out += "==============================================================================\n\n";
// در بدنه فقط مارکرهای FILE باقی می‌مانند؛ تیترهای بخش در فهرست ابتدای فایل هستند.
// این کار جلوی چسبیدن جداکننده‌های نمایشی به محتوای فایل در پارسرهای ساده را می‌گیرد.
for (const s of entries) {
  for (const f of s.files) {
    out += `── FILE: ${f.path}  (${f.lines} خط) ──\n\n${f.content}\n\n`;
  }
}

// ---------- خودآزمایی بسته: استخراج ←→ مقایسه (اگر شکست: بدون خروجی) ----------
writeFileSync("CODE_ALL_FA.txt.tmp", out);
const selfDir = mkdtempSync(path.join(os.tmpdir(), "codeall-selftest-"));
try {
  const { files } = extractBundle("CODE_ALL_FA.txt.tmp", selfDir);
  const listed = new Set();
  for (const sec of SECTIONS) for (const f of sec.files) listed.add(f);
  for (const f of files) {
    const a = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
    const b = readFileSync(path.join(selfDir, f), "utf8");
    if (a !== b) throw new Error(`self-test: ${f} پس از استخراج با منبع فرق دارد`);
  }
  for (const must of ["package.json", "package-lock.json", "src/components/PmTab.tsx", "drizzle/0005_megger_pi.sql", "drizzle/0006_alerts_open_unique.sql", "scripts/extract-code-all.mjs", "scripts/generate-code-all.mjs"]) {
    if (!listed.has(must)) throw new Error(`self-test: ${must} در بسته نیست`);
  }
  for (const f of ["audit/audit5.mjs", "scripts/mirror-backup.mjs", "scripts/pg-init.mjs", "scripts/pg-dump.mjs", "scripts/pg-import-json.mjs"]) {
    const first = readFileSync(path.join(selfDir, f), "utf8").split("\n")[0];
    if (first !== "#!/usr/bin/env node") throw new Error(`self-test: shebang ${f} در خط اول نیست`);
  }
  try {
    const tracked = execSync("git ls-files --full-name", { encoding: "utf8" }).split("\n").filter(Boolean);
    const deleted = new Set(execSync("git ls-files --deleted --full-name", { encoding: "utf8" }).split("\n").filter(Boolean));
    const excluded = (t) => t.startsWith("pumpstation-v1.2/docs/") || t.startsWith("pumpstation-v1.2/public/") || t.startsWith("pumpstation-v1.2/drizzle/meta/") ||
      ["pumpstation-v1.2/CODE_ALL_FA.txt", "pumpstation-v1.2/README_PREVIEW_FA.md", "pumpstation-v1.2/next-env.d.ts", "pumpstation-v1.2/tsconfig.tsbuildinfo"].includes(t);
    for (const t of tracked) {
      if (!t.startsWith("pumpstation-v1.2/") || deleted.has(t) || excluded(t)) continue;
      const rel = t.slice("pumpstation-v1.2/".length);
      if (!listed.has(rel)) throw new Error(`self-test: ${rel} رهگیری می‌شود ولی در بسته نیست`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("self-test:")) throw error;
    console.warn("هشدار خودآزمایی: git در دسترس نیست؛ بررسی افتادگی رد شد");
  }
} catch (error) {
  rmSync("CODE_ALL_FA.txt.tmp", { force: true });
  rmSync(selfDir, { recursive: true, force: true });
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
rmSync(selfDir, { recursive: true, force: true });
// گیت کامل نصب (بخش ۵): استخراج ← نصب ← مهاجرت ← بیلد ← استارت ← تست.
// با GENERATE_SKIP_FRESH_TEST=1 رد می‌شود (فقط خودآزمایی سریع می‌ماند).
if (process.env.GENERATE_SKIP_FRESH_TEST !== "1") {
  console.log("self-test کامل: آزمون نصب تازه از بستهٔ تازه…");
  try {
    execFileSync(process.execPath, ["scripts/test-fresh-install.mjs"], {
      stdio: "inherit",
      env: { ...process.env, FRESH_BUNDLE: path.resolve("CODE_ALL_FA.txt.tmp") },
    });
  } catch {
    rmSync("CODE_ALL_FA.txt.tmp", { force: true });
    console.error("self-test کامل شکست خورد؛ خروجی نوشته نشد");
    process.exit(1);
  }
}
renameSync("CODE_ALL_FA.txt.tmp", "CODE_ALL_FA.txt");
console.log(`CODE_ALL_FA.txt: ${fileCount} فایل، ${withComma(lineCount)} خط، کامیت ${commit}`);
