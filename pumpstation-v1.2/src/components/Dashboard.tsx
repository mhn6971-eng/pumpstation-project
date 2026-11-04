"use client";

import { useEffect, useState } from "react";
import { useApp } from "./context";
import { Icon, Panel } from "./ui";
import MotorCard from "./MotorCard";
import MotorDetail from "./MotorDetail";
import { MotorServiceForm, MotorServiceStartForm } from "./ServiceForm";
import ChartModal from "./ChartModal";
import { addDaysToDay, operationalDay } from "@/lib/jalali";

export default function Dashboard() {
  const { state, day, interval, setDay, setInterval, act, busy, openModal } = useApp();
  const [note, setNote] = useState(state.note);
  const op = operationalDay();
  useEffect(() => setNote(state.note), [state.note, day]);

  const activeAlerts = state.alerts.filter((a) => !a.seenAt && !a.actedAt);
  const on = state.motors.filter((m) => m.state === "on");
  const off = state.motors.filter((m) => m.state === "off");
  const svc = state.motors.filter((m) => m.state === "service");

  async function printReport() {
    const id = await act("report.create", { kind: "daily", day });
    if (typeof id === "number") window.open(`/report/${id}`, "_blank");
  }
  async function sendReport() {
    await act("report.send", { kind: "daily", day });
  }

  return (
    <div className="grid">
      {/* نوار هشدار؛ پس از «اقدام کردم» به سربرگ هشدارها منتقل می‌شود */}
      <div className="alert-strip">
        {activeAlerts.length === 0 && <div className="chip live" style={{ justifySelf: "start", padding: "9px 14px" }}><Icon name="check" size={14} /> هشدار فعالی وجود ندارد</div>}
        {activeAlerts.slice(0, 6).map((a) => (
          <div key={a.id} className={`alert-item ${a.severity}`}>
            <span className="tag">{a.tag}</span>
            <span className="msg">{a.message}</span>
            <span className="chip muted" style={{ padding: "3px 8px" }}>{a.at.slice(11, 16)}{a.seenAt ? " — دیده شد" : ""}</span>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn tiny" disabled={busy || Boolean(a.seenAt)} onClick={() => act("alert.ack", { id: a.id, kind: "seen" })}>دیدم</button>
              <button type="button" className="btn tiny green" disabled={busy} onClick={() => act("alert.ack", { id: a.id, kind: "acted" })}>اقدام کردم</button>
            </div>
          </div>
        ))}
      </div>

      {/* بازه‌های ثبت (با ناوبری روز در همین پنل) */}
      <Panel
        title="بازه‌های ثبت ۴ساعته"
        icon="clock"
        actions={
          <>
            {day !== op.day && <span className="chip warn">ثبت دیرهنگام — {day}</span>}
            <button type="button" className="btn tiny" onClick={() => setDay(addDaysToDay(day, -1))}>روز قبل</button>
            <button type="button" className="btn tiny" onClick={() => setDay(op.day)}>امروز</button>
            <button type="button" className="btn tiny" disabled={day >= op.day} onClick={() => setDay(addDaysToDay(day, 1))}>روز بعد</button>
          </>
        }
      >
        <div className="intervals">
          {state.intervals.map((it) => {
            const missing = it.filled === 0;
            const partial = it.filled > 0 && it.filled < it.total;
            return (
              <button key={it.index} type="button" className={`interval ${it.current ? "current" : ""} ${missing ? "missing" : partial ? "current" : "filled"} ${interval === it.index ? "selected" : ""}`} onClick={() => setInterval(it.index)} title={`${it.filled} از ${it.total} پارامتر ثبت شده`}>
                {it.label}
                <span className="n">{missing ? "بدون ثبت" : `${it.filled}/${it.total}`}{it.current ? " · جاری" : ""}</span>
              </button>
            );
          })}
        </div>
        <p className="panel-sub" style={{ marginTop: 8 }}>Enter = ثبت فوری. آخرین مقدار ملاک است. بازه‌های گذشته هم قابل پر شدن‌اند. مقادیر خارج از ست‌پوینت بلاک نمی‌شوند؛ فقط قرمز و با ستاره در گزارش می‌آیند.</p>
      </Panel>

      {/* پارامترهای فرآیندی */}
      <Panel title="پارامترهای فرآیندی" icon="gauge">
        <div className="process-grid">
          {state.process.map((p) => (
            <div key={p.tag} className={`param-card ${p.out ? "out" : ""}`}>
              <div className="tag">
                <span>{p.tag}</span>
                <button type="button" className="btn tiny ghost" style={{ padding: 3 }} title="نمودار" onClick={() => openModal(`نمودار ${p.tag}`, <ChartModal scope="process" tag={p.tag} param={p.tag} />, { wide: true })}><Icon name="chart" size={13} /></button>
              </div>
              <label>{p.label}</label>
              <NumericCell value={p.value} onCommit={(v) => act("process.set", { tag: p.tag, value: v, day, intervalIndex: interval })} />
              <div className="tag" style={{ marginTop: 5, color: p.out ? "var(--red)" : "var(--dim)", fontWeight: 400 }}>
                <span>{p.unit} {p.value !== null && p.out ? <b className="star">*</b> : ""}</span>
                <span className="tiny">حد: {p.warnMin ?? "—"} … {p.warnMax ?? "—"}</span>
              </div>
            </div>
          ))}
          <div className="param-card" style={{ borderColor: "var(--accent)" }}>
            <div className="tag">
              <span>TOTAL-FIT</span>
              <button type="button" className="btn tiny ghost" style={{ padding: 3 }} title="جدول و نمودار ماهانه" onClick={() => openModal("توتال ماهانه", <ChartModal scope="total" />, { wide: true })}><Icon name="chart" size={13} /></button>
            </div>
            <label>توتال روزانه دبی (متر مکعب)</label>
            <NumericCell value={state.total} onCommit={(v) => act("total.set", { value: v, day })} />
            <div className="tag" style={{ marginTop: 5, color: "var(--dim)", fontWeight: 400 }}><span>m³ — مستقل از شیفت</span><span>{state.total !== null ? "ثبت شد" : "ثبت نشده"}</span></div>
            <button type="button" className="btn tiny" style={{ marginTop: 6, width: "100%" }} onClick={() => openModal("توتال ماهانه", <ChartModal scope="total" />, { wide: true })}><Icon name="chart" size={12} /> جدول و نمودار ماهانه</button>
          </div>
        </div>
      </Panel>

      {/* موتورها: ابتدا خلاصه وضعیت، سپس کارت‌ها */}
      <Panel title="موتورهای اصلی M-01 تا M-08" icon="bolt" hint={`بازه سرویس ${state.settings.serviceInterval} ساعت`}>
        <div className="motor-summary">
          <div className="box on"><b style={{ color: "#166534" }}>● موتورهای روشن ({on.length})</b><div className="tags">{on.length ? on.map((m) => <span key={m.tag}>{m.tag}</span>) : <span className="muted">—</span>}</div></div>
          <div className="box off"><b style={{ color: "#334155" }}>● خاموش / آماده به کار ({off.length})</b><div className="tags">{off.length ? off.map((m) => <span key={m.tag}>{m.tag}</span>) : <span className="muted">—</span>}</div></div>
          <div className="box svc"><b style={{ color: "#92400e" }}>● در حال سرویس ({svc.length})</b><div className="tags">{svc.length ? svc.map((m) => <span key={m.tag}>{m.tag}</span>) : <span className="muted">—</span>}</div></div>
        </div>
        <div className="motors-grid">
          {state.motors.map((m) => (
            <MotorCard
              key={m.tag}
              m={m}
              settings={state.settings}
              busy={busy}
              onOpen={() => openModal(`${m.tag} — ثبت داده و جزئیات`, <MotorDetail tag={m.tag} />, { wide: true, sub: `${m.tag} / ${m.pumpTag} — ${day} — بازه ${state.now.intervalLabel}` })}
              onState={(next) => {
                if (next === "service") openModal(`علامت‌گذاری ${m.tag} در حال سرویس`, <MotorServiceStartForm tag={m.tag} />);
                else void act("motor.state", { tag: m.tag, state: next });
              }}
              onService={() => openModal(`سرویس ماهانه موتور ${m.tag}`, <MotorServiceForm tag={m.tag} />, { wide: true, sub: "ذغال‌ها، ساعت HMI، انجام‌دهندگان، مگر و روغن" })}
              onChart={() => openModal(`نمودار ${m.tag}`, <ChartModal scope="motor" tag={m.tag} param="T10" />, { wide: true })}
            />
          ))}
        </div>
      </Panel>

      {/* گزارش دستی اپراتور */}
      <Panel title="گزارش دستی اپراتور" icon="file" hint={`${state.shift.label} — ${state.shift.members.join(" و ")} — ${day}`}>
        <textarea className="input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="کارهای انجام‌شدهٔ شیفت، مشکلات، نکات تحویل شیفت…" />
        <div className="row" style={{ marginTop: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn primary" disabled={busy} onClick={() => act("note.save", { text: note, day })}>ذخیره گزارش دستی</button>
        </div>
      </Panel>

      {/* انتهای صفحه: فقط ارسال و چاپ */}
      <div className="panel" style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
        <div className="small muted">زیر گزارش، نام <b>{state.shift.label}</b> و اپراتورها ({state.shift.members.join(" و ")}) ثبت می‌شود. نسخهٔ قبلی گزارش هرگز حذف نمی‌شود.</div>
        <div className="row">
          <button type="button" className="btn primary" style={{ padding: "11px 18px", fontSize: 15 }} disabled={busy} onClick={sendReport}><Icon name="bolt" size={15} /> ارسال گزارش</button>
          <button type="button" className="btn" style={{ padding: "11px 18px", fontSize: 15 }} disabled={busy} onClick={printReport}><Icon name="file" size={15} /> چاپ گزارش</button>
        </div>
      </div>
    </div>
  );
}

function NumericCell({ value, onCommit }: { value: number | null; onCommit: (value: string) => Promise<boolean | number> }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => setText(value === null ? "" : String(value)), [value]);
  async function commit() {
    if (text === "" || Number(text) === value) return;
    await onCommit(text);
  }
  return (
    <input type="number" step="any" inputMode="decimal" placeholder="—" value={text} onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void commit(); } }} onBlur={() => void commit()} />
  );
}
