import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { dailyTotals } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { ensureSeed } from "@/db/seed";
import PrintBar from "@/components/PrintBar";
import { APP_NAME, APP_SUBTITLE, ORG_NAME } from "@/lib/domain";
import { monthDaysOf, operationalDay, PERSIAN_MONTHS, pad } from "@/lib/jalali";

export const dynamic = "force-dynamic";

function shift(month: number, year: number, delta: number) {
  let m = month + delta;
  let y = year;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return { y, m };
}

export default async function TotalsPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  await ensureSeed();
  const user = await getSessionUser();
  if (!user) redirect("/");
  const op = operationalDay();
  const sp = await searchParams;
  let year = Number(sp.year ?? op.jy);
  let month = Number(sp.month ?? op.jm);
  if (!Number.isInteger(year) || year < 1300 || year > 1500) year = op.jy;
  if (!Number.isInteger(month) || month < 1 || month > 12) month = op.jm;

  const rows = await db.select().from(dailyTotals).where(sql`${dailyTotals.day} like ${`${year}/${pad(month)}/%`}`).orderBy(dailyTotals.day);
  const map = new Map(rows.map((r) => [r.day, r.value]));
  const days = monthDaysOf(year, month);
  const table = Array.from({ length: days }, (_, i) => ({ d: i + 1, value: map.get(`${year}/${pad(month)}/${pad(i + 1)}`) ?? null }));
  const sum = table.reduce((a, t) => a + (t.value ?? 0), 0);
  const prev = shift(month, year, -1);
  const next = shift(month, year, 1);

  return (
    <main className="report-page">
      <PrintBar title={`توتال ماهانه — ${PERSIAN_MONTHS[month - 1]} ${year}`} />
      <div className="report-toolbar no-print" style={{ justifyContent: "center" }}>
        <Link className="btn tiny" href={`/totals?year=${prev.y}&month=${prev.m}`}>ماه قبل</Link>
        <span className="chip accent">{PERSIAN_MONTHS[month - 1]} {year}</span>
        <Link className="btn tiny" href={`/totals?year=${next.y}&month=${next.m}`}>ماه بعد</Link>
      </div>
      <article className="print-sheet">
        <header className="print-head">
          <div>
            <div className="org">{ORG_NAME}</div>
            <div className="print-sub">{APP_NAME} — {APP_SUBTITLE}</div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo.svg" alt={ORG_NAME} style={{ height: 46 }} />
        </header>
        <h1 className="print-title">توتال ماهانه دبی (m³) — {PERSIAN_MONTHS[month - 1]} {year}</h1>
        <div className="print-meta">
          <span><b>تعداد روزهای ثبت‌شده:</b> {table.filter((t) => t.value !== null).length} از {days}</span>
          <span><b>جمع کل:</b> {sum.toLocaleString("en-US")} m³</span>
          <span><b>ثبت‌کننده:</b> {user.label}</span>
        </div>
        <table>
          <thead><tr><th style={{ width: 70 }} className="center">روز</th><th style={{ width: 120 }}>تاریخ</th><th>مقدار (m³)</th></tr></thead>
          <tbody>
            {table.map((t) => (
              <tr key={t.d}>
                <td className="center ltr">{t.d}</td>
                <td className="ltr">{year}/{pad(month)}/{pad(t.d)}</td>
                <td className="ltr">{t.value === null ? "—" : t.value.toLocaleString("en-US")}</td>
              </tr>
            ))}
            <tr><th colSpan={2}>جمع کل ماه</th><td className="ltr"><b>{sum.toLocaleString("en-US")}</b></td></tr>
          </tbody>
        </table>
      </article>
    </main>
  );
}
