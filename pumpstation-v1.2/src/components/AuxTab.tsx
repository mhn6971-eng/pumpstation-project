"use client";

import { useMemo, useState } from "react";
import { useApp } from "./context";
import { Icon, Panel, StatusPill, StatusToggle } from "./ui";
import { EquipmentServiceForm } from "./ServiceForm";

export default function AuxTab() {
  const { state, act, busy, openModal } = useApp();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "ready" | "in_service">("all");

  const aux = useMemo(
    () =>
      state.equipment
        .filter((e) => e.isAux)
        .filter((e) => (filter === "all" ? true : e.status === filter))
        .filter((e) => (query ? [e.tag, e.name, e.location].some((v) => v.toLowerCase().includes(query.toLowerCase())) : true))
        .sort((a, b) => a.tag.localeCompare(b.tag)),
    [state.equipment, filter, query],
  );
  const all = state.equipment.filter((e) => e.isAux);
  const auxTags = new Set(all.map((e) => e.tag));
  const logs = state.serviceLogs.filter((s) => auxTags.has(s.tag)).slice(0, 12);

  async function printReport() {
    const id = await act("report.create", { kind: "aux", day: state.now.day });
    if (typeof id === "number") window.open(`/report/${id}`, "_blank");
  }

  return (
    <div className="grid">
      <div className="kpi-grid">
        <div className="kpi"><div className="v" style={{ color: "var(--green)" }}>{all.filter((e) => e.status === "ready").length}</div><div className="l">آماده به کار</div></div>
        <div className="kpi"><div className="v" style={{ color: "var(--amber)" }}>{all.filter((e) => e.status === "in_service").length}</div><div className="l">در حال سرویس</div></div>
        <div className="kpi"><div className="v">{all.length}</div><div className="l">کل تجهیزات این سربرگ</div></div>
      </div>

      <Panel
        title="پایش تجهیزات جانبی"
        icon="gauge"
        hint="وضعیت فقط آماده به کار / در حال سرویس — با توضیحات"
        actions={<button type="button" className="btn primary" disabled={busy} onClick={printReport}><Icon name="file" size={14} /> گزارش PDF این سربرگ</button>}
      >
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <div className="search-wrap" style={{ maxWidth: 320 }}>
            <input style={{ background: "#fff", color: "var(--text)", borderColor: "var(--line)" }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جستجوی تگ، نام یا محل نصب…" />
            <span className="search-icon" style={{ color: "var(--dim)" }}><Icon name="search" size={15} /></span>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {[["all", "همه"], ["ready", "آماده به کار"], ["in_service", "در حال سرویس"]].map(([k, l]) => (
              <button key={k} type="button" className={`btn tiny ${filter === k ? "active" : ""}`} onClick={() => setFilter(k as typeof filter)}>{l}</button>
            ))}
          </div>
        </div>

        <div className="aux-grid">
          {aux.map((e) => (
            <article key={e.tag} className={`aux-card ${e.status === "in_service" ? "service" : ""}`}>
              <div className="aux-top">
                <div>
                  <div className="aux-tag">{e.tag}</div>
                  <div className="aux-name">{e.name}</div>
                  <div className="small muted" style={{ marginTop: 2 }}>محل نصب: {e.location || "—"}</div>
                </div>
                <StatusPill status={e.status} statusFa={e.statusFa} />
              </div>
              <div className="aux-desc">
                {e.description || <span className="muted">توضیح سرویس ثبت نشده است.</span>}
                {e.descriptionAt && <span className="meta">زمان ثبت توضیح: {e.descriptionAt}</span>}
              </div>
              <div className="aux-actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <StatusToggle status={e.status} disabled={busy} onPick={(mode) => openModal(`${mode === "ready" ? "آماده به کار" : "در حال سرویس"} — ${e.tag}`, <EquipmentServiceForm tag={e.tag} name={e.name} defaultMode={mode} />)} />
                <button type="button" className="btn tiny ghost" disabled={busy} onClick={() => openModal(`گزارش سرویس ${e.tag}`, <EquipmentServiceForm tag={e.tag} name={e.name} defaultMode="report" />)}><Icon name="file" size={12} /> ثبت گزارش سرویس (بدون تغییر وضعیت)</button>
              </div>
            </article>
          ))}
        </div>
        {aux.length === 0 && <div className="empty">تجهیزی با این مشخصات پیدا نشد.</div>}
      </Panel>

      <Panel title="آخرین گزارش‌های سرویس تجهیزات جانبی" icon="file" hint="در گزارش PDF همان روز درج می‌شود">
        {logs.length === 0 ? <div className="empty">گزارشی ثبت نشده است.</div> : (
          <div className="services-list">
            {logs.map((s) => (
              <div key={s.id} className="service-item">
                <div style={{ flex: "1 1 240px" }}><span className="mono" style={{ color: "var(--accent)", fontWeight: 700 }}>{s.tag}</span><span className="small muted"> — {s.kind === "service" ? "سرویس" : s.kind === "ready" ? "آماده به کار" : "گزارش"}</span><div style={{ marginTop: 3 }}>{s.reason}</div></div>
                <div className="small muted" style={{ whiteSpace: "nowrap" }}>{s.at}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
