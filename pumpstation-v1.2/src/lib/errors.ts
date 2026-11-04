import { randomUUID } from "node:crypto";
import { recordEvent } from "@/lib/log";

/** خطای قابل‌نمایش به کاربر با کد وضعیت مشخص */
export class AppError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "app_error") {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string, code = "bad_request") => new AppError(message, 400, code);
export const unauthorized = (message = "ابتدا وارد سامانه شوید") => new AppError(message, 401, "unauthorized");
export const forbidden = (message = "دسترسی لازم را ندارید") => new AppError(message, 403, "forbidden");
export const notFound = (message = "مورد درخواستی پیدا نشد") => new AppError(message, 404, "not_found");
export const tooMany = (message = "تعداد درخواست‌ها زیاد است؛ کمی بعد تلاش کنید") => new AppError(message, 429, "rate_limited");
export const unavailable = (message = "سامانه موقتاً پاسخگو نیست؛ دوباره تلاش کنید") => new AppError(message, 503, "unavailable");

export function requestId(request?: Request) {
  return request?.headers.get("x-request-id")?.slice(0, 64) || randomUUID();
}

/**
 * سقف زمانی برای کارهای خواندنی: اگر دیتابیس قفل شد یا پاسخ نداد،
 * کاربر به‌جای انتظار بی‌پایان (هنگ) پیام روشن می‌گیرد.
 * توجه: برای نوشتن استفاده نمی‌شود؛ چون لغو واقعی تراکنش ممکن نیست.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(unavailable(`پاسخی در زمان مجاز (${Math.round(ms / 1000)} ثانیه) دریافت نشد — ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type ErrorContext = { source: string; path?: string; requestId?: string; shiftKey?: string };

/** پاسخ خطای یکدست؛ خطاهای فنی در app_events ثبت می‌شوند و جزئیات داخلی به کاربر لو نمی‌رود */
export async function errorResponse(error: unknown, context: ErrorContext) {
  const id = context.requestId ?? randomUUID();
  const known = error instanceof AppError;
  if (!known) {
    await recordEvent({
      level: "error",
      source: context.source,
      message: error instanceof Error ? error.message : String(error),
      detail: error,
      requestId: id,
      shiftKey: context.shiftKey,
      path: context.path,
    });
  }
  const status = known ? error.status : 500;
  const message = known ? error.message : "خطای داخلی سامانه رخ داد؛ جزئیات برای بررسی ثبت شد";
  return Response.json(
    { ok: false, error: message, code: known ? error.code : "internal_error", requestId: id },
    { status, headers: { "x-request-id": id, "cache-control": "no-store" } },
  );
}

/** JSON با هدرهای استاندارد و شناسه درخواست */
export function jsonResponse(data: unknown, init: { status?: number; requestId?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "cache-control": "no-store", ...(init.headers ?? {}) };
  if (init.requestId) headers["x-request-id"] = init.requestId;
  return Response.json(data, { status: init.status ?? 200, headers });
}
