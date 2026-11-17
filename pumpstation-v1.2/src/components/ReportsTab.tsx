"use client";

import { useState } from "react";
import { useApp } from "./context";
import { Icon, Panel } from "./ui";

export default function ReportsTab({ initialView = "reports" }: { initialView?: "reports" | "problems" }) {
  const { state, act, busy, toast, refresh } = useApp();
  const [view, setView] = useState<"reports" | "alerts" | "problems" | "services">(initialView === "problems" ? "problems" : "reports");
  const [problemText, setProblemText] = useState("");

  async function createReport(kind: "daily" | "aux") {
    try {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "report.create", payload: { kind, day: state.now.day } }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ساخت گزارش ناموفق بود");
      await refresh();
      window.open(`/report/${data.id}`, "_blank");
    } catch (error) {
      toast(error instanceof Error ? error.message : "ساخت گزارش ناموفق بود", "error");
    }
  }

  return (
    <div className="grid">
      <Panel
        title="گزارش‌ها، هشدارها و مشکلات"
        icon="file"
        hint={`${state.reports.length} گزارش بایگانی‌شده`}
        actions={
          <>
            <button type="button" className="btn primary" onClick={() => createReport("daily")}>
              <Icon name="file" size={13} /> گزارش روزانه
            </button>
            <button type="button" className="btn" onClick={() => createReport("aux")}>
              <Icon name="database" size={13} /> گزارش تجهیزات جانبی
            </button>
          </>
        }
      >
        <div className="row" style={{ marginBottom: 12 }}>
          {[
            { key: "reports", label: "آرشیو گزارش‌ها" },
            { key: "alerts", label: "تاریخچه هشدارها" },
            { key: "services", label: "گزارش‌های سرویس" },
            { key: "problems", label: "گزارش مشکل" },
          ].map((v) => (
            <button key={v.key} type="button" className={`btn tiny ${view === v.key ? "active" : ""}`} onClick={() => setView(v.key as typeof view)}>
              {v.label}
            </button>
          ))}
        </div>

        {view === "reports" && (
          <>
            {state.reports.length === 0 ? (
              <div className="empty">هنوز گزارشی ساخته نشده است.</div>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 520 }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>نوع</th>
                      <th>عنوان</th>
                      <th>روز</th>
                      <th>زمان ساخت</th>
                      <th>مشاهده / چاپ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.reports.map((r) => (
                      <tr key={r.id}>
                        <td className="mono">{r.id}</td>
                        <td>{r.kind === "daily" ? "روزانه" : "تجهیزات جانبی"}</td>
                        <td className="tiny">{r.title}</td>
                        <td className="mono tiny">{r.day}</td>
                        <td className="mono tiny">{r.createdAt}</td>
                        <td>
                          <button type="button" className="btn tiny" onClick={() => window.open(`/report/${r.id}`, "_blank")}>
                            بازکردن
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="note" style={{ marginTop: 10, fontSize: 10.5 }}>
              نسخه‌های قبلی گزارش حذف نمی‌شوند؛ هر بار ساخت گزارش، یک رکورد جدید با زمان دقیق ثبت می‌شود. صفحهٔ گزارش برای چاپ
              A4 و ذخیره به‌صورت PDF آماده است.
            </div>
          </>
        )}

        {view === "alerts" && (
          <div className="table-wrap" style={{ maxHeight: 520 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>زمان</th>
                  <th>تگ</th>
                  <th>پیام</th>
                  <th>شدت</th>
                  <th>دیدم</th>
                  <th>اقدام کردم</th>
                </tr>
              </thead>
              <tbody>
                {state.alerts.map((a) => (
                  <tr key={a.id}>
                    <td className="mono tiny">{a.at}</td>
                    <td className="mono">{a.tag}</td>
                    <td className="tiny">{a.message}</td>
                    <td>{a.severity === "critical" ? <span className="chip danger">بحرانی</span> : <span className="chip warn">هشدار</span>}</td>
                    <td className="tiny">{a.seenAt || "—"}</td>
                    <td className="tiny">
                      {a.actedAt || (
                        <button type="button" className="btn tiny" disabled={busy} onClick={() => act("alert.ack", { id: a.id, kind: "acted" })}>
                          اقدام کردم
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {state.alerts.length === 0 && <div className="empty">هشداری ثبت نشده است.</div>}
          </div>
        )}

        {view === "services" && (
          <>
            {state.serviceLogs.length === 0 ? (
              <div className="empty">گزارشی ثبت نشده است.</div>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 520 }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>زمان</th>
                      <th>تگ</th>
                      <th>نوع</th>
                      <th>توضیحات</th>
                      <th>ثبت‌کننده</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.serviceLogs.map((s) => (
                      <tr key={s.id}>
                        <td className="mono tiny">{s.at}</td>
                        <td className="mono">{s.tag}</td>
                        <td className="tiny">{s.kind === "service" ? "در حال سرویس" : s.kind === "ready" ? "آماده به کار" : s.kind === "motor_service" ? "سرویس موتور" : "گزارش"}</td>
                        <td className="tiny">{s.reason}</td>
                        <td className="tiny muted">{s.operator || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {view === "problems" && (
          <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)", gap: 12 }}>
            <div>
              <div className="field">
                <label htmlFor="problem">شرح مشکل یا خطای مشاهده‌شده</label>
                <textarea
                  id="problem"
                  value={problemText}
                  onChange={(e) => setProblemText(e.target.value)}
                  placeholder="مثلاً: در بازهٔ ۱۵ تا ۱۹، نمایشگر فشار رانش عددی نشان نداد…"
                />
              </div>
              <button
                type="button"
                className="btn primary"
                disabled={busy || problemText.trim().length < 3}
                onClick={async () => {
                  const ok = await act("problem.add", { text: problemText });
                  if (ok) setProblemText("");
                }}
              >
                <Icon name="plus" size={13} /> ثبت گزارش مشکل
              </button>
              <div className="note" style={{ marginTop: 10, fontSize: 10.5 }}>
                متن شما برای بررسی فنی ذخیره می‌شود. خطاهای داخلی سامانه هم به‌صورت خودکار در همین فهرست با برچسب «سیستمی»
                ثبت می‌شوند.
              </div>
            </div>
            <div className="services-list">
              {state.problems.length === 0 && <div className="empty">گزارش مشکلی ثبت نشده است.</div>}
              {state.problems.map((p) => (
                <div key={p.id} className="service-item">
                  <span style={{ flex: "1 1 220px" }}>{p.text}</span>
                  <span className="tiny muted">{p.at}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      <div className="note">
        <b>پیشنهاد چیدمان گزارش:</b> گزارش روزانه شامل جدول پارامترها، فهرست موتورهای روشن، توضیحات اپراتور، وضعیت تجهیزات
        جانبی و جدول امضا (اپراتور / سرپرست ایستگاه / مدیر پروژه) است. هشدارها عمداً در گزارش روزانه نمی‌آیند تا گزارش عملیاتی
        با گزارش فنی مخلوط نشود.
      </div>
    </div>
  );
}
