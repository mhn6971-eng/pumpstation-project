"use client";

import { useState } from "react";
import { useApp } from "./context";
import { MOTOR_PARAM_GROUPS } from "@/lib/domain";
import { Icon } from "./ui";
import { MeggerForm, OilForm } from "./ServiceForm";
import ChartModal from "./ChartModal";

export default function MotorDetail({ tag }: { tag: string }) {
  const { state, act, busy, openModal, closeModal } = useApp();
  const motor = state.motors.find((m) => m.tag === tag);
  const [form, setForm] = useState<Record<string, string>>({});
  const [hours, setHours] = useState("");

  if (!motor) return <div className="empty">موتور پیدا نشد.</div>;

  const serviceHistory = state.motorServices.filter((s) => s.tag === tag);
  // نوار هشدار جزئیات هم فقط «تازه‌ها» را نشان می‌دهد؛ دیده/اقدام‌شده فقط در سربرگ هشدارها
  const liveAlerts = state.alerts.filter((a) => a.tag === tag && !a.seenAt && !a.actedAt);

  async function save() {
    const values = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ""));
    if (!Object.keys(values).length) return;
    const ok = await act("motor.values", { tag, values, day: state.now.day });
    if (ok) {
      setForm({});
      closeModal();
    }
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ gap: 6 }}>
          <span className={`chip ${motor.state === "on" ? "live" : motor.state === "service" ? "warn" : "muted"}`}>
            <span className="dot" style={{ width: 6, height: 6, boxShadow: "none", background: motor.state === "on" ? "var(--green)" : motor.state === "service" ? "var(--amber)" : "#64748b" }} />
            {motor.stateFa}
          </span>
          <span className="chip muted">ساعت کارکرد: {Math.round(motor.totalHours).toLocaleString("en-US")}</span>
          <span className="chip muted">
            از سرویس: {Math.round(motor.hoursSinceService)} / {motor.serviceInterval} h
          </span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="btn tiny" onClick={() => openModal(`نمودار ${tag}`, <ChartModal scope="motor" tag={tag} param="T10" />, { wide: true })}>
            <Icon name="chart" size={12} /> نمودار و مقایسه
          </button>
          <button type="button" className="btn tiny" onClick={() => openModal(`تست مگر ${tag}`, <MeggerForm tag={tag} />)}>تست مگر</button>
          <button type="button" className="btn tiny" onClick={() => openModal(`تعویض روغن ${tag}`, <OilForm tag={tag} />)}>تعویض روغن</button>
        </div>
      </div>

      <div className="motor-stats" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
        <div className="stat">
          <div className="v">{motor.avgCurrent !== null ? `${motor.avgCurrent.toFixed(1)} A` : "—"}</div>
          <div className="l">جریان میانگین (I1–I3)</div>
        </div>
        <div className="stat">
          <div className={`v ${(motor.windingTemp ?? 0) > state.settings.windingWarn ? "hot" : ""}`}>{motor.windingTemp !== null ? `${motor.windingTemp.toFixed(1)}°C` : "—"}</div>
          <div className="l">دمای سیم‌پیچ (T1–T10)</div>
        </div>
        <div className="stat">
          <div className={`v ${(motor.bearingTemp ?? 0) > state.settings.bearingWarn ? "hot" : ""}`}>{motor.bearingTemp !== null ? `${motor.bearingTemp.toFixed(1)}°C` : "—"}</div>
          <div className="l">دمای یاتاقان پمپ</div>
        </div>
        <div className="stat">
          <div className={`v ${(motor.maxVibration ?? 0) > state.settings.vibWarn ? "vib" : ""}`}>{motor.maxVibration !== null ? `${motor.maxVibration.toFixed(1)} mm/s` : "—"}</div>
          <div className="l">بیشینه لرزش</div>
        </div>
      </div>

      {liveAlerts.length > 0 && (
        <div className="alert-strip" style={{ marginBottom: 0 }}>
          {liveAlerts.map((a) => (
            <div key={a.id} className={`alert-item ${a.severity}`}>
              <Icon name="alert" size={14} />
              <span className="msg">{a.message}</span>
            </div>
          ))}
        </div>
      )}

      {MOTOR_PARAM_GROUPS.map((group) => (
        <div key={group.title}>
          <div className="panel-title" style={{ fontSize: 12, marginBottom: 6 }}>
            {group.title}
          </div>
          <div className="process-grid">
            {group.params.map((p) => {
              const current = motor.values[p.key];
              return (
                <div key={p.key} className="param-card">
                  <div className="tag">
                    <span>{p.key}</span>
                    <span className="unit">{p.unit}</span>
                  </div>
                  <label>{p.label}</label>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    placeholder={current !== null ? String(current) : "—"}
                    value={form[p.key] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, [p.key]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void save();
                    }}
                  />
                  <div className="tag" style={{ marginTop: 4, color: "var(--dim)", fontSize: 9.5 }}>
                    <span>آخرین مقدار: {current !== null ? current : "—"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="note">
        فقط فیلدهای تغییریافته را پر کنید؛ Enter هر مقدار را همان لحظه ثبت می‌کند. مقادیر خالی، مقدار قبلی را تغییر نمی‌دهند.
      </div>

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <input
            className="inline-input"
            style={{ width: 140 }}
            placeholder="شمارنده HMI"
            type="number"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
          <button
            type="button"
            className="btn tiny"
            disabled={busy || hours === ""}
            onClick={async () => {
              const reason = state.me.role === "admin" && Number(hours) < motor.totalHours ? window.prompt("دلیل اصلاح شمارنده (ادمین):") ?? "" : "";
              const ok = await act("motor.hours", { tag, hours, reason });
              if (ok) setHours("");
            }}
          >
            ثبت شمارنده HMI
          </button>
        </div>
        <button type="button" className="btn primary" disabled={busy} onClick={save}>
          ثبت مقادیر واردشده
        </button>
      </div>

      <div>
        <div className="panel-title" style={{ fontSize: 12, marginBottom: 6 }}>
          تاریخچه سرویس‌ها
        </div>
        {serviceHistory.length === 0 ? (
          <div className="empty">سرویسی ثبت نشده است.</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>تاریخ</th>
                  <th>ساعت HMI</th>
                  <th>انجام‌دهندگان</th>
                  <th>یادداشت</th>
                  <th>شیفت</th>
                </tr>
              </thead>
              <tbody>
                {serviceHistory.map((s) => (
                  <tr key={s.id}>
                    <td className="mono tiny">{s.day}</td>
                    <td className="mono">{s.hours}</td>
                    <td>{s.workers || "—"}</td>
                    <td>{s.note || "—"}</td>
                    <td className="tiny">{s.shiftLabel || s.shiftKey}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="row tiny muted" style={{ justifyContent: "space-between" }}>
        <span>حدود هشدار: دما {state.settings.windingWarn}°C / بحرانی {state.settings.windingCrit}°C</span>
        <span>لرزش {state.settings.vibWarn} / {state.settings.vibCrit} mm/s</span>
        <span>یاتاقان {state.settings.bearingWarn} / {state.settings.bearingCrit}°C</span>
        <span>آخرین مگر: {motor.lastMeggerDay} | آخرین روغن: {motor.lastOilDay}</span>
      </div>
    </div>
  );
}
