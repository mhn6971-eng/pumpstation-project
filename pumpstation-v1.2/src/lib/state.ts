import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  shifts,
  settings,
  equipment,
  motors,
  processReadings,
  dailyTotals,
  motorReadings,
  motorServices,
  meggerTests,
  oilChanges,
  equipmentReports,
  pmTemplates,
  pmRecords,
  alerts,
  activity,
  problems,
  reports,
  backups,
  operatorNotes,
  valueAudits,
  sendQueue,
  channels,
} from "@/db/schema";
import { ensureSeed, getAllSettings } from "@/db/seed";
import { appendActivity } from "@/lib/audit";
import { INTERVALS, jalaliNow, operationalDay } from "@/lib/jalali";
import { MOTORS, MOTOR_PARAMS, MOTOR_STATE_FA, PROCESS_PARAMS, STATUS_FA, type Severity } from "@/lib/domain";
import type { AppState, MotorView, ProcessView } from "@/lib/types";

type Threshold = { warnMin: number | null; warnMax: number | null; critMin: number | null; critMax: number | null };

export async function getProcessThresholds() {
  const map: Record<string, Threshold> = {};
  for (const p of PROCESS_PARAMS) map[p.tag] = { warnMin: p.warnMin, warnMax: p.warnMax, critMin: p.critMin, critMax: p.critMax };
  const rows = await db.select().from(settings).where(eq(settings.key, "processSetpoints"));
  const stored = (rows[0]?.value ?? {}) as Record<string, Partial<Threshold>>;
  for (const [tag, value] of Object.entries(stored)) if (map[tag]) map[tag] = { ...map[tag], ...value };
  return map;
}

export function thresholdSeverity(value: number | null, t: Threshold): Severity {
  if (value === null) return "ok";
  if ((t.critMin !== null && value < t.critMin) || (t.critMax !== null && value > t.critMax)) return "critical";
  if ((t.warnMin !== null && value < t.warnMin) || (t.warnMax !== null && value > t.warnMax)) return "warning";
  return "ok";
}

export async function effectiveShift() {
  const s = await getAllSettings();
  let key = "A";
  let auto = true;
  if (s.shiftOverride) {
    key = s.shiftOverride;
    auto = false;
  } else {
    const op = operationalDay();
    key = ["A", "B", "C"][((op.ordinal % 3) + 3) % 3];
  }
  const row = (await db.select().from(shifts).where(eq(shifts.key, key)).limit(1))[0];
  return { key, label: row?.label ?? `شیفت ${key}`, role: row?.role ?? "operator", members: row?.members ?? [], auto };
}

function latestPerParam(rows: { param: string; intervalIndex: number; value: number }[], selectedInterval: number) {
  const chosen: Record<string, { interval: number; value: number }> = {};
  for (const row of rows) {
    if (row.intervalIndex > selectedInterval) continue;
    const prev = chosen[row.param];
    if (!prev || row.intervalIndex > prev.interval) chosen[row.param] = { interval: row.intervalIndex, value: row.value };
  }
  const out: Record<string, number> = {};
  for (const [param, v] of Object.entries(chosen)) out[param] = v.value;
  return out;
}

