import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  equipment,
  dailyTotals,
  motors,
  motorStateLogs,
  equipmentReports,
  operatorNotes,
  reports,
  motorServices,
  meggerTests,
  oilChanges,
  pmRecords,
  catalogs,
  motorReadingsAll,
  processReadingsAll,
} from "@/db/schema";
import { getProcessThresholds, thresholdSeverity } from "@/lib/state";
import { jalaliNow, operationalDay } from "@/lib/jalali";
import { MOTORS, MOTOR_PARAMS, PROCESS_PARAMS, STATUS_FA } from "@/lib/domain";
import { motorStateAtDayEnd } from "@/lib/motor-history";

export const REPORT_KINDS: Record<string, string> = {
  trend: "گزارش روند پارامتر",
  daily: "پایش روزانه",
  aux: "تجهیزات جانبی",
  motor_service: "سرویس موتور اصلی",
  megger: "تست مگر",
  oil: "تعویض روغن",
  pm: "نگهداشت / PM",
  registry: "لیست تجهیزات",
};

type ShiftLike = { key: string; label: string; members: string[] };

export async function buildOperationalPayload(kind: "daily" | "aux", day: string, shift: ShiftLike) {
  const op = operationalDay();
  const [processRows, totalRows, motorRows, equipmentRows, serviceRows, noteRows, thresholds, stateLogs] = await Promise.all([
    db.select().from(processReadingsAll).where(eq(processReadingsAll.day, day)),
    db.select().from(dailyTotals).where(eq(dailyTotals.day, day)).limit(1),
    db.select().from(motors),
    db.select().from(equipment).where(eq(equipment.deletedAt, "")),
    db.select().from(equipmentReports).orderBy(desc(equipmentReports.id)).limit(200),
    db.select().from(operatorNotes).where(eq(operatorNotes.day, day)).orderBy(desc(operatorNotes.id)).limit(1),
    getProcessThresholds(),
    db.select({ id: motorStateLogs.id, tag: motorStateLogs.tag, fromState: motorStateLogs.fromState, toState: motorStateLogs.toState, at: motorStateLogs.at })
      .from(motorStateLogs).where(inArray(motorStateLogs.tag, MOTORS.map((motor) => motor.tag)))
      .orderBy(asc(motorStateLogs.at), asc(motorStateLogs.id)),
  ]);
  const total = totalRows[0];
  const note = noteRows[0];
  const dayEnd = `${day} 23:59:59`;
  const stateLogsByTag = new Map<string, typeof stateLogs>();
  for (const entry of stateLogs) stateLogsByTag.set(entry.tag, [...(stateLogsByTag.get(entry.tag) ?? []), entry]);
  const historicalState = (motor: (typeof motorRows)[number]) =>
    motorStateAtDayEnd(motor.state, stateLogsByTag.get(motor.tag) ?? [], dayEnd);

  const process = PROCESS_PARAMS.map((p) => {
    const rows = processRows.filter((r) => r.tag === p.tag).sort((a, b) => b.intervalIndex - a.intervalIndex);
    const latest = rows[0];
    return {
      tag: p.tag,
      label: p.label,
      unit: p.unit,
      value: latest?.value ?? null,
      out: latest ? thresholdSeverity(latest.value, thresholds[p.tag]) !== "ok" : false,
      byInterval: Array.from({ length: 6 }, (_, i) => rows.find((r) => r.intervalIndex === i)?.value ?? null),
    };
  });

  const empty = processRows.length === 0 && !total && !note?.text;
  return {
    kind,
    day,
    empty,
    generatedAt: jalaliNow(),
    weekday: day === op.day ? op.weekday : "",
    shift: { key: shift.key, label: shift.label, members: shift.members },
    process,
    total: total?.value ?? null,
    motorsOn: motorRows.filter((m) => historicalState(m) === "on").map((m) => m.tag),
    motorsOff: motorRows.filter((m) => historicalState(m) === "off").map((m) => m.tag),
    motorsService: motorRows.filter((m) => historicalState(m) === "service").map((m) => m.tag),
    note: note?.text ?? "",
    equipment: equipmentRows
      .filter((e) => e.isAux)
      .map((e) => ({ tag: e.tag, name: e.name, category: e.category, statusFa: STATUS_FA[e.status] ?? e.status, safetyCritical: e.safetyCritical, description: e.description, descriptionAt: e.descriptionAt })),
    serviceReports: serviceRows
      .filter((s) => s.at.startsWith(day))
      .map((s) => ({ tag: s.tag, kind: s.kind, reason: s.reason, operator: s.operator, at: s.at })),
  };
}

export async function createReport(input: { kind: string; day: string; shift: ShiftLike; payload: Record<string, unknown>; title?: string }, d: typeof db = db) {
  const title = input.title ?? `${REPORT_KINDS[input.kind] ?? input.kind} — ${input.day}`;
  const operators = `${input.shift.label}${input.shift.members.length ? ` — ${input.shift.members.join(" و ")}` : ""}`;
  const row = await d
    .insert(reports)
    .values({ kind: input.kind, title, day: input.day, shiftKey: input.shift.key, operators, createdAt: jalaliNow(), payload: input.payload })
    .returning({ id: reports.id });
  return row[0]?.id ?? 0;
}

