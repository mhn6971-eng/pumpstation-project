/**
 * منطق مخصوص Node: ثبت خطاهای کشنده و خاموشی تمیز دیتابیس.
 * جدا از instrumentation.ts نگه داشته شده تا در باندل Edge استفاده نشود.
 */
export async function registerNode() {
  const { recordEvent } = await import("@/lib/log");

  process.on("unhandledRejection", (reason) => {
    void recordEvent({ level: "error", source: "process", message: "unhandledRejection", detail: reason });
  });
  process.on("uncaughtException", (error) => {
    void recordEvent({ level: "error", source: "process", message: "uncaughtException", detail: error });
  });

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      const { client } = await import("@/db");
      await client.close();
    } catch {
      /* اگر بسته نشد، پروسه خارج می‌شود */
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}
