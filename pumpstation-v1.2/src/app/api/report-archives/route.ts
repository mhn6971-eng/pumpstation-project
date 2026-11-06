import { and, eq, inArray, like, notInArray } from "drizzle-orm";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { alerts, dailyTotals, equipmentReports, meggerTests, motorReadings, motorServices, oilChanges, pmRecords, pmTemplates, processReadings, reports } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { isValidJalaliDay, jalaliNow } from "@/lib/jalali";
import { zipDeflated } from "@/lib/zip";

export const dynamic = "force-dynamic";

const enc = new TextEncoder();
const jsonFile = (value: unknown) => enc.encode(`${JSON.stringify(value, null, 2)}\n`);

/** ساخت ZIP فشردهٔ گزارش روزانه و نگه‌داری نسخه روی درایو دادهٔ انتخاب‌شده */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "ابتدا وارد سامانه شوید" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ ok: false, error: "فقط ادمین می‌تواند آرشیو ZIP بسازد" }, { status: 403 });

  let body: { kind?: unknown; day?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "درخواست JSON معتبر نیست" }, { status: 400 });
  }
  const kind = String(body.kind ?? "");
  const day = String(body.day ?? "");
  if (kind !== "process" && kind !== "pm") return Response.json({ ok: false, error: "نوع ZIP باید process یا pm باشد" }, { status: 400 });
  if (!isValidJalaliDay(day)) return Response.json({ ok: false, error: "تاریخ شمسی نامعتبر است" }, { status: 400 });

  const rows: Record<string, unknown[]> = {};
  let outputDir: string;
  if (kind === "process") {
    [rows.processReadings, rows.motorReadings, rows.dailyTotals, rows.alerts, rows.reports] = await Promise.all([
      db.select().from(processReadings).where(eq(processReadings.day, day)).orderBy(processReadings.intervalIndex, processReadings.tag),
      db.select().from(motorReadings).where(eq(motorReadings.day, day)).orderBy(motorReadings.tag, motorReadings.intervalIndex, motorReadings.param),
      db.select().from(dailyTotals).where(eq(dailyTotals.day, day)),
      db.select().from(alerts).where(eq(alerts.day, day)).orderBy(alerts.id),
      db.select().from(reports).where(and(eq(reports.day, day), notInArray(reports.kind, ["pm", "motor_service", "megger", "oil"]))).orderBy(reports.id),
    ]);
    outputDir = path.resolve(/*turbopackIgnore: true*/ process.env.PROCESS_REPORT_DIR ?? path.join(process.cwd(), ".data", "report-archives", "process"));
  } else {
    [rows.pmRecords, rows.motorServices, rows.meggerTests, rows.oilChanges, rows.equipmentReports, rows.pmTemplates, rows.reports] = await Promise.all([
      db.select().from(pmRecords).where(eq(pmRecords.day, day)).orderBy(pmRecords.id),
      db.select().from(motorServices).where(eq(motorServices.day, day)).orderBy(motorServices.id),
      db.select().from(meggerTests).where(eq(meggerTests.day, day)).orderBy(meggerTests.id),
      db.select().from(oilChanges).where(eq(oilChanges.day, day)).orderBy(oilChanges.id),
      db.select().from(equipmentReports).where(like(equipmentReports.at, `${day}%`)).orderBy(equipmentReports.id),
      db.select().from(pmTemplates).orderBy(pmTemplates.category, pmTemplates.name),
      db.select().from(reports).where(and(eq(reports.day, day), inArray(reports.kind, ["pm", "motor_service", "megger", "oil"])) ).orderBy(reports.id),
    ]);
    outputDir = path.resolve(/*turbopackIgnore: true*/ process.env.PM_REPORT_DIR ?? path.join(process.cwd(), ".data", "report-archives", "PM"));
  }

  const generatedAt = new Date().toISOString();
  const counts = Object.fromEntries(Object.entries(rows).map(([name, values]) => [name, values.length]));
  const manifest = { format: "pumpstation-report-zip-v1", kind, day, generatedAt, counts };
  const files = [
    { name: "manifest.json", data: jsonFile(manifest) },
    ...Object.entries(rows).map(([name, values]) => ({ name: `${name}.json`, data: jsonFile(values) })),
  ];
  let archive: Uint8Array;
  let tempFile = "";
  try {
    archive = zipDeflated(files);
    await mkdir(outputDir, { recursive: true });
    const stamp = generatedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const fileName = `${kind}-${day.replaceAll("/", "-")}-${stamp}-${randomUUID().slice(0, 8)}.zip`;
    const target = path.join(outputDir, fileName);
    tempFile = `${target}.tmp`;
    await writeFile(tempFile, archive);
    await rename(tempFile, target);
    tempFile = "";
    return new Response(Buffer.from(archive), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Report-Archive-Filename": fileName,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (tempFile) await rm(tempFile, { force: true }).catch(() => undefined);
    console.error("[reports] zip archive failed", error);
    return Response.json({ ok: false, error: "ساخت یا ذخیرهٔ ZIP گزارش انجام نشد؛ فضای درایو و دسترسی پوشه را بررسی کنید" }, { status: 500 });
  }
}
