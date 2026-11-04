import { eq } from "drizzle-orm";
import { db } from "@/db";
import { catalogs } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { logActivity } from "@/lib/state";
import { jalaliNow } from "@/lib/jalali";

export const dynamic = "force-dynamic";

/** آپلود کاتالوگ PDF (فقط ادمین) */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return Response.json({ ok: false, error: "فقط ادمین می‌تواند کاتالوگ بارگذاری کند" }, { status: 403 });
  const form = await request.formData();
  const file = form.get("file");
  const tag = String(form.get("tag") ?? "").trim();
  if (!(file instanceof File) || !tag) return Response.json({ ok: false, error: "فایل یا تگ ارسال نشده" }, { status: 400 });
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return Response.json({ ok: false, error: "فقط PDF مجاز است" }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return Response.json({ ok: false, error: "حداکثر حجم ۸ مگابایت" }, { status: 400 });
  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const row = await db.insert(catalogs).values({ tag, name: file.name, mime: "application/pdf", size: file.size, data, uploadedAt: jalaliNow(), uploadedBy: user.label }).returning({ id: catalogs.id });
  await logActivity(user.key, "آپلود کاتالوگ", `${tag} — ${file.name}`);
  return Response.json({ ok: true, id: row[0]?.id });
}

/** مشاهده کاتالوگ: /api/catalogs?id=… */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "ابتدا وارد شوید" }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  const row = (await db.select().from(catalogs).where(eq(catalogs.id, id)).limit(1))[0];
  if (!row) return Response.json({ error: "کاتالوگ پیدا نشد" }, { status: 404 });
  return new Response(Buffer.from(row.data, "base64"), {
    headers: { "Content-Type": row.mime, "Content-Disposition": `inline; filename="${encodeURIComponent(row.name)}"` },
  });
}
