import { getSessionUser } from "@/lib/auth";
import { addDaysToDay, operationalDay } from "@/lib/jalali";
import { buildTrendPayload, normalizeRange } from "@/lib/reporting";

export const dynamic = "force-dynamic";

/** روند پارامتر با بازهٔ دلخواه: ?scope&tag&param&from&to (شمسی) یا days=… */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "ابتدا وارد شوید" }, { status: 401 });
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") === "motor" ? "motor" : "process";
    const tag = url.searchParams.get("tag") ?? "";
    const param = url.searchParams.get("param") ?? "";
    const days = Math.min(3650, Math.max(1, Number(url.searchParams.get("days") ?? 14)));
    const op = operationalDay();
    const { from, to } = normalizeRange(
      url.searchParams.get("from") ?? "",
      url.searchParams.get("to") ?? "",
      addDaysToDay(op.day, -(days - 1)),
      op.day,
    );
    const compare = scope === "motor" && !tag;
    const payload = await buildTrendPayload(scope, tag, scope === "motor" ? param : tag, from, to, compare);
    return Response.json(payload);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "خطا" }, { status: 400 });
  }
}
