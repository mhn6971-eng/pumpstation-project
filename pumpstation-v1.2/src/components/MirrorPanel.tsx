"use client";

import { useEffect, useState } from "react";
import { useApp } from "./context";
import { Icon, Panel } from "./ui";

type MirrorState = {
  dir: string;
  available: boolean;
  keep: string;
  okRuns: number;
  failRuns: number;
  last24: number;
  files: string[];
  verdict: "ok" | "stale" | "missing" | "failing";
  message: string;
  last: { at: string; file: string; bytes: number; ok: boolean; error: string } | null;
};

const COLORS: Record<MirrorState["verdict"], string> = {
  ok: "var(--green, #2e7d32)",
  stale: "var(--amber)",
  missing: "var(--red, #c62828)",
  failing: "var(--red, #c62828)",
};

const LABELS: Record<MirrorState["verdict"], string> = {
  ok: "سالم",
  stale: "قدیمی",
  missing: "رسانه وصل نیست",
  failing: "خطا",
};

export default function MirrorPanel() {
  const { act, call, busy, toast } = useApp();
  const [data, setData] = useState<MirrorState | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const res = await call("mirror.status");
      setData(res as unknown as MirrorState);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "خواندن وضعیت آینه ناموفق بود");
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  async function run(forceFresh: boolean) {
    try {
      if (forceFresh) {
        await act("mirror.now");
        await load();
      } else {
        const res = await fetch("/api/mirror", { method: "POST", signal: AbortSignal.timeout(120000) });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error ?? "کپی ناموفق بود");
        toast("کپی روی آینه انجام و با هش تأیید شد");
        await load();
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "کپی ناموفق بود", "error");
    }
  }

  return (
    <Panel
      title="آینهٔ بک‌آپ (حافظهٔ بیرونی)"
      icon="database"
      hint="کپی JSON و آخرین بستهٔ بازیابی آرشیو/فایل‌ها به فلش یا درایو بیرونی"
      actions={
        <button type="button" className="btn tiny" disabled={busy} onClick={load}>
          <Icon name="refresh" size={13} /> بازخوانی
        </button>
      }
    >
      {error && <div className="note warn-note" style={{ marginBottom: 8 }}>{error}</div>}
      {!data ? (
        <div className="empty">در حال خواندن وضعیت…</div>
      ) : (
        <>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div>
              <b style={{ color: COLORS[data.verdict] }}>{LABELS[data.verdict]}</b>
              <div className="tiny muted">{data.message}</div>
            </div>
            <span className="chip accent">{data.okRuns} کپی موفق / {data.failRuns} ناموفق</span>
          </div>

          <div className="grid" style={{ gap: 6, fontSize: 12 }}>
            <div><span className="muted">مسیر آینه: </span><span className="mono tiny">{data.dir}</span></div>
            <div><span className="muted">آخرین فایل JSON: </span>
              <span className="tiny">{data.last ? `${data.last.at} — ${data.last.file} (${(data.last.bytes / 1024).toFixed(0)} KB)` : "—"}</span>
            </div>
            <div><span className="muted">کپی‌های ۲۴ ساعت گذشته: </span><span className="tiny">{data.last24}</span></div>
            <div><span className="muted">نگه‌داری: </span><span className="tiny">{data.keep} نسخهٔ آخر روی آینه</span></div>
          </div>

          {data.files.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 10, maxHeight: 150 }}>
              <table className="data">
                <thead>
                  <tr><th>نسخه روی آینه</th></tr>
                </thead>
                <tbody>
                  {data.files.map((f) => (
                    <tr key={f}><td className="mono tiny">{f}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button type="button" className="btn primary" disabled={busy} onClick={() => run(true)}>
              <Icon name="download" size={13} /> بک‌آپ تازه + کپی به آینه
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => run(false)}>
              کپی آخرین نسخه
            </button>
          </div>

          {data.verdict !== "ok" && (
            <div className="note warn-note" style={{ marginTop: 10 }}>
              بررسی کنید فلش/درایو به دستگاه وصل و مسیر <span className="mono">MIRROR_DIR</span> درست باشد؛
              زمان‌بند ویندوز باید روزانه <span className="mono">scripts/mirror-backup.mjs</span> را اجرا کند.
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
