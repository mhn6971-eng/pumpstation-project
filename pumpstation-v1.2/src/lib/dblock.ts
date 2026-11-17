import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * قفل فایل برای دیتابیس PGlite.
 * اگر دو برنامه هم‌زمان همین پوشهٔ داده را باز کنند، فایل‌های دیتابیس خراب می‌شوند
 * (سناریوی واقعی: اجرای init-db یا اسکریپت پشتیبان‌گیری وقتی سامانه روشن است).
 * این قفل جلوی آن را می‌گیرد وپیام روشن می‌دهد.
 */
export type LockInfo = { pid: number; startedAt: number; dir: string };

export function lockPath(dataDir: string) {
  return path.join(path.resolve(process.cwd(), dataDir), ".pumpstation.lock");
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireDbLock(dataDir: string, options: { enforce?: boolean } = {}) {
  const file = lockPath(dataDir);
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file)) {
    try {
      const info = JSON.parse(readFileSync(file, "utf8")) as LockInfo;
      if (info.pid && info.pid !== process.pid && alive(info.pid)) {
        if (options.enforce === false) {
          // در حالت توسعه ممکن است Next چند پردازه داشته باشد؛ فقط هشدار می‌دهیم
          console.warn(`[db-lock] پوشهٔ داده توسط PID ${info.pid} باز است؛ در حالت توسعه ادامه می‌دهیم.`);
          return;
        }
        throw new Error(
          `دیتابیس همین حالا توسط برنامهٔ دیگری (PID ${info.pid}) باز است. ` +
            "برای جلوگیری از خرابی داده، دو برنامه نباید هم‌زمان به یک پوشهٔ داده دسترسی داشته باشند. " +
            "اگر این رایانه اتاق دوم است، برنامه را اینجا اجرا نکنید؛ از مرورگر به سرور اصلی وصل شوید. " +
            "در غیر این صورت ابتدا پردازهٔ قبلی را ببندید.",
        );
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        /* قفل ناقص از اجرای قبلی؛ بازنویسی می‌شود */
      } else {
        throw error;
      }
    }
  }
  writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: Date.now(), dir: path.resolve(dataDir) }), "utf8");
}

export function releaseDbLock(dataDir: string) {
  const file = lockPath(dataDir);
  try {
    if (!existsSync(file)) return;
    const info = JSON.parse(readFileSync(file, "utf8")) as LockInfo;
    if (info.pid === process.pid) unlinkSync(file);
  } catch {
    /* در خاموشی، پاک‌نشدن قفل مهم نیست چون PID زنده بررسی می‌شود */
  }
}
