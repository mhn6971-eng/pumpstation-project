"use client";

import { useState } from "react";
import { useApp } from "./context";
import { Icon } from "./ui";

const PHASES = ["U", "V", "W"] as const;

/** فرم کامل سرویس ماهانه موتور اصلی (مطابق نسخهٔ Flask): ۲۴ قرائت ذغال، ساعت HMI، انجام‌دهندگان، یادداشت */
export function MotorServiceForm({ tag }: { tag: string }) {
  const { state, act, busy, closeModal, openModal } = useApp();
  const motor = state.motors.find((m) => m.tag === tag);
  const [hours, setHours] = useState(motor ? String(motor.totalHours) : "");
  const [note, setNote] = useState("");
  const [brush, setBrush] = useState<Record<string, string>>({});
  const history = state.motorServices.filter((s) => s.tag === tag);
  const lastMegger = state.meggers.find((m) => m.tag === tag);
  const lastOil = state.oils.find((o) => o.tag === tag);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = await act("motor.service", { tag, hours, note, brush, day: state.now.day });
    if (id) {
      closeModal();
      if (typeof id === "number") window.open(`/report/${id}`, "_blank");
    }
  }

  return (
    <form onSubmit={submit} className="grid" style={{ gap: 12 }}>
      <div className="note">ثبت سرویس، شمارندهٔ «ساعت از آخرین سرویس» را صفر می‌کند و وضعیت موتور را «خاموش/آماده» می‌سازد. گزارش PDF سرویس به‌صورت خودکار ساخته می‌شود و در سربرگ گزارش‌ها (دستهٔ سرویس موتور) قابل چاپ است.</div>
      <div className="form-grid">
        <div className="field"><label>شمارنده HMI هنگام سرویس</label><input className="input mono" type="number" step="any" value={hours} onChange={(e) => setHours(e.target.value)} required /></div>
        <div className="field"><label>تاریخ سرویس</label><input className="input" value={state.now.day} readOnly /></div>
        <div className="field"><label>شیفت ثبت‌کننده</label><input className="input" value={`${state.shift.label} — ${state.shift.members.join(" و ")}`} readOnly /></div>
      </div>
      <div>
        <div className="panel-title" style={{ fontSize: 14, marginBottom: 6 }}><Icon name="bolt" size={14} /> قرائت ذغال‌ها (۸ برس برای هر فاز — میلی‌متر)</div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>فاز</th>{Array.from({ length: 8 }, (_, i) => <th key={i}>برس {i + 1}</th>)}</tr></thead>
            <tbody>
              {PHASES.map((ph) => (
                <tr key={ph}>
                  <td className="mono" style={{ fontWeight: 700 }}>{ph}</td>
                  {Array.from({ length: 8 }, (_, i) => {
                    const k = `${ph}${i + 1}`;
                    return <td key={k}><input className="inline-input" style={{ width: 64, padding: "5px 6px", fontSize: 14 }} type="number" step="any" value={brush[k] ?? ""} onChange={(e) => setBrush({ ...brush, [k]: e.target.value })} /></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="field"><label>یادداشت سرویس</label><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="تعویض ذغال، تمیزکاری حلقه‌ها، بررسی یاتاقان، تنظیم کوپلینگ…" /></div>

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <span className="chip muted">آخرین تست مگر: {lastMegger?.day ?? "—"}</span>
          <span className="chip muted">آخرین تعویض روغن: {lastOil?.day ?? "—"}</span>
          <button type="button" className="btn tiny" onClick={() => openModal(`تست مگر ${tag}`, <MeggerForm tag={tag} />)}>ثبت تست مگر</button>
          <button type="button" className="btn tiny" onClick={() => openModal(`تعویض روغن ${tag}`, <OilForm tag={tag} />)}>ثبت تعویض روغن</button>
        </div>
        <div className="row">
          <button type="button" className="btn ghost" onClick={closeModal}>انصراف</button>
          <button type="submit" className="btn primary" disabled={busy}><Icon name="wrench" size={14} /> ثبت سرویس و ساخت گزارش</button>
        </div>
      </div>

      {history.length > 0 && (
        <div>
          <div className="panel-title" style={{ fontSize: 14, marginBottom: 6 }}>سرویس‌های قبلی {tag}</div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>تاریخ</th><th>ساعت HMI</th><th>شیفت</th><th>یادداشت</th><th>گزارش</th></tr></thead>
              <tbody>
                {history.map((s) => {
                  const rep = state.reports.find((r) => r.kind === "motor_service" && r.day === s.day && r.title.includes(tag));
                  return (
                    <tr key={s.id}>
                      <td className="mono">{s.day}</td><td className="mono">{s.hours}</td><td>{s.shiftLabel || s.shiftKey}</td><td className="small">{s.note || "—"}</td>
                      <td>{rep ? <button type="button" className="btn tiny" onClick={() => window.open(`/report/${rep.id}`, "_blank")}>PDF</button> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </form>
  );
}

/** تست مگر — فقط ۴ آیتم قفل‌شده + ولتاژ تست */
export function MeggerForm({ tag }: { tag: string }) {
  const { state, act, busy, closeModal } = useApp();
  const [f, setF] = useState<Record<string, string>>({ testVoltage: "1000" });
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const history = state.meggers.filter((m) => m.tag === tag);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = await act("motor.megger", { tag, ...f, testVoltage: Number(f.testVoltage), day: state.now.day });
    if (id) closeModal();
  }
  return (
    <form onSubmit={submit}>
      <div className="panel-title" style={{ fontSize: 14, marginBottom: 6 }}>مقاومت عایقی استاتور (MΩ)</div>
      <div className="form-grid">{["statorU", "statorV", "statorW"].map((k, i) => <div className="field" key={k}><label>{["U1", "V1", "W1"][i]}</label><input className="input mono" type="number" step="any" value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} /></div>)}</div>
      <div className="panel-title" style={{ fontSize: 14, margin: "10px 0 6px" }}>مقاومت عایقی رتور (MΩ)</div>
      <div className="form-grid">{["rotorU", "rotorV", "rotorW"].map((k, i) => <div className="field" key={k}><label>{["U1", "V1", "W1"][i]}</label><input className="input mono" type="number" step="any" value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} /></div>)}</div>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <div className="field"><label>دمای سیم‌پیچ (°C)</label><input className="input mono" type="number" step="any" value={f.windingTemp ?? ""} onChange={(e) => set("windingTemp", e.target.value)} /></div>
        <div className="field"><label>ضریب پلاریزاسیون (PI)</label><input className="input mono" type="number" step="any" value={f.pi ?? ""} onChange={(e) => set("pi", e.target.value)} /></div>
        <div className="field"><label>ولتاژ تست</label><select className="input" value={f.testVoltage} onChange={(e) => set("testVoltage", e.target.value)}>{[500, 1000, 2500, 5000].map((v) => <option key={v} value={v}>{v} V</option>)}</select></div>
        <div className="field"><label>انجام‌دهندگان</label><input className="input" value={f.workers ?? ""} onChange={(e) => set("workers", e.target.value)} /></div>
      </div>
      <div className="field"><label>یادداشت</label><textarea value={f.note ?? ""} onChange={(e) => set("note", e.target.value)} style={{ minHeight: 60 }} /></div>
      <div className="row" style={{ justifyContent: "flex-end" }}><button type="button" className="btn ghost" onClick={closeModal}>انصراف</button><button type="submit" className="btn primary" disabled={busy}>ثبت تست مگر</button></div>
      {history.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="data"><thead><tr><th>تاریخ</th><th>U1/V1/W1 استاتور</th><th>U1/V1/W1 رتور</th><th>دما</th><th>PI</th><th>ولتاژ</th></tr></thead>
            <tbody>{history.map((m) => <tr key={m.id}><td className="mono">{m.day}</td><td className="mono">{m.statorU ?? "—"} / {m.statorV ?? "—"} / {m.statorW ?? "—"}</td><td className="mono">{m.rotorU ?? "—"} / {m.rotorV ?? "—"} / {m.rotorW ?? "—"}</td><td className="mono">{m.windingTemp ?? "—"}</td><td className="mono">{m.pi ?? "—"}</td><td className="mono">{m.testVoltage}</td></tr>)}</tbody></table>
        </div>
      )}
    </form>
  );
}

export function OilForm({ tag }: { tag: string }) {
  const { state, act, busy, closeModal } = useApp();
  const motor = state.motors.find((m) => m.tag === tag);
  const [hours, setHours] = useState(motor ? String(motor.totalHours) : "");
  const [note, setNote] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (await act("motor.oil", { tag, hours, note, day: state.now.day })) closeModal();
  }
  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <div className="field"><label>تاریخ</label><input className="input" value={state.now.day} readOnly /></div>
        <div className="field"><label>ساعت کارکرد</label><input className="input mono" type="number" step="any" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
      </div>
      <div className="field"><label>یادداشت (نوع روغن، مقدار، …)</label><textarea value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 60 }} /></div>
      <div className="row" style={{ justifyContent: "flex-end" }}><button type="button" className="btn ghost" onClick={closeModal}>انصراف</button><button type="submit" className="btn primary" disabled={busy}>ثبت تعویض روغن</button></div>
    </form>
  );
}

/** علامت‌گذاری موتور «در حال سرویس» با دلیل (بدون ریست شمارنده) */
export function MotorServiceStartForm({ tag }: { tag: string }) {
  const { act, busy, closeModal } = useApp();
  const [reason, setReason] = useState("");
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await act("motor.state", { tag, state: "service", reason })) closeModal(); }}>
      <div className="note" style={{ marginBottom: 10 }}>موتور {tag} به حالت «در سرویس» می‌رود (زرد + آچار چشمک‌زن). شمارنده ریست نمی‌شود؛ برای سرویس ماهانه از «ثبت سرویس» استفاده کنید.</div>
      <div className="field"><label>دلیل / توضیحات سرویس</label><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً: صدای غیرعادی یاتاقان، تعویض ذغال، بازدید فنی…" /></div>
      <div className="row" style={{ justifyContent: "flex-end" }}><button type="button" className="btn ghost" onClick={closeModal}>انصراف</button><button type="submit" className="btn warn" disabled={busy}><Icon name="wrench" size={14} /> ثبت در حال سرویس</button></div>
    </form>
  );
}

