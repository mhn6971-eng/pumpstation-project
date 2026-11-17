import { getSessionUser } from "@/lib/auth";
import { errorResponse, jsonResponse, requestId } from "@/lib/errors";
import { mirrorLatest, mirrorStatus, verifyMirrorToken } from "@/lib/mirror";
import { logSecurityEvent } from "@/lib/security";

/**
 * وضعیت و اجرای «آینهٔ بک‌آپ» (کپی روی حافظهٔ بیرونی).
 * GET  → خلاصهٔ سلامت آینه (فقط ادمین)
 * POST → ساخت نسخهٔ تازه و کپی به آینه؛ یا با نشست ادمین، یا با توکن محلی زمان‌بند
 *        (هدر x-mirror-token، مقدارش در .data/mirror-token)
 */
export async function GET(request: Request) {
  const rid = requestId(request);
  try {
    const user = await getSessionUser();
    if (!user) return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401, requestId: rid });
    if (user.role !== "admin") return jsonResponse({ ok: false, error: "دسترسی مدیریت لازم است" }, { status: 403, requestId: rid });
    return jsonResponse({ ok: true, ...(await mirrorStatus()) }, { requestId: rid });
  } catch (error) {
    return errorResponse(error, { source: "api/mirror", path: "/api/mirror", requestId: rid });
  }
}

export async function POST(request: Request) {
  const rid = requestId(request);
  try {
    const token = request.headers.get("x-mirror-token") ?? "";
    let actor = "زمان‌بند";
    if (token) {
      if (!(await verifyMirrorToken(token))) {
        await logSecurityEvent("mirror_bad_token", "system", "local", "تلاش اجرای آینه با توکن نامعتبر");
        return jsonResponse({ ok: false, error: "توکن نامعتبر است" }, { status: 403, requestId: rid });
      }
    } else {
      const user = await getSessionUser();
      if (!user) return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401, requestId: rid });
      if (user.role !== "admin") return jsonResponse({ ok: false, error: "دسترسی مدیریت لازم است" }, { status: 403, requestId: rid });
      actor = `${user.label} (${user.key})`;
    }

    const result = await mirrorLatest({ fresh: true, actor });
    const status = await mirrorStatus();
    return jsonResponse({ ...result, status }, { requestId: rid });
  } catch (error) {
    return errorResponse(error, { source: "api/mirror", path: "/api/mirror", requestId: rid });
  }
}
