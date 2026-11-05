"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppState } from "@/lib/types";
import { APP_NAME, APP_SUBTITLE } from "@/lib/domain";
import { AppCtx } from "./context";
import { Icon, Logo } from "./ui";
import Dashboard from "./Dashboard";
import AuxTab from "./AuxTab";
import RegistryTab from "./RegistryTab";
import ReportsHub from "./ReportsHub";
import AlertsTab from "./AlertsTab";
import TrainingTab from "./TrainingTab";
import ProblemsTab from "./ProblemsTab";
import AdminTab from "./AdminTab";


/** ---------------- صف آفلاین با کلید یکتا (ضدثبت تکراری) ----------------
 * اگر اینترنت قطع شود، عمل اپراتور در حافظهٔ مرورگر می‌ماند و پس از وصل شدن
 * با همان «کلید یکتا» دوباره فرستاده می‌شود؛ سرور درخواست تکراری را اجرا نمی‌کند.
 */
type PendingAction = { key: string; action: string; payload: Record<string, unknown>; at: number; tries: number };
const QUEUE_KEY = "ps_pending_v1";
const QUEUE_MAX = 50;

function readQueue(): PendingAction[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const list = raw ? (JSON.parse(raw) as PendingAction[]) : [];
    return Array.isArray(list) ? list.filter((x) => x && typeof x.key === "string" && typeof x.action === "string") : [];
  } catch {
    return [];
  }
}

function writeQueue(list: PendingAction[]) {
  try {
    if (!list.length) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-QUEUE_MAX)));
  } catch {
    /* حافظهٔ مرورگر ممکن است پر باشد */
  }
}

function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type ModalEntry = { id: number; title: string; node: ReactNode; wide: boolean; sub?: string };

const TABS = [
  { key: "dashboard", label: "داشبورد" },
  { key: "aux", label: "پایش تجهیزات جانبی" },
  { key: "registry", label: "لیست تجهیزات" },
  { key: "reports", label: "گزارش‌ها" },
  { key: "alerts", label: "هشدارها و آلارم‌ها" },
  { key: "training", label: "آموزش و دستورالعمل" },
  { key: "problems", label: "گزارش مشکل" },
  { key: "admin", label: "ادمین" },
];

function tabFromUrl() {
  if (typeof window === "undefined") return "dashboard";
  const t = new URLSearchParams(window.location.search).get("tab");
  return t && TABS.some((x) => x.key === t) ? t : "dashboard";
}

