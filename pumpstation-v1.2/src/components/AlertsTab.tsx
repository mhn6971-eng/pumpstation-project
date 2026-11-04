"use client";

import { useState } from "react";
import { useApp } from "./context";
import { Icon, Panel } from "./ui";

export default function AlertsTab() {
  const { state, act, busy } = useApp();
  const [view, setView] = useState<"active" | "history">("active");
  const [q, setQ] = useState("");
  const rows = state.alerts
    .filter((a) => (view === "active" ? !a.actedAt : true))
    .filter((a) => (q ? a.message.includes(q) || a.tag.toLowerCase().includes(q.toLowerCase()) || a.day.includes(q) : true));
  return (
    <div className="grid">
      <div className="kpi-grid">
        <div className="kpi"><div className="v" style={{ color: "var(--red)" }}>{state.alerts.filter((a) => !a.actedAt && a.severity === "critical").length}</div><div className="l">بحرانی فعال</div></div>
        <div className="kpi"><div className="v" style={{ color: "var(--amber)" }}>{state.alerts.filter((a) => !a.actedAt && a.severity === "warning").length}</div><div className="l">هشدار فعال</div></div>
        <div className="kpi"><div className="v">{state.alerts.filter((a) => a.actedAt).length}</div><div className="l">اقدام‌شده (تاریخچه)</div></div>
        <div className="kpi"><div className="v">{state.counts.alerts}</div><div className="l">کل هشدارهای ثبت‌شده</div></div>
      </div>
      <Panel title="هشدارها و آلارم‌ها" icon="alert" hint="فقط بصری — بدون صدا. هر تأیید با زمان و شیفت ثبت می‌شود"
        actions={<><button type="button" className={`btn tiny ${view === "active" ? "active" : ""}`} onClick={() => setView("active")}>فعال</button><button type="button" className={`btn tiny ${view === "history" ? "active" : ""}`} onClick={() => setView("history")}>تاریخچه کامل</button></>}>
        <div className="search-wrap" style={{ maxWidth: 360, marginBottom: 10 }}>
          <input style={{ background: "#fff", color: "var(--text)", borderColor: "var(--line)" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو بر اساس تگ، پیام یا تاریخ…" />
          <span className="search-icon" style={{ color: "var(--dim)" }}><Icon name="search" size={15} /></span>
        </div>
        {rows.length === 0 ? <div className="empty">موردی وجود ندارد.</div> : (
          <div className="table-wrap" style={{ maxHeight: 600 }}>
            <table className="data">
              <thead><tr><th>زمان</th><th>تگ</th><th>پیام</th><th>مقدار</th><th>شدت</th><th>شیفت</th><th>دیدم</th><th>اقدام کردم</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="mono small">{a.at}</td><td className="mono" style={{ fontWeight: 700 }}>{a.tag}</td><td>{a.message}</td><td className="mono">{a.value}</td>
                    <td>{a.severity === "critical" ? <span className="chip danger">بحرانی</span> : <span className="chip warn">هشدار</span>}</td><td>{a.shiftKey}</td>
                    <td className="small">{a.seenAt ? `${a.seenAt} — ${a.seenShift || ""}` : <button type="button" className="btn tiny" disabled={busy} onClick={() => act("alert.ack", { id: a.id, kind: "seen" })}>دیدم</button>}</td>
                    <td className="small">{a.actedAt ? `${a.actedAt} — ${a.actedShift || ""}` : <button type="button" className="btn tiny green" disabled={busy} onClick={() => act("alert.ack", { id: a.id, kind: "acted" })}>اقدام کردم</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
