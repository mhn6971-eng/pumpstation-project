"use client";

import type { CSSProperties, ReactNode } from "react";

export function Logo({ size = 30 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/logo.jpg" alt="آب منطقه‌ای اصفهان" style={{ height: size, width: "auto", display: "block", background: "#fff", borderRadius: 6, padding: 2 }} />;
}

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#38bdf8" />
          <stop offset="1" stopColor="#2dd4bf" />
        </linearGradient>
      </defs>
      <path d="M24 5C18 14 11 21 11 29a13 13 0 0 0 26 0c0-8-7-15-13-24Z" stroke="url(#logoGrad)" strokeWidth="2.4" />
      <path d="M24 19c-2.6 4-6.2 7-6.2 11a6.2 6.2 0 0 0 12.4 0c0-4-3.6-7-6.2-11Z" fill="url(#logoGrad)" opacity="0.75" />
      <circle cx="24" cy="31" r="2.4" fill="#07111d" />
    </svg>
  );
}

const paths: Record<string, string> = {
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 4 4",
  gauge: "M4 16a8 8 0 1 1 16 0M12 12l4-4M8 16h8",
  thermo: "M10 4a2 2 0 0 1 4 0v8.3a4 4 0 1 1-4 0Z",
  wrench: "M14 6a4 4 0 0 0-5 5l-5 5 2 2 5-5a4 4 0 0 0 5-5l-2 1-2-1-1-2Z",
  chart: "M4 19V5M4 19h16M8 15l3-4 3 2 4-6",
  alert: "M12 4 3 20h18L12 4Zm0 6v5m0 3v.5",
  check: "m5 13 4 4L19 7",
  clock: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  bolt: "m13 3-8 11h5l-1 7 8-11h-5Z",
  shield: "M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6Z",
  file: "M7 3h7l4 4v14H7Zm7 0v4h4M10 12h6M10 16h6",
  plus: "M12 5v14M5 12h14",
  arrow: "M15 6l-6 6 6 6",
  download: "M12 4v10m0 0 4-4m-4 4-4-4M5 19h14",
  database: "M12 4c4 0 7 1.2 7 2.7S16 9.4 12 9.4 5 8.2 5 6.7 8 4 12 4Zm7 2.7v10C19 18.2 16 19.4 12 19.4S5 18.2 5 16.7v-10",
  users: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20c0-3 2.7-5 6-5s6 2 6 5m2-5c3 0 6 1.6 6 5",
  logout: "M15 12H4m0 0 4-4m-4 4 4 4M12 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5v.5m0 3V16",
  fire: "M12 3c1 4 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 1-2 0-5 1-8Z",
  wave: "M3 9c3-3 6 3 9 0s6 3 9 0M3 15c3-3 6 3 9 0s6 3 9 0",
  archive: "M4 7h16v4H4zM6 11v9h12v-9M9 15h6",
  save: "M5 4h11l3 3v13H5zM8 4v6h7V4M8 20v-6h8v6",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 4a9 9 0 0 0-.2-1.8l2-1.5-2-3.4-2.3 1a9 9 0 0 0-3.1-1.8L15 2H9l-.4 2.5a9 9 0 0 0-3.1 1.8l-2.3-1-2 3.4 2 1.5A9 9 0 0 0 3 12c0 .6.1 1.2.2 1.8l-2 1.5 2 3.4 2.3-1a9 9 0 0 0 3.1 1.8L9 22h6l.4-2.5a9 9 0 0 0 3.1-1.8l2.3 1 2-3.4-2-1.5c.1-.6.2-1.2.2-1.8Z",
  refresh: "M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4",
};

export function Icon({ name, size = 15, className = "", style }: { name: keyof typeof paths | string; size?: number; className?: string; style?: CSSProperties }) {
  const d = paths[name] ?? paths.info;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

export function Panel({ title, icon, hint, actions, children, className = "" }: { title?: string; icon?: string; hint?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-head">
          <div>
            {title && (
              <div className="panel-title">
                {icon && <Icon name={icon} size={15} className="muted" />}
                {title}
                {hint && <small>{hint}</small>}
              </div>
            )}
          </div>
          {actions && <div className="toolbar">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function StatusPill({ status, statusFa }: { status: string; statusFa: string }) {
  const service = status === "in_service";
  return (
    <span className={`status-pill ${service ? "service" : ""}`}>
      <span className="dot" style={{ width: 6, height: 6, background: service ? "var(--amber)" : "var(--green)", boxShadow: "none" }} />
      {statusFa}
    </span>
  );
}


/** کلید دوقطبی وضعیت تجهیز: حالت فعلی مشخص، تغییر با کلیک روی حالت مقابل */
export function StatusToggle({ status, onPick, disabled }: { status: string; onPick: (mode: "ready" | "in_service") => void; disabled?: boolean }) {
  const ready = status !== "in_service";
  return (
    <div className="state-toggle" role="group" aria-label="وضعیت تجهیز">
      <button type="button" className={`on ${ready ? "active" : ""}`} disabled={disabled || ready} onClick={() => onPick("ready")} title={ready ? "وضعیت فعلی" : "بازگرداندن به آماده به کار با ثبت توضیح"}>
        ✓ آماده به کار
      </button>
      <button type="button" className={`svc ${!ready ? "active" : ""}`} disabled={disabled || !ready} onClick={() => onPick("in_service")} title={!ready ? "وضعیت فعلی" : "بردن به حال سرویس با ثبت توضیح"}>
        در حال سرویس
      </button>
    </div>
  );
}

export function Spinner({ label = "در حال دریافت…" }: { label?: string }) {
  return (
    <div className="empty" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
      <span className="dot live" style={{ background: "var(--accent)" }} />
      {label}
    </div>
  );
}
