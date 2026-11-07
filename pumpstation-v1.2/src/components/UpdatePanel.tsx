"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "./context";
import { Icon, Panel } from "./ui";

type UpdateStatus = {
  phase: "idle" | "staged" | "preparing" | "restarting" | "complete" | "failed";
  message: string;
  version?: string;
  updatedAt?: string;
  stageId?: string;
  fileName?: string;
  sha256?: string;
  sizeBytes?: number;
  entryCount?: number;
};

type StagedUpdate = {
  stageId: string;
  fileName: string;
  currentVersion: string;
  version: string;
  sha256: string;
  sizeBytes: number;
  entryCount: number;
};

type UpdateResponse = {
  ok: boolean;
  currentVersion?: string;
  enabled?: boolean;
  status?: UpdateStatus;
  logTail?: string;
  error?: string;
};

const formatSize = (size: number) => `${(size / 1024 / 1024).toFixed(1)} MB`;

export default function UpdatePanel() {
  const { toast } = useApp();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [currentVersion, setCurrentVersion] = useState("");
  const [status, setStatus] = useState<UpdateStatus>({ phase: "idle", message: "" });
  const [staged, setStaged] = useState<StagedUpdate | null>(null);
  const [pin, setPin] = useState("");
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [logTail, setLogTail] = useState("");
  const [showLog, setShowLog] = useState(false);

  async function loadStatus() {
    try {
      const response = await fetch("/api/admin/update", { cache: "no-store" });
      const data = await response.json() as UpdateResponse;
      if (!response.ok || !data.ok) {
        setError(data.error ?? "وضعیت به‌روزرسانی خوانده نشد.");
        return;
      }
      const nextStatus = data.status ?? { phase: "idle", message: "" };
      setCurrentVersion(data.currentVersion ?? "");
      setStatus(nextStatus);
      setApplying(nextStatus.phase === "preparing" || nextStatus.phase === "restarting");
      setEnabled(Boolean(data.enabled));
      setLogTail(data.logTail ?? "");
      if (nextStatus.phase === "staged" && nextStatus.stageId && nextStatus.version && nextStatus.sha256) {
        setStaged({
          stageId: nextStatus.stageId,
          fileName: nextStatus.fileName ?? "ZIP آماده‌شده",
          currentVersion: data.currentVersion ?? "",
          version: nextStatus.version,
          sha256: nextStatus.sha256,
          sizeBytes: nextStatus.sizeBytes ?? 0,
          entryCount: nextStatus.entryCount ?? 0,
        });
      } else if (nextStatus.phase !== "staged") {
        setStaged(null);
      }
      if (nextStatus.phase === "failed") setError(nextStatus.message);
      else if (nextStatus.phase === "complete") setError("");
    } catch {
      // The server is intentionally offline during the controlled swap/restart.
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadStatus(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!applying) return;
    let alive = true;
    let timeout = false;
    const startedAt = Date.now();
    const poll = async () => {
      if (!alive || timeout) return;
      try {
        const response = await fetch("/api/admin/update", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        const data = await response.json() as UpdateResponse;
        if (response.ok && data.ok && data.status) {
          setCurrentVersion(data.currentVersion ?? "");
          setStatus(data.status);
          setLogTail(data.logTail ?? "");
          if (data.status.phase === "complete" && data.currentVersion === data.status.version) {
            setApplying(false);
            toast("به‌روزرسانی با موفقیت انجام شد؛ صفحه دوباره بارگذاری می‌شود.");
            window.setTimeout(() => window.location.reload(), 900);
            return;
          }
          if (data.status.phase === "failed") {
            setApplying(false);
            setError(data.status.message);
            return;
          }
        }
      } catch {
        // The app is stopped briefly while its code and service are swapped.
      }
      if (Date.now() - startedAt > 8 * 60_000) {
        timeout = true;
        setApplying(false);
        setError("راه‌اندازی بیش از ۸ دقیقه طول کشید. برنامه را نبندید؛ وضعیت و لاگ را بررسی کنید.");
        return;
      }
      window.setTimeout(() => { void poll(); }, 2000);
    };
    void poll();
    return () => { alive = false; };
  }, [applying, toast]);

  async function uploadFile(file: File) {
    setError("");
    setUploading(true);
    setStaged(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/admin/update", { method: "POST", body: form });
      const data = await response.json() as UpdateResponse & {
        stageId?: string;
        newVersion?: string;
        fileName?: string;
        sizeBytes?: number;
        sha256?: string;
        entryCount?: number;
      };
      if (!response.ok || !data.ok || !data.stageId || !data.newVersion || !data.sha256) {
        throw new Error(data.error ?? "بررسی فایل ZIP ناموفق بود.");
      }
      const info: StagedUpdate = {
        stageId: data.stageId,
        fileName: data.fileName ?? file.name,
        currentVersion: data.currentVersion ?? currentVersion,
        version: data.newVersion,
        sha256: data.sha256,
        sizeBytes: data.sizeBytes ?? file.size,
        entryCount: data.entryCount ?? 0,
      };
      setStaged(info);
      setStatus({ phase: "staged", message: "فایل بررسی و آمادهٔ تأیید شد.", version: info.version });
      toast(`ZIP نسخهٔ ${info.version} آمادهٔ بررسی است.`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "آپلود فایل ناموفق بود.";
      setError(message);
      toast(message, "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function cancelStaged() {
    try {
      const response = await fetch("/api/admin/update", { method: "DELETE" });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "لغو فایل آماده‌شده ناموفق بود.");
      setStaged(null);
      setPin("");
      setStatus({ phase: "idle", message: "فایل آماده‌شده لغو شد." });
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "لغو ناموفق بود.");
    }
  }

  async function applyUpdate() {
    if (!staged) return;
    if (!/^[0-9]{4,6}$/.test(pin)) {
      setError("PIN مدیر را وارد کنید.");
      return;
    }
    const confirmed = window.confirm(
      `فقط ZIP دریافتی از منبع مورداعتماد را نصب کنید.\n\n` +
      `نسخهٔ فعلی: ${staged.currentVersion}\n` +
      `نسخهٔ انتخاب‌شده: ${staged.version}\n` +
      `SHA-256: ${staged.sha256}\n\n` +
      `سرور برای مدت کوتاهی متوقف می‌شود. ابتدا از پایگاه‌داده نسخهٔ ایمنی گرفته می‌شود؛ ` +
      `در صورت شکست، نسخهٔ قبلی و داده‌های قبلی برمی‌گردند. ادامه می‌دهید؟`,
    );
    if (!confirmed) return;

    setError("");
    setApplying(true);
    try {
      const response = await fetch("/api/admin/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, confirm: true, stageId: staged.stageId }),
      });
      const data = await response.json() as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "شروع به‌روزرسانی ناموفق بود.");
      toast(data.message ?? "به‌روزرسانی در پس‌زمینه شروع شد.");
    } catch (caught) {
      setApplying(false);
      const message = caught instanceof Error ? caught.message : "شروع به‌روزرسانی ناموفق بود.";
      setError(message);
      toast(message, "error");
    }
  }

  const busy = uploading || applying || status.phase === "preparing" || status.phase === "restarting";
  return (
    <Panel title="به‌روزرسانی برنامه از فایل ZIP" icon="download" hint="انتخاب فایل از رایانه، بررسی بسته، تأیید مدیر و بازگشت خودکار در صورت شکست">
      <div className="note" style={{ marginBottom: 10 }}>
        <b>نسخهٔ نصب‌شده:</b> <span className="mono">{currentVersion || "در حال خواندن…"}</span>
        {status.phase === "complete" && <span className="chip live" style={{ marginInlineStart: 8 }}>به‌روزرسانی اخیر موفق بود</span>}
        {status.phase === "failed" && <span className="chip danger" style={{ marginInlineStart: 8 }}>به‌روزرسانی اخیر ناموفق</span>}
      </div>

      <div className="note warn-note" style={{ marginBottom: 10 }}>
        <b>پیش از اعمال:</b> ZIP باید از پوشهٔ کامل <span className="mono">pumpstation-v1.2</span> ساخته شده باشد.
        بسته قبل از توقف سرور بررسی و build می‌شود؛ پایگاه‌داده پیش از migration نسخهٔ ایمنی می‌گیرد و در صورت شکست، برنامه به نسخهٔ قبلی بازمی‌گردد.
        فقط ZIP تهیه‌شده از منبع مورداعتماد را انتخاب کنید.
      </div>

      {!enabled && <div className="note warn-note" style={{ marginBottom: 10 }}>به‌روزرسانی در این شیوهٔ اجرا فعال نیست؛ از راه‌انداز نصب‌شدهٔ Pumpstation و دادهٔ محلی PGlite استفاده کنید.</div>}
      {status.phase === "preparing" || status.phase === "restarting" ? <div className="note">{status.message}</div> : null}
      {error && <div className="note warn-note" role="alert" style={{ marginBottom: 10 }}>{error}</div>}

      {!staged ? (
        <div className="field">
          <label htmlFor="pumpstation-update-zip">فایل ZIP نسخهٔ جدید را از رایانه انتخاب کنید (حداکثر ۱۰۰ مگابایت)</label>
          <input
            id="pumpstation-update-zip"
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            disabled={!enabled || busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void uploadFile(file);
            }}
          />
          {uploading && <div className="tiny muted" style={{ marginTop: 6 }}>در حال بارگذاری و بررسی مسیرها، ساختار و نسخهٔ ZIP…</div>}
        </div>
      ) : (
        <>
          <div className="table-wrap" style={{ marginBottom: 10 }}>
            <table className="data">
              <tbody>
                <tr><th style={{ width: 150 }}>فایل انتخاب‌شده</th><td className="mono small" dir="auto">{staged.fileName}</td></tr>
                <tr><th>حجم فایل</th><td className="mono">{formatSize(staged.sizeBytes)} · {staged.entryCount.toLocaleString("fa-IR")} فایل</td></tr>
                <tr><th>SHA-256</th><td className="mono small" dir="ltr">{staged.sha256}</td></tr>
                <tr><th>نسخهٔ فعلی</th><td className="mono">{staged.currentVersion}</td></tr>
                <tr><th>نسخهٔ ZIP</th><td className="mono" style={{ fontWeight: 700, color: "var(--green)" }}>{staged.version}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="field">
            <label htmlFor="pumpstation-update-pin">برای تأیید، PIN مدیر را وارد کنید</label>
            <input
              id="pumpstation-update-pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              maxLength={6}
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="۴ تا ۶ رقم"
              className="input mono"
              disabled={busy}
            />
          </div>

          <div className="row" style={{ justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void cancelStaged()}>لغو فایل</button>
            <button type="button" className="btn danger" disabled={!enabled || busy || pin.length < 4} onClick={() => void applyUpdate()}>
              <Icon name="download" size={14} /> {busy ? "در حال به‌روزرسانی…" : "تأیید و نصب ZIP"}
            </button>
          </div>
        </>
      )}

      <div style={{ marginTop: 10 }}>
        <button type="button" className="btn tiny ghost" onClick={() => { setShowLog((shown) => !shown); void loadStatus(); }}>
          {showLog ? "پنهان‌کردن لاگ" : "نمایش لاگ آخرین به‌روزرسانی"}
        </button>
        {showLog && (
          <pre className="mono tiny" style={{
            marginTop: 8, padding: 10, background: "#0b2745", color: "#cfe0f3",
            borderRadius: 8, maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap",
            direction: "ltr", fontSize: 11,
          }}>
            {logTail || "(لاگ هنوز موجود نیست)"}
          </pre>
        )}
      </div>
    </Panel>
  );
}
