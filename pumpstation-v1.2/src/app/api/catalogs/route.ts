import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { catalogs } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { logActivity } from "@/lib/state";
import { jalaliNow } from "@/lib/jalali";

export const dynamic = "force-dynamic";

export const CATALOG_DIR = process.env.CATALOG_DIR ?? "files/catalogs";
const MAX_BYTES = 8 * 1024 * 1024;

/** محافظت از مسیر: فقط فایل‌های داخل پوشهٔ کاتالوگ خوانده شوند */
function safeName(name: string) {
  return path.basename(name).replace(/[^\w.-]/g, "_");
}

/**
 * آپلود کاتالوگ PDF (فقط ادمین)
 * امنیت (H5): بررسی امضای واقعی فایل، ذخیره روی دیسک (نه داخل دیتابیس) و هش SHA-256.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return Response.json({ ok: false, error: "فقط ادمین می‌تواند کاتالوگ بارگذاری کند" }, { status: 403 });

  const form = await request.formData();
  const file = form.get("file");
  const tag = String(form.get("tag") ?? "").trim().slice(0, 40);
  if (!(file instanceof File) || !tag) return Response.json({ ok: false, error: "فایل یا تگ ارسال نشده" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ ok: false, error: "حداکثر حجم ۸ مگابایت" }, { status: 400 });
  if (file.size === 0) return Response.json({ ok: false, error: "فایل خالی است" }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  // امضای واقعی PDF — پسوند و MIME به‌تنهایی قابل جعل است
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return Response.json({ ok: false, error: "فایل PDF معتبر نیست (امضای فایل بررسی شد)" }, { status: 400 });
  }
  // فایل‌های PDF اجازهٔ اجرای اسکریپت ندارند؛ وجود جاوااسکریپت توکار را هم هشدار می‌دهیم
  const suspicious = bytes.includes(Buffer.from("/JavaScript")) || bytes.includes(Buffer.from("/OpenAction"));

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const stored = `${Date.now()}-${randomBytes(4).toString("hex")}-${safeName(file.name || "catalog.pdf")}`;
  await mkdir(CATALOG_DIR, { recursive: true });
  await writeFile(path.join(CATALOG_DIR, stored), bytes);

  const row = await db
    .insert(catalogs)
    .values({
      tag,
      name: file.name || stored,
      mime: "application/pdf",
      size: bytes.length,
      data: "",
      path: stored,
      sha256,
      uploadedAt: jalaliNow(),
      uploadedBy: user.label,
    })
    .returning({ id: catalogs.id });

  await logActivity(user.key, "آپلود کاتالوگ", `${tag} — ${file.name} — ${(bytes.length / 1024).toFixed(0)}KB — ${sha256.slice(0, 12)}`);
  return Response.json({ ok: true, id: row[0]?.id, sha256, warning: suspicious ? "این PDF شامل JavaScript/OpenAction است؛ با احتیاط باز کنید" : null });
}

/** مشاهدهٔ کاتالوگ: /api/catalogs?id=… */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "ابتدا وارد شوید" }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "شناسهٔ نامعتبر" }, { status: 400 });

  const row = (await db.select().from(catalogs).where(eq(catalogs.id, id)).limit(1))[0];
  if (!row) return Response.json({ error: "کاتالوگ پیدا نشد" }, { status: 404 });

  const headers: Record<string, string> = {
    "Content-Type": "application/pdf",
    // هرچند فایل PDF است، اجازهٔ اجرای هر چیزی در آن زمینه (sandbox) داده نمی‌شود
    "Content-Security-Policy": "sandbox; default-src 'none'; plugin-types application/pdf",
    "X-Content-Type-Options": "nosniff",
  };

  if (row.path) {
    const file = await readFile(path.join(CATALOG_DIR, safeName(row.path))).catch(() => null);
    if (!file) return Response.json({ error: "فایل روی دیسک پیدا نشد" }, { status: 404 });
    return new Response(new Uint8Array(file), {
      headers: { ...headers, "Content-Disposition": `inline; filename="${encodeURIComponent(row.name)}"` },
    });
  }

  // سازگاری با کاتالوگ‌های قدیمی که داخل دیتابیس ذخیره شده‌اند
  return new Response(new Uint8Array(Buffer.from(row.data, "base64")), {
    headers: { ...headers, "Content-Disposition": `inline; filename="${encodeURIComponent(row.name)}"` },
  });
}
