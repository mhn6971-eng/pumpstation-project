"use client";

import { useState } from "react";
import { useApp } from "./context";
import { Panel } from "./ui";
import { PmForm } from "./RegistryTab";

/** سربرگ نگهداشت دوره‌ای (PM): قالب‌ها + تاریخچهٔ همهٔ تجهیزات */
export default function PmTab() {
  const { state, act, busy, isAdmin, goTab } = useApp();
  const [tag, setTag] = useState("");
  const [eqTag, setEqTag] = useState("");
  const [openTpl, setOpenTpl] = useState<number | null>(null);
  const [newTpl, setNewTpl] = useState<{ category: string; name: string; items: string } | null>(null);

  const tags = Array.from(new Set(state.pmRecords.map((r) => r.tag))).sort();
  const history = state.pmRecords.filter((r) => !tag || r.tag === tag);
  const cats = Array.from(new Set(state.pmTemplates.map((t) => t.category)));
  const equipTags = [...state.equipment].sort((a, b) => a.tag.localeCompare(b.tag));

  return (
    <div className="grid">
      <Panel title="ثبت PM تازه" icon="plus" hint="تجهیز را انتخاب کنید و فرم PM همان‌جا باز می‌شود">
        <div className="field" style={{ maxWidth: 340, marginBottom: 10 }}>
          <label>تجهیز</label>
          <select className="input" value={eqTag} onChange={(e) => setEqTag(e.target.value)}>
            <option value="">— انتخاب تجهیز —</option>
            {equipTags.map((e) => (
              <option key={e.tag} value={e.tag}>{e.tag} — {e.name}</option>
            ))}
          </select>
        </div>
        {eqTag ? <PmForm key={eqTag} tag={eqTag} /> : <div className="empty">برای ثبت PM تازه، ابتدا یک تجهیز انتخاب کنید.</div>}
      </Panel>

      <Panel
        title="تاریخچهٔ PM همهٔ تجهیزات"
        icon="wrench"
        hint="ثبت PM تازه از پنل بالا انجام می‌شود"
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

      <Panel
        title="قالب‌های PM"
        icon="file"
        hint="ساخت قالب تازه فقط ادمین؛ ویرایش قالب‌ها در سربرگ ادمین"
        actions={isAdmin ? (
          <button type="button" className="btn tiny primary" onClick={() => setNewTpl({ category: cats[0] ?? "", name: "", items: "" })}>
            قالب تازه
          </button>
        ) : undefined}
      >
        {newTpl && (
          <div className="service-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, marginBottom: 10 }}>
            <div className="form-grid">
              <div className="field"><label>دسته</label><input className="input" value={newTpl.category} onChange={(e) => setNewTpl({ ...newTpl, category: e.target.value })} placeholder="مثلاً: الکتروموتور" /></div>
              <div className="field"><label>نام قالب</label><input className="input" value={newTpl.name} onChange={(e) => setNewTpl({ ...newTpl, name: e.target.value })} placeholder="مثلاً: PM ماهانه" /></div>
            </div>
            <div className="field"><label>آیتم‌های چک‌لیست (هر خط یک آیتم)</label><textarea className="input" rows={4} value={newTpl.items} onChange={(e) => setNewTpl({ ...newTpl, items: e.target.value })} /></div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn ghost tiny" onClick={() => setNewTpl(null)}>انصراف</button>
              <button type="button" className="btn tiny primary" disabled={busy} onClick={async () => { if (await act("pm.template", { category: newTpl.category, name: newTpl.name, items: newTpl.items.split("\n").map((x) => x.trim()).filter(Boolean) })) setNewTpl(null); }}>ذخیره قالب</button>
            </div>
          </div>
        )}
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
