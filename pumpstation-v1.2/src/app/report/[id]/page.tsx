import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reports } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { ensureSeed } from "@/db/seed";
import PrintBar from "@/components/PrintBar";
import { APP_NAME, APP_SUBTITLE, ORG_NAME } from "@/lib/domain";
import { REPORT_KINDS } from "@/lib/reporting";

export const dynamic = "force-dynamic";

type Any = Record<string, unknown>;
const v = (x: unknown) => (x === null || x === undefined || x === "" ? "—" : String(x));
const kindOf = (k: string) => (k === "service" ? "در حال سرویس" : k === "ready" ? "آماده به کار" : k === "motor_service" ? "سرویس موتور" : k === "pm" ? "PM" : "گزارش سرویس");

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  await ensureSeed();
  const user = await getSessionUser();
  if (!user) redirect("/");
  const { id } = await params;
  const row = (await db.select().from(reports).where(eq(reports.id, Number(id))).limit(1))[0];
  if (!row) notFound();
  const d = row.payload as Any;
  const [opShift, opMembers] = row.operators.includes(" — ") ? row.operators.split(" — ") : [row.operators || row.shiftKey, ""];

  return (
    <main className="report-page">
      <PrintBar title={`${row.title} — نسخه ${row.id}`} />
      <article className="print-sheet">
        <header className="print-head">
          <div>
            <div className="org">{ORG_NAME}</div>
            <div className="print-sub">{APP_NAME} — {APP_SUBTITLE}</div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo.jpg" alt={ORG_NAME} style={{ height: 64, width: "auto" }} />
        </header>

        <h1 className="print-title">{REPORT_KINDS[row.kind] ?? row.title}</h1>
        <div className="print-meta">
          <span><b>تاریخ گزارش:</b> {row.day}{d.weekday ? ` — ${String(d.weekday)}` : ""}</span>
          <span><b>شیفت / اپراتورها:</b> {row.operators}</span>
          <span><b>زمان تولید:</b> {row.createdAt}</span>
          <span><b>شماره نسخه:</b> {row.id}</span>
        </div>
        {d.empty === true && <div className="print-stamp">گزارشی ثبت نگردیده — داده‌ای برای این تاریخ وارد نشده است</div>}

        {row.kind === "daily" && <Daily d={d} />}
        {row.kind === "aux" && <Aux d={d} />}
        {row.kind === "motor_service" && <MotorService d={d} />}
        {row.kind === "megger" && <Megger d={d} />}
        {row.kind === "oil" && <Simple rows={[["تگ", v(d.tag)], ["تاریخ", v(d.day)], ["ساعت کارکرد", v(d.hours)], ["یادداشت", v(d.note)]]} />}
        {row.kind === "pm" && <Pm d={d} />}
        {row.kind === "registry" && <Registry d={d} />}
        {row.kind === "trend" && <Trend d={d} />}

        <table className="sign-table" style={{ marginTop: 22 }}>
          <thead><tr><th style={{ width: "33%" }}>اپراتور</th><th style={{ width: "34%" }}>سرپرست ایستگاه پمپاژ</th><th style={{ width: "33%" }}>مدیر پروژه</th></tr></thead>
          <tbody><tr><td><div style={{ height: 30 }}></div><div style={{ fontWeight: 700 }}>{opShift}</div><div>{opMembers}</div></td><td></td><td></td></tr></tbody>
        </table>
        <div className="print-foot">{ORG_NAME} — {APP_NAME} — تولیدشده توسط {row.operators}</div>
      </article>
    </main>
  );
}

function Simple({ rows }: { rows: [string, string][] }) {
  return <table><tbody>{rows.map(([k, val]) => <tr key={k}><th style={{ width: 160 }}>{k}</th><td>{val}</td></tr>)}</tbody></table>;
}

