import { and, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { dailyTotals } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { monthDaysOf, operationalDay, PERSIAN_MONTHS, pad } from "@/lib/jalali";

export const dynamic = "force-dynamic";

/** توتال ماهانه: ?year&month → جدول روز ۱ تا آخر ماه + جمع کل؛ به‌همراه فهرست ماه‌های دارای ثبت */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "ابتدا وارد شوید" }, { status: 401 });
  const url = new URL(request.url);
  const op = operationalDay();
  let year = Number(url.searchParams.get("year") ?? op.jy);
  let month = Number(url.searchParams.get("month") ?? op.jm);
  if (!Number.isInteger(year) || year < 1300 || year > 1500) year = op.jy;
  if (!Number.isInteger(month) || month < 1 || month > 12) month = op.jm;

  const months = await db
    .select({ ym: sql<string>`substring(${dailyTotals.day}, 1, 7)`, count: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${dailyTotals.value}),0)::float` })
    .from(dailyTotals)
    .groupBy(sql`substring(${dailyTotals.day}, 1, 7)`)
    .orderBy(sql`substring(${dailyTotals.day}, 1, 7) desc`);

  const prefix = `${year}/${pad(month)}/`;
  const rows = await db.select().from(dailyTotals).where(and(gte(dailyTotals.day, `${prefix}01`), lte(dailyTotals.day, `${prefix}31`))).orderBy(dailyTotals.day);
  const map = new Map(rows.map((r) => [r.day, r.value]));
  const days = monthDaysOf(year, month);
  const table = Array.from({ length: days }, (_, i) => {
    const day = `${year}/${pad(month)}/${pad(i + 1)}`;
    return { day, d: i + 1, value: map.get(day) ?? null };
  });
  const values = table.map((t) => t.value).filter((v): v is number => v !== null);
  return Response.json({
    months: months.map((m) => ({ ym: m.ym, count: m.count, sum: Math.round(m.sum) })),
    data: {
      year,
      month,
      monthLabel: PERSIAN_MONTHS[month - 1],
      days,
      rows: table,
      sum: values.reduce((a, b) => a + b, 0),
      count: values.length,
    },
  });
}