export async function buildRegistryPayload(tags: string[] | null, category: string | null) {
  const rows = await db.select().from(equipment).where(eq(equipment.deletedAt, ""));
  const cats = await db.select({ id: catalogs.id, tag: catalogs.tag, name: catalogs.name }).from(catalogs);
  const pm = await db.select().from(pmRecords).orderBy(desc(pmRecords.id)).limit(500);
  const svc = await db.select().from(equipmentReports).orderBy(desc(equipmentReports.id)).limit(500);
  const filtered = rows.filter((e) => (tags ? tags.includes(e.tag) : true)).filter((e) => (category ? e.category === category : true));
  return {
    generatedAt: jalaliNow(),
    scope: tags ? (tags.length === 1 ? "single" : "batch") : category ? "category" : "all",
    category,
    items: filtered.map((e) => ({
      tag: e.tag,
      name: e.name,
      category: e.category,
      spec: e.spec,
      plate: e.plate,
      partNumbers: e.partNumbers,
      location: e.location,
      statusFa: STATUS_FA[e.status] ?? e.status,
      description: e.description,
      catalogs: cats.filter((c) => c.tag === e.tag).map((c) => c.name),
      lastPm: pm.find((p) => p.tag === e.tag)?.day ?? "—",
      lastService: svc.find((s) => s.tag === e.tag)?.at ?? "—",
    })),
  };
}

export async function latestMotorRecords(tag: string, d: typeof db = db) {
  const [service, megger, oil] = await Promise.all([
    d.select().from(motorServices).where(eq(motorServices.tag, tag)).orderBy(desc(motorServices.id)).limit(1),
    d.select().from(meggerTests).where(eq(meggerTests.tag, tag)).orderBy(desc(meggerTests.id)).limit(1),
    d.select().from(oilChanges).where(eq(oilChanges.tag, tag)).orderBy(desc(oilChanges.id)).limit(1),
  ]);
  return { service: service[0] ?? null, megger: megger[0] ?? null, oil: oil[0] ?? null };
}


/* ---------- گزارش روند پارامتر (بازهٔ دلخواه، از اولین ثبت تا هر بازه) ---------- */
export type TrendPoint = { x: string; y: number; day: string; interval: number; shift: string };

const DAY_RE = /^\d{4}\/\d{2}\/\d{2}$/;

export function normalizeRange(from: string, to: string, fallbackFrom: string, fallbackTo: string) {
  let f = DAY_RE.test(from) ? from : fallbackFrom;
  let t = DAY_RE.test(to) ? to : fallbackTo;
  if (f > t) [f, t] = [t, f];
  return { from: f, to: t };
}

function trendStats(points: TrendPoint[]) {
  const values = points.map((p) => p.y);
  if (!values.length) return { count: 0, avg: null as number | null, min: null as number | null, max: null as number | null };
  return {
    count: values.length,
    avg: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function groupDaily(rows: { day: string; value: number }[]): TrendPoint[] {
  const map = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const e = map.get(r.day) ?? { sum: 0, n: 0 };
    e.sum += r.value; e.n += 1;
    map.set(r.day, e);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, e]) => ({ x: day.slice(2), y: Number((e.sum / e.n).toFixed(2)), day, interval: -1, shift: `${e.n} ثبت` }));
}

export async function buildTrendPayload(
  scope: "process" | "motor",
  tag: string,
  param: string,
  from: string,
  to: string,
  compare: boolean,
) {
  if (scope === "process") {
    const meta = PROCESS_PARAMS.find((p) => p.tag === tag);
    if (!meta) throw new Error("پارامتر نامعتبر است");
    const rows = await db
      .select()
      .from(processReadingsAll)
      .where(and(eq(processReadingsAll.tag, tag), gte(processReadingsAll.day, from), lte(processReadingsAll.day, to)));
    rows.sort((a, b) => (a.day + a.intervalIndex).localeCompare(b.day + b.intervalIndex));
    const grouped = rows.length > 1500;
    const points: TrendPoint[] = grouped
      ? groupDaily(rows)
      : rows.map((r) => ({ x: `${r.day.slice(5)} #${r.intervalIndex + 1}`, y: r.value, day: r.day, interval: r.intervalIndex, shift: r.shiftKey }));
    return { scope, tag, param: tag, compare: false, label: meta.label, unit: meta.unit, from, to, grouped: grouped ? "day" : "interval", points: points.slice(0, 5000), truncated: points.length > 5000, stats: trendStats(points) };
  }
  const meta = MOTOR_PARAMS.find((p) => p.key === param);
  if (!meta) throw new Error("پارامتر نامعتبر است");
  if (compare) {
    const rows = await db.select().from(motorReadingsAll).where(and(eq(motorReadingsAll.param, param), gte(motorReadingsAll.day, from), lte(motorReadingsAll.day, to)));
    const points: TrendPoint[] = MOTORS.map((m) => {
      const vals = rows.filter((r) => r.tag === m.tag).map((r) => r.value);
      return { x: m.tag, y: vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : 0, day: from, interval: -1, shift: `${vals.length} ثبت` };
    });
    return { scope, tag: "", param, compare: true, label: meta.label, unit: meta.unit, from, to, grouped: "motor", points, truncated: false, stats: trendStats(points.filter((p) => p.y > 0)) };
  }
  const rows = await db.select().from(motorReadingsAll).where(and(eq(motorReadingsAll.tag, tag), eq(motorReadingsAll.param, param), gte(motorReadingsAll.day, from), lte(motorReadingsAll.day, to)));
  rows.sort((a, b) => (a.day + a.intervalIndex).localeCompare(b.day + b.intervalIndex));
  const grouped = rows.length > 1500;
  const points: TrendPoint[] = grouped
    ? groupDaily(rows)
    : rows.map((r) => ({ x: `${r.day.slice(5)} #${r.intervalIndex + 1}`, y: r.value, day: r.day, interval: r.intervalIndex, shift: r.shiftKey }));
  return { scope, tag, param, compare: false, label: `${tag} — ${meta.label} (${meta.key})`, unit: meta.unit, from, to, grouped: grouped ? "day" : "interval", points: points.slice(0, 5000), truncated: points.length > 5000, stats: trendStats(points) };
}
