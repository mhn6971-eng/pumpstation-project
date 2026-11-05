"use client";

import { useState } from "react";
import { Icon } from "./ui";
import { APP_NAME, APP_SUBTITLE, ORG_NAME } from "@/lib/domain";

type ShiftOption = { key: string; label: string; members: string[]; role: string };

export default function Login({ roster, weekday, day }: { roster: ShiftOption[]; weekday: string; day: string }) {
  const [selected, setSelected] = useState(roster[0]?.key ?? "A");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: selected, pin, ...(totp ? { totp } : {}) }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.needsTotp) setNeedsTotp(true);
        throw new Error(data.error ?? "ورود ناموفق بود");
      }
      window.location.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ورود ناموفق بود");
      setTotp("");
      // اگر ورود دوعاملی فعال است، PIN را نگه می‌داریم تا اپراتور فقط کد را وارد کند
      if (!needsTotp) setPin("");
    } finally {
      setBusy(false);
    }
  }
  const active = roster.find((r) => r.key === selected);

  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-hero">
          <div className="hero-machine">
            {/* لوگوی رسمی شرکت — عین فایل ارسالی کارفرما */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo.jpg" alt={ORG_NAME} style={{ height: 64, width: "auto", background: "#fff", borderRadius: 8, padding: 4 }} />
          </div>
          <div>
            <h2>{APP_NAME}</h2>
            <p style={{ fontSize: 16, fontWeight: 600 }}>{APP_SUBTITLE}</p>

            <div className="row" style={{ gap: 6, marginTop: 14 }}>
              <span className="chip live"><span className="dot live" /> سامانه محلی و آفلاین</span>
              <span className="chip accent"><Icon name="clock" size={13} /> {weekday} {day}</span>
            </div>
          </div>
        </div>

        <form className="login-form" onSubmit={submit}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
            <div className="panel-title" style={{ fontSize: 16 }}><Icon name="users" size={18} className="muted" /> انتخاب شیفت و ورود</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo.jpg" alt={ORG_NAME} style={{ height: 44, width: "auto", background: "#fff", borderRadius: 8, padding: 4 }} />
          </div>

          <div className="shift-options">
            {roster.map((r) => (
              <button key={r.key} type="button" className={`shift-option ${selected === r.key ? "active" : ""}`} onClick={() => { setSelected(r.key); setPin(""); setTotp(""); setNeedsTotp(false); setError(""); }}>
                <b>{r.label}</b>
                <small>{r.members.join(" و ")}</small>
              </button>
            ))}
          </div>

          <div className="note" style={{ marginBottom: 12 }}>
            شیفت انتخاب‌شده: <b>{active?.label}</b>{active?.role === "admin" ? " — دسترسی مدیریت کامل" : ""}
          </div>

          <div className="field">
            <label htmlFor="pin">PIN چهاررقمی</label>
            <input id="pin" className="pin-input" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" autoFocus />
          </div>

          {needsTotp && (
            <div className="field">
              <label htmlFor="totp">کد ورود دوعاملی (۶ رقم) یا کد پشتیبان</label>
              <input
                id="totp"
                className="input mono"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/[^0-9A-Za-z-]/g, "").slice(0, 9))}
                placeholder="۱۲۳۴۵۶"
                autoFocus
              />
              <div className="tiny muted" style={{ marginTop: 4 }}>
                کد از برنامهٔ Authenticator گوشی؛ هر ۳۰ ثانیه عوض می‌شود. اگر گوشی در دسترس نیست، یکی از کدهای پشتیبان را وارد کنید.
              </div>
            </div>
          )}

          {error && <div className="note warn-note" style={{ marginBottom: 10 }}>{error}</div>}

          <button className="btn primary" type="submit" disabled={busy || pin.length !== 4 || (needsTotp && totp.length < 6)} style={{ width: "100%", padding: 13, fontSize: 16 }}>
            {busy ? "در حال ورود…" : "ورود به سامانه"}
          </button>

          <div className="note" style={{ marginTop: 12 }}>
            برای تست: شیفت A = ۱۱۱۱ · شیفت B = ۲۲۲۲ · شیفت C = ۳۳۳۳ · ادمین = ۹۹۹۹
          </div>
          <p className="tiny muted" style={{ marginTop: 10, textAlign: "center" }}>{ORG_NAME} — در گزارش‌ها نام شیفت و اپراتورهای همان شیفت ثبت می‌شود.</p>
        </form>
      </div>
    </main>
  );
}
