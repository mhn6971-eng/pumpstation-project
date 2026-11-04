"use client";

import { useEffect, useState } from "react";
import { useApp } from "./context";
import { Icon, Panel } from "./ui";

type Status = { key: string; enabled: boolean; enabledAt: string; backupCodes: number; pending: boolean };

export default function TwoFactorPanel() {
  const { state, act, call, busy, toast, isAdmin } = useApp();
  const [status, setStatus] = useState<Status | null>(null);
  const [stage, setStage] = useState<"idle" | "setup" | "codes">("idle");
  const [secret, setSecret] = useState("");
  const [otpauth, setOtpauth] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [others, setOthers] = useState<Status[]>([]);

  const myShift = state.me.key;

  async function loadStatus() {
    try {
      const data = (await call("totp.status")) as unknown as Status & { ok: boolean };
      setStatus({ key: data.key, enabled: data.enabled, enabledAt: data.enabledAt, backupCodes: data.backupCodes, pending: data.pending });
      if (isAdmin) {
        const rows = await Promise.all(
          state.roster
            .filter((r) => r.key !== myShift)
            .map(async (r) => {
              const d = (await call("totp.status", { key: r.key })) as unknown as Status & { ok: boolean };
              return { key: r.key, enabled: d.enabled, enabledAt: d.enabledAt, backupCodes: d.backupCodes, pending: d.pending } as Status;
            }),
        );
        setOthers(rows);
      }
    } catch {
      /* نمایش وضعیت، مسیر بحرانی نیست */
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadStatus(); }, []);

  async function begin() {
    try {
      const data = await call("totp.begin", {});
      setSecret(String(data.secret ?? ""));
      setOtpauth(String(data.otpauth ?? ""));
      setCode("");
      setStage("setup");
      toast("راز ساخته شد؛ آن را در برنامهٔ Authenticator ثبت کنید");
    } catch (error) {
      toast(error instanceof Error ? error.message : "ساخت راز ناموفق بود", "error");
    }
  }

  async function enable() {
    try {
      const data = await call("totp.enable", { code });
      setCodes((data.backupCodes as string[]) ?? []);
      setStage("codes");
      setStatus((s) => (s ? { ...s, enabled: true, backupCodes: 10, pending: false } : s));
      toast("ورود دوعاملی فعال شد");
    } catch (error) {
      toast(error instanceof Error ? error.message : "فعال‌سازی ناموفق بود", "error");
    }
  }

  async function disable() {
    try {
      const ok = await act("totp.disable", { pin });
      if (ok) {
        setStatus((s) => (s ? { ...s, enabled: false, backupCodes: 0, enabledAt: "" } : s));
        setPin("");
        setStage("idle");
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "غیرفعال‌سازی ناموفق بود", "error");
    }
  }

  async function regenerate() {
    try {
      const data = await call("totp.codes", { pin });
      setCodes((data.backupCodes as string[]) ?? []);
      setStage("codes");
      toast("۱۰ کد پشتیبان تازه صادر شد");
    } catch (error) {
      toast(error instanceof Error ? error.message : "صدور کد ناموفق بود", "error");
    }
  }

  async function resetOther(key: string) {
    try {
      const ok = await act("totp.disable", { key, pin });
      if (ok) {
        setOthers((list) => list.map((o) => (o.key === key ? { ...o, enabled: false, backupCodes: 0, enabledAt: "" } : o)));
        toast(`دوعاملی شیفت ${key} بازنشانی شد`);
      }
    } catch {
      /* پیام از act نمایش داده می‌شود */
    }
  }

  function copyCodes() {
    const text = codes.join("\n");
    void navigator.clipboard?.writeText(text).then(
      () => toast("کدها کپی شد"),
      () => toast("کپی ناموفق بود؛ دستی یادداشت کنید", "error"),
    );
  }

  function downloadCodes() {
    const text = [
      "کدهای پشتیبان ورود دوعاملی — سامانهٔ ایستگاه پمپاژ گلاب",
      `شیفت: ${status?.key ?? ""}    تاریخ: ${new Date().toLocaleString("fa-IR")}`,
      "هر کد فقط یک‌بار قابل استفاده است. این برگه را جدا از دستگاه و در جای امن نگه دارید.",
      "",
      ...codes.map((c, i) => `${String(i + 1).padStart(2, "0")}.  ${c}`),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup-codes-${status?.key ?? "shift"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Panel
      title="ورود دوعاملی (Authenticator)"
      icon="shield"
      hint="لایهٔ دوم ورود برای حساب ادمین و شیفت‌های حساس؛ مستقل از اینترنت — ساعت دستگاه مهم است"
    >
      {!status ? (
        <div className="empty">در حال خواندن وضعیت…</div>
      ) : (
        <>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div>
              <b>شیفت {status.key}</b>
              <div className="tiny muted">
                {status.enabled ? `فعال — از ${status.enabledAt || "—"} · ${status.backupCodes} کد پشتیبان باقی‌مانده` : "غیرفعال"}
              </div>
            </div>
            <span className={`chip ${status.enabled ? "live" : "accent"}`}>
              <span className={`dot ${status.enabled ? "live" : "accent"}`} /> {status.enabled ? "محافظت‌شده" : "فقط PIN"}
            </span>
          </div>

          {stage === "idle" && (
            <div className="grid" style={{ gap: 8 }}>
              {!status.enabled ? (
                <button type="button" className="btn primary" disabled={busy} onClick={begin}>
                  <Icon name="shield" size={13} /> فعال‌سازی ورود دوعاملی
                </button>
              ) : (
                <div className="grid" style={{ gap: 8 }}>
                  <div className="field">
                    <label htmlFor="2fa-pin">برای تغییر، PIN همین شیفت را وارد کنید</label>
                    <input
                      id="2fa-pin"
                      className="input pin-input"
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      placeholder="••••"
                    />
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn" disabled={busy || pin.length !== 4} onClick={regenerate}>
                      <Icon name="download" size={13} /> کدهای پشتیبان جدید
                    </button>
                    <button type="button" className="btn danger" disabled={busy || pin.length !== 4} onClick={disable}>
                      غیرفعال‌سازی
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {stage === "setup" && (
            <div className="grid" style={{ gap: 8 }}>
              <div className="note warn-note">
                این راز را در برنامهٔ Authenticator (Google Authenticator، Aegis، Microsoft Authenticator) به‌صورت «ورود دستی» ثبت کنید،
                سپس کد ۶ رقمی نمایش‌داده‌شده را وارد کنید. راز را جایی ذخیره نکنید.
              </div>
              <div className="field">
                <label>کلید (Base32)</label>
                <input className="input mono" readOnly value={secret} onFocus={(e) => e.currentTarget.select()} />
              </div>
              <div className="field">
                <label>نشانی otpauth (برای ثبت خودکار)</label>
                <input className="input mono" readOnly value={otpauth} onFocus={(e) => e.currentTarget.select()} style={{ fontSize: 10 }} />
              </div>
              <div className="field">
                <label htmlFor="2fa-code">کد ۶ رقمی برنامه</label>
                <input
                  id="2fa-code"
                  className="input mono pin-input"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="۱۲۳۴۵۶"
                />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn primary" disabled={busy || code.length !== 6} onClick={enable}>
                  تأیید و فعال‌سازی
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => { setStage("idle"); setSecret(""); setOtpauth(""); }}>
                  انصراف
                </button>
              </div>
            </div>
          )}

          {stage === "codes" && (
            <div className="grid" style={{ gap: 8 }}>
              <div className="note warn-note">
                این ۱۰ کد فقط همین یک‌بار نمایش داده می‌شوند. هر کد یک‌بار قابل استفاده است؛ اگر گوشی گم شود، با یکی از آن‌ها وارد شوید.
              </div>
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 6 }}>
                {codes.map((c, i) => (
                  <div key={c} className="mono" style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}>
                    <span className="muted tiny">{i + 1}.</span> {c}
                  </div>
                ))}
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn" onClick={copyCodes}><Icon name="download" size={13} /> کپی همه</button>
                <button type="button" className="btn" onClick={downloadCodes}><Icon name="download" size={13} /> ذخیرهٔ فایل</button>
                <button type="button" className="btn primary" onClick={() => { setStage("idle"); setCodes([]); }}>یادداشت کردم</button>
              </div>
            </div>
          )}

          {isAdmin && others.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 12, maxHeight: 200 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>شیفت</th>
                    <th>وضعیت</th>
                    <th>اقدام (با PIN ادمین)</th>
                  </tr>
                </thead>
                <tbody>
                  {others.map((o) => (
                    <tr key={o.key}>
                      <td className="mono">{o.key}</td>
                      <td className="tiny">{o.enabled ? `فعال · ${o.backupCodes} کد` : "غیرفعال"}</td>
                      <td>
                        <button
                          type="button"
                          className="btn tiny danger"
                          disabled={busy || !o.enabled || pin.length !== 4}
                          onClick={() => resetOther(o.key)}
                          title="برای گوشی گم‌شده؛ دوعاملی شیفت را بازنشانی می‌کند"
                        >
                          بازنشانی
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="note" style={{ marginTop: 10 }}>
            ساعت دستگاه و گوشی باید هم‌زمان باشد (±۳۰ ثانیه). اگر کد پذیرفته نشد، زمان ویندوز را همگام کنید.
          </div>
        </>
      )}
    </Panel>
  );
}
