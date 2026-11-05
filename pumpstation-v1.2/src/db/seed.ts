import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  shifts,
  settings,
  equipment,
  motors,
  processReadings,
  dailyTotals,
  motorReadings,
  operatorNotes,
  alerts,
  pmTemplates,
  channels,
} from "@/db/schema";
import {
  DEFAULT_SETTINGS,
  MOTORS,
  MOTOR_PARAMS,
  PROCESS_PARAMS,
  EQUIPMENT_SEED,
  AUX_TAGS,
  SAFETY_TAGS,
  PM_TEMPLATE_SEED,
  type Settings,
} from "@/lib/domain";
import { resolveRoster } from "@/lib/roster";
import { jelaliSeedDays, padSeedValue } from "@/lib/seed-helpers";
import { jalaliNow, operationalDay } from "@/lib/jalali";
import { hashPin } from "@/lib/pin";

export async function getAllSettings(): Promise<Settings> {
  const rows = await db.select().from(settings);
  const stored: Record<string, unknown> = {};
  for (const row of rows) stored[row.key] = row.value;
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) } as Settings;
}

export async function saveSettings(next: Partial<Settings>) {
  const merged = { ...(await getAllSettings()), ...next };
  for (const [key, value] of Object.entries(merged)) {
    if (value === null || value === undefined) continue;
    await db
      .insert(settings)
      .values({ key, value: value as never })
      .onConflictDoUpdate({ target: settings.key, set: { value: value as never } });
  }
  return merged;
}

let seedPromise: Promise<void> | null = null;

export function ensureSeed() {
  if (!seedPromise) seedPromise = runSeed().catch((error) => {
    seedPromise = null;
    throw error;
  });
  return seedPromise;
}

