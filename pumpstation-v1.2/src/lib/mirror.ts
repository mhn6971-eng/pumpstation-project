import { createHash, timingSafeEqual } from "node:crypto";
import { randomBytes } from "node:crypto";
import { chmod, copyFile, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { backupMirrorRuns } from "@/db/schema";
import { BACKUP_DIR, createInternalBackup, listFileBackups, writeFileBackup } from "./backup";
import { copyLatestBundleTo } from "./backup-bundle";

/**
 * آینهٔ بک‌آپ: کپی خودکار آخرین نسخهٔ بک‌آپ روی حافظهٔ بیرونی (فلش/درایو USB/شبکهٔ محلی).
 * اگر دستگاه اصلی از بین برود (سرقت، آتش، خرابی دیسک) نسخهٔ سالم روی رسانهٔ دوم باقی می‌ماند.
 * همهٔ اجراها در جدول backup_mirror_runs ثبت می‌شود تا سلامت آینه قابل پایش باشد.
 */

export const MIRROR_DIR = path.resolve(process.cwd(), process.env.MIRROR_DIR ?? ".data/mirror");
const STALE_HOURS = Number(process.env.MIRROR_STALE_HOURS ?? 30);

export type MirrorRun = {
  id: number;
  at: string;
  ts: number;
  file: string;
  target: string;
  bytes: number;
  ok: boolean;
  error: string;
};

async function sha256File(file: string) {
  const buf = await readFile(/*turbopackIgnore: true*/ file);
  return createHash("sha256").update(buf).digest("hex");
}

async function ensureDir() {
  await mkdir(/*turbopackIgnore: true*/ MIRROR_DIR, { recursive: true });
  const probe = path.join(MIRROR_DIR, ".mirror-probe");
  await writeFile(/*turbopackIgnore: true*/ probe, String(Date.now()), "utf8");
  await unlink(/*turbopackIgnore: true*/ probe);
}

/** آیا رسانهٔ آینه در دسترس است؟ (فلش کشیده‌شده = false) */
export async function mirrorAvailable() {
  try {
    await ensureDir();
    return true;
  } catch {
    return false;
  }
}

/**
 * کپی آخرین بک‌آپ فایلی به آینه + بررسی صحت با sha256.
 * اگر بک‌آپ فایلی تازه نبود، اول یکی می‌سازد (پس همیشه نتیجه: یک نسخهٔ سالم روی آینه).
 */
let chain: Promise<unknown> = Promise.resolve();

/** اجرای سریالی: دو درخواست هم‌زمان نباید دو نسخهٔ هم‌نام بسازند و هش را خراب کنند */
export function mirrorLatest(opts: { fresh?: boolean; actor?: string } = {}) {
  const run = chain.then(() => mirrorLatestOnce(opts), () => mirrorLatestOnce(opts));
  chain = run.catch(() => {});
  return run;
}

async function mirrorLatestOnce(opts: { fresh?: boolean; actor?: string } = {}) {
  const at = new Date().toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
  const stamp = new Date().toISOString();
  let file = "";
  try {
    await ensureDir();
    if (opts.fresh) {
      const made = await writeFileBackup(`آینه ${opts.actor ?? "سیستم"}`);
      file = path.basename(made.file);
    } else {
      const latest = (await listFileBackups())[0];
      if (!latest) {
        const made = await writeFileBackup(`آینه ${opts.actor ?? "سیستم"}`);
        file = path.basename(made.file);
      } else {
        file = latest.file;
      }
    }

    const source = path.join(BACKUP_DIR, file);
    const destination = path.join(MIRROR_DIR, file);
    const info = await stat(source);
    await copyFile(/*turbopackIgnore: true*/ source, /*turbopackIgnore: true*/ destination);

    // بررسی صحت کپی: حجم و هش باید یکسان باشند
    const destInfo = await stat(destination);
    const [a, b] = await Promise.all([sha256File(source), sha256File(destination)]);
    if (destInfo.size !== info.size) throw new Error("حجم فایل کپی‌شده با مبدأ یکسان نیست");
    if (a !== b) throw new Error("هش فایل کپی‌شده با مبدأ یکسان نیست");

    // نسخهٔ .sha256 کنار فایل بک‌آپ هم منتقل می‌شود تا بازیابی آفلاین قابل مهر تأیید باشد
    await copyFile(/*turbopackIgnore: true*/ `${source}.sha256`, /*turbopackIgnore: true*/ `${destination}.sha256`).catch(() =>
      writeFile(/*turbopackIgnore: true*/ `${destination}.sha256`, a, "utf8"),
    );

    const bundle = await copyLatestBundleTo(MIRROR_DIR);

    await writeFile(
      /*turbopackIgnore: true*/
      path.join(MIRROR_DIR, "last-mirror.txt"),
      `file=${file}\nat=${stamp}\nbytes=${info.size}\nsha256=${a}\nbundle=${bundle?.name ?? ""}\nbundleBytes=${bundle?.bytes ?? 0}\n`,
      "utf8",
    );

    await db.insert(backupMirrorRuns).values({
      at,
      ts: Date.now(),
      file,
      target: MIRROR_DIR,
      bytes: info.size,
      ok: true,
      error: "",
    });
    return { ok: true as const, file, bytes: info.size, sha256: a, bundle: bundle?.name ?? null, bundleBytes: bundle?.bytes ?? 0, target: MIRROR_DIR, at };
  } catch (error) {
    const message = error instanceof Error ? error.message : "خطای نامشخص";
    await db
      .insert(backupMirrorRuns)
      .values({ at, ts: Date.now(), file, target: MIRROR_DIR, bytes: 0, ok: false, error: message.slice(0, 300) })
      .catch(() => {});
    return { ok: false as const, file, error: message, target: MIRROR_DIR, at };
  }
}

let lastCheck = 0;

/** اگر بک‌آپ آینه از حد مجاز قدیمی‌تر شد، خودکار تازه‌سازی می‌کند (حداکثر هر نیم‌ساعت یک بررسی) */
export async function ensureMirrorFresh(maxAgeHours = STALE_HOURS) {
  const now = Date.now();
  if (now - lastCheck < 30 * 60 * 1000) return { skipped: true as const, last: null };
  lastCheck = now;
  const [last] = await db
    .select()
    .from(backupMirrorRuns)
    .where(eq(backupMirrorRuns.ok, true))
    .orderBy(desc(backupMirrorRuns.id))
    .limit(1);
  if (last && last.ts) {
    const ageMs = Date.now() - last.ts;
    if (Number.isFinite(ageMs) && ageMs < maxAgeHours * 3600_000) return { skipped: true as const, last };
  }
  return { skipped: false as const, result: await mirrorLatest({ fresh: true, actor: "زمان‌بند" }) };
}

export type MirrorStatus = {
  dir: string;
  available: boolean;
  keep: string;
  last: MirrorRun | null;
  okRuns: number;
  failRuns: number;
  last24: number;
  files: string[];
  verdict: "ok" | "stale" | "missing" | "failing";
  message: string;
};

export async function mirrorStatus(): Promise<MirrorStatus> {
  const available = await mirrorAvailable();
  const rows = (await db.select().from(backupMirrorRuns).orderBy(desc(backupMirrorRuns.id)).limit(50)) as MirrorRun[];
  const last = rows[0] ?? null;
  const since = new Date(Date.now() - 24 * 3600_000);
  const last24 = rows.filter((r) => r.ok && r.ts >= since.getTime()).length;
  const okRuns = rows.filter((r) => r.ok).length;
  const failRuns = rows.filter((r) => !r.ok).length;
  let files: string[] = [];
  try {
    const entries = await readdir(/*turbopackIgnore: true*/ MIRROR_DIR, { withFileTypes: true });
    const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name);
    const bundleEntries = await readdir(path.join(MIRROR_DIR, "bundles"), { withFileTypes: true }).catch(() => []);
    files = [...jsonFiles.sort().reverse().slice(0, 10), ...bundleEntries.filter((entry) => entry.isDirectory()).map((entry) => `بسته: ${entry.name}`).sort().reverse().slice(0, 10)];
  } catch {
    files = [];
  }

  let verdict: MirrorStatus["verdict"] = "ok";
  let message = "آینه سالم است";
  if (!available) {
    verdict = "missing";
    message = "رسانهٔ آینه در دسترس نیست (فلش/درایو وصل نشده یا مسیر MIRROR_DIR اشتباه است)";
  } else if (!last) {
    verdict = "failing";
    message = "هنوز هیچ کپی‌ای روی آینه انجام نشده است";
  } else if (!last.ok) {
    verdict = "failing";
    message = `آخرین تلاش ناموفق بود: ${last.error}`;
  } else {
    const ageHours = last.ts ? (Date.now() - last.ts) / 3600_000 : Infinity;
    if (ageHours > STALE_HOURS) {
      verdict = "stale";
      message = `آخرین کپی سالم ${Math.round(ageHours)} ساعت پیش بوده؛ قدیمی‌تر از حد مجاز ${STALE_HOURS} ساعت`;
    }
  }

  return { dir: MIRROR_DIR, available, keep: "نامحدود", last, okRuns, failRuns, last24, files, verdict, message };
}

