"use client";

import { useMemo, useState } from "react";
import { useApp } from "./context";
import { CATEGORIES } from "@/lib/domain";
import type { EquipmentView } from "@/lib/types";
import { Icon, Panel, StatusPill, StatusToggle } from "./ui";
import { EquipmentServiceForm, MotorOverhaulForm } from "./ServiceForm";

export default function RegistryTab() {
  const { state, act, busy, isAdmin, openModal } = useApp();
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const rows = useMemo(
    () =>
      state.equipment
        .filter((e) => (category ? e.category === category : true))
        .filter((e) => (status ? e.status === status : true))
        .filter((e) => (query ? [e.tag, e.name, e.spec, e.location, e.description, e.plate].some((v) => v.toLowerCase().includes(query.toLowerCase())) : true)),
    [state.equipment, category, query, status],
  );
  const categories = Array.from(new Set([...CATEGORIES, ...state.equipment.map((e) => e.category)]));

  async function report(scope: "all" | "category" | "selected") {
    const payload = scope === "all" ? { kind: "registry" } : scope === "category" ? { kind: "registry", category } : { kind: "registry", tags: selected };
    if (scope === "category" && !category) return;
    if (scope === "selected" && !selected.length) return;
    const id = await act("report.create", payload);
    if (typeof id === "number") window.open(`/report/${id}`, "_blank");
  }
  const toggle = (tag: string) => setSelected((s) => (s.includes(tag) ? s.filter((x) => x !== tag) : [...s, tag]));

  return (
    <div className="grid">
      <Panel
        title="لیست تجهیزات (رجیستری)"
        icon="database"
        hint={`${rows.length} رکورد از ${state.equipment.length}`}
        actions={
          <>
            {isAdmin && <button type="button" className="btn" onClick={() => openModal("افزودن رکورد تجهیز", <EquipmentForm />)}><Icon name="plus" size={14} /> افزودن تجهیز</button>}
            <button type="button" className="btn" disabled={busy} onClick={() => report("all")}><Icon name="file" size={14} /> گزارش کلی</button>
            <button type="button" className="btn" disabled={busy || !category} onClick={() => report("category")}><Icon name="file" size={14} /> گزارش این دسته</button>
            <button type="button" className="btn primary" disabled={busy || !selected.length} onClick={() => report("selected")}><Icon name="file" size={14} /> گزارش انتخاب‌شده‌ها ({selected.length})</button>
          </>
        }
      >
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <select className="input" style={{ width: 250 }} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">همهٔ دسته‌ها</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input" style={{ width: 170 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">همهٔ وضعیت‌ها</option><option value="ready">آماده به کار</option><option value="in_service">در حال سرویس</option><option value="in_warehouse">در انبار</option>
          </select>
          <div className="search-wrap" style={{ maxWidth: 340 }}>
            <input style={{ background: "#fff", color: "var(--text)", borderColor: "var(--line)" }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جستجوی زنده در تگ، نام، مشخصات، پلاک…" />
            <span className="search-icon" style={{ color: "var(--dim)" }}><Icon name="search" size={15} /></span>
          </div>
          <button type="button" className="btn tiny ghost" onClick={() => setSelected(selected.length ? [] : rows.map((r) => r.tag))}>{selected.length ? "لغو انتخاب" : "انتخاب همهٔ ردیف‌ها"}</button>
        </div>

        <div className="table-wrap" style={{ maxHeight: 640 }}>
          <table className="data">
            <thead><tr><th></th><th>تگ</th><th>نام تجهیز</th><th>دسته</th><th>مشخصات</th><th>محل</th><th>وضعیت</th><th>آخرین توضیحات</th><th>اقدام</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td><input type="checkbox" checked={selected.includes(e.tag)} onChange={() => toggle(e.tag)} /></td>
                  <td className="mono" style={{ color: "var(--accent)", fontWeight: 700, whiteSpace: "nowrap" }}>{e.tag}{e.safetyCritical && <Icon name="shield" size={12} className="muted" style={{ marginInlineStart: 4 }} />}</td>
                  <td>{e.name}{e.isMotor && <span className="chip muted" style={{ marginInlineStart: 6, padding: "1px 7px", fontSize: 11 }}>موتور اصلی</span>}</td>
                  <td className="small muted">{e.category}</td>
                  <td className="small">{e.spec || "—"}</td>
                  <td className="small muted">{e.location || "—"}</td>
                  <td><StatusPill status={e.status} statusFa={e.statusFa} /></td>
                  <td className="small" style={{ maxWidth: 220 }}>{e.description ? e.description.slice(0, 80) : <span className="muted">—</span>}</td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                      <button type="button" className="btn tiny" onClick={() => openModal(`${e.tag} — پرونده تجهیز`, <EquipmentDetail tag={e.tag} />, { wide: true, sub: e.name })}>پرونده</button>
                      <StatusToggle status={e.status} disabled={busy} onPick={(mode) => openModal(`${mode === "ready" ? "آماده به کار" : "در حال سرویس"} — ${e.tag}`, <EquipmentServiceForm tag={e.tag} name={e.name} defaultMode={mode} />)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <div className="empty">رکوردی با این فیلتر پیدا نشد.</div>}
      </Panel>
      <div className="note">دسته‌بندی تابلوها: فشار ضعیف، فشار قوی، لوکال و بانک خازنی. قالب‌های PM از صفحهٔ ادمین قابل ویرایش هستند؛ چک‌لیست ماهیانهٔ الکتروموتور مطابق فرم دریافتی در دسترس است.</div>
    </div>
  );
}

/** پروندهٔ تجهیز: شناسنامه + تاریخچه + ویرایش/حذف (ادمین) */
export function EquipmentDetail({ tag }: { tag: string }) {
  const { state, act, busy, isAdmin, openModal, closeModal, goTab } = useApp();
  const e = state.equipment.find((x) => x.tag === tag);
  if (!e) return <div className="empty">تجهیز پیدا نشد.</div>;
  const logs = state.serviceLogs.filter((s) => s.tag === tag);

  return (
    <div className="grid" style={{ gap: 12 }}>
      <div className="spread">
        <div><div className="mono" style={{ color: "var(--accent)", fontSize: 16, fontWeight: 700 }}>{e.tag}</div><div style={{ fontSize: 16, marginTop: 3 }}>{e.name}</div></div>
        <div className="row"><StatusPill status={e.status} statusFa={e.statusFa} />
          {isAdmin && <button type="button" className="btn tiny" onClick={() => openModal(`ویرایش ${e.tag}`, <EquipmentForm existing={e} />)}><Icon name="wrench" size={12} /> ویرایش</button>}
          {isAdmin && !e.isMotor && <button type="button" className="btn tiny danger" disabled={busy} onClick={async () => { const reason = window.prompt(`حذف ${e.tag}؟ دلیل را بنویسید (رکورد به‌صورت نرم حذف و سابقه حفظ می‌شود):`); if (reason === null) return; if (await act("equipment.delete", { id: e.id, reason })) closeModal(); }}>حذف</button>}
        </div>
      </div>

      <div className="table-wrap">
        <table className="data"><tbody>
          <tr><th style={{ width: 130 }}>دسته</th><td>{e.category}</td></tr>
          <tr><th>مشخصات فنی</th><td>{e.spec || "—"}</td></tr>
          <tr><th>پلاک</th><td>{e.plate || "—"}</td></tr>
          <tr><th>شماره قطعات (تسمه/بلبرینگ/…)</th><td>{e.partNumbers || "—"}</td></tr>
          <tr><th>محل نصب</th><td>{e.location || "—"}</td></tr>
          <tr><th>آخرین توضیحات</th><td>{e.description || "—"}{e.descriptionAt && <span className="small muted"> ({e.descriptionAt})</span>}</td></tr>
          <tr><th>حیاتی ایمنی</th><td>{e.safetyCritical ? "بله" : "خیر"}</td></tr>
        </tbody></table>
      </div>

      {e.isMotor && <div className="note" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><span><b>سرویس اورهال:</b> سابقهٔ ماندگار تاریخ و کارکرد هر اورهال</span><button type="button" className="btn primary" onClick={() => openModal(`سرویس اورهال ${tag}`, <MotorOverhaulForm tag={tag} />, { wide: true })}>سرویس اورهال</button></div>}
      {e.isMotor && <MotorPlates />}
      <div className="row">
        <StatusToggle status={e.status} disabled={busy} onPick={(mode) => openModal(`${mode === "ready" ? "آماده به کار" : "در حال سرویس"} — ${tag}`, <EquipmentServiceForm tag={tag} name={e.name} defaultMode={mode} />)} />
        <button type="button" className="btn ghost" onClick={() => openModal(`گزارش سرویس ${tag}`, <EquipmentServiceForm tag={tag} name={e.name} defaultMode="report" />)}><Icon name="file" size={13} /> ثبت گزارش سرویس</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={async () => { const id = await act("report.create", { kind: "registry", tags: [tag] }); if (typeof id === "number") window.open(`/report/${id}`, "_blank"); }}><Icon name="file" size={13} /> گزارش این تجهیز</button>
      </div>



      <div className="spread">
        <div className="small muted">نگهداشت پیشگیرانه (PM) این تجهیز در سربرگ «نگهداشت» مدیریت می‌شود.</div>
        <button type="button" className="btn tiny" onClick={() => { closeModal(); goTab("pm"); }}>رفتن به سربرگ نگهداشت</button>
      </div>

      <div>
        <div className="panel-title" style={{ fontSize: 14, marginBottom: 6 }}>تاریخچهٔ سرویس و وضعیت</div>
        {logs.length === 0 ? <div className="empty">گزارشی ثبت نشده است.</div> : (
          <div className="services-list">{logs.map((r) => <div key={r.id} className="service-item"><span style={{ flex: "1 1 240px" }}>{r.reason}</span><span className="small muted">{r.operator} — {r.at}</span></div>)}</div>
        )}
      </div>
    </div>
  );
}

/** فرم افزودن/ویرایش تجهیز (ادمین) */
export function EquipmentForm({ existing }: { existing?: EquipmentView }) {
  const { state, act, busy, closeModal } = useApp();
  const [f, setF] = useState({
    tag: existing?.tag ?? "", name: existing?.name ?? "", category: existing?.category ?? CATEGORIES[0], spec: existing?.spec ?? "", plate: existing?.plate ?? "",
    partNumbers: existing?.partNumbers ?? "", location: existing?.location ?? "", isAux: existing?.isAux ?? false, safetyCritical: existing?.safetyCritical ?? false,
  });
  const cats = Array.from(new Set([...CATEGORIES, ...state.equipment.map((e) => e.category)]));
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await act("equipment.save", { ...f, id: existing?.id })) closeModal(); }}>
      <div className="form-grid">
        <div className="field"><label>تگ یکتا</label><input className="input mono" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} required disabled={existing?.isMotor} /></div>
        <div className="field"><label>نام تجهیز</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
        <div className="field"><label>دسته</label><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <div className="field"><label>مشخصات فنی</label><input className="input" value={f.spec} onChange={(e) => setF({ ...f, spec: e.target.value })} /></div>
        <div className="field"><label>پلاک</label><input className="input" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} /></div>
        <div className="field"><label>محل نصب</label><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
      </div>
      <div className="field" style={{ marginTop: 10 }}><label>شماره قطعات (تسمه، بلبرینگ، …)</label><textarea value={f.partNumbers} onChange={(e) => setF({ ...f, partNumbers: e.target.value })} style={{ minHeight: 60 }} /></div>
      <div className="row" style={{ margin: "6px 0 12px" }}>
        <label className="row small" style={{ gap: 5 }}><input type="checkbox" checked={f.isAux} onChange={(e) => setF({ ...f, isAux: e.target.checked })} /> نمایش در «پایش تجهیزات جانبی»</label>
        <label className="row small" style={{ gap: 5 }}><input type="checkbox" checked={f.safetyCritical} onChange={(e) => setF({ ...f, safetyCritical: e.target.checked })} /> تجهیز حیاتی ایمنی</label>
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}><button type="button" className="btn ghost" onClick={closeModal}>انصراف</button><button type="submit" className="btn primary" disabled={busy}>{existing ? "ذخیرهٔ ویرایش" : "ثبت رکورد"}</button></div>
    </form>
  );
}