export default function AppShell({ initial }: { initial: AppState }) {
  const [state, setState] = useState<AppState>(initial);
  const [day, setDayState] = useState(initial.now.day);
  const [interval, setIntervalState] = useState(initial.now.intervalIndex);
  const [tab, setTab] = useState("dashboard");
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: "ok" | "error" }[]>([]);
  const [stack, setStack] = useState<ModalEntry[]>([]);
  const [query, setQuery] = useState("");
  const [lastSync, setLastSync] = useState("");
  const channelRef = useRef<BroadcastChannel | null>(null);
  const isAdmin = state.me.role === "admin";

  // همگام‌سازی سربرگ با URL تا دکمهٔ «بازگشت» مرورگر بین سربرگ‌ها/پنجره‌ها جابه‌جا شود، نه به صفحهٔ ورود
  useEffect(() => {
    const t = tabFromUrl();
    setTab(t === "admin" && initial.me.role !== "admin" ? "dashboard" : t);
    const onPop = () => {
      setStack((s) => (s.length ? s.slice(0, -1) : s));
      setTab(tabFromUrl());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [initial.me.role]);

  const goTab = useCallback((next: string) => {
    setTab(next);
    setStack([]);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.pushState({ psTab: next }, "", url.toString());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const toast = useCallback((message: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const etagRef = useRef<{ key: string; value: string } | null>(null);

  const refresh = useCallback(
    async (opts?: { day?: string; interval?: number }) => {
      const d = opts?.day ?? day;
      const i = opts?.interval ?? interval;
      const cacheKey = `${d}|${i}`;
      const headers: Record<string, string> = {};
      // اگر دادهٔ همین نما تغییری نکرده باشد، سرور ۳۰۴ می‌دهد و بدنه‌ای منتقل نمی‌شود
      if (etagRef.current && etagRef.current.key === cacheKey) headers["if-none-match"] = etagRef.current.value;
      let res: Response;
      try {
        res = await fetch(`/api/state?day=${encodeURIComponent(d)}&interval=${i}`, { cache: "no-store", headers });
      } catch {
        return toast("ارتباط با سرور برقرار نشد — دادهٔ همین صفحه نمایش داده می‌شود", "error");
      }
      if (res.status === 401) return void window.location.replace("/");
      if (res.status === 304) {
        setLastSync(new Date().toLocaleTimeString("fa-IR"));
        return;
      }
      if (!res.ok) return toast("دریافت وضعیت ناموفق بود", "error");
      const etag = res.headers.get("etag");
      if (etag) etagRef.current = { key: cacheKey, value: etag };
      setState((await res.json()) as AppState);
      setLastSync(new Date().toLocaleTimeString("fa-IR"));
    },
    [day, interval, toast],
  );

  const setDay = useCallback((next: string) => { setDayState(next); void refresh({ day: next, interval }); }, [interval, refresh]);
  const setInterval = useCallback((next: number) => { setIntervalState(next); void refresh({ day, interval: next }); }, [day, refresh]);

  const [pendingCount, setPendingCount] = useState(0);

  const postAction = useCallback(
    async (action: string, payload: Record<string, unknown>, key: string) => {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ action, payload }),
      });
      if (res.status === 401) {
        window.location.replace("/");
        throw new Error("unauthorized");
      }
      const data = (await res.json()) as { ok: boolean; error?: string; message?: string; id?: number };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "عملیات انجام نشد");
      return data;
    },
    [],
  );

  const flushQueue = useCallback(
    async (silent = false) => {
      const list = readQueue();
      if (!list.length) return;
      setPendingCount(list.length);
      const remaining: PendingAction[] = [];
      let done = 0;
      for (const item of list) {
        try {
          await postAction(item.action, item.payload, item.key);
          done += 1;
        } catch (error) {
          if (error instanceof Error && error.message === "unauthorized") return;
          const tries = item.tries + 1;
          // خطای اعتبارسنجی تکرارنشدنی است؛ فقط خطای شبکه دوباره تلاش می‌شود
          const message = error instanceof Error ? error.message : "";
          const retriable = /ارتباط|network|fetch/i.test(message) || tries < 3;
          if (retriable) remaining.push({ ...item, tries });
          else if (!silent) toast(`یک ثبت ذخیره‌نشده کنار گذاشته شد: ${message}`, "error");
        }
      }
      writeQueue(remaining);
      setPendingCount(remaining.length);
      if (done) {
        if (!silent) toast(`${done} ثبت ذخیره‌شده ارسال شد`);
        await refresh();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [postAction, toast],
  );

  const call = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      setBusy(true);
      try {
        return (await postAction(action, payload, uid())) as unknown as Record<string, unknown>;
      } finally {
        setBusy(false);
      }
    },
    [postAction],
  );

  const act = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      setBusy(true);
      const key = uid();
      try {
        const data = await postAction(action, payload, key);
        toast(data.message ?? "ثبت شد");
        channelRef.current?.postMessage("changed");
        await refresh();
        // اگر قبلاً چیزی در صف مانده بود، الان که شبکه هست فرصت خوبی است
        if (readQueue().length) void flushQueue(true);
        return data.id ?? true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "خطای نامشخص";
        if (message === "unauthorized") return false;
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        const networkish = offline || /fetch|network|ارتباط/i.test(message);
        if (networkish) {
          const list = readQueue();
          list.push({ key, action, payload, at: Date.now(), tries: 0 });
          writeQueue(list);
          setPendingCount(list.length);
          toast("ارتباط قطع است؛ ثبت در حافظهٔ همین دستگاه نگه داشته شد و پس از وصل شدن ارسال می‌شود", "error");
        } else {
          toast(message, "error");
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    [flushQueue, postAction, refresh, toast],
  );

  // تلاش مجدد خودکار صف آفلاین
  useEffect(() => {
    setPendingCount(readQueue().length);
    const onOnline = () => void flushQueue(false);
    window.addEventListener("online", onOnline);
    const id = window.setInterval(() => {
      if (navigator.onLine && readQueue().length) void flushQueue(true);
    }, 45_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(id);
    };
  }, [flushQueue]);

  // همگام‌سازی بین تب‌ها: هر ثبتی در یک تب، تب‌های دیگر را تازه می‌کند
  useEffect(() => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("pumpstation-state");
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data === "changed") void refresh();
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [refresh]);

  // تازه‌سازی خودکار هر ۶۰ ثانیه تا دادهٔ تب باز کهنه نماند
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const openModal = useCallback((title: string, node: ReactNode, opts?: { wide?: boolean; sub?: string }) => {
    window.history.pushState({ psModal: true }, "", window.location.href);
    setStack((s) => [...s, { id: Date.now() + Math.random(), title, node, wide: opts?.wide ?? false, sub: opts?.sub }]);
  }, []);

  const closeModal = useCallback(() => {
    if (window.history.state?.psModal) window.history.back();
    else setStack((s) => s.slice(0, -1));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && stack.length) closeModal(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack.length, closeModal]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return null;
    return {
      equip: state.equipment.filter((e) => [e.tag, e.name, e.spec, e.category].some((v) => v.toLowerCase().includes(q))).slice(0, 6),
      reports: state.reports.filter((r) => r.title.includes(q) || r.day.includes(q)).slice(0, 4),
      alerts: state.alerts.filter((a) => a.message.includes(q) || a.tag.toLowerCase().includes(q)).slice(0, 4),
    };
  }, [query, state]);

  const activeAlerts = state.alerts.filter((a) => !a.actedAt);
  const criticalCount = activeAlerts.filter((a) => a.severity === "critical").length;
  const topModal = stack[stack.length - 1];

  return (
    <AppCtx.Provider value={{ state, day, interval, setDay, setInterval, refresh, act, call, busy, toast, openModal, closeModal, goTab, isAdmin }}>
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" style={{ width: "auto", padding: "4px 8px" }}><Logo size={34} /></span>
            <div>
              <h1>{APP_NAME}</h1>
              <p>{APP_SUBTITLE} — شرکت سهامی آب منطقه‌ای اصفهان</p>
            </div>
          </div>

          <div className="search-wrap">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جستجو در تجهیزات، گزارش‌ها و هشدارها…" aria-label="جستجوی سراسری" />
            <span className="search-icon"><Icon name="search" size={16} /></span>
            {searchResults && (
              <div className="search-results">
                {!searchResults.equip.length && !searchResults.reports.length && !searchResults.alerts.length && <div className="search-empty">نتیجه‌ای پیدا نشد.</div>}
                {searchResults.equip.map((e) => (
                  <button key={e.tag} type="button" onClick={() => { goTab("registry"); setQuery(""); }}>
                    <span className="mono" style={{ color: "var(--accent)" }}>{e.tag}</span> — {e.name}
                  </button>
                ))}
                {searchResults.reports.map((r) => (
                  <button key={r.id} type="button" onClick={() => window.open(`/report/${r.id}`, "_blank")}><Icon name="file" size={12} /> {r.title}</button>
                ))}
                {searchResults.alerts.map((a) => (
                  <button key={a.id} type="button" onClick={() => { goTab("alerts"); setQuery(""); }}><Icon name="alert" size={12} /> {a.message}</button>
                ))}
              </div>
            )}
          </div>

          <div className="header-meta">
            <span className="chip accent"><Icon name="clock" size={13} /> {state.now.weekday} {state.now.day} — {state.now.time}</span>
            <span className="chip live"><span className="dot live" />{state.shift.label}{state.shift.members.length ? ` — ${state.shift.members.join(" و ")}` : ""}</span>
            {lastSync && <span className="chip" title="آخرین به‌روزرسانی داده از سرور"><Icon name="clock" size={12} /> {lastSync}</span>}
            {pendingCount > 0 && (
              <span className="chip" style={{ background: "rgba(255,180,0,0.2)", color: "#ffd479" }} title="ثبت‌های ذخیره‌شده روی این دستگاه که هنوز ارسال نشده‌اند">
                <Icon name="wave" size={12} /> {pendingCount} در انتظار ارسال
              </span>
            )}
            <button type="button" className="btn tiny ghost" style={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} title="خروج"
              onClick={() => {
                let done = false;
                const go = () => { if (!done) { done = true; window.location.replace("/"); } };
                try {
                  fetch("/api/auth", { method: "DELETE", keepalive: true }).then(go, go);
                } catch { go(); return; }
                setTimeout(go, 2000);
              }}>
              <Icon name="logout" size={14} /> خروج
            </button>
          </div>
        </header>

        <nav className="tabs" aria-label="سربرگ‌های اصلی">
          {TABS.filter((t) => t.key !== "admin" || isAdmin).map((t) => (
            <button key={t.key} type="button" className={`tab ${tab === t.key ? "active" : ""}`} onClick={() => goTab(t.key)}>
              {t.label}
              {t.key === "alerts" && activeAlerts.length > 0 && <span className="badge">{activeAlerts.length}</span>}
            </button>
          ))}
        </nav>

        {criticalCount > 0 && tab !== "dashboard" && tab !== "alerts" && (
          <button type="button" className="alert-item critical" style={{ width: "100%", textAlign: "start", cursor: "pointer", marginBottom: 12 }} onClick={() => goTab("dashboard")}>
            <Icon name="alert" size={16} />
            <span className="msg">{criticalCount} هشدار بحرانی فعال وجود دارد.</span>
            <span className="chip danger">مشاهده داشبورد</span>
          </button>
        )}

        {tab === "dashboard" && <Dashboard />}
        {tab === "aux" && <AuxTab />}
        {tab === "registry" && <RegistryTab />}
        {tab === "reports" && <ReportsHub />}
        {tab === "alerts" && <AlertsTab />}
        {tab === "training" && <TrainingTab />}
        {tab === "problems" && <ProblemsTab />}
        {tab === "admin" && (isAdmin ? <AdminTab /> : <div className="empty">این بخش فقط برای ادمین است.</div>)}
      </div>

      {topModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div className={`modal-card ${topModal.wide ? "" : "small"}`}>
            <div className="modal-head">
              <div><h2>{topModal.title}</h2>{topModal.sub && <p className="sub">{topModal.sub}</p>}</div>
              <button type="button" className="close-x" onClick={closeModal} aria-label="بستن">×</button>
            </div>
            <div className="modal-body">{topModal.node}</div>
          </div>
        </div>
      )}

      <div className="toast-stack">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`}>{t.message}</div>)}
      </div>
    </AppCtx.Provider>
  );
}
