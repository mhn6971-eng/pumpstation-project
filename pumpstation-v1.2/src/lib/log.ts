import { db } from "@/db";
import { appEvents } from "@/db/schema";

/**
 * ثبت رخدادهای فنی.
 * - همیشه در کنسول (به‌صورت JSON یک‌خطی برای لاگ‌گیر سرور)
 * - رخدادهای مهم (warn/error) در جدول `app_events` ذخیره می‌شوند تا در تب ادمین دیده شوند.
 *   برای جلوگیری از پر شدن دیتابیس در شرایط بحرانی، سقف ذخیره‌سازی در دقیقه اعمال می‌شود.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = ORDER[(process.env.LOG_LEVEL as LogLevel) ?? "info"] ?? 20;

const PERSIST_PER_MINUTE = 120;
let persisted = 0;
let windowStart = Date.now();

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return "…";
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack?.split("\n").slice(0, 6).join("\n") };
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (/pin|token|secret|authorization|cookie|password/i.test(key)) out[key] = "«پنهان»";
      else out[key] = redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function logEvent(level: LogLevel, source: string, message: string, detail?: unknown) {
  if (ORDER[level] < MIN_LEVEL) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    source,
    message,
    detail: detail === undefined ? undefined : redact(detail),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** ثبت در دیتابیس (برای نمایش در تب ادمین) — خطای ثبت هرگز جریان اصلی را متوقف نمی‌کند */
export async function recordEvent(input: {
  level?: LogLevel;
  source: string;
  message: string;
  detail?: unknown;
  requestId?: string;
  shiftKey?: string;
  path?: string;
  durationMs?: number;
}) {
  const level = input.level ?? "error";
  logEvent(level, input.source, input.message, input.detail);
  if (ORDER[level] < ORDER.warn) return;

  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    persisted = 0;
  }
  if (persisted >= PERSIST_PER_MINUTE) return;
  persisted += 1;

  try {
    await db.insert(appEvents).values({
      ts: now,
      level,
      source: input.source.slice(0, 80),
      message: input.message.slice(0, 500),
      detail: redact(input.detail) as never,
      requestId: (input.requestId ?? "").slice(0, 64),
      shiftKey: (input.shiftKey ?? "").slice(0, 20),
      path: (input.path ?? "").slice(0, 200),
      durationMs: Math.round(input.durationMs ?? 0),
    });
  } catch {
    /* ثبت خطا نباید خطای تازه بسازد */
  }
}

export async function captureError(error: unknown, context: { source: string; path?: string; requestId?: string; shiftKey?: string }) {
  await recordEvent({
    level: "error",
    source: context.source,
    message: error instanceof Error ? error.message : String(error),
    detail: error,
    requestId: context.requestId,
    shiftKey: context.shiftKey,
    path: context.path,
  });
}
