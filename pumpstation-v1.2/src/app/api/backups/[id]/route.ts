import { eq } from "drizzle-orm";
import { db } from "@/db";
import { backups } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "دسترسی ادمین لازم است" }, { status: 403 });
  }
  const { id } = await params;
  const row = (await db.select().from(backups).where(eq(backups.id, Number(id))).limit(1))[0];
  if (!row) return Response.json({ error: "بک‌آپ پیدا نشد" }, { status: 404 });
  return new Response(JSON.stringify(row.payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="pumpstation-backup-${row.id}.json"`,
    },
  });
}
