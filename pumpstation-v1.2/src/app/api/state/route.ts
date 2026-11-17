import { createHash } from "node:crypto";
import { getSessionUser } from "@/lib/auth";
import { buildState } from "@/lib/state";
import { errorResponse, jsonResponse, requestId, withTimeout } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * وضعیت کامل داشبورد.
 * • ETag: اگر داده از آخرین بار تغییر نکرده باشد، پاسخ ۳۰۴ و «هیچ بدنه‌ای» برمی‌گردد
 *   (با بازخوانی هر ۶۰ ثانیه، این کار پهنای باند و کار سرور را به‌شدت کم می‌کند).
 * • سقف زمانی: به‌جای هنگ‌کردن، پیام روشن ۵۰۳ برمی‌گردد.
 */
export async function GET(request: Request) {
  const rid = requestId(request);
  const user = await getSessionUser();
  if (!user) return jsonResponse({ error: "ابتدا وارد شوید" }, { status: 401, requestId: rid });
  const url = new URL(request.url);
  const day = url.searchParams.get("day") ?? undefined;
  const intervalRaw = url.searchParams.get("interval");
  const interval = intervalRaw === null ? undefined : Number(intervalRaw);

  try {
    const state = await withTimeout(buildState({ who: user, day, interval }), 20_000, "دریافت وضعیت");
    const body = JSON.stringify(state);
    const etag = `"${createHash("sha1").update(body).digest("base64url").slice(0, 22)}"`;

    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { etag, "cache-control": "no-cache, private", "x-request-id": rid },
      });
    }

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        etag,
        "cache-control": "no-cache, private",
        "x-request-id": rid,
      },
    });
  } catch (error) {
    return errorResponse(error, { source: "api/state", path: "/api/state", requestId: rid, shiftKey: user.key });
  }
}
