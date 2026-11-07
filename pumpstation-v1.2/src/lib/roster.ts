import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * روستر شیفت‌ها (نام‌ها و PINها) — نسخهٔ ۱٫۴٫۱.
 *
 * نام واقعی اپراتورها و PIN واقعی هرگز در کد و گیت نیست. ترتیب خواندن:
 *   ۱) فایل محلی `data/roster.local.json` (یا مسیر ROSTER_FILE) — اگر هست،
 *      حتماً باید معتبر باشد؛ اگر خراب باشد سرور بالا نمی‌آید تا اشتباهاً
 *      با PIN آزمایشی کار نکند.
 *   ۲) وگرنه نمونهٔ ساختگی `data/roster.sample.json` (فقط تست و توسعه؛ در production پیش‌فرض ممنوع).
 *
 * این ماژول هیچ ایمپورتی از داخل src ندارد تا هم در سرور، هم در اسکریپت‌ها
 * و هم در تست‌ها (audit6) مستقیم قابل استفاده باشد.
 */

export type RosterEntry = {
  key: string;
  label: string;
  role: "operator" | "admin";
  pin: string;
  members: string[];
};

export type RosterSource = "local" | "sample";

let sampleWarningPrinted = false;

function warnSampleRoster(localPath: string) {
  if (sampleWarningPrinted) return;
  sampleWarningPrinted = true;
  console.warn(`[roster] فایل محلی پیدا نشد یا مسیر روستر به نمونه اشاره می‌کند (${localPath}) — از روستر نمونهٔ ساختگی استفاده می‌شود؛ پیش از بهره‌برداری واقعی roster.local.json را بسازید.`);
}

export function sampleRosterPath(): string {
  return path.join(process.cwd(), "data", "roster.sample.json");
}

export function localRosterPath(): string {
  const raw = (process.env.ROSTER_FILE ?? "").trim() || path.join("data", "roster.local.json");
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

/** اعتبارسنجی ساختار روستر؛ در صورت ایراد با پیام فارسی خطا می‌دهد. */
export function validateRoster(input: unknown, sourceName: string): RosterEntry[] {
  const bad = (why: string): Error => new Error(`روستر ${sourceName} معتبر نیست: ${why}`);
  const root = input as { roster?: unknown } | null;
  const rawList: unknown = root && typeof root === "object" && "roster" in root ? root.roster : input;
  if (!Array.isArray(rawList) || rawList.length === 0) throw bad("فهرست شیفت‌ها خالی است");
  const list: unknown[] = rawList;
  const seen = new Set<string>();
  const out: RosterEntry[] = [];
  for (const item of list) {
    const e = (item ?? {}) as Partial<RosterEntry>;
    const key = String(e.key ?? "").trim();
    if (!/^[A-Za-z0-9_-]{1,10}$/.test(key)) throw bad(`کلید شیفت نامعتبر است (${String(e.key ?? "")})`);
    if (seen.has(key)) throw bad(`کلید تکراری: ${key}`);
    seen.add(key);
    const label = String(e.label ?? "").trim();
    if (!label || label.length > 40) throw bad(`نام نمایشی شیفت ${key} نامعتبر است`);
    const role = e.role;
    if (role !== "operator" && role !== "admin") throw bad(`نقش شیفت ${key} باید operator یا admin باشد`);
    const pin = String(e.pin ?? "");
    if (!/^\d{4}$/.test(pin)) throw bad(`PIN شیفت ${key} باید دقیقاً چهار رقم باشد`);
    const members = Array.isArray(e.members) ? e.members.map((m) => String(m ?? "").trim()).filter(Boolean) : [];
    if (members.length === 0 || members.length > 4) throw bad(`اعضای شیفت ${key} باید یک تا چهار نام باشد`);
    if (members.some((m) => m.length > 80)) throw bad(`نام یکی از اعضای شیفت ${key} بیش از حد طولانی است`);
    out.push({ key, label, role, pin, members });
  }
  const admin = out.find((e) => e.key === "admin");
  if (!admin || admin.role !== "admin") throw bad("یک شیفت admin لازم است تا سامانه قفل نشود");
  return out;
}

/** خواندن و اعتبارسنجی یک فایل روستر. */
export function loadRosterFile(file: string): RosterEntry[] {
  const raw = readFileSync(file, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`روستر ${file} معتبر نیست: فایل JSON خراب است`);
  }
  return validateRoster(parsed, file);
}

/**
 * روستر فعال: فایل محلی اگر هست (خراب = توقف با خطا)، وگرنه نمونهٔ ساختگی.
 * اخطار «نمونه» عمداً بلند است تا در بهره‌برداری واقعی جا نماند.
 */
export function resolveRoster(): { roster: RosterEntry[]; source: RosterSource; path: string } {
  const local = localRosterPath();
  if (existsSync(local)) {
    const roster = loadRosterFile(local);
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_SAMPLE_ROSTER !== "1") {
      const samplePins = new Map(loadRosterFile(sampleRosterPath()).map((entry) => [entry.key, entry.pin]));
      if (roster.some((entry) => samplePins.get(entry.key) === entry.pin)) {
        throw new Error("روستر محلی هنوز PIN پیش‌فرض نمونه دارد؛ PINهای واقعی را تعیین کنید. برای آزمون کنترل‌شده فقط ALLOW_SAMPLE_ROSTER=1 را تنظیم کنید.");
      }
    }
    const source: RosterSource = path.resolve(local) === path.resolve(sampleRosterPath()) ? "sample" : "local";
    if (source === "sample") warnSampleRoster(local);
    return { roster, source, path: local };
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SAMPLE_ROSTER !== "1") {
    throw new Error(
      `روستر محلی پیدا نشد (${local}). اجرای production با PINهای نمونه مسدود است؛ ` +
        "فایل data/roster.local.json را بسازید. برای تست کنترل‌شده فقط ALLOW_SAMPLE_ROSTER=1 را تنظیم کنید.",
    );
  }

  const sample = sampleRosterPath();
  const roster = loadRosterFile(sample);
  warnSampleRoster(local);
  return { roster, source: "sample", path: sample };
}