/** تغییر وضعیت تجهیز به «در حال سرویس» همراه با توضیحات اجباری */
export function EquipmentServiceForm({ tag, name, defaultMode = "in_service" }: { tag: string; name: string; defaultMode?: "in_service" | "report" | "ready" }) {
  const { act, busy, closeModal } = useApp();
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"in_service" | "report" | "ready">(defaultMode);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) return;
    const ok = mode === "report" ? await act("equipment.report", { tag, reason }) : await act("equipment.status", { tag, status: mode, reason });
    if (ok) closeModal();
  }
  return (
    <form onSubmit={submit}>
      <div className="note" style={{ marginBottom: 12 }}>تجهیز <b>{tag}</b> — {name}<br />وضعیت فقط «آماده به کار» یا «در حال سرویس» است. توضیحات در کارت تجهیز و گزارش PDF همان روز می‌آید.</div>
      <div className="field"><label>نوع ثبت</label>
        <select className="input" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="in_service">شروع سرویس — وضعیت «در حال سرویس»</option>
          <option value="ready">پایان سرویس — بازگشت به «آماده به کار»</option>
          <option value="report">فقط ثبت گزارش سرویس (بدون تغییر وضعیت)</option>
        </select>
      </div>
      <div className="field"><label>توضیحات / دلیل سرویس (اجباری)</label><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً: نشتی از شیر ورودی، تعویض گسکت، تنظیم پرس‌استات…" required minLength={3} /></div>
      <div className="row" style={{ justifyContent: "flex-end" }}><button type="button" className="btn ghost" onClick={closeModal}>انصراف</button><button type="submit" className="btn primary" disabled={busy || reason.trim().length < 3}><Icon name="check" size={14} /> ثبت</button></div>
    </form>
  );
}
