import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { activity, alerts, dailyTotals, equipment, motorReadingsAll, processReadingsAll, valueAudits } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { jsonResponse, requestId } from "@/lib/errors";
import { isValidJalaliDay } from "@/lib/jalali";

export const dynamic = "force-dynamic";

/**
 * خروجی CSV برای نگه‌داری آرشیو بیرونی و تحلیل در Excel.
 * فقط ادمین؛ خروجی به‌صورت جریانی ساخته می‌شود تا برای چند صد هزار ردیف حافظه پر نشود.
 * BOM اضافه می‌شود تا اکسل حروف فارسی را درست نشان دهد.
 */

const TABLES = ["motor", "process", "totals", "equipment", "alerts", "activity", "audits"] as const;
type TableName = (typeof TABLES)[number];

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const HEADERS: Record<TableName, string[]> = {
  motor: ["id", "tag", "day", "intervalIndex", "param", "value", "shiftKey", "recordedAt", "updatedAt"],
  process: ["id", "day", "intervalIndex", "tag", "value", "shiftKey", "recordedAt", "updatedAt"],
  totals: ["id", "day", "value", "shiftKey", "recordedAt", "updatedAt"],
  equipment: ["id", "tag", "name", "category", "spec", "plate", "partNumbers", "location", "status", "isAux", "isMotor", "safetyCritical"],
  alerts: ["id", "at", "day", "tag", "param", "label", "value", "severity", "message", "shiftKey", "seenAt", "actedAt", "resolvedAt"],
  activity: ["id", "at", "shiftKey", "action", "detail"],
  audits: ["id", "at", "shiftKey", "scope", "tag", "param", "oldValue", "newValue"],
};

const PAGE = 2000;

async function* rows(table: TableName, from: string, to: string) {
  const ranged = from && to;
  if (table === "motor") {
    let lastId = 0;
    for (;;) {
      const page = await db
        .select()
        .from(motorReadingsAll)
        .where(ranged ? and(gte(motorReadingsAll.day, from), lte(motorReadingsAll.day, to), gte(motorReadingsAll.id, lastId + 1)) : gte(motorReadingsAll.id, lastId + 1))
        .orderBy(asc(motorReadingsAll.id))
        .limit(PAGE);
      if (!page.length) return;
      lastId = page[page.length - 1].id;
      for (const row of page) yield row as unknown as Record<string, unknown>;
      if (page.length < PAGE) return;
    }
  }
  if (table === "process") {
    let lastId = 0;
    for (;;) {
      const page = await db
        .select()
        .from(processReadingsAll)
        .where(ranged ? and(gte(processReadingsAll.day, from), lte(processReadingsAll.day, to), gte(processReadingsAll.id, lastId + 1)) : gte(processReadingsAll.id, lastId + 1))
        .orderBy(asc(processReadingsAll.id))
        .limit(PAGE);
      if (!page.length) return;
      lastId = page[page.length - 1].id;
      for (const row of page) yield row as unknown as Record<string, unknown>;
      if (page.length < PAGE) return;
    }
  }
  if (table === "totals") {
    const rows = await db.select().from(dailyTotals).orderBy(asc(dailyTotals.day));
    for (const row of rows) yield row as unknown as Record<string, unknown>;
    return;
  }
  if (table === "equipment") {
    const rows = await db.select().from(equipment).where(eq(equipment.deletedAt, "")).orderBy(asc(equipment.tag));
    for (const row of rows) yield row as unknown as Record<string, unknown>;
    return;
  }
  if (table === "alerts") {
    const rows = await db.select().from(alerts).orderBy(asc(alerts.id)).limit(50_000);
    for (const row of rows) yield row as unknown as Record<string, unknown>;
    return;
  }
  if (table === "activity") {
    const rows = await db.select().from(activity).orderBy(asc(activity.id)).limit(50_000);
    for (const row of rows) yield row as unknown as Record<string, unknown>;
    return;
  }
  const rows = await db.select().from(valueAudits).orderBy(asc(valueAudits.id)).limit(50_000);
  for (const row of rows) yield row as unknown as Record<string, unknown>;
}

export async function GET(request: Request) {
  const rid = requestId(request);
  const user = await getSessionUser();
  if (!user) return jsonResponse({ error: "ابتدا وارد شوید" }, { status: 401, requestId: rid });
  if (user.role !== "admin") return jsonResponse({ error: "دسترسی ادمین لازم است" }, { status: 403, requestId: rid });

  const url = new URL(request.url);
  const table = (url.searchParams.get("table") ?? "motor") as TableName;
  if (!TABLES.includes(table)) return jsonResponse({ error: "جدول نامعتبر است" }, { status: 400, requestId: rid });

  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if ((from && !isValidJalaliDay(from)) || (to && !isValidJalaliDay(to))) {
    return jsonResponse({ error: "بازهٔ تاریخ نامعتبر است" }, { status: 400, requestId: rid });
  }

  const encoder = new TextEncoder();
  const header = HEADERS[table];
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(`\uFEFF${header.join(",")}\n`));
        let buffer = "";
        for await (const row of rows(table, from, to)) {
          buffer += `${header.map((key) => csvCell((row as Record<string, unknown>)[key])).join(",")}\n`;
          if (buffer.length > 64 * 1024) {
            controller.enqueue(encoder.encode(buffer));
            buffer = "";
          }
        }
        if (buffer) controller.enqueue(encoder.encode(buffer));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="pumpstation-${table}-${stamp}.csv"`,
      "cache-control": "no-store",
      "x-request-id": rid,
    },
  });
}