function Daily({ d }: { d: Any }) {
  const process = (d.process as Any[]) ?? [];
  const motorsOn = (d.motorsOn as string[]) ?? [];
  const motorsService = (d.motorsService as string[]) ?? [];
  const hasStar = process.some((p) => p.out);
  return (
    <>
      <h2>پارامترهای فرآیندی</h2>
      <table>
        <thead><tr><th style={{ width: 80 }}>تگ</th><th>توضیح فارسی</th>{["۷-۱۱", "۱۱-۱۵", "۱۵-۱۹", "۱۹-۲۳", "۲۳-۳", "۳-۷"].map((h) => <th key={h} style={{ width: 54, textAlign: "center" }}>{h}</th>)}<th style={{ width: 80 }}>آخرین</th><th style={{ width: 50 }}>واحد</th></tr></thead>
        <tbody>
          {process.map((p) => (
            <tr key={String(p.tag)}>
              <td className="ltr">{v(p.tag)}</td><td>{v(p.label)}</td>
              {((p.byInterval as (number | null)[]) ?? []).map((x, i) => <td key={i} className="ltr center">{x ?? "—"}</td>)}
              <td className="ltr center"><b>{v(p.value)}</b>{p.out ? <span className="print-star"> *</span> : ""}</td><td>{v(p.unit)}</td>
            </tr>
          ))}
          <tr><td className="ltr">TOTAL-FIT</td><td>توتال روزانه دبی</td><td colSpan={6}></td><td className="ltr center"><b>{v(d.total)}</b></td><td>m³</td></tr>
        </tbody>
      </table>
      {hasStar && <p className="print-note">* مقدار خارج از محدودهٔ ست‌پوینت؛ ثبت انجام شده و فقط برای اطلاع علامت‌گذاری شده است.</p>}

      <h2>وضعیت موتورهای اصلی</h2>
      <table><tbody>
        <tr><th style={{ width: 160 }}>روشن</th><td className="ltr">{motorsOn.length ? motorsOn.join("، ") : "—"}</td></tr>
        <tr><th>خاموش / آماده به کار</th><td className="ltr">{((d.motorsOff as string[]) ?? []).join("، ") || "—"}</td></tr>
        <tr><th>در حال سرویس</th><td className="ltr">{motorsService.join("، ") || "—"}</td></tr>
      </tbody></table>

      <h2>گزارش دستی اپراتور</h2>
      <p className="print-para">{v(d.note)}</p>

    </>
  );
}

function Aux({ d }: { d: Any }) {
  const equipment = (d.equipment as Any[]) ?? [];
  const svc = (d.serviceReports as Any[]) ?? [];
  return (
    <>
      <h2>وضعیت تجهیزات جانبی</h2>
      <table><thead><tr><th style={{ width: 80 }}>تگ</th><th>تجهیز</th><th style={{ width: 100 }}>وضعیت</th><th>توضیحات / دلیل سرویس</th><th style={{ width: 120 }}>زمان ثبت</th></tr></thead>
        <tbody>{equipment.map((e) => <tr key={String(e.tag)}><td className="ltr">{v(e.tag)}{e.safetyCritical ? " *" : ""}</td><td>{v(e.name)}</td><td>{v(e.statusFa)}</td><td className="small">{v(e.description)}</td><td className="ltr small">{v(e.descriptionAt)}</td></tr>)}</tbody></table>
      <p className="print-note">* تجهیز حیاتی ایمنی</p>
      <h2>گزارش‌های سرویس امروز</h2>
      {svc.length === 0 ? <p className="print-para">گزارشی ثبت نشده است.</p> : (
        <table><thead><tr><th style={{ width: 80 }}>تگ</th><th style={{ width: 100 }}>نوع</th><th>توضیحات</th><th style={{ width: 130 }}>زمان</th></tr></thead>
          <tbody>{svc.map((s, i) => <tr key={i}><td className="ltr">{v(s.tag)}</td><td>{kindOf(String(s.kind))}</td><td>{v(s.reason)}</td><td className="ltr small">{v(s.at)}</td></tr>)}</tbody></table>)}
    </>
  );
}