async function runSeed() {
  const flag = await db
    .select()
    .from(settings)
    .where(sql`${settings.key} = 'seeded'`)
    .limit(1);
  if (flag.length > 0) return;

  const now = jalaliNow();
  const op = operationalDay();
  const hour = op.hour;

  // روستر از فایل محلی (واقعی) یا نمونهٔ ساختگی خوانده می‌شود؛ نام و PIN واقعی در کد نیست
  const { roster, source } = resolveRoster();
  console.log(`[seed] shifts roster source: ${source}`);
  await db.insert(shifts).values(
    roster.map((s) => ({
      key: s.key,
      label: s.label,
      role: s.role,
      pin: hashPin(s.pin),
      members: s.members,
    })),
  );

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (value === null || value === undefined) continue;
    await db.insert(settings).values({ key, value: value as never });
  }

  await db.insert(equipment).values(
    EQUIPMENT_SEED.map((e) => ({
      tag: e.tag,
      name: e.name,
      category: e.category,
      spec: e.spec ?? "",
      location: e.location ?? "",
      status: e.status ?? "ready",
      isAux: Boolean(e.isAux),
      isMotor: Boolean(e.isMotor),
      safetyCritical: Boolean(e.safetyCritical),
      description: "",
      descriptionAt: "",
      descriptionBy: "",
      updatedAt: now,
    })),
  );

  await db.insert(pmTemplates).values(PM_TEMPLATE_SEED.map((t) => ({ ...t, updatedAt: now })));
  await db.insert(channels).values([
    { key: "daily", provider: "bale", chatId: "", token: "", enabled: false },
    { key: "backup", provider: "bale", chatId: "", token: "", enabled: false },
  ]);

  const profiles = [
    { state: "on", total: 18220, last: 17850, bearing: 62.4, winding: 68.2, current: 101.2 },
    { state: "on", total: 16480, last: 15580, bearing: 68.9, winding: 74.1, current: 99.4 },
    { state: "on", total: 17502, last: 16102, bearing: 74.8, winding: 87.3, current: 108.9 },
    { state: "on", total: 11360, last: 10900, bearing: 64.1, winding: 71.6, current: 96.8 },
    { state: "off", total: 9210, last: 8500, bearing: 41.2, winding: 44.8, current: 0 },
    { state: "off", total: 8740, last: 8300, bearing: 39.8, winding: 43.2, current: 0 },
    { state: "on", total: 14870, last: 14080, bearing: 66.3, winding: 72.4, current: 103.1 },
    { state: "service", total: 15210, last: 14900, bearing: 48.2, winding: 51.4, current: 0 },
  ];

  await db.insert(motors).values(
    MOTORS.map((m, i) => ({
      tag: m.tag,
      pumpTag: m.pumpTag,
      state: profiles[i].state,
      totalHours: profiles[i].total,
      lastServiceHours: profiles[i].last,
      stateChangedAt: now,
    })),
  );

  // ---- نمونه داده‌های چند روز اخیر برای نمودارها ----
  const days = await jelaliSeedDays();
  const processRows: (typeof processReadings.$inferInsert)[] = [];
  const totalRows: (typeof dailyTotals.$inferInsert)[] = [];
  const motorRows: (typeof motorReadings.$inferInsert)[] = [];

  days.forEach((day, di) => {
    PROCESS_PARAMS.forEach((p, pi) => {
      const base =
        p.tag === "PIT-002" ? 20.6 : p.tag === "FIT-001" ? 412 : p.tag === "LT-01" || p.tag === "LT-02" ? 168 : p.tag === "PIT-001" ? 3.4 : 3.8;
      for (let interval = 0; interval < 6; interval += 1) {
        if (di === days.length - 1 && interval > op.intervalIndex) continue;
        if ((di + interval + pi) % 5 === 0 && interval !== op.intervalIndex) continue;
        const noise = (Math.sin((di + 1) * (interval + 2) * 1.7 + pi) + Math.cos(di * 0.9 + pi)) * (base * 0.018);
        processRows.push({
          day,
          intervalIndex: interval,
          tag: p.tag,
          value: Number(padSeedValue(base + noise, 2)),
          shiftKey: ["A", "B", "C"][di % 3],
          recordedAt: `${day} ${String(7 + interval * 4).padStart(2, "0")}:05:00`,
          updatedAt: now,
        });
      }
    });
    totalRows.push({
      day,
      value: Number((16800 + di * 190 + Math.sin(di) * 90).toFixed(0)),
      shiftKey: ["A", "B", "C"][di % 3],
      recordedAt: `${day} 06:40:00`,
      updatedAt: now,
    });
  });

  MOTORS.forEach((m, mi) => {
    const p = profiles[mi];
    const params: Record<string, number> = {
      I1: p.current + 1.8,
      I2: p.current - 1.2,
      I3: p.current + 0.4,
      "BRG-P-DE": p.bearing,
      "BRG-P-NDE": p.bearing - 1.6,
      "VIB-P-DE": mi === 2 ? 7.8 : mi === 1 ? 5.2 : 2.4,
      "VIB-P-NDE": mi === 2 ? 6.9 : 2.1,
      "VIB-M-DE": mi === 2 ? 5.4 : 1.9,
      "VIB-M-NDE": mi === 2 ? 4.9 : 1.7,
    };
    for (let t = 1; t <= 10; t += 1) {
      params[`T${t}`] = p.winding - (t > 8 ? 4 : t * 0.8) + (t === 10 ? 0 : 1);
    }
    for (const day of days.slice(-3)) {
      for (let interval = 0; interval < 6; interval += 1) {
        if ((mi + interval) % 3 === 0 && interval !== op.intervalIndex) continue;
        for (const param of MOTOR_PARAMS) {
          const val = params[param.key];
          if (val === undefined) continue;
          const drift = Math.sin((mi + interval) * 1.3) * (param.type === "vib" ? 0.25 : 1.1);
          motorRows.push({
            tag: m.tag,
            day,
            intervalIndex: interval,
            param: param.key,
            value: Number((val + drift).toFixed(2)),
            shiftKey: ["A", "B", "C"][interval % 3],
            recordedAt: `${day} ${String(7 + interval * 4).padStart(2, "0")}:12:00`,
            updatedAt: now,
          });
        }
      }
    }
  });

  if (processRows.length) await db.insert(processReadings).values(processRows);
  if (totalRows.length) await db.insert(dailyTotals).values(totalRows);
  if (motorRows.length) await db.insert(motorReadings).values(motorRows);

  await db.insert(operatorNotes).values({
    day: op.day,
    shiftKey: "A",
    text:
      "تیغه‌های صافی خط مکش تمیز شد. سطح روغن یاتاقان پمپ P-05 بررسی و تأیید شد. " +
      "درخواست بازدید فنی از لرزش غیرعادی پمپ P-03 ثبت گردید.",
    updatedAt: now,
  });

  await db.insert(alerts).values([
    {
      at: now,
      day: op.day,
      tag: "M-03",
      param: "T10",
      label: "دمای بدنه",
      value: 87.3,
      severity: "critical",
      message: "M-03 / دمای بدنه = ۸۷.۳ °C — بالاتر از حد بحرانی ۸۰ °C",
      shiftKey: "A",
      seenAt: "",
      actedAt: "",
    },
    {
      at: now,
      day: op.day,
      tag: "M-03",
      param: "VIB-P-DE",
      label: "لرزش پمپ جلو",
      value: 7.8,
      severity: "critical",
      message: "M-03 / لرزش پمپ جلو = ۷.۸ mm/s — بالاتر از حد بحرانی ۷.۱",
      shiftKey: "A",
      seenAt: "",
      actedAt: "",
    },
    {
      at: now,
      day: op.day,
      tag: "M-02",
      param: "VIB-P-DE",
      label: "لرزش پمپ جلو",
      value: 5.2,
      severity: "warning",
      message: "M-02 / لرزش پمپ جلو = ۵.۲ mm/s — بالاتر از حد هشدار ۴.۵",
      shiftKey: "A",
      seenAt: "",
      actedAt: "",
    },
  ]);

  void hour;
  await db.insert(settings).values({ key: "seeded", value: true as never });
  void AUX_TAGS;
  void SAFETY_TAGS;
}