export async function buildState(input: { who: { key: string; label: string; role: string; members: string[] }; day?: string; interval?: number }): Promise<AppState> {
  await ensureSeed();
  const cfg = await getAllSettings();
  const op = operationalDay();
  const day = input.day && /^\d{4}\/\d{2}\/\d{2}$/.test(input.day) ? input.day : op.day;
  const interval = typeof input.interval === "number" && input.interval >= 0 && input.interval <= 5 ? input.interval : op.intervalIndex;

  const shift =
    input.who.role === "operator"
      ? { key: input.who.key, label: input.who.label, role: input.who.role, members: input.who.members, auto: false }
      : await effectiveShift();
  const thresholds = await getProcessThresholds();

  const [processRows, totalsRow, motorRowsAll, equipmentRows, noteRow, alertRows, logRows, reportRows, backupRows, problemRows, serviceRows, meggerRows, oilRows] =
    await Promise.all([
      db.select().from(processReadings).where(eq(processReadings.day, day)),
      db.select().from(dailyTotals).where(eq(dailyTotals.day, day)).limit(1),
      db.select().from(motorReadings).where(eq(motorReadings.day, day)),
      db.select().from(equipment).where(eq(equipment.deletedAt, "")).orderBy(equipment.tag),
      db.select().from(operatorNotes).where(eq(operatorNotes.day, day)).orderBy(desc(operatorNotes.id)).limit(1),
      db.select().from(alerts).where(eq(alerts.resolvedAt, "")).orderBy(desc(alerts.id)).limit(200),
      db.select().from(activity).orderBy(desc(activity.id)).limit(100),
      db.select({ id: reports.id, kind: reports.kind, title: reports.title, day: reports.day, shiftKey: reports.shiftKey, operators: reports.operators, createdAt: reports.createdAt }).from(reports).orderBy(desc(reports.id)).limit(300),
      db.select({ id: backups.id, label: backups.label, createdAt: backups.createdAt, sizeBytes: backups.sizeBytes }).from(backups).orderBy(desc(backups.id)).limit(20),
      db.select().from(problems).orderBy(desc(problems.id)).limit(100),
      db.select().from(motorServices).orderBy(desc(motorServices.id)).limit(80),
      db.select().from(meggerTests).orderBy(desc(meggerTests.id)).limit(80),
      db.select().from(oilChanges).orderBy(desc(oilChanges.id)).limit(80),
    ]);

  const [motorStateRows, serviceLogs, auditRows, pmT, pmR, queueRows, channelRows, shiftRows, monthlyTotals] = await Promise.all([
    db.select().from(motors).orderBy(motors.tag),
    db.select().from(equipmentReports).orderBy(desc(equipmentReports.id)).limit(120),
    db.select().from(valueAudits).orderBy(desc(valueAudits.id)).limit(60),
    db.select().from(pmTemplates).orderBy(pmTemplates.id),
    db.select().from(pmRecords).orderBy(desc(pmRecords.id)).limit(120),
    db.select().from(sendQueue).orderBy(desc(sendQueue.id)).limit(60),
    db.select().from(channels),
    db.select().from(shifts),
    db.select().from(dailyTotals).where(sql`${dailyTotals.day} like ${`${day.slice(0, 7)}/%`}`).orderBy(dailyTotals.day),
  ]);

  const process: ProcessView[] = PROCESS_PARAMS.map((p) => {
    const rows = processRows.filter((r) => r.tag === p.tag);
    const exact = rows.find((r) => r.intervalIndex === interval);
    const earlier = rows.filter((r) => r.intervalIndex < interval).sort((a, b) => b.intervalIndex - a.intervalIndex)[0];
    const value = exact?.value ?? earlier?.value ?? null;
    const t = thresholds[p.tag] ?? { warnMin: null, warnMax: null, critMin: null, critMax: null };
    return { tag: p.tag, label: p.label, unit: p.unit, value, ...t, out: thresholdSeverity(value, t) !== "ok" };
  });

  const intervals = INTERVALS.map((it, index) => {
    const tags = new Set(processRows.filter((r) => r.intervalIndex === index).map((r) => r.tag));
    return { index, label: it.label, filled: tags.size, total: PROCESS_PARAMS.length, current: index === op.intervalIndex };
  });

  const motorsView: MotorView[] = MOTORS.map((m) => {
    const stateRow = motorStateRows.find((r) => r.tag === m.tag);
    const vals = latestPerParam(motorRowsAll.filter((r) => r.tag === m.tag), interval);
    const values: Record<string, number | null> = {};
    for (const p of MOTOR_PARAMS) values[p.key] = vals[p.key] ?? null;
    const num = (keys: string[]) => keys.map((k) => values[k]).filter((v): v is number => typeof v === "number");
    const currents = num(["I1", "I2", "I3"]);
    const avgCurrent = currents.length ? currents.reduce((a, b) => a + b, 0) / currents.length : null;
    const temps = num(Array.from({ length: 10 }, (_, i) => `T${i + 1}`));
    const windingTemp = temps.length ? Math.max(...temps) : null;
    const bearings = num(["BRG-P-DE", "BRG-P-NDE"]);
    const bearingTemp = bearings.length ? Math.max(...bearings) : null;
    const vibs = num(["VIB-P-DE", "VIB-P-NDE", "VIB-M-DE", "VIB-M-NDE"]);
    const maxVibration = vibs.length ? Math.max(...vibs) : null;

    const motorAlerts: MotorView["alerts"] = [];
    let severity: Severity = "ok";
    const add = (param: string, label: string, value: number | null, warn: number, crit: number, unit: string) => {
      if (value === null) return;
      const sev: Severity = value > crit ? "critical" : value > warn ? "warning" : "ok";
      if (sev === "ok") return;
      if (severity === "ok" || sev === "critical") severity = sev;
      motorAlerts.push({ param, label, severity: sev, message: `${m.tag} / ${label} = ${value} ${unit} بالاتر از حد ${sev === "critical" ? "بحرانی" : "هشدار"} ${sev === "critical" ? crit : warn}` });
    };
    add("T", "دمای سیم‌پیچ", windingTemp, cfg.windingWarn, cfg.windingCrit, "°C");
    add("BRG", "دمای یاتاقان", bearingTemp, cfg.bearingWarn, cfg.bearingCrit, "°C");
    add("VIB", "لرزش", maxVibration, cfg.vibWarn, cfg.vibCrit, "mm/s");
    if (avgCurrent !== null && avgCurrent > 5) add("I", "جریان میانگین", Number(avgCurrent.toFixed(1)), cfg.currentWarn, cfg.currentCrit, "A");

    const totalHours = stateRow?.totalHours ?? 0;
    const lastServiceHours = stateRow?.lastServiceHours ?? 0;
    const hoursSinceService = Math.max(0, totalHours - lastServiceHours);
    const servicePct = Math.min(150, (hoursSinceService / (cfg.serviceInterval || 1)) * 100);
    const state = (stateRow?.state ?? "off") as MotorView["state"];
    const lastService = serviceRows.find((s) => s.tag === m.tag);
    if (state === "service" && severity === "ok") severity = "warning";

    return {
      tag: m.tag,
      pumpTag: m.pumpTag,
      state,
      stateFa: MOTOR_STATE_FA[state] ?? state,
      totalHours,
      lastServiceHours,
      hoursSinceService,
      servicePct: Number(servicePct.toFixed(1)),
      serviceInterval: cfg.serviceInterval,
      avgCurrent: avgCurrent === null ? null : Number(avgCurrent.toFixed(1)),
      windingTemp,
      bearingTemp,
      maxVibration,
      severity,
      alerts: motorAlerts,
      values,
      lastServiceDay: lastService?.day ?? "—",
      lastServiceWorkers: lastService?.workers ?? "—",
      lastMeggerDay: meggerRows.find((x) => x.tag === m.tag)?.day ?? "—",
      lastOilDay: oilRows.find((x) => x.tag === m.tag)?.day ?? "—",
    };
  });

  const roster = ["A", "B", "C", "admin"]
    .map((k) => shiftRows.find((s) => s.key === k))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({ key: s.key, label: s.label, members: s.members ?? [], role: s.role }));

  const [rcRows, acRows, scRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(processReadings),
    db.select({ count: sql<number>`count(*)::int` }).from(alerts),
    db.select({ count: sql<number>`count(*)::int` }).from(motorServices),
  ]);
  const readingCount = rcRows[0]?.count ?? 0;
  const alertCount = acRows[0]?.count ?? 0;
  const serviceCount = scRows[0]?.count ?? 0;

  return {
    me: input.who,
    now: { day, weekday: op.weekday, monthLabel: op.monthLabel, time: op.time, intervalLabel: INTERVALS[interval].label, intervalIndex: interval },
    shift,
    motors: motorsView,
    process,
    total: totalsRow[0]?.value ?? null,
    intervals,
    equipment: equipmentRows.map((e) => ({
      id: e.id,
      tag: e.tag,
      name: e.name,
      category: e.category,
      spec: e.spec,
      plate: e.plate,
      partNumbers: e.partNumbers,
      location: e.location,
      status: e.status,
      statusFa: STATUS_FA[e.status] ?? e.status,
      isAux: e.isAux,
      isMotor: e.isMotor,
      safetyCritical: e.safetyCritical,
      description: e.description,
      descriptionAt: e.descriptionAt,
      descriptionBy: e.descriptionBy,
    })),
    alerts: alertRows.map((a) => ({ ...a, severity: (a.severity as Severity) ?? "warning" })),
    serviceLogs,
    activity: logRows,
    reports: reportRows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, day: r.day, shiftKey: r.shiftKey, operators: r.operators, createdAt: r.createdAt })),
    backups: backupRows.map((b) => ({ id: b.id, label: b.label, createdAt: b.createdAt, sizeBytes: b.sizeBytes })),
    problems: problemRows.map((p) => ({ id: p.id, at: p.at, shiftKey: p.shiftKey, text: p.text })),
    note: noteRow[0]?.text ?? "",
    settings: cfg,
    motorServices: serviceRows.map((s) => ({ ...s, brush: s.brush ?? {} })),
    meggers: meggerRows,
    oils: oilRows,
    pmTemplates: pmT.map((t) => ({ id: t.id, category: t.category, name: t.name, items: t.items ?? [] })),
    pmRecords: pmR.map((r) => ({ ...r, results: r.results ?? {} })),
    queue: queueRows,
    channels: channelRows.map((c) => ({ key: c.key, provider: c.provider, chatId: c.chatId, hasToken: Boolean(c.token), enabled: c.enabled })),
    monthlyTotals: monthlyTotals.map((t) => ({ day: t.day, value: t.value })),
    roster,
    counts: { equipment: equipmentRows.length, readings: readingCount, alerts: alertCount, services: serviceCount },
    audits: auditRows,
  };
}

export async function logActivity(shiftKey: string, action: string, detail = "", d: typeof db = db) {
  // دفتر فعالیت با زنجیرهٔ هش ثبت می‌شود (تشخیص دست‌کاری)
  await appendActivity(d, shiftKey, action, detail);
}
