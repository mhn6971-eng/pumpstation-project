/**
 * قلاب‌های زمان اجرا (Next.js instrumentation)
 * ------------------------------------------------
 * ۱) ثبت خطاهای حل‌نشده و استثناهای کشنده در `app_events` تا در تب ادمین دیده شوند.
 * ۲) خاموشی تمیز: با SIGTERM/SIGINT دیتابیس درست بسته می‌شود تا فایل‌ها خراب نشوند.
 * ۳) `onRequestError`: هر خطای مسیرها/رندرها بدون دست‌کاری کد مسیرها ثبت می‌شود.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { recordEvent } = await import("@/lib/log");

  process.on("unhandledRejection", (reason) => {
    void recordEvent({ level: "error", source: "process", message: "unhandledRejection", detail: reason });
  });
  process.on("uncaughtException", (error) => {
    void recordEvent({ level: "error", source: "process", message: "uncaughtException", detail: error });
  });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    try {
      const { client } = await import("@/db");
      await client.close();
    } catch {
      /* اگر بسته نشد، پروسه خارج می‌شود */
    } finally {
      void signal;
      process.exit(0);
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

type RequestLike = { path?: string; method?: string; headers?: Record<string, string | undefined> };
type ContextLike = { routerKind?: string; routePath?: string; routeType?: string };

export async function onRequestError(error: unknown, request: RequestLike, context: ContextLike) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { recordEvent } = await import("@/lib/log");
    await recordEvent({
      level: "error",
      source: `next:${context.routeType ?? "route"}`,
      message: error instanceof Error ? error.message : String(error),
      detail: { error, routerKind: context.routerKind, routePath: context.routePath },
      path: request?.path ?? "",
      requestId: request?.headers?.["x-request-id"] ?? "",
    });
  } catch {
    /* ثبت خطا نباید خودش خطا بدهد */
  }
}
