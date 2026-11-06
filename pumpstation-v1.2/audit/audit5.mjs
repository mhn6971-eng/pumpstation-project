#!/usr/bin/env node
/**
 * audit5 — ورود دوعاملی (TOTP)، آینهٔ بک‌آپ، هدرهای امنیتی و آمادگی HTTPS/PostgreSQL
 *
 *   BASE=http://127.0.0.1:3000 node audit/audit5.mjs
 *
 * نکته: پیاده‌سازی TOTP در این فایل مستقل از کد سرور نوشته شده (base32 + HMAC-SHA1)
 * تا صحت کد سرور را واقعاً بسنجد، نه اینکه همان تابع را دوباره صدا بزند.
 */
import crypto from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { verifyTotp as verifyTotpUnderTest } from "../src/lib/totp.ts";

const BASE = (process.env.BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const ADMIN_PIN = process.env.ADMIN_PIN ?? "9009";

let pass = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ---------------- TOTP مستقل (RFC 6238) ---------------- */
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of input.toUpperCase().replace(/=+$/, "").replace(/\s/g, "")) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpCode(secret, at = Date.now(), step = 30, digits = 6) {
  const counter = Math.floor(at / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter % 2 ** 32, 4);
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const num = ((hmac[offset] & 127) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(num % 10 ** digits).padStart(digits, "0");
}

/* ---------------- ابزار HTTP ---------------- */
let cookie = "";

async function call(pathname, { method = "GET", body, headers = {}, keepCookie = true } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    if (raw.startsWith("ps_session=")) {
      const pair = raw.split(";")[0];
      if (keepCookie) cookie = pair;
      return { res, json: await safeJson(res), setCookie: raw };
    }
  }
  return { res, json: await safeJson(res), setCookie: "" };
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

const act = (action, payload = {}) => call("/api/actions", { method: "POST", body: { action, payload } });
const login = (key, pin, totp) => call("/api/auth", { method: "POST", body: { key, pin, ...(totp ? { totp } : {}) } });

function section(title) {
  console.log(`\n${title}`);
}

async function main() {
  console.log(`audit5 — ${BASE}`);

  /* ---------- ۱) هدرهای امنیتی و آمادگی HTTPS ---------- */
  section("۱) هدرهای امنیتی و آمادگی HTTPS");
  const home = await call("/");
  const h = home.res.headers;
  check("پاسخ صفحهٔ اصلی ۲۰۰ یا ریدایرکت است", home.res.status === 200 || home.res.status === 307, String(home.res.status));
  check("X-Content-Type-Options: nosniff", h.get("x-content-type-options") === "nosniff");
  check("X-Frame-Options: SAMEORIGIN", h.get("x-frame-options") === "SAMEORIGIN");
  const csp = h.get("content-security-policy") ?? "";
  check("CSP با frame-ancestors و object-src none", csp.includes("frame-ancestors") && csp.includes("object-src 'none'"));
  const hsts = h.get("strict-transport-security");
  const secureMode = process.env.COOKIE_SECURE === "1" || process.env.FORCE_HTTPS === "1";
  check(
    secureMode ? "HSTS در حالت HTTPS فعال فرستاده می‌شود" : "HSTS در حالت HTTP محلی فرستاده نمی‌شود",
    secureMode ? Boolean(hsts) : !hsts,
    String(hsts),
  );

  const health = await call("/api/health");
  check("سلامت سرویس ok است", health.json?.ok === true);
  check("حالت دیتابیس گزارش می‌شود", ["pglite", "postgres"].includes(health.json?.db?.mode), String(health.json?.db?.mode));
  const healthText = JSON.stringify(health.json ?? {});
  check("پاسخ سلامت راز/PIN افشا نمی‌کند", !/password|scrypt|secret|pinHash/i.test(healthText));

  /* ---------- ۲) ورود دوعاملی ---------- */
  section("۲) ورود دوعاملی (TOTP)");
  cookie = "";
  const first = await login("admin", ADMIN_PIN);
  check("ورود ادمین با PIN", first.res.status === 200 && first.json?.ok === true, String(first.res.status));
  const setCookie = first.setCookie;
  check("کوکی نشست HttpOnly است", /HttpOnly/i.test(setCookie));
  check("کوکی نشست SameSite دارد", /SameSite=(lax|strict)/i.test(setCookie));
  check("کوکی نشست Secure فقط در حالت HTTPS", secureMode ? /Secure/i.test(setCookie) : !/Secure/i.test(setCookie));

  await act("admin.unlock", { key: "all" });

  // وضعیت اولیه
  const st0 = await act("totp.status");
  check("وضعیت دوعاملی خوانده می‌شود", st0.json?.ok === true && typeof st0.json?.enabled === "boolean");
  if (st0.json?.enabled) {
    // اگر قبلاً فعال مانده، همان را خاموش کن تا تست از حالت مشخص شروع شود
    await act("totp.disable", { pin: ADMIN_PIN });
  }

  const begin = await act("totp.begin");
  const secret = String(begin.json?.secret ?? "");
  check("راز TOTP ساخته می‌شود (Base32، ۳۲ کاراکتر)", /^[A-Z2-7]{32}$/.test(secret), secret.slice(0, 8));
  check("نشانی otpauth ساخته می‌شود", String(begin.json?.otpauth ?? "").startsWith("otpauth://totp/"), String(begin.json?.otpauth ?? "").slice(0, 24));
  check("راز در پاسخ، خطا/پیام امنیتی هم دارد", Boolean(begin.json?.message));

  const badEnable = await act("totp.enable", { code: "000000" });
  check("کد نادرست فعال‌سازی نمی‌کند", badEnable.res.status >= 400);

  const enable = await act("totp.enable", { code: totpCode(secret) });
  const backupCodes = Array.isArray(enable.json?.backupCodes) ? enable.json.backupCodes : [];
  check("فعال‌سازی با کد درست", enable.res.status === 200 && enable.json?.ok === true, String(enable.res.status));
  check("۱۰ کد پشتیبان صادر می‌شود", backupCodes.length === 10, String(backupCodes.length));
  check("قالب کد پشتیبان XXXX-XXXX است", backupCodes.every((c) => /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c)), backupCodes[0]);
  check("secret خراب TOTP به false تبدیل می‌شود، نه exception", verifyTotpUnderTest("not-a-valid-secret", "123456") === false);

  const externalBackup = await act("backup.create");
  const externalBackupFile = String(externalBackup.json?.file ?? "");
  const externalBackupPayload = externalBackupFile ? JSON.parse(await readFile(externalBackupFile, "utf8")) : null;
  const exportedShifts = externalBackupPayload?.shifts ?? [];
  check("JSON خارجی هیچ راز/کد TOTP ندارد", exportedShifts.length > 0 && exportedShifts.every((row) => row.totpSecret === "" && row.totpPending === "" && row.totpEnabled === false && Array.isArray(row.totpBackupCodes) && row.totpBackupCodes.length === 0 && row.totpEnabledAt === ""));
  const restoredExternalBackup = await act("backup.restore_file", { file: externalBackupFile });
  check("بازیابی JSON محلی، TOTP فعلی را حفظ می‌کند", restoredExternalBackup.res.status === 200 && String(restoredExternalBackup.json?.message ?? "").includes("TOTP"), String(restoredExternalBackup.res.status));

  // ورود بدون کد
  cookie = "";
  const noCode = await login("admin", ADMIN_PIN);
  check("ورود بدون کد رد می‌شود (401 needsTotp)", noCode.res.status === 401 && noCode.json?.needsTotp === true, String(noCode.res.status));

  // ورود با کد نادرست
  cookie = "";
  const wrongCode = await login("admin", ADMIN_PIN, "123456");
  check("کد نادرست اجازهٔ ورود نمی‌دهد", wrongCode.res.status === 401 || wrongCode.res.status === 429, String(wrongCode.res.status));

  // ورود با کد درست
  cookie = "";
  const okCode = await login("admin", ADMIN_PIN, totpCode(secret));
  check("ورود با کد درست", okCode.res.status === 200 && okCode.json?.twoFactor === true, String(okCode.res.status));

  // شیفت دیگر همچنان فقط با PIN وارد می‌شود (دوعاملی فقط برای ادمین فعال است)
  cookie = "";
  const other = await login("A", "1011");
  check("شیفت بدون دوعاملی با PIN وارد می‌شود", other.res.status === 200, String(other.res.status));
  await act("admin.unlock", { key: "all" });

  // ورود با کد پشتیبان (حروف کوچک و بدون خط تیره — نرمال‌سازی)
  cookie = "";
  const bc = String(backupCodes[0]).toLowerCase().replace("-", "");
  const okBackup = await login("admin", ADMIN_PIN, bc);
  check("ورود با کد پشتیبان (نرمال‌سازی حروف/خط تیره)", okBackup.res.status === 200, String(okBackup.res.status));
  check("تعداد کدهای باقی‌مانده درست است (۹)", okBackup.json?.backupCodesLeft === 9, String(okBackup.json?.backupCodesLeft));

  // استفادهٔ دوباره از همان کد پشتیبان
  cookie = "";
  const reuse = await login("admin", ADMIN_PIN, bc);
  check("کد پشتیبان یک‌بارمصرف است", reuse.res.status === 401 || reuse.res.status === 429, String(reuse.res.status));

  // بازگشت به حالت ادمینِ وارد‌شده
  cookie = "";
  await login("admin", ADMIN_PIN, totpCode(secret));
  await act("admin.unlock", { key: "all" });

  // صدور مجدد کدهای پشتیبان
  const badRegen = await act("totp.codes", { pin: "0000" });
  check("صدور مجدد کد با PIN نادرست رد می‌شود", badRegen.res.status >= 400);
  const regen = await act("totp.codes", { pin: ADMIN_PIN });
  check("صدور مجدد با PIN درست", regen.res.status === 200 && (regen.json?.backupCodes?.length ?? 0) === 10);
  const oldCodeNow = await (async () => {
    cookie = "";
    return login("admin", ADMIN_PIN, String(backupCodes[1]).toLowerCase().replace("-", ""));
  })();
  check("کدهای پشتیبان قبلی پس از صدور مجدد باطل‌اند", oldCodeNow.res.status === 401 || oldCodeNow.res.status === 429);

  cookie = "";
  await login("admin", ADMIN_PIN, totpCode(secret));
  await act("admin.unlock", { key: "all" });

  // غیرفعال‌سازی
  const badDisable = await act("totp.disable", { pin: "0000" });
  check("غیرفعال‌سازی با PIN نادرست رد می‌شود", badDisable.res.status >= 400);
  const disable = await act("totp.disable", { pin: ADMIN_PIN });
  check("غیرفعال‌سازی با PIN درست", disable.res.status === 200, String(disable.res.status));

  cookie = "";
  const afterDisable = await login("admin", ADMIN_PIN);
  check("پس از غیرفعال‌سازی، ورود با PIN کافی است", afterDisable.res.status === 200 && afterDisable.json?.twoFactor === false);
  await act("admin.unlock", { key: "all" });

  /* ---------- ۳) آینهٔ بک‌آپ ---------- */
  section("۳) آینهٔ بک‌آپ (کپی روی حافظهٔ بیرونی)");
  cookie = "";
  const anonMirror = await call("/api/mirror");
  check("دسترسی ناشناس به وضعیت آینه ۴۰۱ است", anonMirror.res.status === 401, String(anonMirror.res.status));

  await login("admin", ADMIN_PIN);
  await act("admin.unlock", { key: "all" });

  const status0 = await call("/api/mirror");
  check("ادمین وضعیت آینه را می‌بیند", status0.res.status === 200 && typeof status0.json?.dir === "string");
  check("حکم سلامت آینه معتبر است", ["ok", "stale", "missing", "failing"].includes(status0.json?.verdict), String(status0.json?.verdict));

  const badToken = await call("/api/mirror", { method: "POST", headers: { "x-mirror-token": "invalid-token-value" } });
  check("توکن نامعتبر آینه ۴۰۳ می‌گیرد", badToken.res.status === 403, String(badToken.res.status));

  const historicalReading = await act("process.set", { tag: "PIT-001", value: 4.2, day: "1400/01/01", intervalIndex: 0 });
  check("قرائت تاریخی برای آزمون آرشیو ثبت شد", historicalReading.res.status === 200, String(historicalReading.res.status));
  const archived = await act("data.archive", { years: 1 });
  check("قرائت تاریخی به جدول آرشیو منتقل شد", archived.res.status === 200 && Number(archived.json?.processRows ?? 0) >= 1, String(archived.json?.processRows ?? archived.res.status));

  const bundleChannel = await act("admin.channel", { key: "backup", provider: "bale", chatId: "bundle-audit-channel", token: "BUNDLE-SECRET-TEST", enabled: true });
  check("کانال آزمایشی برای سنجش redaction آماده است", bundleChannel.res.status === 200, String(bundleChannel.res.status));

  const pdfForm = new FormData();
  pdfForm.append("tag", "AUDIT-BUNDLE");
  pdfForm.append("file", new Blob(["%PDF-1.4\\n% bundle integration test\\n"], { type: "application/pdf" }), "audit-bundle.pdf");
  const uploadedPdf = await fetch(`${BASE}/api/catalogs`, { method: "POST", headers: { Cookie: cookie }, body: pdfForm });
  const uploadedPdfJson = await safeJson(uploadedPdf);
  check("PDF آزمایشی در کاتالوگ بارگذاری شد", uploadedPdf.status === 200 && Number(uploadedPdfJson?.id) > 0, String(uploadedPdfJson?.error ?? uploadedPdf.status));

  const bundleCreated = await act("backup.bundle.create");
  const bundleName = String(bundleCreated.json?.name ?? "");
  check("بستهٔ بازیابی شامل snapshot همهٔ جدول‌ها ساخته می‌شود", bundleCreated.res.status === 200 && bundleCreated.json?.ok === true && bundleName.startsWith("pumpstation-bundle-"), String(bundleCreated.res.status));
  const bundleVerified = await act("backup.bundle.verify", { name: bundleName });
  check("بستهٔ بازیابی checksum جدول‌ها/فایل‌ها را تأیید می‌کند", bundleVerified.res.status === 200 && bundleVerified.json?.ok === true && bundleVerified.json?.complete === true, String(bundleVerified.json?.error ?? bundleVerified.res.status));
  check("بسته هم قرائت بایگانی و هم PDF را دارد", Number(bundleVerified.json?.tableCounts?.processReadingsArchive ?? 0) >= 1 && Number(bundleVerified.json?.assets ?? 0) >= 2, JSON.stringify({ archive: bundleVerified.json?.tableCounts?.processReadingsArchive, assets: bundleVerified.json?.assets }));

  const mirrorNow = await act("mirror.now");
  check("کپی تازه روی آینه انجام شد", mirrorNow.res.status === 200 && mirrorNow.json?.ok === true, String(mirrorNow.res.status));
  check("هش کپی گزارش می‌شود", /^[0-9a-f]{64}$/.test(String(mirrorNow.json?.sha256 ?? "")), String(mirrorNow.json?.sha256 ?? "").slice(0, 12));
  check("بستهٔ کامل نیز به آینه کپی می‌شود", mirrorNow.json?.bundle === bundleName, String(mirrorNow.json?.bundle ?? ""));
  const mirroredBundleManifest = path.join(String(mirrorNow.json?.target ?? ""), "bundles", bundleName, "manifest.json");
  check("manifest بسته روی آینه موجود است", await readFile(mirroredBundleManifest, "utf8").then((text) => JSON.parse(text).name === bundleName).catch(() => false));

  // بررسی فیزیکی: فایل روی آینه هست و هشش با مبدأ یکی است
  const mirrorDir = String(mirrorNow.json?.target ?? "");
  const fileName = String(mirrorNow.json?.file ?? "");
  const sourcePath = path.resolve(process.env.BACKUP_DIR ?? ".data/backups", fileName);
  const destPath = path.resolve(mirrorDir, fileName);
  let physicallyVerified = false;
  let verifyDetail = "";
  try {
    const [src, dst] = await Promise.all([readFile(sourcePath), readFile(destPath)]);
    const hs = crypto.createHash("sha256").update(src).digest("hex");
    const hd = crypto.createHash("sha256").update(dst).digest("hex");
    physicallyVerified = hs === hd && hs === mirrorNow.json?.sha256;
    verifyDetail = hs.slice(0, 12);
  } catch (error) {
    verifyDetail = error instanceof Error ? error.message : String(error);
  }
  check("فایل آینه فیزیکی است و هش با مبدأ یکی است", physicallyVerified, verifyDetail);
  check("فایل .sha256 هم روی آینه کپی شده", await readFile(`${destPath}.sha256`, "utf8").then((t) => /^[0-9a-f]{64}$/.test(t.trim())).catch(() => false));

  const status1 = await act("mirror.status");
  check("آخرین اجرای آینه در سابقه ثبت شده", status1.json?.last?.ok === true && status1.json?.last24 >= 1, JSON.stringify({ last24: status1.json?.last24 }));
  check("حکم آینه پس از کپی سالم است", status1.json?.verdict === "ok", String(status1.json?.verdict));
  check("نگه‌داری نسخه‌های آینه نامحدود است", status1.json?.keep === "نامحدود", String(status1.json?.keep));

  // اجرای زمان‌بند با توکن محلی (همان مسیری که Task Scheduler استفاده می‌کند)
  const tokenPath = path.resolve(process.env.MIRROR_TOKEN_FILE ?? ".data/mirror-token");
  const token = await readFile(tokenPath, "utf8").then((t) => t.trim()).catch(() => "");
  check("توکن محلی زمان‌بند وجود دارد", token.length >= 32, String(token.length));
  const cronRun = await call("/api/mirror", { method: "POST", headers: { "x-mirror-token": token } });
  check("اجرای زمان‌بند با توکن محلی موفق است", cronRun.res.status === 200 && cronRun.json?.ok === true, String(cronRun.res.status));
  const mirrorFiles = await readdir(mirrorDir).catch(() => []);
  check("نسخه‌های بک‌آپ روی آینه نگه‌داری می‌شوند", mirrorFiles.filter((f) => f.endsWith(".json")).length >= 1, String(mirrorFiles.length));

  /* ---------- ۴) آمادگی PostgreSQL ---------- */
  section("۴) آمادگی مهاجرت PostgreSQL");
  const healthFull = await call("/api/health?full=1");
  check("گزارش کامل سلامت برای ادمین", healthFull.res.status === 200);
  const migrations = healthFull.json?.detail?.migrations ?? [];
  const names = migrations.map((m) => m.name);
  check("مهاجرت‌های ۰۰۰۰ تا ۰۰۰۴ ثبت شده‌اند", ["0000", "0001", "0002", "0003", "0004"].every((p) => names.some((n) => String(n).startsWith(p))), names.join(","));
  check("وضعیت آینه در گزارش کامل هست", Boolean(healthFull.json?.detail?.mirror?.verdict));
  const mode = healthFull.json?.db?.mode;
  check("حالت دیتابیس با تنظیمات هم‌خوان است", mode === (process.env.DATABASE_URL ? "postgres" : "pglite"), String(mode));

  const bundleRestore = await act("backup.bundle.restore", { name: bundleName });
  check("بازیابی بسته اتمیک است و نسخهٔ ایمنی می‌سازد", bundleRestore.res.status === 200 && bundleRestore.json?.ok === true && String(bundleRestore.json?.safetyBundle ?? "").startsWith("pumpstation-bundle-"), String(bundleRestore.json?.error ?? bundleRestore.res.status));
  check("توکن کانال مقصد یکسان هنگام restore حفظ می‌شود", !((bundleRestore.json?.channelsNeedSetup ?? [])).includes("backup"), JSON.stringify(bundleRestore.json?.channelsNeedSetup));
  const restoredStats = await act("data.stats");
  check("پس از بازیابی، قرائت بایگانی‌شده در دیتابیس هست", Number(restoredStats.json?.archive?.archive?.process ?? 0) >= 1, JSON.stringify(restoredStats.json?.archive?.archive));
  const restoredPdf = await fetch(`${BASE}/api/catalogs?id=${Number(uploadedPdfJson?.id)}`, { headers: { Cookie: cookie } });
  check("پس از بازیابی، PDF پیوست قابل دریافت است", restoredPdf.status === 200 && restoredPdf.headers.get("content-type") === "application/pdf", String(restoredPdf.status));

  /* ---------- پایان ---------- */
  await act("admin.unlock", { key: "all" });
  const total = pass + failures.length;
  console.log(`\naudit5: ${pass}/${total}`);
  if (failures.length) {
    console.log("موارد ناموفق:");
    for (const f of failures) console.log(` - ${f}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("خطای اجرای audit5:", error);
  process.exit(1);
});
