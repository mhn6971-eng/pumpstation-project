"use client";

import { useState } from "react";
import { useApp } from "./context";
import { Panel } from "./ui";

/** سربرگ نگهداشت دوره‌ای (PM): قالب‌ها + تاریخچهٔ همهٔ تجهیزات */
export default function PmTab() {
  const { state, goTab } = useApp();
  const [tag, setTag] = useState("");
  const [openTpl, setOpenTpl] = useState<number | null>(null);

  const tags = Array.from(new Set(state.pmRecords.map((r) => r.tag))).sort();
  const history = state.pmRecords.filter((r) => !tag || r.tag === tag);
  const cats = Array.from(new Set(state.pmTemplates.map((t) => t.category)));

  return (
    <div className="grid">
      <Panel
        title="تاریخچهٔ PM همهٔ تجهیزات"
        icon="wrench"
        hint="ثبت PM تازه از سربرگ لیست تجهیزات، روی همان تجهیز انجام می‌شود"
        actions={
          <button type="button" className="btn tiny" onClick={() => goTab("registry")}>
            رفتن به لیست تجهیزات
          </button>
        }
      >
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="field" style={{ minWidth: 200 }}>
            <label>پالایش بر اساس تجهیز</label>
            <select className="input" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">همهٔ تجهیزات</option>
              {tags.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
        {history.length === 0 ? (
          <div className="empty">PM ثبت نشده است.</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>تاریخ</th><th>تجهیز</th><th>قالب</th><th>انجام‌دهندگان</th><th>شیفت</th><th>یادداشت</th><th>PDF</th></tr></thead>
              <tbody>
                {history.map((r) => {
                  const rep = state.reports.find((x) => x.kind === "pm" && x.day === r.day && x.title.includes(r.tag));
                  return (
                    <tr key={r.id}>
                      <td className="mono">{r.day}</td>
                      <td className="mono">{r.tag}</td>
                      <td>{r.templateName}</td>
                      <td>{r.workers || "—"}</td>
                      <td>{r.shiftKey}</td>
                      <td className="small">{r.note || "—"}</td>
                      <td>{rep ? <button type="button" className="btn tiny" onClick={() => window.open(`/report/${rep.id}`, "_blank")}>PDF</button> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="قالب‌های PM" icon="file" hint="قالب‌ها توسط ادمین در سربرگ ادمین ساخته و ویرایش می‌شوند">
        {state.pmTemplates.length === 0 ? (
          <div className="empty">قالبی تعریف نشده است.</div>
        ) : (
          <div className="services-list">
            {cats.map((c) => (
              <div key={c}>
                <div className="panel-title" style={{ fontSize: 13, margin: "6px 0" }}>{c}</div>
                {state.pmTemplates.filter((t) => t.category === c).map((t) => (
                  <div key={t.id} className="service-item" style={{ flexWrap: "wrap" }}>
                    <button type="button" className="btn tiny ghost" onClick={() => setOpenTpl(openTpl === t.id ? null : t.id)} title="مشاهدهٔ آیتم‌ها">
                      <b>{openTpl === t.id ? "−" : "+"}</b> {t.name} <span className="muted">({t.items.length} آیتم)</span>
                    </button>
                    {openTpl === t.id && (
                      <ul className="small" style={{ flexBasis: "100%", margin: "6px 0 2px", paddingInlineStart: 18 }}>
                        {t.items.map((it) => <li key={it}>{it}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