/** فرم PM داینامیک بر اساس قالب دسته */
export function PmForm({ tag }: { tag: string }) {
  const { state, act, busy, closeModal } = useApp();
  const e = state.equipment.find((x) => x.tag === tag);
  const templates = state.pmTemplates.filter((t) => t.category === e?.category);
  const preferredTemplate = templates.find((t) => t.name.includes("ماهیانه")) ?? templates[0];
  const [templateId, setTemplateId] = useState<number>(preferredTemplate?.id ?? 0);
  const template = state.pmTemplates.find((t) => t.id === templateId);
  const [results, setResults] = useState<Record<string, string>>({});
  const [stage, setStage] = useState("1");
  const [workers, setWorkers] = useState("");
  const [note, setNote] = useState("");
  if (!e) return <div className="empty">تجهیز پیدا نشد.</div>;
  return (
    <form onSubmit={async (ev) => { ev.preventDefault(); const id = await act("pm.record", { tag, templateName: template?.name ?? "PM", stage, results, workers, note, day: state.now.day }); if (id) { closeModal(); if (typeof id === "number") window.open(`/report/${id}`, "_blank"); } }}>
      <div className="note" style={{ marginBottom: 10 }}>چک‌لیست ماهیانهٔ مصوب بر اساس فرم ارسالی، برای موتور/تجهیز <b>{e.tag} — {e.name}</b>. نتیجه و توضیحات هر ردیف در گزارش قابل چاپ ثبت می‌شود.</div>
      {templates.length > 1 && <div className="field"><label>قالب</label><select className="input" value={templateId} onChange={(ev) => setTemplateId(Number(ev.target.value))}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>}
      {!template ? <div className="empty">برای این دسته قالبی تعریف نشده؛ ادمین از تب ادمین قالب را بسازد.</div> : (
        <div className="table-wrap"><table className="data"><thead><tr><th>آیتم</th><th style={{ width: 140 }}>نتیجه</th><th>توضیح</th></tr></thead>
          <tbody>{template.items.map((item) => (
            <tr key={item}><td>{item}</td>
              <td><select className="input" style={{ padding: "5px 8px" }} value={results[item]?.split(" | ")[0] ?? ""} onChange={(ev) => setResults({ ...results, [item]: [ev.target.value, results[item]?.split(" | ")[1] ?? ""].filter(Boolean).join(" | ") })}><option value="">—</option><option value="سالم">سالم</option><option value="نیاز به اقدام">نیاز به اقدام</option><option value="انجام شد">انجام شد</option><option value="N/A">N/A</option></select></td>
              <td><input className="inline-input" style={{ textAlign: "start", fontSize: 13 }} value={results[item]?.split(" | ")[1] ?? ""} onChange={(ev) => setResults({ ...results, [item]: [results[item]?.split(" | ")[0] ?? "", ev.target.value].filter(Boolean).join(" | ") })} /></td>
            </tr>
          ))}</tbody></table></div>
      )}
      <div className="form-grid" style={{ marginTop: 10 }}>
        {template?.name.includes("ماهیانه") && <div className="field"><label>مرحلهٔ بازدید ماهانه</label><select className="input" value={stage} onChange={(ev) => setStage(ev.target.value)}><option value="1">مرحلهٔ اول — هفتهٔ اول ماه</option><option value="2">مرحلهٔ دوم — هفتهٔ سوم ماه</option></select></div>}
        <div className="field"><label>انجام‌دهندگان</label><input className="input" value={workers} onChange={(ev) => setWorkers(ev.target.value)} /></div>
        <div className="field"><label>تاریخ</label><input className="input" value={state.now.day} readOnly /></div>
      </div>
      <div className="field"><label>یادداشت</label><textarea value={note} onChange={(ev) => setNote(ev.target.value)} style={{ minHeight: 60 }} /></div>
      <div className="row" style={{ justifyContent: "flex-end" }}><button type="button" className="btn ghost" onClick={closeModal}>انصراف</button><button type="submit" className="btn primary" disabled={busy || !template}>ثبت PM و ساخت گزارش</button></div>
    </form>
  );
}


