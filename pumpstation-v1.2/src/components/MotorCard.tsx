"use client";

import type { MotorView } from "@/lib/types";
import type { Settings } from "@/lib/domain";
import { Icon } from "./ui";
import MotorVisual from "./MotorVisual";

/**
 * منطق رنگ/انیمیشن (قطعی با کاربر):
 *  خاموش → خاکستری کم‌رنگ | در سرویس → زرد + آچار چشمک‌زن
 *  روشن: ۰–۵۰٪ سبز | ۵۰–۷۰٪ نوار سبز→زرد | ۷۰–۹۰٪ نوار زرد + موتور زرد + لرزش خفیف
 *        ۹۰–۱۰۰٪ نوار قرمز + زمینه قرمز کم‌رنگ + لرزش بیشتر + دود | دما/لرزش بالا = همان حالت قرمز
 */
export default function MotorCard({
  m, settings, onOpen, onState, onService, onChart, busy,
}: {
  m: MotorView;
  settings: Settings;
  onOpen: () => void;
  onState: (state: "on" | "off" | "service") => void;
  onService: () => void;
  onChart: () => void;
  busy: boolean;
}) {
  const pct = Math.min(150, m.servicePct);
  const hotWarn = (m.windingTemp ?? 0) > settings.windingWarn || (m.bearingTemp ?? 0) > settings.bearingWarn;
  const hotCrit = (m.windingTemp ?? 0) > settings.windingCrit || (m.bearingTemp ?? 0) > settings.bearingCrit;
  const vibWarn = (m.maxVibration ?? 0) > settings.vibWarn;
  const vibCrit = (m.maxVibration ?? 0) > settings.vibCrit;

  const barTone = pct >= 90 ? "crit" : pct >= 70 ? "warn" : pct >= 50 ? "mid" : "";
  const red = m.state !== "service" && (pct >= 90 || hotCrit || vibCrit);
  const yellow = !red && m.state !== "service" && (pct >= 70 || hotWarn || vibWarn);
  const shake = m.state === "on" ? (red ? "motor-shake-hard" : yellow ? "motor-shake-light" : "") : "";
  const smoke = red && m.state === "on";
  const severity: "ok" | "warning" | "critical" = red ? "critical" : yellow || m.state === "service" ? "warning" : "ok";
  const reason = hotCrit ? "دمای بالا" : vibCrit ? "لرزش بالا" : pct >= 100 ? "سرویس عقب‌افتاده" : pct >= 90 ? "نزدیک سرویس" : hotWarn ? "افزایش دما" : vibWarn ? "لرزش" : pct >= 70 ? "کارکرد زیاد" : m.state === "service" ? "در سرویس" : "";

  const classes = ["motor-card", `motor-${m.state}`, shake, hotWarn || red ? "motor-heat" : "", smoke ? "motor-smoke" : "", red ? "tint-red critical" : yellow ? "tint-yellow warning" : "", m.state === "service" ? "service" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={classes}>
      <div className="motor-head">
        <div className="motor-tags">
          {m.tag} <span>/ {m.pumpTag}</span>
        </div>
        <div className="led-wrap">
          <span className={`led ${m.state === "on" ? "green" : m.state === "service" ? "amber" : ""}`} title={m.stateFa} />
          <span className={`led ${red ? "red" : yellow ? "amber" : ""}`} title="وضعیت هشدار" />
        </div>
      </div>

      <div className="motor-visual" onClick={onOpen} title="ثبت جزئیات و مشاهدهٔ پارامترها">
        {severity !== "ok" && <span className={`badge-severity ${severity === "warning" ? "warning" : ""}`}>{severity === "critical" ? "بحرانی" : "هشدار"} — {reason}</span>}
        {(hotWarn || red) && m.windingTemp !== null && (
          <div className="heat-icon">
            <span className="bubble"><Icon name="thermo" size={11} /> {m.windingTemp.toFixed(1)}°C</span>
            {hotCrit && <span className="bubble"><Icon name="fire" size={11} className="thermo-flame" /> حرارت بالا</span>}
          </div>
        )}
        {m.state === "service" && <span className="wrench-icon wrench-blink"><Icon name="wrench" size={20} /></span>}
        <MotorVisual tag={m.tag} pumpTag={m.pumpTag} on={m.state === "on"} hot={hotWarn || red} smoke={smoke} />
      </div>

      {/* نوار سرویس: ساعت گذشته / بازه سرویس */}
      <div className="motor-service-row" title="ساعت کارکرد از آخرین سرویس نسبت به بازهٔ سرویس">
        <span className={`chip ${m.state === "on" ? "live" : m.state === "service" ? "warn" : "muted"}`} style={{ padding: "4px 9px", fontSize: 12.5 }}>
          {m.stateFa}
        </span>
        <div className="service-track">
          <span className={`service-fill ${barTone}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <span className="service-text" dir="ltr">
          {Math.round(m.hoursSinceService)} / {m.serviceInterval}
        </span>
      </div>


      {/* نوار اول: روشن / خاموش / سرویس */}
      <div className="motor-actions">
        <div className="state-toggle" role="group" aria-label="تغییر وضعیت موتور">
          <button type="button" className={`on ${m.state === "on" ? "active" : ""}`} disabled={busy} onClick={() => onState("on")}>روشن</button>
          <button type="button" className={`off ${m.state === "off" ? "active" : ""}`} disabled={busy} onClick={() => onState("off")}>خاموش</button>
          <button type="button" className={`svc ${m.state === "service" ? "active" : ""}`} disabled={busy} onClick={() => onState("service")}>سرویس</button>
        </div>
      </div>

      {/* نوار دوم: ثبت جزئیات + ساعت کارکرد کل + ثبت سرویس */}
      <div className="motor-actions" style={{ alignItems: "stretch" }}>
        <button type="button" className="btn tiny primary" style={{ flex: 1 }} onClick={onOpen}>
          <Icon name="gauge" size={13} /> ثبت جزئیات
        </button>
        <div className="stat" style={{ flex: 1.2, padding: "4px 8px", textAlign: "center" }}>
          <div className="v" style={{ justifyContent: "center" }} dir="ltr">{Math.round(m.totalHours).toLocaleString("en-US")} h</div>
          <div className="l">ساعت کارکرد کل از نصب</div>
        </div>
        <button type="button" className="btn tiny warn" style={{ flex: 1 }} onClick={onService}>
          <Icon name="wrench" size={13} /> ثبت سرویس
        </button>
        <button type="button" className="btn tiny ghost" onClick={onChart} title="نمودار پارامترها"><Icon name="chart" size={13} /></button>
      </div>
    </article>
  );
}
