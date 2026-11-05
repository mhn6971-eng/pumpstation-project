/**
 * ورود گروهی قرائت‌ها از CSV از مسیر رسمی API (نسخهٔ ۱٫۴٫۱).
 *
 *   node scripts/bulk-import.mjs --file rows.csv --shift A --pin 1011 --confirm-test
 *   node scripts/bulk-import.mjs --file rows.csv --dry-run   (بدون نوشتن؛ فقط بررسی و گزارش)
 *
 * ستون‌های CSV (با سطر سربرگ): day,interval,scope,tag,param,value
 *   scope=process → tag مثل PIT-001 (param نادیده) — یک درخواست برای هر سطر
 *   scope=motor   → tag مثل M-01 و param مثل I1 — سطرهای هم‌روز/هم‌بازه/هم‌موتور یکی می‌شوند
 *   scope=total   → فقط value (یک عدد برای هر روز)
 *
 * ایمنی: بدون --confirm-test هیچ چیزی نوشته نمی‌شود (--dry-run استثناست)؛
 * پیش‌فرض فقط به خودِ دستگاه وصل می‌شود (--allow-remote برای آدرس بیرونی).
 * هر درخواست کلید یکتایی قطعی دارد؛ اگر وسط کار قطع شود، اجرای دوباره
 * سطرهای قبلی را تکرارِ بی‌اثر می‌کند (نه ثبت دوباره).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isValidJalaliDay } from "../src/lib/jalali.ts";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.findIndex((a) => a === name);
  return i >= 0 ? (args[i + 1] ?? "").trim() : "";
};
const has = (name) => args.includes(name);

const file = flag("--file");
const shift = flag("--shift") || "A";
const pin = flag("--pin");
const base = (flag("--base") || "http://127.0.0.1:3000").replace(/\/$/, "");
const chunkSize = Math.max(1, Number(flag("--chunk") || 50));
const dryRun = has("--dry-run");
const confirmed = has("--confirm-test");

if (!file) {
  console.error("استفاده: node scripts/bulk-import.mjs --file rows.csv --shift A --pin **** [--dry-run | --confirm-test]");
  process.exit(1);
}
if (!dryRun && !confirmed) {
  console.error("بدون --confirm-test هیچ چیزی نوشته نمی‌شود (تأیید می‌کنید دیتابیس مقصد آزمایشی است). برای بررسی بدون نوشتن: --dry-run");
  process.exit(1);
}
if (!dryRun && !pin) {
  console.error("--pin لازم است.");
  process.exit(1);
}
let baseUrl;
try {
  baseUrl = new URL(base);
} catch {
  console.error(`آدرس مقصد نامعتبر است: ${base}`);
  process.exit(1);
}
const localHost = ["127.0.0.1", "localhost", "::1"].includes(baseUrl.hostname);
if (!localHost && !has("--allow-remote")) {
  console.error(`مقصد ${base} دستگاه خودمان نیست؛ برای ادامه --allow-remote را اضافه کنید.`);
  process.exit(1);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (lines.length < 2) return { header: [], rows: [] };
  const split = (line) => line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const header = split(lines[0]).map((h) => h.toLowerCase());
  return { header, rows: lines.slice(1).map((line, i) => ({ lineNo: i + 2, cells: split(line) })) };
}

const { header, rows } = parseCsv(readFileSync(file, "utf8"));
const need = ["day", "interval", "scope", "tag", "param", "value"];
const missing = need.filter((c) => !header.includes(c));
if (missing.length) {
  console.error(`ستون‌های لازم در CSV نیست: ${missing.join("، ")} (لازم: ${need.join(",")})`);
  process.exit(1);
}
const col = (row, name) => row.cells[header.indexOf(name)] ?? "";

const failures = [];   // { lineNo, reason }
const requests = [];   // { action, payload }
const motorGroups = new Map(); // day|interval|tag -> { day, intervalIndex, tag, values }

for (const row of rows) {
  const fail = (reason) => failures.push({ lineNo: row.lineNo, reason });
  const day = col(row, "day");
  const intervalIndex = Number(col(row, "interval"));
  const scope = col(row, "scope").toLowerCase();
  const tag = col(row, "tag");
  const param = col(row, "param");
  const value = Number(col(row, "value"));
  if (!isValidJalaliDay(day)) { fail(`روز نامعتبر: ${day}`); continue; }
  if (!Number.isInteger(intervalIndex) || intervalIndex < 0 || intervalIndex > 5) { fail(`بازه نامعتبر: ${col(row, "interval")}`); continue; }
  if (!Number.isFinite(value)) { fail(`مقدار نامعتبر: ${col(row, "value")}`); continue; }
  if (scope === "process") {
    if (!tag) { fail("تگ خالی است"); continue; }
    requests.push({ action: "process.set", payload: { tag, value, day, intervalIndex } });
  } else if (scope === "motor") {
    if (!tag || !param) { fail("تگ یا پارامتر خالی است"); continue; }
    const key = `${day}|${intervalIndex}|${tag}`;
    if (!motorGroups.has(key)) motorGroups.set(key, { day, intervalIndex, tag, values: {} });
    motorGroups.get(key).values[param] = value;
  } else if (scope === "total") {
    requests.push({ action: "total.set", payload: { value, day } });
  } else {
    fail(`نوع نامعتبر (process/motor/total): ${col(row, "scope")}`);
  }
}
for (const g of motorGroups.values()) {
  requests.push({ action: "motor.values", payload: { tag: g.tag, values: g.values, day: g.day, intervalIndex: g.intervalIndex } });
}

console.log(`سطرها: ${rows.length} | درخواست‌ها: ${requests.length} | سطر خراب: ${failures.length}`);
if (dryRun) {
  console.log("(حالت بررسی: چیزی نوشته نشد.)");
  for (const f of failures.slice(0, 20)) console.log(`  سطر ${f.lineNo}: ${f.reason}`);
  if (failures.length > 20) console.log(`  … و ${failures.length - 20} مورد دیگر`);
  process.exit(failures.length ? 1 : 0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idemKey = (req) => `bulk-${createHash("sha1").update(JSON.stringify(req)).digest("hex").slice(0, 32)}`;

const login = await fetch(`${base}/api/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ key: shift, pin }),
});
if (!login.ok) {
  console.error(`ورود ناموفق (${login.status})؛ شیفت/PIN یا آدرس مقصد را بررسی کنید.`);
  process.exit(1);
}
const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
if (!cookie) {
  console.error("ورود کوکی برنگرداند؛ ادامه ممکن نیست.");
  process.exit(1);
}

let ok = 0, replayed = 0;
const sendFailures = [];
for (let i = 0; i < requests.length; i += 1) {
  const req = requests[i];
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const res = await fetch(`${base}/api/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie, "Idempotency-Key": idemKey(req) },
      body: JSON.stringify(req),
    });
    if (res.status === 429 && attempt <= 4) {
      const wait = Math.min(300, Math.max(1, Number(res.headers.get("Retry-After") ?? 60)));
      console.log(`  … سقف نرخ؛ ${wait} ثانیه صبر و ادامه (درخواست ${i + 1}/${requests.length})`);
      await sleep(wait * 1000);
      continue;
    }
    const body = await res.json().catch(() => null);
    if (res.ok && body?.ok) {
      if (res.headers.get("idempotent-replay")) replayed += 1; else ok += 1;
    } else {
      sendFailures.push({ n: i + 1, action: req.action, error: body?.error ?? `HTTP ${res.status}` });
    }
    break;
  }
  if ((i + 1) % chunkSize === 0 && i + 1 < requests.length) {
    console.log(`  … ${i + 1}/${requests.length} ارسال شد؛ مکث کوتاه`);
    await sleep(1000);
  }
}

// نمونه‌بینی: یک قلم فرآیندی و یک قلم موتوری را از تاریخچه می‌خوانیم
const verify = [];
const sampleProcess = requests.find((r) => r.action === "process.set");
const sampleMotor = requests.find((r) => r.action === "motor.values");
async function checkHistory(url, needle) {
  try {
    const res = await fetch(url, { headers: { cookie } });
    const text = await res.text();
    return res.ok && text.includes(needle);
  } catch {
    return false;
  }
}
if (sampleProcess) {
  const p = sampleProcess.payload;
  const good = await checkHistory(
    `${base}/api/history?scope=process&tag=${encodeURIComponent(p.tag)}&from=${encodeURIComponent(p.day)}&to=${encodeURIComponent(p.day)}`,
    String(p.value),
  );
  verify.push(`نمونهٔ فرآیندی ${p.tag}=${p.value}: ${good ? "پیدا شد ✓" : "پیدا نشد ✗"}`);
}
if (sampleMotor) {
  const p = sampleMotor.payload;
  const firstParam = Object.keys(p.values)[0];
  const good = await checkHistory(
    `${base}/api/history?scope=motor&tag=${encodeURIComponent(p.tag)}&param=${encodeURIComponent(firstParam)}&from=${encodeURIComponent(p.day)}&to=${encodeURIComponent(p.day)}`,
    String(p.values[firstParam]),
  );
  verify.push(`نمونهٔ موتوری ${p.tag}/${firstParam}=${p.values[firstParam]}: ${good ? "پیدا شد ✓" : "پیدا نشد ✗"}`);
}

console.log("--- گزارش ---");
console.log(`موفق: ${ok} | تکراریِ بی‌اثر: ${replayed} | ناموفق: ${sendFailures.length} | سطر خراب: ${failures.length}`);
for (const f of failures.slice(0, 10)) console.log(`  سطر ${f.lineNo}: ${f.reason}`);
for (const f of sendFailures.slice(0, 10)) console.log(`  درخواست ${f.n} (${f.action}): ${f.error}`);
for (const v of verify) console.log(`  ${v}`);
process.exit(sendFailures.length || failures.length ? 1 : 0);
