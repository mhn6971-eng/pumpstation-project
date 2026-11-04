"use client";

import { useMemo, useState } from "react";
import { useApp } from "./context";
import { Icon, Panel } from "./ui";
import { addDaysToDay, operationalDay } from "@/lib/jalali";

const KINDS: { key: string; label: string; desc: string; creatable: boolean }[] = [
  { key: "daily", label: "پایش روزانه", desc: "پارامترهای فرآیندی، موتورهای روشن، گزارش دستی و امضاها", creatable: true },
  { key: "aux", label: "تجهیزات جانبی", desc: "وضعیت و توضیحات سرویس تجهیزات جانبی و ایمنی", creatable: true },
  { key: "motor_service", label: "سرویس موتور اصلی", desc: "ذغال‌ها، ساعت HMI، انجام‌دهندگان", creatable: false },
  { key: "megger", label: "تست مگر", desc: "مقاومت عایقی استاتور/رتور، دما، PI", creatable: false },
  { key: "oil", label: "تعویض روغن", desc: "تاریخ، ساعت کارکرد، یادداشت", creatable: false },
  { key: "pm", label: "نگهداشت / PM", desc: "چک‌لیست PM هر تجهیز", creatable: false },
  { key: "registry", label: "لیست تجهیزات", desc: "گزارش تکی، دسته‌ای یا کلی رجیستری", creatable: true },
  { key: "trend", label: "روند پارامتر", desc: "نمودار و جدول روند هر پارامتر در بازهٔ دلخواه — از دکمهٔ نمودار هر پارامتر ساخته می‌شود", creatable: false },
];

export default function ReportsHub() {
  const { state, act, busy } = useApp();
  const op = operationalDay();
  const [kind, setKind] = useState("daily");
  const [day, setDay] = useState(op.day);
  const matches = useMemo(() => state.reports.filter((r) => r.kind === kind && (kind === "registry" || kind === "trend" ? true : r.day === day)), [state.reports, kind, day]);
  const kindMeta = KINDS.find((k) => k.key === kind)!;
  const daysWithReports = useMemo(() => Array.from(new Set(state.reports.filter((r) => r.kind === kind).map((r) => r.day))).sort().reverse(), [state.reports, kind]);

  async function create() {
    const id = await act("report.create", { kind, day });
    if (typeof id === "number") window.open(`/report/${id}`, "_blank");
  }

  return (
    <div className="grid">
      <Panel title="مرکز گزارش‌ها" icon="file" hint="همهٔ گزارش‌ها بر اساس دسته و تاریخ — نسخه‌های قبلی حذف نمی‌شوند">
        <div className="row" style={{ marginBottom: 12 }}>
          {KINDS.map((k) => {
            const n = state.reports.filter((r) => r.kind === k.key).length;
            return <button key={k.key} type="button" className={`btn ${kind === k.key ? "active" : ""}`} onClick={() => setKind(k.key)}>{k.label} <span className="chip muted" style={{ padding: "0 6px", fontSize: 11 }}>{n}</span></button>;
          })}
        </div>
        <div className="note" style={{ marginBottom: 12 }}>{kindMeta.desc}</div>

        {kind !== "registry" && kind !== "trend" && (
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <label className="small muted">تاریخ (شمسی):</label>
            <input className="input mono" style={{ width: 150, direction: "ltr", textAlign: "center" }} value={day} onChange={(e) => setDay(e.target.value)} placeholder="1405/08/13" />
            <button type="button" className="btn tiny" onClick={() => setDay(addDaysToDay(day, -1))}>روز قبل</button>
            <button type="button" className="btn tiny" onClick={() => setDay(op.day)}>امروز</button>
            <button type="button" className="btn tiny" disabled={day >= op.day} onClick={() => setDay(addDaysToDay(day, 1))}>روز بعد</button>
            {daysWithReports.length > 0 && (
              <select className="input" style={{ width: 190 }} value="" onChange={(e) => e.target.value && setDay(e.target.value)}>
                <option value="">روزهای دارای گزارش…</option>
                {daysWithReports.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
          </div>
        )}

        {matches.length === 0 ? (
          <div className="empty" style={{ padding: 28 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--red)", marginBottom: 6 }}>گزارشی ثبت نگردیده</div>
            <div className="small muted">برای {kindMeta.label}{kind !== "registry" && kind !== "trend" ? ` در تاریخ ${day}` : ""} گزارشی وجود ندارد.</div>
            {kindMeta.creatable && (
              <button type="button" className="btn primary" style={{ marginTop: 12 }} disabled={busy} onClick={create}>
                <Icon name="file" size={14} /> ساخت فرم گزارش این تاریخ (داده‌های ثبت‌نشده با «—» و مهر «ثبت نگردیده»)
              </button>
            )}
            {!kindMeta.creatable && <div className="small muted" style={{ marginTop: 8 }}>این نوع گزارش هنگام ثبت رکورد (سرویس/مگر/روغن/PM) به‌صورت خودکار ساخته می‌شود.</div>}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>#</th><th>عنوان</th><th>تاریخ</th><th>شیفت / اپراتورها</th><th>زمان ساخت</th><th>PDF</th></tr></thead>
              <tbody>
                {matches.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.id}</td><td>{r.title}</td><td className="mono">{r.day}</td><td className="small">{r.operators}</td><td className="mono small">{r.createdAt}</td>
                    <td><button type="button" className="btn tiny primary" onClick={() => window.open(`/report/${r.id}`, "_blank")}>مشاهده / چاپ PDF</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {kindMeta.creatable && matches.length > 0 && (
          <div className="row" style={{ marginTop: 10, justifyContent: "flex-end" }}>
            <button type="button" className="btn" disabled={busy} onClick={create}><Icon name="plus" size={13} /> ساخت نسخهٔ جدید (اصلاحی) برای این تاریخ</button>
          </div>
        )}
      </Panel>

      <Panel title="صف ارسال به کانال" icon="bolt" hint="هیچ گزارشی گم نمی‌شود؛ ارسال فقط دستی">
        {state.queue.length === 0 ? <div className="empty">آیتمی در صف نیست.</div> : (
          <div className="table-wrap"><table className="data"><thead><tr><th>#</th><th>گزارش</th><th>وضعیت</th><th>تلاش</th><th>آخرین خطا</th><th>زمان</th></tr></thead>
            <tbody>{state.queue.map((q) => <tr key={q.id}><td className="mono">{q.id}</td><td className="mono">{q.reportId}</td><td>{q.status === "sent" ? <span className="chip live">ارسال شد</span> : q.status === "canceled" ? <span className="chip muted">لغو</span> : <span className="chip warn">در صف</span>}</td><td className="mono">{q.attempts}</td><td className="small muted">{q.lastError || "—"}</td><td className="mono small">{q.sentAt || q.createdAt}</td></tr>)}</tbody></table></div>
        )}
      </Panel>
    </div>
  );
}
