/**
 * قلاب‌های زمان اجرا (Next.js instrumentation)
 * این فایل عمداً «نازک» است تا در باندل Edge هم کامپایل شود؛
 * منطق واقعی فقط در محیط Node بارگذاری می‌شود.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { registerNode } = await import("./instrumentation.node");
  await registerNode();
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