/** برای اسکریپت زمان‌بند ویندوز: بک‌آپ + آینه در یک قدم، خروجی متنی برای لاگ */
export async function backupAndMirror(actor = "زمان‌بند") {
  const created = await createInternalBackup(`بک‌آپ زمان‌بند ${actor}`);
  const mirrored = await mirrorLatest({ fresh: true, actor });
  const status = await mirrorStatus();
  return { created, mirrored, status };
}

export const MIRROR_STALE_HOURS = STALE_HOURS;

/** توکن محلی برای اجرای زمان‌بند (Task Scheduler) بدون نشست مرورگر */
export const MIRROR_TOKEN_FILE = path.resolve(process.cwd(), process.env.MIRROR_TOKEN_FILE ?? ".data/mirror-token");

export async function mirrorToken(): Promise<string> {
  try {
    const existing = (await readFile(/*turbopackIgnore: true*/ MIRROR_TOKEN_FILE, "utf8")).trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* اولین بار: ساخته می‌شود */
  }
  const token = randomBytes(24).toString("hex");
  await mkdir(/*turbopackIgnore: true*/ path.dirname(MIRROR_TOKEN_FILE), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ MIRROR_TOKEN_FILE, token, "utf8");
  await chmod(/*turbopackIgnore: true*/ MIRROR_TOKEN_FILE, 0o600).catch(() => {});
  return token;
}

export async function verifyMirrorToken(candidate: string) {
  if (!candidate) return false;
  const expected = await mirrorToken();
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// برای استفاده در تست‌ها/ابزارها
export const _internal = { and, gte };