function MotorPlates() {
  const files = ["IMG_20261111_150359.jpg", "IMG_20261111_150436.jpg", "IMG_20261111_150447.jpg", "IMG_20261111_150454.jpg", "IMG_20261111_150458.jpg", "IMG_20261111_150526.jpg"];
  return <section><div className="panel-title" style={{ fontSize: 14, marginBottom: 6 }}>پلاک‌ها و اطلاعات فنی موتورهای اصلی ۱۸۰۰ کیلووات</div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8 }}>{files.map((file, i) => <a key={file} href={`/equipment-plates/${file}`} target="_blank" rel="noreferrer" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 6, textAlign: "center" }}><img src={`/equipment-plates/${file}`} alt={`پلاک یا مشخصات موتور ${i + 1}`} style={{ width: "100%", height: 140, objectFit: "contain" }} /><span className="small muted">مشخصات پلاک / اطلاعات فنی {i + 1}</span></a>)}</div><div className="small muted" style={{ marginTop: 6 }}>مشخصات پلاک اصلی: Siemens، مدل 1RU5566-4HA70-Z، ۱۸۰۰ kW، ۶۶۰۰ V، ۱۸۲ A، ۵۰ Hz، ۱۴۹۱ دور/دقیقه؛ یاتاقان 6230 M C3 و گریس Shell Alvania R3.</div></section>;
}
