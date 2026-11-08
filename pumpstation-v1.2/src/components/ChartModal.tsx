"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "./context";
import { MOTOR_PARAMS, PROCESS_PARAMS } from "@/lib/domain";
import { addDaysToDay } from "@/lib/jalali";
import { Icon } from "./ui";

type Point = { x: string; y: number; day: string; interval: number; shift: string };
type TrendResp = {
  points: Point[]; unit: string; label: string; from: string; to: string;
  grouped: string; truncated: boolean;
  stats: { count: number; avg: number | null; min: number | null; max: number | null };
};
type Props = { scope: "process" | "motor" | "total"; tag?: string; param?: string };
const COLORS = ["#0e7490", "#15803d", "#d97706", "#dc2626"];
const PRESETS: { label: string; days: number | "all" }[] = [
  { label: "۷ روز", days: 7 },
  { label: "۳۰ روز", days: 30 },
  { label: "۹۰ روز", days: 90 },
  { label: "۱ سال", days: 365 },
  { label: "از اولین ثبت", days: "all" },
];

export default function ChartModal({ scope, tag = "", param = "" }: Props) {
  if (scope === "total") return <TotalMonthlyChart />;
  return <TrendChart scope={scope} tag={tag} param={param} />;
}

function TrendChart({ scope, tag, param }: { scope: "process" | "motor"; tag: string; param: string }) {
  const { state, act, openModal } = useApp();
  const isMotor = scope === "motor";
  const [selectedTag, setSelectedTag] = useState(tag || (isMotor ? "M-01" : PROCESS_PARAMS[0].tag));
  const selectedPumpTag = state.motors.find((motor) => motor.tag === selectedTag)?.pumpTag ?? selectedTag;
  const [selectedParam, setSelectedParam] = useState(param || (isMotor ? "T10" : ""));
  const [compare, setCompare] = useState(false);
  const [from, setFrom] = useState(addDaysToDay(state.now.day, -13));
  const [to, setTo] = useState(state.now.day);
  const [applied, setApplied] = useState({ from: addDaysToDay(state.now.day, -13), to: state.now.day });
  const [type, setType] = useState<"line" | "bar" | "scatter">("line");
  const [view, setView] = useState<"chart" | "table" | "both">("both");
  const [data, setData] = useState<TrendResp | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (f: string, t: string, st: string, sp: string, cmp: boolean) => {
    setLoading(true);
    try {
      const q = isMotor
        ? `scope=motor&tag=${cmp ? "" : st}&param=${sp}&from=${f}&to=${t}`
        : `scope=process&tag=${st}&from=${f}&to=${t}`;
      const res = await fetch(`/api/history?${q}`, { cache: "no-store", signal: AbortSignal.timeout(30000) });
      const json = await res.json();
      if (res.ok) setData(json as TrendResp);
    } finally {
      setLoading(false);
    }
  }, [isMotor]);

  useEffect(() => { void load(applied.from, applied.to, selectedTag, selectedParam, compare); }, [applied, selectedTag, selectedParam, compare, load]);

  function preset(days: number | "all") {
    const t = state.now.day;
    const f = days === "all" ? "1300/01/01" : addDaysToDay(t, -(days - 1));
    setFrom(f); setTo(t); setApplied({ from: f, to: t });
  }

  async function makePrintable() {
    const id = await act("report.create", { kind: "trend", scope, tag: compare ? "" : selectedTag, param: selectedParam, from: applied.from, to: applied.to, compare });
    if (typeof id === "number") window.open(`/report/${id}`, "_blank");
  }

  const grouped = data?.grouped === "day";
  const shown = (data?.points ?? []).slice(0, 1500);

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        {isMotor ? (
          <>
            <select className="input" style={{ width: 170 }} value={selectedTag} onChange={(e) => setSelectedTag(e.target.value)} disabled={compare}>
              {state.motors.map((m) => <option key={m.tag} value={m.tag}>{m.pumpTag}</option>)}
            </select>
            <select className="input" style={{ width: 210 }} value={selectedParam} onChange={(e) => setSelectedParam(e.target.value)}>
              {MOTOR_PARAMS.map((p) => <option key={p.key} value={p.key}>{p.label} ({p.key})</option>)}
            </select>
            <label className="row small" style={{ gap: 5 }}><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> مقایسهٔ همهٔ پمپ‌ها</label>
          </>
        ) : (
          <select className="input" style={{ width: 250 }} value={selectedTag} onChange={(e) => setSelectedTag(e.target.value)}>
            {PROCESS_PARAMS.map((p) => <option key={p.tag} value={p.tag}>{p.tag} — {p.label}</option>)}
          </select>
        )}
      </div>

      <div className="toolbar" style={{ marginBottom: 10 }}>
        <span className="small muted">بازهٔ زمانی (شمسی):</span>
        {PRESETS.map((p) => <button key={p.label} type="button" className="btn tiny" onClick={() => preset(p.days)}>{p.label}</button>)}
        <input className="input mono" style={{ width: 130, direction: "ltr", textAlign: "center" }} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="از: 1405/01/01" />
        <input className="input mono" style={{ width: 130, direction: "ltr", textAlign: "center" }} value={to} onChange={(e) => setTo(e.target.value)} placeholder="تا: 1405/08/13" />
        <button type="button" className="btn tiny primary" onClick={() => setApplied({ from, to })}>اعمال بازه</button>
      </div>

      <div className="row" style={{ marginBottom: 10 }}>
        <span className="chip">میانگین: {data?.stats.avg ?? "—"}</span>
        <span className="chip">کمینه: {data?.stats.min ?? "—"}</span>
        <span className="chip">بیشینه: {data?.stats.max ?? "—"}</span>
        <span className="chip muted">نقاط: {data?.stats.count ?? 0}{data?.truncated ? " (خلاصه‌شده)" : ""}</span>
        <span className="chip muted">واحد: {data?.unit || "—"}</span>
        {grouped && <span className="chip warn">بازهٔ طولانی — میانگین روزانه</span>}
      </div>

      <div className="toolbar" style={{ marginBottom: 10 }}>
        <select className="input" style={{ width: 130 }} value={view} onChange={(e) => setView(e.target.value as typeof view)}>
          <option value="both">نمودار + جدول</option><option value="chart">فقط نمودار</option><option value="table">فقط جدول</option>
        </select>
        <select className="input" style={{ width: 120 }} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="line">خطی</option><option value="bar">میله‌ای</option><option value="scatter">پراکنده</option>
        </select>
        {isMotor && !compare && (
          <button type="button" className="btn tiny ghost" onClick={() => openModal(`ترند چندکاناله ${selectedPumpTag}`, <MultiParamChart tag={selectedTag} from={applied.from} to={applied.to} />, { wide: true })}>ترند چندکاناله</button>
        )}
        <button type="button" className="btn tiny primary" onClick={makePrintable}><Icon name="file" size={12} /> گزارش چاپی / PDF این روند</button>
      </div>

      {loading && <div className="empty">در حال دریافت داده…</div>}
      {!loading && (!data || data.points.length === 0) && <div className="empty">داده‌ای در این بازه ثبت نشده است.</div>}
      {!loading && data && data.points.length > 0 && (
        <>
          {view !== "table" && <div className="chart-box"><LineChart points={data.points} type={type} unit={data.unit} color={COLORS[0]} /></div>}
          {view !== "chart" && (
            <div className="table-wrap" style={{ maxHeight: 340, marginTop: view === "both" ? 10 : 0 }}>
              <table className="data">
                <thead><tr><th>تاریخ</th><th>{compare ? "پمپ" : grouped ? "نوع" : "بازه"}</th><th>مقدار ({data.unit})</th><th>شیفت / ثبت</th></tr></thead>
                <tbody>
                  {shown.map((p, i) => (
                    <tr key={i}>
                      <td className="mono">{compare ? p.x : p.day}</td>
                      <td className="small">{compare ? `${data.label}` : grouped ? "میانگین روزانه" : `بازه ${p.interval + 1}`}</td>
                      <td className="mono" style={{ fontWeight: 700 }}>{p.y}</td>
                      <td className="small muted">{p.shift}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.points.length > shown.length && <div className="empty">جدول {shown.length} ردیف اول از {data.points.length} نقطه را نشان می‌دهد؛ گزارش چاپی کامل است.</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function LineChart({ points, type, unit, color = COLORS[0] }: { points: Point[]; type: "line" | "bar" | "scatter"; unit: string; color?: string }) {
  const width = 720, height = 280, padX = 52, padY = 26;
  const values = points.map((p) => p.y);
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const innerW = width - padX * 2, innerH = height - padY * 2;
  const x = (i: number) => padX + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => padY + innerH - ((v - min) / span) * innerH;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="نمودار روند">
      <defs><linearGradient id="chartArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.25" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {[0, 1, 2, 3, 4].map((i) => {
        const gy = padY + (innerH / 4) * i, val = max - (span / 4) * i;
        return (<g key={i}><line x1={padX} y1={gy} x2={width - padX} y2={gy} stroke="rgba(11,39,69,0.12)" strokeDasharray="3 4" /><text x={padX - 6} y={gy + 3} fill="#7b93ab" fontSize="10" textAnchor="end" fontFamily="monospace">{val.toFixed(1)}</text></g>);
      })}
      {type === "bar" && points.map((p, i) => <rect key={i} x={x(i) - Math.max(2, innerW / points.length / 3)} y={y(p.y)} width={Math.max(3, innerW / points.length / 1.6)} height={padY + innerH - y(p.y)} fill={color} opacity="0.75" rx="2"><title>{`${p.x} — ${p.y} ${unit}`}</title></rect>)}
      {type === "scatter" && points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.y)} r="3.4" fill={color}><title>{`${p.x} — ${p.y} ${unit}`}</title></circle>)}
      {type === "line" && (<><path d={`${line} L${x(points.length - 1)},${padY + innerH} L${x(0)},${padY + innerH} Z`} fill="url(#chartArea)" /><path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></>)}
      {points.map((p, i) => i % labelEvery === 0 ? <text key={`l-${i}`} x={x(i)} y={height - 8} fill="#7b93ab" fontSize="9" textAnchor="middle" fontFamily="monospace">{p.x}</text> : null)}
    </svg>
  );
}

function MultiParamChart({ tag, from, to }: { tag: string; from: string; to: string }) {
  const [series, setSeries] = useState<string[]>(["T1", "T5", "T10"]);
  const [data, setData] = useState<Record<string, TrendResp>>({});
  useEffect(() => {
    let active = true;
    Promise.all(series.map(async (param) => {
      const res = await fetch(`/api/history?scope=motor&tag=${tag}&param=${param}&from=${from}&to=${to}`, { cache: "no-store", signal: AbortSignal.timeout(30000) });
      return [param, (await res.json()) as TrendResp] as const;
    })).then((entries) => { if (active) setData(Object.fromEntries(entries)); }).catch(() => {});
    return () => { active = false; };
  }, [series, tag, from, to]);
  const all = Object.values(data).flatMap((d) => d.points.map((p) => p.y));
  const min = all.length ? Math.min(...all) : 0, max = all.length ? Math.max(...all) : 1, span = max - min || 1;
  const width = 720, height = 300, pad = 40;
  const count = Math.max(...Object.values(data).map((d) => d.points.length), 1);
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        {MOTOR_PARAMS.map((p) => <label key={p.key} className="row small" style={{ gap: 4 }}><input type="checkbox" checked={series.includes(p.key)} onChange={(e) => setSeries((s) => (e.target.checked ? [...s, p.key] : s.filter((x) => x !== p.key)))} />{p.key}</label>)}
      </div>
      <div className="chart-legend" style={{ marginBottom: 8 }}>
        {series.map((s, i) => <span key={s} className="row" style={{ gap: 5 }}><span style={{ width: 12, height: 3, background: COLORS[i % COLORS.length], display: "inline-block", borderRadius: 2 }} /> {s}</span>)}
      </div>
      <div className="chart-box">
        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }}>
          {series.map((param, si) => {
            const points = data[param]?.points ?? [];
            const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${pad + (i / Math.max(1, count - 1)) * (width - pad * 2)},${pad + (height - pad * 2) - ((p.y - min) / span) * (height - pad * 2)}`).join(" ");
            return <path key={param} d={d} fill="none" stroke={COLORS[si % COLORS.length]} strokeWidth="1.8" />;
          })}
        </svg>
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>بازه: {from} تا {to}</div>
    </div>
  );
}

type TotalsResp = {
  months: { ym: string; count: number; sum: number }[];
  data: { year: number; month: number; monthLabel: string; days: number; rows: { day: string; d: number; value: number | null }[]; sum: number; count: number };
};

function TotalMonthlyChart() {
  const { state } = useApp();
  const [ym, setYm] = useState(state.now.day.slice(0, 7));
  const [resp, setResp] = useState<TotalsResp | null>(null);
  useEffect(() => {
    const [y, m] = ym.split("/");
    fetch(`/api/totals?year=${y}&month=${m}`, { cache: "no-store", signal: AbortSignal.timeout(30000) }).then((r) => r.json()).then(setResp).catch(() => {});
  }, [ym]);
  const d = resp?.data;
  const max = Math.max(...(d?.rows.map((r) => r.value ?? 0) ?? [1]), 1);
  const cur = state.now.day.slice(0, 7);
  const options = Array.from(new Set([cur, ...(resp?.months.map((m) => m.ym) ?? [])])).sort().reverse();
  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <label className="small muted">ماه:</label>
        <select className="input" style={{ width: 170 }} value={ym} onChange={(e) => setYm(e.target.value)}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <span className="chip live">جمع کل: {(d?.sum ?? 0).toLocaleString("en-US")} m³</span>
        <span className="chip muted">ثبت‌شده: {d?.count ?? 0} از {d?.days ?? 0} روز</span>
        <button type="button" className="btn tiny primary" onClick={() => { const [y, m] = ym.split("/"); window.open(`/totals?year=${y}&month=${m}`, "_blank"); }}><Icon name="file" size={12} /> چاپ / PDF جدول ماهانه</button>
      </div>
      {!d ? <div className="empty">در حال دریافت…</div> : (
        <>
          <div className="table-wrap" style={{ maxHeight: 380 }}>
            <table className="data">
              <thead><tr><th style={{ width: 60 }}>روز</th><th style={{ width: 130 }}>تاریخ</th><th>مقدار (m³)</th></tr></thead>
              <tbody>
                {d.rows.map((r) => <tr key={r.d}><td className="mono">{r.d}</td><td className="mono">{r.day}</td><td className="mono" style={{ fontWeight: 700 }}>{r.value === null ? "—" : r.value.toLocaleString("en-US")}</td></tr>)}
                <tr><th colSpan={2}>جمع کل {d.monthLabel}</th><td className="mono" style={{ fontWeight: 800, color: "var(--accent)" }}>{d.sum.toLocaleString("en-US")}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="chart-box" style={{ marginTop: 10 }}>
            <svg viewBox={`0 0 ${Math.max(320, d.rows.length * 30)} 170`} style={{ width: "100%", height: "auto" }}>
              <defs><linearGradient id="tbar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0e7490" stopOpacity="0.8" /><stop offset="1" stopColor="#0e7490" stopOpacity="0.15" /></linearGradient></defs>
              {d.rows.map((r, i) => {
                const h = ((r.value ?? 0) / max) * 120;
                return (<g key={r.d}><rect x={i * 30 + 10} y={140 - h} width="18" height={h} rx="3" fill="url(#tbar)" /><text x={i * 30 + 19} y={155} fontSize="8.5" fill="#7b93ab" textAnchor="middle" fontFamily="monospace">{r.d}</text></g>);
              })}
              <line x1="4" y1="140" x2="100%" y2="140" stroke="#cbd8e6" />
            </svg>
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>ثبت روزانه و مستقل از شیفت؛ ماه‌های دارای سابقه از فهرست بالا قابل انتخاب‌اند.</div>
        </>
      )}
    </div>
  );
}
