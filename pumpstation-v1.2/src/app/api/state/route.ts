import { getSessionUser } from "@/lib/auth";
import { buildState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "ابتدا وارد شوید" }, { status: 401 });
  const url = new URL(request.url);
  const day = url.searchParams.get("day") ?? undefined;
  const intervalRaw = url.searchParams.get("interval");
  const interval = intervalRaw === null ? undefined : Number(intervalRaw);
  try {
    const state = await buildState({ who: user, day, interval });
    return Response.json(state);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "خطا در دریافت وضعیت" }, { status: 500 });
  }
}