function MotorService({ d }: { d: Any }) {
  const brush = (d.brush as Record<string, number>) ?? {};
  const megger = d.megger as Any | null;
  const oil = d.oil as Any | null;
  return (
    <>
      <Simple rows={[["موتور / پمپ", `${v(d.tag)} / ${v(d.pumpTag)}`], ["تاریخ سرویس", v(d.day)], ["ساعت HMI هنگام سرویس", v(d.hours)], ["شیفت ثبت‌کننده", v(d.shiftLabel ?? d.workers)], ["یادداشت", v(d.note)]]} />
      <h2>قرائت ذغال‌ها (میلی‌متر)</h2>
      <table><thead><tr><th>فاز</th>{Array.from({ length: 8 }, (_, i) => <th key={i} className="center">برس {i + 1}</th>)}</tr></thead>
        <tbody>{["U", "V", "W"].map((ph) => <tr key={ph}><td className="ltr"><b>{ph}</b></td>{Array.from({ length: 8 }, (_, i) => <td key={i} className="ltr center">{brush[`${ph}${i + 1}`] ?? "—"}</td>)}</tr>)}</tbody></table>
      <h2>آخرین تست مگر</h2>
      {megger ? <Simple rows={[["تاریخ", v(megger.day)], ["استاتور U1/V1/W1 (MΩ)", `${v(megger.statorU)} / ${v(megger.statorV)} / ${v(megger.statorW)}`], ["رتور U1/V1/W1 (MΩ)", `${v(megger.rotorU)} / ${v(megger.rotorV)} / ${v(megger.rotorW)}`], ["دمای سیم‌پیچ", v(megger.windingTemp)], ["PI", v(megger.pi)], ["ولتاژ تست", `${v(megger.testVoltage)} V`]]} /> : <p className="print-para">ثبت نشده است.</p>}
      <h2>آخرین تعویض روغن پمپ</h2>
      {oil ? <Simple rows={[["تاریخ", v(oil.day)], ["ساعت کارکرد", v(oil.hours)], ["یادداشت", v(oil.note)]]} /> : <p className="print-para">ثبت نشده است.</p>}
    </>
  );
}

function Megger({ d }: { d: Any }) {
  return (
    <>
      <Simple rows={[["موتور", v(d.tag)], ["تاریخ", v(d.day)], ["ولتاژ تست", `${v(d.testVoltage)} V`], ["انجام‌دهندگان", v(d.workers)]]} />
      <h2>نتایج</h2>
      <table><thead><tr><th>آیتم</th><th className="center">U1</th><th className="center">V1</th><th className="center">W1</th></tr></thead>
        <tbody>
          <tr><td>مقاومت عایقی استاتور (MΩ)</td><td className="ltr center">{v(d.statorU)}</td><td className="ltr center">{v(d.statorV)}</td><td className="ltr center">{v(d.statorW)}</td></tr>
          <tr><td>مقاومت عایقی رتور (MΩ)</td><td className="ltr center">{v(d.rotorU)}</td><td className="ltr center">{v(d.rotorV)}</td><td className="ltr center">{v(d.rotorW)}</td></tr>
          <tr><td>دمای سیم‌پیچ (°C)</td><td className="ltr center" colSpan={3}>{v(d.windingTemp)}</td></tr>
          <tr><td>ضریب پلاریزاسیون (PI)</td><td className="ltr center" colSpan={3}>{v(d.pi)}</td></tr>
        </tbody></table>
      {d.note ? <p className="print-para">یادداشت: {String(d.note)}</p> : null}
    </>
  );
}

function Pm({ d }: { d: Any }) {
  const results = (d.results as Record<string, string>) ?? {};
  return (
    <>
      <Simple rows={[["تجهیز", `${v(d.tag)} — ${v(d.name)}`], ["دسته", v(d.category)], ["قالب", v(d.templateName)], ["تاریخ", v(d.day)], ["انجام‌دهندگان", v(d.workers)], ["یادداشت", v(d.note)]]} />
      <h2>چک‌لیست</h2>
      <table><thead><tr><th>آیتم</th><th style={{ width: 120 }}>نتیجه</th><th>توضیح</th></tr></thead>
        <tbody>{Object.entries(results).map(([k, val]) => { const [r, note] = String(val).split(" | "); return <tr key={k}><td>{k}</td><td>{r || "—"}</td><td className="small">{note || "—"}</td></tr>; })}</tbody></table>
    </>
  );
}

function Trend({ d }: { d: Any }) {
  const points = (d.points as Any[]) ?? [];
  const stats = (d.stats as Any) ?? {};
  const W = 760, H = 240, px = 52, py = 18;
  const vals = points.map((p) => Number(p.y));
  const min = vals.length ? Math.min(...vals) : 0;
  const max = vals.length ? Math.max(...vals) : 1;
  const span = max - min || 1;
  const X = (i: number) => px + (points.length <= 1 ? (W - px * 2) / 2 : (i / (points.length - 1)) * (W - px * 2));
  const Y = (vv: number) => py + (H - py * 2) - ((vv - min) / span) * (H - py * 2);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(Number(p.y)).toFixed(1)}`).join(" ");
  const shown = points.slice(0, 1500);
  const isCompare = d.grouped === "motor";
  return (
    <>
      <Simple rows={[
        ["پارامتر", v(d.label)],
        ["واحد", v(d.unit)],
        ["بازهٔ گزارش", `${v(d.from)} تا ${v(d.to)}`],
        ["تعداد نقاط", v(stats.count)],
        ["میانگین / کمینه / بیشینه", `${v(stats.avg)} / ${v(stats.min)} / ${v(stats.max)}`],
        ...(d.grouped === "day" ? [["تجمیع", "میانگین روزانه (بازهٔ طولانی)"] as [string, string]] : []),
      ]} />
      {points.length > 0 && (<><h2>نمودار روند</h2>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", border: "1px solid #b9c7d6", borderRadius: 6 }}>
          {[0, 1, 2, 3, 4].map((i) => { const gy = py + ((H - py * 2) / 4) * i; return (<g key={i}><line x1={px} y1={gy} x2={W - 10} y2={gy} stroke="#cbd8e6" strokeDasharray="3 4" /><text x={px - 6} y={gy + 3} fill="#64748b" fontSize="9" textAnchor="end" fontFamily="monospace">{(max - (span / 4) * i).toFixed(1)}</text></g>); })}
          <path d={line} fill="none" stroke="#0e7490" strokeWidth="2" strokeLinejoin="round" />
        </svg></>)}
      <h2>جدول مقادیر</h2>
      {shown.length === 0 ? <p className="print-para">داده‌ای در این بازه ثبت نشده است.</p> : (
        <table><thead><tr><th style={{ width: 110 }}>{isCompare ? "موتور" : "تاریخ"}</th><th style={{ width: 110 }}>{isCompare ? "پارامتر" : d.grouped === "day" ? "نوع" : "بازه"}</th><th>مقدار ({v(d.unit)})</th><th style={{ width: 120 }}>شیفت / ثبت</th></tr></thead>
          <tbody>{shown.map((p, i) => (
            <tr key={i}>
              <td className="ltr">{isCompare ? v(p.x) : v(p.day)}</td>
              <td className="small">{isCompare ? v(d.label) : d.grouped === "day" ? "میانگین روزانه" : `بازه ${Number(p.interval) + 1}`}</td>
              <td className="ltr"><b>{v(p.y)}</b></td>
              <td className="small">{v(p.shift)}</td>
            </tr>
          ))}</tbody></table>
      )}
      {points.length > shown.length && <p className="print-note">جدول {shown.length} ردیف اول از {points.length} نقطه را نشان می‌دهد.</p>}
    </>
  );
}

function Registry({ d }: { d: Any }) {
  const items = (d.items as Any[]) ?? [];
  return (
    <>
      <p className="print-para">محدوده: {d.scope === "all" ? "کل رجیستری" : d.scope === "category" ? `دستهٔ ${v(d.category)}` : d.scope === "single" ? "یک تجهیز" : "چند تجهیز انتخابی"} — {items.length} رکورد</p>
      <table><thead><tr><th style={{ width: 80 }}>تگ</th><th>نام</th><th>دسته</th><th>مشخصات</th><th>پلاک / قطعات</th><th>محل</th><th style={{ width: 80 }}>وضعیت</th><th style={{ width: 70 }}>آخرین PM</th></tr></thead>
        <tbody>{items.map((e) => <tr key={String(e.tag)}><td className="ltr">{v(e.tag)}</td><td>{v(e.name)}</td><td className="small">{v(e.category)}</td><td className="small">{v(e.spec)}</td><td className="small">{[e.plate, e.partNumbers].filter(Boolean).join(" — ") || "—"}</td><td className="small">{v(e.location)}</td><td>{v(e.statusFa)}</td><td className="ltr small">{v(e.lastPm)}</td></tr>)}</tbody></table>
    </>
  );
}
