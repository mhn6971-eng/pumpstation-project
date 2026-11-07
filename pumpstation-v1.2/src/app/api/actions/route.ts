import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { AppError, badRequest, errorResponse, forbidden } from "@/lib/errors";
import {
  shifts,
  settings,
  equipment,
  motors,
  processReadings,
  dailyTotals,
  motorReadings,
  motorStateLogs,
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
  sessions as sessionsTable,
  appEvents,
  idempotencyKeys,
} from "@/db/schema";
import { getSessionId, getSessionUser, revokeSessions } from "@/lib/auth";
import { cleanupSessions, listSessions, revokeAllSessions, revokeSession } from "@/lib/sessions";
import { verifyActivityChain } from "@/lib/audit";
import { archiveOlderThan, archiveStats, pruneArchives } from "@/lib/archive";
import { recordEvent } from "@/lib/log";
import { hashPin, verifyPin } from "@/lib/pin";
import { generateBackupCode, generateTotpSecret, normalizeBackupCode, otpauthUrl, verifyTotp } from "@/lib/totp";
import { ensureSeed, getAllSettings, saveSettings } from "@/db/seed";
import { ensureMirrorFresh, mirrorLatest, mirrorStatus } from "@/lib/mirror";
import { createInternalBackup, ensureDailyFileBackup, listFileBackups, restoreAll, restoreFromFile, verifyFileBackup, writeFileBackup, type Snapshot } from "@/lib/backup";
import { listBackupBundles, restoreBackupBundle, verifyBackupBundle, writeBackupBundle } from "@/lib/backup-bundle";
import { bodyTooLarge, clearLoginLock, logSecurityEvent, rateLimitedResponse, tooLargeResponse, writeRateLimited } from "@/lib/security";
import { effectiveShift, getProcessThresholds, logActivity, thresholdSeverity } from "@/lib/state";
import { buildOperationalPayload, buildRegistryPayload, buildTrendPayload, createReport, latestMotorRecords, normalizeRange, REPORT_KINDS } from "@/lib/reporting";
import { addDaysToDay, isValidJalaliDay, jalaliNow, operationalDay } from "@/lib/jalali";
import { sendBotDocument, sendBotText } from "@/lib/bot";
import { zipStored } from "@/lib/zip";
import { CATEGORIES, MOTORS, MOTOR_PARAMS, MOTOR_TYPE_LIMITS, MOTOR_STATE_FA, PROCESS_LIMITS, PROCESS_PARAMS, TOTAL_LIMITS, limitError, type Settings } from "@/lib/domain";

export const dynamic = "force-dynamic";

type Payload = Record<string, unknown>;

function num(value: unknown): number {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    throw badRequest("مقدار عددی لازم است");
  }
  const n = typeof value === "string" ? Number(value.replace(/,/g, "").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))) : Number(value);
  if (!Number.isFinite(n)) throw badRequest("مقدار عددی معتبر وارد کنید");
  if (Math.abs(n) > 10_000_000) throw badRequest("مقدار خارج از محدودهٔ منطقی است");
  return n;
}
function optNum(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  return num(value);
}
function str(value: unknown, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}
/** اعتبارسنجی محدودهٔ فیزیکی مقدار (H4) */
function inRange(value: number, limits: [number, number], label: string, unit: string) {
  if (value < limits[0] || value > limits[1]) throw badRequest(limitError(label, unit, limits[0], limits[1]).message);
  return value;
}

type Db = typeof db;
/** اجرای اتمیک چند نوشتن پشت‌سرهم (C5) — اگر یکی شکست بخورد هیچ‌کدام اعمال نمی‌شود */
async function runTx<T>(fn: (d: Db) => Promise<T>): Promise<T> {
  return (await db.transaction(async (tx) => fn(tx as unknown as Db))) as T;
}

/**
 * ثبت هشدار با ضدسیل (H3): برای هر (تگ، پارامتر، روز) فقط یک هشدار «باز» نگه داشته می‌شود
 * و ثبت‌های بعدی همان هشدار را به‌روز می‌کنند، نه ردیف تازه.
 */
async function addAlert(input: { tag: string; param: string; label: string; value: number; severity: "warning" | "critical"; message: string; day: string; shiftKey: string }, d: Db = db) {
  await d
    .insert(alerts)
    .values({ ...input, at: jalaliNow(), seenAt: "", actedAt: "", seenShift: "", actedShift: "", resolvedAt: "" })
    .onConflictDoUpdate({
      target: [alerts.tag, alerts.param, alerts.day],
      targetWhere: sql`${alerts.actedAt} = '' AND ${alerts.resolvedAt} = ''`,
      set: {
        value: sql`excluded.value`,
        severity: sql`excluded.severity`,
        message: sql`excluded.message`,
        at: sql`excluded.at`,
        shiftKey: sql`excluded.shift_key`,
      },
    });
}

/** وقتی مقدار به محدودهٔ مجاز برگشت، هشدارهای باز همان پارامتر بسته می‌شوند */
async function resolveAlerts(tag: string, param: string, day: string, d: Db = db) {
  const open = await d.select().from(alerts).where(and(eq(alerts.tag, tag), eq(alerts.param, param), eq(alerts.day, day), eq(alerts.actedAt, ""), eq(alerts.resolvedAt, "")));
  for (const row of open) {
    await d.update(alerts).set({ resolvedAt: jalaliNow() }).where(eq(alerts.id, row.id));
  }
}

async function audit(shiftKey: string, scope: string, tag: string, param: string, oldValue: unknown, newValue: unknown, d: Db = db) {
  await d.insert(valueAudits).values({ at: jalaliNow(), shiftKey, scope, tag, param, oldValue: String(oldValue), newValue: String(newValue) });
}

async function trySend(reportId: number, channelKey: string, shiftKey: string) {
  const ch = (await db.select().from(channels).where(eq(channels.key, channelKey)).limit(1))[0];
  const report = (await db.select().from(reports).where(eq(reports.id, reportId)).limit(1))[0];
  const q = await db.insert(sendQueue).values({ reportId, channelKey, status: "pending", attempts: 0, lastError: "", createdAt: jalaliNow(), sentAt: "", shiftKey }).returning({ id: sendQueue.id });
  const qid = q[0].id;
  if (!ch || !ch.enabled || !ch.token || !ch.chatId) {
    await db.update(sendQueue).set({ lastError: "کانال ارسال هنوز توسط ادمین تنظیم نشده است؛ گزارش در صف ماند" }).where(eq(sendQueue.id, qid));
    return { queued: true, sent: false, message: "گزارش بایگانی و در صف ارسال قرار گرفت (کانال هنوز تنظیم نشده)" };
  }
  try {
    const text = `${report?.title ?? "گزارش"}\n${report?.operators ?? ""}\nزمان: ${jalaliNow()}\nسامانه پایش ایستگاه پمپاژ زیرزمینی — تونل انتقال آب گلاب`;
    await sendBotText({ provider: ch.provider === "eitaa" ? "eitaa" : "bale", token: ch.token, chatId: ch.chatId, text });
    await db.update(sendQueue).set({ status: "sent", attempts: 1, sentAt: jalaliNow() }).where(eq(sendQueue.id, qid));
    return { queued: true, sent: true, message: "گزارش ارسال شد" };
  } catch (error) {
    await db.update(sendQueue).set({ attempts: 1, lastError: error instanceof Error ? error.message : "خطای شبکه" }).where(eq(sendQueue.id, qid));
    return { queued: true, sent: false, message: "شبکه در دسترس نیست؛ گزارش در صف ماند و بعداً ارسال می‌شود" };
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "ابتدا وارد سامانه شوید" }, { status: 401 });
  await ensureSeed();

  // محدودیت نرخ نوشتن (H2)
  if (writeRateLimited(user.key)) {
    await logSecurityEvent("rate_limited", user.key, "local", "نوشتن بیش از حد مجاز");
    return rateLimitedResponse();
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return Response.json({ ok: false, error: "درخواست نامعتبر" }, { status: 400 });
  }
  if (bodyTooLarge(request, raw.length)) return tooLargeResponse();

  let body: { action?: string; payload?: Payload };
  try {
    body = JSON.parse(raw) as { action?: string; payload?: Payload };
  } catch {
    return Response.json({ ok: false, error: "درخواست نامعتبر" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const p: Payload = body.payload ?? {};
  const isAdmin = user.role === "admin";
  const shift = isAdmin ? await effectiveShift() : { key: user.key, label: user.label, members: user.members };
  const shiftKey = user.key;
  const op = operationalDay();
  void ensureDailyFileBackup().catch(() => {});
  void ensureMirrorFresh().catch(() => {});
  // تاریخ نامعتبر رد می‌شود، نه این‌که بی‌صدا امروز فرض شود (H4)
  let day = op.day;
  if (typeof p.day === "string" && p.day.trim()) {
    const candidate = p.day.trim();
    if (!isValidJalaliDay(candidate)) return Response.json({ ok: false, error: "تاریخ شمسی نامعتبر است (مثال درست: ۱۴۰۵/۰۸/۱۳)" }, { status: 400 });
    if (candidate > op.day) return Response.json({ ok: false, error: "ثبت داده برای تاریخ آینده مجاز نیست" }, { status: 400 });
    day = candidate;
  }
  // بازهٔ نامعتبر بی‌صدا به بازهٔ جاری تبدیل نمی‌شود (M1)
  let interval = op.intervalIndex;
  if (p.intervalIndex !== undefined && p.intervalIndex !== null && p.intervalIndex !== "") {
    const candidate = Number(p.intervalIndex);
    if (!Number.isInteger(candidate) || candidate < 0 || candidate > 5) {
      return Response.json({ ok: false, error: "بازهٔ زمانی نامعتبر است" }, { status: 400 });
    }
    interval = candidate;
  }
  const requireAdmin = () => {
    if (!isAdmin) throw forbidden("دسترسی ادمین لازم است");
  };

  // ضدثبتِ تکراری: اگر همین درخواست قبلاً با موفقیت انجام شده، همان پاسخ برگردانده می‌شود
  const idemRaw = (request.headers.get("idempotency-key") ?? "").trim().slice(0, 80);
  const idemKey = idemRaw ? `${shiftKey}:${idemRaw}` : "";
  if (idemKey) {
    const prior = (await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, idemKey)).limit(1))[0];
    if (prior?.response) {
      return Response.json(prior.response, { headers: { "idempotent-replay": "1", "cache-control": "no-store" } });
    }
  }

  try {
    const response = await (async (): Promise<Response> => {
      switch (action) {
      case "process.set": {
        const tag = str(p.tag, 20);
        const meta = PROCESS_PARAMS.find((x) => x.tag === tag);
        if (!meta) throw badRequest("پارامتر نامعتبر است");
        const value = num(p.value);
        inRange(value, PROCESS_LIMITS[tag] ?? [-1e9, 1e9], meta.label, meta.unit);
        const thresholds = await getProcessThresholds();
        const severity = thresholdSeverity(value, thresholds[tag]);
        await runTx(async (d) => {
          const existing = (await d.select().from(processReadings).where(and(eq(processReadings.day, day), eq(processReadings.intervalIndex, interval), eq(processReadings.tag, tag))).limit(1))[0];
          if (existing) {
            await audit(shiftKey, "process", tag, tag, existing.value, value, d);
            await d.update(processReadings).set({ value, updatedAt: jalaliNow(), shiftKey }).where(eq(processReadings.id, existing.id));
          } else {
            await d.insert(processReadings).values({ day, intervalIndex: interval, tag, value, shiftKey, recordedAt: jalaliNow(), updatedAt: jalaliNow() }).onConflictDoNothing();
          }
          if (severity !== "ok") {
            await addAlert({ tag, param: tag, label: meta.label, value, severity, message: `${tag} / ${meta.label} = ${value} ${meta.unit} — خارج از ${severity === "critical" ? "حد بحرانی" : "حد هشدار"}`, day, shiftKey }, d);
          } else {
            await resolveAlerts(tag, tag, day, d);
          }
          await logActivity(shiftKey, "ثبت پارامتر فرآیندی", `${tag} = ${value} — ${day} بازه ${interval + 1}`, d);
        });
        return Response.json({ ok: true });
      }

      case "total.set": {
        const value = num(p.value);
        inRange(value, TOTAL_LIMITS, "توتال روزانه", "m³");
        await runTx(async (d) => {
          // PostgreSQL permits concurrent transactions to both observe an empty day;
          // serialize this day before the read/insert to avoid a unique(day) race.
          await d.execute(sql`select pg_advisory_xact_lock(hashtext(${`daily-total:${day}`}))`);
          const existing = (await d.select().from(dailyTotals).where(eq(dailyTotals.day, day)).limit(1))[0];
          if (existing) {
            await audit(shiftKey, "total", "TOTAL-FIT", "total", existing.value, value, d);
            await d.update(dailyTotals).set({ value, updatedAt: jalaliNow(), shiftKey }).where(eq(dailyTotals.id, existing.id));
          } else {
            await d.insert(dailyTotals).values({ day, value, shiftKey, recordedAt: jalaliNow(), updatedAt: jalaliNow() });
          }
          await logActivity(shiftKey, "ثبت توتال روزانه", `${day} = ${value} m³`, d);
        });
        return Response.json({ ok: true });
      }

      case "motor.values": {
        const tag = str(p.tag, 10);
        if (!MOTORS.some((m) => m.tag === tag)) throw badRequest("موتور نامعتبر است");
        const values = (p.values ?? {}) as Record<string, unknown>;
        const cfg = await getAllSettings();
        let saved = 0;
        await runTx(async (d) => {
          for (const [param, raw] of Object.entries(values)) {
            const meta = MOTOR_PARAMS.find((x) => x.key === param);
            if (!meta || raw === "" || raw === null || raw === undefined) continue;
            const value = num(raw);
            // محدودهٔ فیزیکی بر اساس نوع پارامتر (جریان/دما/یاتاقان/لرزش)
            inRange(value, MOTOR_TYPE_LIMITS[meta.type] ?? [-1e9, 1e9], `${tag} / ${meta.label}`, meta.unit);
            const existing = (await d.select().from(motorReadings).where(and(eq(motorReadings.tag, tag), eq(motorReadings.day, day), eq(motorReadings.intervalIndex, interval), eq(motorReadings.param, param))).limit(1))[0];
            if (existing) {
              await audit(shiftKey, "motor", tag, param, existing.value, value, d);
              await d.update(motorReadings).set({ value, updatedAt: jalaliNow(), shiftKey }).where(eq(motorReadings.id, existing.id));
            } else {
              await d.insert(motorReadings).values({ tag, day, intervalIndex: interval, param, value, shiftKey, recordedAt: jalaliNow(), updatedAt: jalaliNow() }).onConflictDoNothing();
            }
            saved += 1;
            const limit =
              meta.type === "vib" ? { warn: cfg.vibWarn, crit: cfg.vibCrit, label: `لرزش ${meta.label}`, unit: "mm/s" }
              : meta.type === "bearing" ? { warn: cfg.bearingWarn, crit: cfg.bearingCrit, label: `دمای ${meta.label}`, unit: "°C" }
              : meta.type === "temp" ? { warn: cfg.windingWarn, crit: cfg.windingCrit, label: `دمای سیم‌پیچ ${meta.key}`, unit: "°C" }
              : { warn: cfg.currentWarn, crit: cfg.currentCrit, label: `جریان ${meta.label}`, unit: "A" };
            const severity = value > limit.crit ? "critical" : value > limit.warn ? "warning" : "ok";
            if (severity !== "ok") {
              await addAlert({ tag, param, label: limit.label, value, severity, message: `${tag} / ${limit.label} = ${value} ${limit.unit} — بالاتر از حد ${severity === "critical" ? "بحرانی" : "هشدار"}`, day, shiftKey }, d);
            } else {
              await resolveAlerts(tag, param, day, d);
            }
          }
          if (!saved) throw badRequest("هیچ مقداری برای ثبت وارد نشده است");
          await logActivity(shiftKey, "ثبت داده موتور", `${tag} — ${saved} پارامتر — ${day} بازه ${interval + 1}`, d);
        });
        return Response.json({ ok: true, message: `${saved} مقدار ثبت شد` });
      }

      case "motor.state": {
        const tag = str(p.tag, 10);
        const state = str(p.state, 10);
        if (!["on", "off", "service"].includes(state)) throw badRequest("وضعیت نامعتبر است");
        const row = (await db.select().from(motors).where(eq(motors.tag, tag)).limit(1))[0];
        if (!row) throw badRequest("موتور پیدا نشد");
        await db.update(motors).set({ state, stateChangedAt: jalaliNow() }).where(eq(motors.tag, tag));
        await db.insert(motorStateLogs).values({ tag, fromState: row.state, toState: state, at: jalaliNow(), shiftKey });
        await db.update(equipment).set({ status: state === "service" ? "in_service" : "ready", updatedAt: jalaliNow() }).where(eq(equipment.tag, tag));
        const reason = str(p.reason, 500);
        if (state === "service" && reason) {
          await db.insert(equipmentReports).values({ tag, kind: "service", reason, operator: shift.label, shiftKey, at: jalaliNow() });
          await db.update(equipment).set({ description: reason, descriptionAt: jalaliNow(), descriptionBy: shift.label }).where(eq(equipment.tag, tag));
        }
        await logActivity(shiftKey, "تغییر وضعیت موتور", `${tag}: ${MOTOR_STATE_FA[row.state]} ← ${MOTOR_STATE_FA[state]}`);
        return Response.json({ ok: true });
      }

      case "motor.hours": {
        const tag = str(p.tag, 10);
        const hours = num(p.hours);
        const row = (await db.select().from(motors).where(eq(motors.tag, tag)).limit(1))[0];
        if (!row) throw badRequest("موتور پیدا نشد");
        if (hours < row.totalHours && !isAdmin) throw forbidden("شمارنده کمتر از مقدار قبلی است؛ اصلاح فقط توسط ادمین با ذکر دلیل");
        if (hours < row.totalHours && !str(p.reason)) throw badRequest("برای اصلاح شمارنده، دلیل را بنویسید");
        await audit(shiftKey, "hours", tag, "HMI", row.totalHours, hours);
        await db.update(motors).set({ totalHours: hours }).where(eq(motors.tag, tag));
        await logActivity(shiftKey, hours < row.totalHours ? "اصلاح شمارنده HMI (ادمین)" : "ثبت شمارنده HMI", `${tag}: ${row.totalHours} ← ${hours} ${str(p.reason)}`);
        return Response.json({ ok: true });
      }

      case "motor.service": {
        const tag = str(p.tag, 10);
        const row = (await db.select().from(motors).where(eq(motors.tag, tag)).limit(1))[0];
        if (!row) throw badRequest("موتور پیدا نشد");
        const hours = p.hours === undefined || p.hours === "" ? row.totalHours : num(p.hours);
        const workers = "";
        const note = str(p.note, 1500);
        const brushRaw = (p.brush ?? {}) as Record<string, unknown>;
        const brush: Record<string, number> = {};
        for (const ph of ["U", "V", "W"]) for (let i = 1; i <= 8; i += 1) {
          const v = optNum(brushRaw[`${ph}${i}`]);
          if (v !== null) brush[`${ph}${i}`] = v;
        }
        const rid = await runTx(async (d) => {
          const sid = (await d.insert(motorServices).values({ tag, day, hours, workers, note, brush, at: jalaliNow(), shiftKey, shiftLabel: shift.label }).returning({ id: motorServices.id }))[0].id;
          await d.update(motors).set({ totalHours: Math.max(hours, row.totalHours), lastServiceHours: hours, state: "off", stateChangedAt: jalaliNow() }).where(eq(motors.tag, tag));
          await d.insert(motorStateLogs).values({ tag, fromState: row.state, toState: "off", at: jalaliNow(), shiftKey });
          await d.insert(equipmentReports).values({ tag, kind: "motor_service", reason: `سرویس ماهانه — ساعت ${hours}${note ? ` — ${note}` : ""}`, operator: workers || shift.label, shiftKey, at: jalaliNow() });
          await d.update(equipment).set({ description: `سرویس ماهانه انجام شد (ساعت ${hours})${note ? ` — ${note}` : ""}`, descriptionAt: jalaliNow(), descriptionBy: workers || shift.label, status: "ready", updatedAt: jalaliNow() }).where(eq(equipment.tag, tag));
          const latest = await latestMotorRecords(tag, d);
          const reportId = await createReport({ kind: "motor_service", day, shift, title: `سرویس موتور ${tag} — ${day}`, payload: { serviceId: sid, tag, pumpTag: row.pumpTag, day, hours, shiftLabel: `${shift.label} — ${shift.members.join(" و ")}`, note, brush, megger: latest.megger, oil: latest.oil, generatedAt: jalaliNow() } }, d);
          await logActivity(shiftKey, "ثبت سرویس موتور", `${tag} — ساعت ${hours}`, d);
          return reportId;
        });
        return Response.json({ ok: true, id: rid, message: "سرویس ثبت و گزارش آن ساخته شد" });
      }

      case "motor.megger": {
        const tag = str(p.tag, 10);
        if (!MOTORS.some((m) => m.tag === tag)) throw badRequest("موتور نامعتبر است");
        const testVoltage = Number(p.testVoltage ?? 1000);
        if (![500, 1000, 2500, 5000].includes(testVoltage)) throw badRequest("ولتاژ تست نامعتبر است");
        const testVoltageRotor = p.testVoltageRotor === undefined || p.testVoltageRotor === "" || p.testVoltageRotor === null ? testVoltage : Number(p.testVoltageRotor);
        if (![500, 1000, 2500, 5000].includes(testVoltageRotor)) throw badRequest("ولتاژ تست رتور نامعتبر است");
        const unit = p.unit === "GΩ" ? "GΩ" : "MΩ";
        const rec = {
          tag, day, testVoltage, testVoltageRotor, unit,
          statorU: optNum(p.statorU), statorV: optNum(p.statorV), statorW: optNum(p.statorW),
          rotorU: optNum(p.rotorU), rotorV: optNum(p.rotorV), rotorW: optNum(p.rotorW),
          windingTemp: optNum(p.windingTemp), pi: optNum(p.pi),
          piStatorU: optNum(p.piStatorU), piStatorV: optNum(p.piStatorV), piStatorW: optNum(p.piStatorW), piRotor: optNum(p.piRotor),
          workers: "", note: str(p.note, 1000), at: jalaliNow(), shiftKey,
        };
        if ([rec.statorU, rec.statorV, rec.statorW, rec.rotorU, rec.rotorV, rec.rotorW, rec.windingTemp, rec.pi, rec.piStatorU, rec.piStatorV, rec.piStatorW, rec.piRotor].every((v) => v === null)) throw badRequest("حداقل یک مقدار تست را وارد کنید");
        const id = (await db.insert(meggerTests).values(rec).returning({ id: meggerTests.id }))[0].id;
        const rid = await createReport({ kind: "megger", day, shift, title: `تست مگر ${tag} — ${day}`, payload: { ...rec, meggerId: id, shiftLabel: `${shift.label} — ${shift.members.join(" و ")}`, generatedAt: jalaliNow() } });
        await logActivity(shiftKey, "ثبت تست مگر", `${tag} — ${testVoltage}/${testVoltageRotor} V`);
        return Response.json({ ok: true, id: rid });
      }

      case "motor.oil": {
        const tag = str(p.tag, 10);
        if (!MOTORS.some((m) => m.tag === tag)) throw badRequest("موتور نامعتبر است");
        const rec = { tag, day, hours: optNum(p.hours) ?? 0, note: str(p.note, 1000), at: jalaliNow(), shiftKey };
        await db.insert(oilChanges).values(rec);
        const rid = await createReport({ kind: "oil", day, shift, title: `تعویض روغن ${tag} — ${day}`, payload: { ...rec, generatedAt: jalaliNow() } });
        await logActivity(shiftKey, "ثبت تعویض روغن", `${tag} — ساعت ${rec.hours}`);
        return Response.json({ ok: true, id: rid });
      }

      case "equipment.status": {
        const tag = str(p.tag, 40);
        const status = str(p.status, 20);
        const reason = str(p.reason, 1500);
        if (!["ready", "in_service"].includes(status)) throw badRequest("وضعیت نامعتبر است");
        const row = (await db.select().from(equipment).where(eq(equipment.tag, tag)).limit(1))[0];
        if (!row) throw badRequest("تجهیز پیدا نشد");
        if (status === "in_service" && reason.length < 3) throw badRequest("برای «در حال سرویس» توضیحات/دلیل سرویس را بنویسید");
        await runTx(async (d) => {
          await d.update(equipment).set({ status, description: reason || row.description, descriptionAt: reason ? jalaliNow() : row.descriptionAt, descriptionBy: reason ? shift.label : row.descriptionBy, updatedAt: jalaliNow() }).where(eq(equipment.tag, tag));
          await d.insert(equipmentReports).values({ tag, kind: status === "in_service" ? "service" : "ready", reason: reason || "بازگشت به آماده به کار", operator: shift.label, shiftKey, at: jalaliNow() });
          if (row.isMotor) {
            await d.update(motors).set({ state: status === "in_service" ? "service" : "off", stateChangedAt: jalaliNow() }).where(eq(motors.tag, tag));
          }
          await logActivity(shiftKey, status === "in_service" ? "تجهیز به حال سرویس رفت" : "تجهیز آماده به کار شد", `${tag} — ${reason}`, d);
        });
        return Response.json({ ok: true });
      }

      case "equipment.report": {
        const tag = str(p.tag, 40);
        const reason = str(p.reason, 1500);
        if (reason.length < 3) throw badRequest("متن گزارش سرویس را بنویسید");
        const row = (await db.select().from(equipment).where(eq(equipment.tag, tag)).limit(1))[0];
        if (!row) throw badRequest("تجهیز پیدا نشد");
        await db.insert(equipmentReports).values({ tag, kind: "report", reason, operator: shift.label, shiftKey, at: jalaliNow() });
        await db.update(equipment).set({ description: reason, descriptionAt: jalaliNow(), descriptionBy: shift.label, updatedAt: jalaliNow() }).where(eq(equipment.tag, tag));
        await logActivity(shiftKey, "گزارش سرویس دستی", `${tag} — ${reason}`);
        return Response.json({ ok: true });
      }

      case "equipment.save": {
        requireAdmin();
        const id = p.id ? Number(p.id) : null;
        const tag = str(p.tag, 40).toUpperCase();
        if (tag.length < 2) throw badRequest("تگ تجهیز را وارد کنید");
        const category = str(p.category, 100);
        if (!CATEGORIES.includes(category) && !category) throw badRequest("دسته را انتخاب کنید");
        const data = {
          tag, name: str(p.name, 200) || tag, category, spec: str(p.spec, 400), plate: str(p.plate, 400), partNumbers: str(p.partNumbers, 600), location: str(p.location, 200),
          isAux: p.isAux === true, safetyCritical: p.safetyCritical === true, updatedAt: jalaliNow(),
        };
        const dup = (await db.select().from(equipment).where(eq(equipment.tag, tag)).limit(1))[0];
        if (id) {
          if (dup && dup.id !== id) throw badRequest("این تگ برای تجهیز دیگری ثبت شده است");
          await db.update(equipment).set(data).where(eq(equipment.id, id));
          await logActivity(shiftKey, "ویرایش رکورد تجهیز", tag);
        } else {
          if (dup) throw badRequest("این تگ قبلاً ثبت شده است");
          await db.insert(equipment).values({ ...data, status: "ready", description: "", descriptionAt: "", descriptionBy: "", deletedAt: "" });
          await logActivity(shiftKey, "افزودن رکورد تجهیز", `${tag} — ${category}`);
        }
        return Response.json({ ok: true });
      }

      case "equipment.delete": {
        requireAdmin();
        const id = Number(p.id);
        const row = (await db.select().from(equipment).where(eq(equipment.id, id)).limit(1))[0];
        if (!row) throw badRequest("تجهیز پیدا نشد");
        if (row.isMotor) throw badRequest("موتورهای اصلی حذف‌شدنی نیستند");
        if (row.safetyCritical) throw badRequest("تجهیز ایمنی‌حیاتی حذف‌شدنی نیست؛ فقط مشخصات آن را ویرایش کنید");
        await db.update(equipment).set({ deletedAt: jalaliNow(), updatedAt: jalaliNow() }).where(eq(equipment.id, id));
        await logActivity(shiftKey, "حذف (نرم) تجهیز", `${row.tag} — ${str(p.reason, 300)}`);
        return Response.json({ ok: true, message: "تجهیز از فهرست برداشته شد (سابقه حفظ می‌شود)" });
      }

      case "pm.template": {
        requireAdmin();
        const id = p.id ? Number(p.id) : null;
        const category = str(p.category, 100);
        const name = str(p.name, 200);
        const items = Array.isArray(p.items) ? p.items.map((x) => str(x, 200)).filter(Boolean) : [];
        if (!name || !items.length) throw badRequest("نام قالب و حداقل یک آیتم لازم است");
        if (id) await db.update(pmTemplates).set({ category, name, items, updatedAt: jalaliNow() }).where(eq(pmTemplates.id, id));
        else await db.insert(pmTemplates).values({ category, name, items, updatedAt: jalaliNow() });
        await logActivity(shiftKey, "ویرایش قالب PM", `${category} — ${name}`);
        return Response.json({ ok: true });
      }

      case "pm.record": {
        const tag = str(p.tag, 40);
        const row = (await db.select().from(equipment).where(eq(equipment.tag, tag)).limit(1))[0];
        if (!row) throw badRequest("تجهیز پیدا نشد");
        const results = (p.results ?? {}) as Record<string, unknown>;
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(results)) clean[str(k, 200)] = str(v, 300);
        if (!Object.keys(clean).length) throw badRequest("حداقل یک آیتم چک‌لیست را تکمیل کنید");
        const rec = { tag, templateName: str(p.templateName, 200), results: clean, workers: str(p.workers, 200), note: str(p.note, 1500), day, at: jalaliNow(), shiftKey };
        const rid = await runTx(async (d) => {
          const id = (await d.insert(pmRecords).values(rec).returning({ id: pmRecords.id }))[0].id;
          await d.insert(equipmentReports).values({ tag, kind: "pm", reason: `PM: ${rec.templateName}${rec.note ? ` — ${rec.note}` : ""}`, operator: rec.workers || shift.label, shiftKey, at: jalaliNow() });
          const reportId = await createReport({ kind: "pm", day, shift, title: `PM ${tag} — ${day}`, payload: { ...rec, pmId: id, name: row.name, category: row.category, generatedAt: jalaliNow() } }, d);
          await logActivity(shiftKey, "ثبت PM", `${tag} — ${rec.templateName}`, d);
          return reportId;
        });
        return Response.json({ ok: true, id: rid });
      }

      case "alert.ack": {
        const id = Number(p.id);
        const kind = str(p.kind, 10);
        const row = (await db.select().from(alerts).where(eq(alerts.id, id)).limit(1))[0];
        if (!row) throw badRequest("هشدار پیدا نشد");
        if (kind === "seen") await db.update(alerts).set({ seenAt: jalaliNow(), seenShift: shift.label }).where(eq(alerts.id, id));
        else if (kind === "acted") await db.update(alerts).set({ actedAt: jalaliNow(), actedShift: shift.label, ...(row.seenAt ? {} : { seenAt: jalaliNow(), seenShift: shift.label }) }).where(eq(alerts.id, id));
        else throw badRequest("نوع تأیید نامعتبر است");
        await logActivity(shiftKey, kind === "seen" ? "تأیید «دیدم» هشدار" : "تأیید «اقدام کردم» هشدار", String(id));
        return Response.json({ ok: true });
      }

      case "note.save": {
        const raw = String(p.text ?? "");
        if (raw.length > 4000) throw badRequest("متن گزارش حداکثر ۴٬۰۰۰ کاراکتر است؛ لطفاً کوتاه‌تر کنید");
        const text = raw.trim();
        await runTx(async (d) => {
          // «گزارش دستی روز» یک متن مشترک برای همان روز است؛ همهٔ شیفت‌ها همان را می‌بینند
          const existing = (await d.select().from(operatorNotes).where(eq(operatorNotes.day, day)).orderBy(desc(operatorNotes.id)).limit(1))[0];
          // قفل خوش‌بینانه: از overwrite بی‌صدای یادداشت مشترک بین تب‌ها/شیفت‌ها جلوگیری می‌کند.
          if (existing && typeof p.expected !== "string") {
            throw badRequest("نسخهٔ فعلی گزارش ارسال نشده است؛ صفحه را تازه کنید و دوباره ذخیره کنید");
          }
          if (existing && String(p.expected).trim() !== (existing.text ?? "").trim()) {
            throw badRequest("این گزارش در تب یا دستگاه دیگری تغییر کرده است؛ صفحه را تازه کنید و متن خود را دوباره وارد کنید");
          }
          if (existing) await d.update(operatorNotes).set({ text, updatedAt: jalaliNow() }).where(eq(operatorNotes.id, existing.id));
          else await d.insert(operatorNotes).values({ day, shiftKey, text, updatedAt: jalaliNow() });
          await logActivity(shiftKey, "ثبت گزارش دستی اپراتور", day, d);
        });
        return Response.json({ ok: true });
      }

      case "problem.add": {
        const text = str(p.text, 2000);
        if (text.length < 3) throw badRequest("متن گزارش مشکل را کامل‌تر بنویسید");
        await db.insert(problems).values({ at: jalaliNow(), shiftKey, text, internal: false });
        await logActivity(shiftKey, "ثبت گزارش مشکل", text.slice(0, 120));
        return Response.json({ ok: true });
      }

      case "report.create": {
        const kind = str(p.kind, 20);
        if (kind === "daily" || kind === "aux") {
          const payload = await buildOperationalPayload(kind, day, shift);
          const id = await createReport({ kind, day, shift, payload });
          await logActivity(shiftKey, `ساخت گزارش ${REPORT_KINDS[kind]}`, day);
          return Response.json({ ok: true, id });
        }
        if (kind === "trend") {
          const tScope = p.scope === "motor" ? "motor" : "process";
          const tTag = str(p.tag, 20);
          const tParam = str(p.param || p.tag, 20);
          const tCompare = p.compare === true;
          const { from, to } = normalizeRange(str(p.from), str(p.to), addDaysToDay(op.day, -13), op.day);
          if (tScope === "motor" && !tCompare && !MOTORS.some((m) => m.tag === tTag)) throw badRequest("موتور نامعتبر است");
          const payload = await buildTrendPayload(tScope, tTag, tParam, from, to, tCompare);
          const id = await createReport({ kind, day: to, shift, payload, title: `روند ${payload.label} — ${from} تا ${to}` });
          await logActivity(shiftKey, "ساخت گزارش روند", `${payload.label} — ${from} تا ${to}`);
          return Response.json({ ok: true, id });
        }
        if (kind === "registry") {
          const tags = Array.isArray(p.tags) ? p.tags.map((t) => str(t, 40)) : null;
          const category = p.category ? str(p.category, 100) : null;
          const payload = await buildRegistryPayload(tags && tags.length ? tags : null, category);
          const id = await createReport({ kind, day: op.day, shift, payload, title: `لیست تجهیزات${category ? ` — ${category}` : tags?.length ? ` — ${tags.join("، ")}` : " — کامل"} — ${op.day}` });
          await logActivity(shiftKey, "ساخت گزارش لیست تجهیزات", payload.scope);
          return Response.json({ ok: true, id });
        }
        throw badRequest("نوع گزارش نامعتبر است");
      }

      case "report.send": {
        const kind = str(p.kind, 20) || "daily";
        let reportId = Number(p.reportId) || 0;
        if (!reportId) {
          const payload = await buildOperationalPayload(kind === "aux" ? "aux" : "daily", day, shift);
          reportId = await createReport({ kind: kind === "aux" ? "aux" : "daily", day, shift, payload });
        }
        const result = await trySend(reportId, "daily", shiftKey);
        await logActivity(shiftKey, "ارسال گزارش به کانال", `گزارش ${reportId} — ${result.sent ? "ارسال شد" : "در صف"}`);
        return Response.json({ ok: true, id: reportId, message: result.message });
      }

      case "queue.retry": {
        requireAdmin();
        const items = await db.select().from(sendQueue).where(eq(sendQueue.status, "pending"));
        let sent = 0;
        for (const item of items) {
          const ch = (await db.select().from(channels).where(eq(channels.key, item.channelKey)).limit(1))[0];
          if (!ch?.enabled || !ch.token) continue;
          const report = (await db.select().from(reports).where(eq(reports.id, item.reportId)).limit(1))[0];
          try {
            await sendBotText({ provider: ch.provider === "eitaa" ? "eitaa" : "bale", token: ch.token, chatId: ch.chatId, text: `${report?.title ?? ""}\n${report?.operators ?? ""}` });
            await db.update(sendQueue).set({ status: "sent", attempts: item.attempts + 1, sentAt: jalaliNow(), lastError: "" }).where(eq(sendQueue.id, item.id));
            sent += 1;
          } catch (error) {
            await db.update(sendQueue).set({ attempts: item.attempts + 1, lastError: error instanceof Error ? error.message : "خطا" }).where(eq(sendQueue.id, item.id));
          }
        }
        return Response.json({ ok: true, message: `${sent} مورد ارسال شد` });
      }

      case "queue.cancel": {
        requireAdmin();
        await db.update(sendQueue).set({ status: "canceled" }).where(eq(sendQueue.id, Number(p.id)));
        await logActivity(shiftKey, "لغو آیتم صف ارسال", String(p.id));
        return Response.json({ ok: true });
      }

      case "admin.channel": {
        requireAdmin();
        const key = str(p.key, 20);
        if (!["daily", "backup"].includes(key)) throw badRequest("کانال نامعتبر است");
        const existing = (await db.select().from(channels).where(eq(channels.key, key)).limit(1))[0];
        const clearToken = p.clearToken === true;
        const token = str(p.token, 300);
        await db.update(channels).set({ provider: str(p.provider, 10) === "eitaa" ? "eitaa" : "bale", chatId: str(p.chatId, 100), token: clearToken ? "" : token || existing?.token || "", enabled: !clearToken && p.enabled === true }).where(eq(channels.key, key));
        await logActivity(shiftKey, "ویرایش کانال ارسال", key);
        return Response.json({ ok: true });
      }

      case "channel.test": {
        requireAdmin();
        const key = str(p.key, 20);
        if (!["daily", "backup"].includes(key)) throw badRequest("کانال نامعتبر است");
        const ch = (await db.select().from(channels).where(eq(channels.key, key)).limit(1))[0];
        if (!ch?.enabled) throw badRequest("کانال فعال نیست؛ ابتدا آن را فعال و ذخیره کنید");
        if (!ch.token || !ch.chatId) throw badRequest("توکن یا شناسه کانال خالی است؛ ابتدا ذخیره کنید");
        try {
          await sendBotText({ provider: ch.provider === "eitaa" ? "eitaa" : "bale", token: ch.token, chatId: ch.chatId, text: `✅ اتصال سالم است\nزمان: ${jalaliNow()}\nسامانه پایش ایستگاه پمپاژ زیرزمینی — تونل انتقال آب گلاب` });
        } catch (error) {
          throw new AppError(`ارسال تستی ناموفق بود (${error instanceof Error ? error.message : "خطای شبکه"})`, 502, "upstream_error");
        }
        await logActivity(shiftKey, "تست اتصال کانال ارسال", key);
        return Response.json({ ok: true, message: "پیام تستی ارسال شد؛ کانال را بررسی کنید" });
      }

      case "channel.sendReport": {
        requireAdmin();
        const ch = (await db.select().from(channels).where(eq(channels.key, "daily")).limit(1))[0];
        if (!ch?.enabled) throw badRequest("کانال گزارش روزانه فعال نیست؛ ابتدا آن را فعال و ذخیره کنید");
        if (!ch.token || !ch.chatId) throw badRequest("توکن یا شناسه کانال گزارش روزانه خالی است؛ ابتدا ذخیره کنید");
        const latest = (await db.select().from(reports).where(eq(reports.kind, "daily")).orderBy(desc(reports.id)).limit(1))[0];
        if (!latest) throw badRequest("هنوز گزارش روزانه‌ای ثبت نشده است؛ چیزی برای ارسال نیست");
        const fail = async (detail: string) => {
          await logActivity(shiftKey, "ارسال ناموفق گزارش به کانال", `گزارش ${latest.id} (${latest.day}): ${detail}`);
        };
        let html: string;
        try {
          const origin = new URL(request.url).origin;
          const page = await fetch(`${origin}/report/${latest.id}`, { headers: { cookie: request.headers.get("cookie") ?? "" }, signal: AbortSignal.timeout(15000) });
          if (!page.ok) throw new AppError(`پاسخ ${page.status}`, 502, "upstream_error");
          html = await page.text();
        } catch (error) {
          const detail = error instanceof Error ? error.message : "خطای شبکه";
          await fail(detail);
          throw new AppError(`خواندن صفحهٔ گزارش ناموفق بود (${detail})`, 502, "upstream_error");
        }
        try {
          await sendBotDocument({
            provider: ch.provider === "eitaa" ? "eitaa" : "bale",
            token: ch.token,
            chatId: ch.chatId,
            filename: `ایستگاه پمپاژ زیر زمینی — ${latest.day}.html`,
            data: new TextEncoder().encode(html),
            caption: `${latest.title}\nروز: ${latest.day}${latest.operators ? `\n${latest.operators}` : ""}`,
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : "خطای شبکه";
          await fail(detail);
          throw new AppError(`ارسال به کانال ناموفق بود (${detail})`, 502, "upstream_error");
        }
        await logActivity(shiftKey, "ارسال گزارش روزانه به کانال", `${latest.title} (${latest.day})`);
        return Response.json({ ok: true, message: "گزارش روزانه به کانال ارسال شد" });
      }

      case "channel.sendBackup": {
        requireAdmin();
        const ch = (await db.select().from(channels).where(eq(channels.key, "backup")).limit(1))[0];
        if (!ch?.enabled) throw badRequest("کانال بکاپ فعال نیست؛ ابتدا آن را فعال و ذخیره کنید");
        if (!ch.token || !ch.chatId) throw badRequest("توکن یا شناسه کانال بکاپ خالی است؛ ابتدا ذخیره کنید");
        const snap = await writeFileBackup("channel");
        const { readFile } = await import("node:fs/promises");
        const jsonBytes = await readFile(snap.file);
        const sha = await readFile(`${snap.file}.sha256`, "utf8").catch(() => "");
        const base = snap.file.replace(/\\/g, "/").split("/").pop() ?? "backup.json";
        const zip = zipStored([
          { name: base, data: new Uint8Array(jsonBytes) },
          { name: `${base}.sha256`, data: new TextEncoder().encode(sha) },
        ]);
        try {
          await sendBotDocument({
            provider: ch.provider === "eitaa" ? "eitaa" : "bale",
            token: ch.token,
            chatId: ch.chatId,
            filename: base.replace(/\.json$/, "") + ".zip",
            data: zip,
            caption: `بکاپ کامل ایستگاه پمپاژ (${snap.rows} ردیف)${sha ? `\nsha256: ${sha.slice(0, 32)}…` : ""}`,
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : "خطای شبکه";
          await logActivity(shiftKey, "ارسال ناموفق بکاپ به کانال", detail);
          throw new AppError(`ارسال به کانال ناموفق بود (${detail})`, 502, "upstream_error");
        }
        await logActivity(shiftKey, "ارسال بکاپ به کانال", `${base} — ${snap.rows} ردیف`);
        return Response.json({ ok: true, message: "فایل بکاپ (ZIP) به کانال ارسال شد" });
      }

      case "admin.settings": {
        requireAdmin();
        const incoming = (p.settings ?? {}) as Partial<Record<keyof Settings, unknown>>;
        const clean: Partial<Settings> = {};
        for (const key of ["serviceInterval", "vibWarn", "vibCrit", "windingWarn", "windingCrit", "bearingWarn", "bearingCrit", "currentWarn", "currentCrit"] as const) {
          if (incoming[key] !== undefined) clean[key] = num(incoming[key]);
        }
        if (clean.serviceInterval !== undefined && clean.serviceInterval < 100) throw badRequest("بازه سرویس باید حداقل ۱۰۰ ساعت باشد");
        if (clean.vibWarn !== undefined && clean.vibCrit !== undefined && clean.vibWarn >= clean.vibCrit) throw badRequest("حد هشدار لرزش باید کمتر از حد بحرانی باشد");
        await saveSettings(clean);
        await logActivity(shiftKey, "ویرایش تنظیمات/ست‌پوینت", JSON.stringify(clean));
        return Response.json({ ok: true });
      }

      case "admin.setpoints": {
        requireAdmin();
        const tag = str(p.tag, 20);
        if (!PROCESS_PARAMS.some((x) => x.tag === tag)) throw badRequest("پارامتر نامعتبر است");
        const existing = (await db.select().from(settings).where(eq(settings.key, "processSetpoints")).limit(1))[0];
        const current = (existing?.value ?? {}) as Record<string, Record<string, number | null>>;
        const patch: Record<string, number | null> = {};
        for (const key of ["warnMin", "warnMax", "critMin", "critMax"] as const) patch[key] = optNum(p[key]);
        current[tag] = { ...(current[tag] ?? {}), ...patch };
        await saveSettings({ processSetpoints: current } as unknown as Partial<Settings>);
        await logActivity(shiftKey, "ویرایش ست‌پوینت پارامتر", `${tag}: ${JSON.stringify(patch)}`);
        return Response.json({ ok: true });
      }

      case "admin.pin": {
        requireAdmin();
        const key = str(p.key, 10);
        const pin = str(p.pin, 10);
        if (!["A", "B", "C", "admin"].includes(key)) throw badRequest("شیفت نامعتبر است");
        if (!/^\d{4,6}$/.test(pin)) throw badRequest("PIN باید چهار تا شش رقم باشد");
        await db.update(shifts).set({ pin: hashPin(pin) }).where(eq(shifts.key, key));
        await logActivity(shiftKey, "تغییر PIN شیفت", key);
        return Response.json({ ok: true });
      }

      case "admin.members": {
        requireAdmin();
        const key = str(p.key, 10);
        const members = Array.isArray(p.members) ? p.members.map((m) => str(m, 80)).filter(Boolean).slice(0, 4) : [];
        if (!members.length) throw badRequest("حداقل یک نام لازم است");
        await db.update(shifts).set({ members }).where(eq(shifts.key, key));
        await logActivity(shiftKey, "ویرایش اعضای شیفت", `${key}: ${members.join(" و ")}`);
        return Response.json({ ok: true });
      }

      case "admin.shift": {
        requireAdmin();
        const key = p.key === null || p.key === "" || p.key === "auto" ? "" : str(p.key, 5);
        if (key && !["A", "B", "C"].includes(key)) throw badRequest("شیفت نامعتبر است");
        await saveSettings({ shiftOverride: key });
        await logActivity(shiftKey, "تنظیم شیفت فعال", key || "چرخش خودکار");
        return Response.json({ ok: true });
      }

      case "backup.create": {
        requireAdmin();
        const inner = await createInternalBackup("بک‌آپ دستی");
        let file: { file: string; bytes: number } | null = null;
        try {
          file = await writeFileBackup("بک‌آپ دستی ادمین");
        } catch (error) {
          await logActivity(shiftKey, "خطا در بک‌آپ فایلی", error instanceof Error ? error.message : "نامشخص");
        }
        await logActivity(shiftKey, "ساخت بک‌آپ داده‌ها", `${inner.id ?? "-"} — ${((inner.sizeBytes ?? 0) / 1024).toFixed(1)} KB${file ? ` — فایل: ${file.file}` : ""}`);
        return Response.json({ ok: true, id: inner.id, file: file?.file ?? null });
      }

      case "backup.restore": {
        requireAdmin();
        const id = Number(p.id);
        const row = (await db.select().from(backups).where(eq(backups.id, id)).limit(1))[0];
        if (!row) throw badRequest("بک‌آپ پیدا نشد");
        // نسخهٔ ایمنی قبل از بازیابی (هم داخلی، هم فایل) تا اگر چیزی اشتباه بود برگشت‌پذیر باشد
        await createInternalBackup("نسخه ایمنی قبل از بازیابی");
        await writeFileBackup("نسخه ایمنی قبل از بازیابی").catch(() => {});
        await restoreAll(row.payload as Snapshot);
        await logActivity(shiftKey, "بازیابی بک‌آپ", `شناسه ${id}`);
        return Response.json({ ok: true, message: "بازیابی انجام و شمارش رکوردها تطبیق داده شد" });
      }

      case "backup.verify": {
        requireAdmin();
        const result = await verifyFileBackup(str(p.file, 200));
        return Response.json({
          ok: result.checksumOk,
          ...result,
          ...(result.checksumOk ? {} : { error: result.checksumPresent ? "چک‌سام با فایل نمی‌خواند" : "فایل .sha256 ندارد" }),
        }, { status: result.checksumOk ? 200 : 422 });
      }

      case "backup.files": {
        requireAdmin();
        const files = await listFileBackups();
        return Response.json({ ok: true, files });
      }

      case "backup.bundle.create": {
        requireAdmin();
        const bundle = await writeBackupBundle();
        await logActivity(shiftKey, "ساخت بستهٔ بازیابی", `${bundle.name} — ${(bundle.bytes / 1024 / 1024).toFixed(2)} MB`);
        const message = bundle.complete
          ? `بستهٔ بازیابی ساخته شد (${(bundle.bytes / 1024 / 1024).toFixed(2)} MB)${bundle.warnings.length ? `؛ ${bundle.warnings.length} هشدار فایل سرد` : ""}`
          : `بسته ساخته شد اما کامل نیست؛ ${bundle.warnings.length} فایل کاتالوگ/آرشیو نیاز به بررسی دارد`;
        return Response.json({ ok: true, ...bundle, message });
      }

      case "backup.bundle.files": {
        requireAdmin();
        const bundles = await listBackupBundles();
        return Response.json({ ok: true, bundles });
      }

      case "backup.bundle.verify": {
        requireAdmin();
        const result = await verifyBackupBundle(str(p.name, 160));
        return Response.json({ ok: true, ...result });
      }

      case "backup.bundle.restore": {
        requireAdmin();
        const name = str(p.name, 160);
        if (!name) throw badRequest("نام بسته را انتخاب کنید");
        const result = await restoreBackupBundle(name, { allowIncomplete: p.allowIncomplete === true });
        await logActivity(shiftKey, "بازیابی بستهٔ کامل", `${name} — ${result.rows} ردیف — نسخهٔ ایمنی ${result.safetyBundle}`);
        const warnings: string[] = [...result.warnings];
        if (result.channelsNeedSetup.length) warnings.push(`توکن کانال‌های ${result.channelsNeedSetup.join("، ")} باید دوباره وارد شود`);
        return Response.json({ ok: true, ...result, warnings, message: warnings.length ? `بازیابی انجام شد؛ هشدارها: ${warnings.join(" | ")}` : "بازیابی کامل و تطبیق تعداد ردیف‌ها موفق بود" });
      }

      case "admin.logout_all": {
        requireAdmin();
        const key = str(p.key, 10) || "all";
        await revokeSessions(key);
        await logActivity(shiftKey, "ابطال نشست‌ها", key === "all" ? "همهٔ دستگاه‌ها" : `شیفت ${key}`);
        return Response.json({ ok: true, message: key === "all" ? "همهٔ نشست‌ها باطل شدند؛ ورود دوباره لازم است" : `نشست‌های شیفت ${key} باطل شدند` });
      }

      case "admin.unlock": {
        requireAdmin();
        const target = str(p.key, 10) || "all";
        if (!["A", "B", "C", "admin", "all"].includes(target)) throw badRequest("شیفت نامعتبر است");
        const cleared = await clearLoginLock(target);
        await logSecurityEvent("lock_cleared", target, "admin", "رفع قفل ورود توسط ادمین");
        await logActivity(shiftKey, "رفع قفل ورود", `${target} — ${cleared} قفل`);
        return Response.json({ ok: true, cleared, message: cleared ? `قفل ورود ${target === "all" ? "همهٔ شیفت‌ها" : `شیفت ${target}`} برداشته شد` : "قفلی برای این شیفت ثبت نشده بود" });
      }

      case "session.list": {
        const includeRevoked = p.all === true;
        const rows = isAdmin && p.shifts === true ? await listSessions({ includeRevoked }) : await listSessions({ shiftKey, includeRevoked });
        const current = await getSessionId();
        return Response.json({
          ok: true,
          current: current ? current.slice(0, 8) : null,
          sessions: rows.map((r) => ({ ...r, current: r.id === current, agent: r.agent.slice(0, 60) })),
        });
      }

      case "session.revoke": {
        const id = str(p.id, 64);
        const row = (await db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).limit(1))[0];
        if (!row) throw badRequest("نشست پیدا نشد");
        if (!isAdmin && row.shiftKey !== shiftKey) throw forbidden("دسترسی لازم است");
        await revokeSession(id, isAdmin ? "ابطال توسط ادمین" : "ابطال توسط کاربر");
        await logActivity(shiftKey, "ابطال نشست", `${row.shiftKey} — ${row.ip}`);
        return Response.json({ ok: true, message: "آن دستگاه از سامانه خارج شد" });
      }

      case "session.revoke_others": {
        const current = await getSessionId();
        const requested = str(p.key, 10);
        const target = isAdmin && requested ? requested : shiftKey;
        if (!["A", "B", "C", "admin", "all"].includes(target)) throw badRequest("شیفت نامعتبر است");
        if (target === "all" && (!isAdmin || p.confirmAll !== true)) throw forbidden("برای خروج از همهٔ شیفت‌ها تأیید صریح ادمین لازم است");
        const count = await revokeAllSessions(target, "خروج از سایر دستگاه‌ها", current ?? undefined);
        await logActivity(shiftKey, "خروج از سایر دستگاه‌ها", `${target} — ${count} نشست`);
        return Response.json({ ok: true, count, message: count ? `${count} نشست بسته شد` : "نشست دیگری فعال نبود" });
      }

      case "audit.verify": {
        requireAdmin();
        const report = await verifyActivityChain(Math.min(20000, Math.max(10, Number(p.limit) || 5000)));
        return Response.json({ ...report, ok: true });
      }

      case "data.stats": {
        requireAdmin();
        const stats = await archiveStats();
        const counts = await db.execute<{ motor: number; process: number; sessions: number; events: number; audits: number }>(sql`
          select (select count(*)::int from motor_readings) as motor,
                 (select count(*)::int from process_readings) as process,
                 (select count(*)::int from sessions) as sessions,
                 (select count(*)::int from app_events) as events,
                 (select count(*)::int from activity) as audits`);
        return Response.json({ ok: true, archive: stats, counts: counts.rows[0] ?? null });
      }

      case "data.archive": {
        requireAdmin();
        const years = Math.min(20, Math.max(1, Number(p.years) || 3));
        const result = await archiveOlderThan(years, shiftKey);
        await pruneArchives().catch(() => 0);
        await logActivity(shiftKey, "بایگانی داده قدیمی", `قدیمی‌تر از ${years} سال (${result.cutoffDay}) — ${result.motorRows + result.processRows} ردیف — پیرایش نسخه‌های قدیمی غیرفعال است (نگه‌داری نامحدود)`);
        return Response.json({ ok: true, ...result, message: `${result.motorRows + result.processRows} ردیف بایگانی شد` });
      }

      case "data.optimize": {
        requireAdmin();
        const tables = ["motor_readings", "process_readings", "alerts", "activity", "value_audits", "send_queue", "security_events", "app_events", "problems", "motors", "equipment"];
        for (const t of tables) {
          try {
            await db.execute(sql.raw(`vacuum (analyze) "${t}"`));
          } catch (error) {
            await recordEvent({ level: "warn", source: "maintenance", message: `vacuum ${t} ناموفق بود`, detail: error });
          }
        }
        const removed = await cleanupSessions().catch(() => 0);
        await db
          .delete(idempotencyKeys)
          .where(sql`${idempotencyKeys.createdAt} < ${Date.now() - 24 * 60 * 60 * 1000}`)
          .catch(() => undefined);
        await logActivity(shiftKey, "بهینه‌سازی دیتابیس", `vacuum analyze — ${removed} نشست کهنه پاک شد`);
        return Response.json({ ok: true, message: `بهینه‌سازی انجام شد؛ ${removed} نشست کهنه پاک شد` });
      }

      case "equipment.trash": {
        requireAdmin();
        const rows = await db.select().from(equipment).where(sql`${equipment.deletedAt} <> ''`).orderBy(desc(equipment.id)).limit(100);
        return Response.json({ ok: true, items: rows.map((r) => ({ id: r.id, tag: r.tag, name: r.name, category: r.category, deletedAt: r.deletedAt })) });
      }

      case "equipment.restore": {
        requireAdmin();
        const id = Number(p.id);
        const row = (await db.select().from(equipment).where(eq(equipment.id, id)).limit(1))[0];
        if (!row) throw badRequest("تجهیز پیدا نشد");
        await db.update(equipment).set({ deletedAt: "", updatedAt: jalaliNow() }).where(eq(equipment.id, id));
        await logActivity(shiftKey, "بازگرداندن تجهیز از سطل بازیافت", row.tag);
        return Response.json({ ok: true, message: `${row.tag} به فهرست برگشت` });
      }

      case "events.list": {
        requireAdmin();
        const rows = await db.select().from(appEvents).orderBy(desc(appEvents.id)).limit(100);
        return Response.json({ ok: true, events: rows });
      }

      case "backup.restore_file": {
        requireAdmin();
        const file = str(p.file, 200);
        if (!file) throw badRequest("نام فایل را انتخاب کنید");
        const result = await restoreFromFile(file, { force: p.force === true });
        await logActivity(shiftKey, "بازیابی از فایل بک‌آپ", `${file} — ${result.rows} ردیف`);
        const warnings: string[] = [];
        if (result.catalogFiles.missing.length) {
          warnings.push(`${result.catalogFiles.missing.length} فایل PDF کاتالوگ پیدا نشد یا هش آن نادرست است: ${result.catalogFiles.missing.join("، ")}`);
        }
        if (result.channelsNeedSetup.length) {
          warnings.push(`توکن کانال‌های ${result.channelsNeedSetup.join("، ")} در بک‌آپ ذخیره نمی‌شود؛ در پنل ادمین دوباره وارد کنید`);
        }
        warnings.push("رازهای TOTP در بک‌آپ خارجی ذخیره نمی‌شوند؛ تنظیمات محلی حفظ شد و روی دستگاه تازه باید دوباره تنظیم شود");
        const message = warnings.length ? `داده‌ها بازگردانی شد؛ ${warnings.join(" | ")}` : "داده‌ها بازگردانی شد و فایل‌های کاتالوگ بررسی شدند";
        return Response.json({ ok: true, ...result, message });
      }

      case "totp.status": {
        const target = isAdmin && p.key ? str(p.key, 10) : shiftKey;
        const row = (await db.select().from(shifts).where(eq(shifts.key, target)).limit(1))[0];
        if (!row) throw badRequest("شیفت پیدا نشد");
        return Response.json({
          ok: true,
          key: target,
          enabled: row.totpEnabled,
          enabledAt: row.totpEnabledAt,
          backupCodes: (row.totpBackupCodes ?? []).length,
          pending: Boolean(row.totpPending),
        });
      }

      case "totp.begin": {
        // فقط برای شیفت خودِ کاربر (یا ادمین به‌جای شیفت دیگر)
        const target = isAdmin && p.key ? str(p.key, 10) : shiftKey;
        const secret = generateTotpSecret();
        const updated = await db.update(shifts).set({ totpPending: secret }).where(eq(shifts.key, target)).returning({ key: shifts.key });
        if (!updated.length) throw badRequest("شیفت پیدا نشد");
        const url = otpauthUrl({ issuer: "Pumpstation Golab", account: `${target} — ایستگاه پمپاژ گلاب`, secret });
        await logActivity(shiftKey, "شروع ثبت ورود دوعاملی", `شیفت ${target}`);
        return Response.json({
          ok: true,
          key: target,
          secret,
          otpauth: url,
          message: "راز ساخته شد؛ آن را در برنامهٔ Authenticator ثبت و کد ۶ رقمی را تأیید کنید",
        });
      }

      case "totp.enable": {
        const target = isAdmin && p.key ? str(p.key, 10) : shiftKey;
        const row = (await db.select().from(shifts).where(eq(shifts.key, target)).limit(1))[0];
        if (!row) throw badRequest("شیفت پیدا نشد");
        if (!row.totpPending) throw badRequest("ابتدا مرحلهٔ «ساخت راز» را انجام دهید");
        if (!verifyTotp(row.totpPending, str(p.code, 10))) {
          throw badRequest("کد وارد‌شده معتبر نیست؛ ساعت گوشی و کد ۶ رقمی را بررسی کنید");
        }
        const codes = Array.from({ length: 10 }, () => generateBackupCode());
        await db
          .update(shifts)
          .set({
            totpSecret: row.totpPending,
            totpPending: "",
            totpEnabled: true,
            totpEnabledAt: jalaliNow(),
            totpBackupCodes: codes.map((c) => hashPin(normalizeBackupCode(c))),
          })
          .where(eq(shifts.key, target));
        await logActivity(shiftKey, "فعال‌سازی ورود دوعاملی", `شیفت ${target} — ۱۰ کد پشتیبان صادر شد`);
        await logSecurityEvent("totp_enabled", target, "local", "ورود دوعاملی فعال شد");
        return Response.json({
          ok: true,
          backupCodes: codes,
          message: "ورود دوعاملی فعال شد. کدهای پشتیبان را همین حالا یادداشت کنید؛ دیگر نمایش داده نمی‌شوند.",
        });
      }

      case "totp.disable": {
        const target = isAdmin && p.key ? str(p.key, 10) : shiftKey;
        const row = (await db.select().from(shifts).where(eq(shifts.key, target)).limit(1))[0];
        if (!row) throw badRequest("شیفت پیدا نشد");
        // تأیید هویت دوباره: کاربر عادی با PIN همان شیفت، ادمین با PIN خودش (برای نجات گوشی گم‌شده)
        const authRow = isAdmin ? (await db.select().from(shifts).where(eq(shifts.key, shiftKey)).limit(1))[0] : row;
        if (!authRow || !verifyPin(str(p.pin, 10).trim(), authRow.pin)) {
          throw badRequest(isAdmin && target !== shiftKey ? "برای این کار PIN حساب ادمین را وارد کنید" : "PIN نادرست است");
        }
        await db
          .update(shifts)
          .set({ totpEnabled: false, totpSecret: "", totpPending: "", totpBackupCodes: [], totpEnabledAt: "" })
          .where(eq(shifts.key, target));
        await logActivity(shiftKey, "غیرفعال‌سازی ورود دوعاملی", `شیفت ${target}`);
        await logSecurityEvent("totp_disabled", target, "local", "ورود دوعاملی غیرفعال شد");
        return Response.json({ ok: true, message: "ورود دوعاملی غیرفعال شد" });
      }

      case "totp.codes": {
        const target = isAdmin && p.key ? str(p.key, 10) : shiftKey;
        const row = (await db.select().from(shifts).where(eq(shifts.key, target)).limit(1))[0];
        if (!row) throw badRequest("شیفت پیدا نشد");
        if (!row.totpEnabled) throw badRequest("ورود دوعاملی برای این شیفت فعال نیست");
        const authRow2 = isAdmin ? (await db.select().from(shifts).where(eq(shifts.key, shiftKey)).limit(1))[0] : row;
        if (!authRow2 || !verifyPin(str(p.pin, 10).trim(), authRow2.pin)) throw badRequest("PIN نادرست است");
        const codes = Array.from({ length: 10 }, () => generateBackupCode());
        await db.update(shifts).set({ totpBackupCodes: codes.map((c) => hashPin(normalizeBackupCode(c))) }).where(eq(shifts.key, target));
        await logActivity(shiftKey, "صدور مجدد کدهای پشتیبان", `شیفت ${target}`);
        return Response.json({ ok: true, backupCodes: codes, message: "کدهای پشتیبان قبلی باطل و ۱۰ کد تازه صادر شد" });
      }

      case "mirror.status": {
        if (!isAdmin) throw forbidden("برای دیدن وضعیت آینه، دسترسی مدیریت لازم است");
        const st = await mirrorStatus();
        return Response.json({ ...st });
      }

      case "mirror.now": {
        if (!isAdmin) throw forbidden("برای کپی به آینه، دسترسی مدیریت لازم است");
        const result = await mirrorLatest({ fresh: true, actor: `${user.label} (${shiftKey})` });
        await logActivity(shiftKey, "کپی بک‌آپ به آینه", result.ok ? `فایل ${result.file}` : `ناموفق: ${result.error}`);
        if (!result.ok) return Response.json({ ok: false, error: `کپی به آینه ناموفق بود: ${result.error}` }, { status: 500 });
        return Response.json({ ...result, message: `نسخهٔ ${result.file} روی آینه کپی و با هش تأیید شد` });
      }

      default:
        return Response.json({ ok: false, error: "عملیات ناشناخته" }, { status: 400 });
      }
    })();

    if (idemKey && response.ok) {
      try {
        const parsed = JSON.parse(await response.clone().text()) as unknown;
        await db
          .insert(idempotencyKeys)
          .values({ key: idemKey, shiftKey, action, createdAt: Date.now(), response: parsed })
          .onConflictDoNothing();
        // پاک‌سازی تنبل کلیدهای کهنه (بیش از ۲۴ ساعت)
        await db
          .delete(idempotencyKeys)
          .where(sql`${idempotencyKeys.createdAt} < ${Date.now() - 24 * 60 * 60 * 1000}`)
          .catch(() => undefined);
      } catch {
        /* ثبت کلید نباید پاسخ موفق را خراب کند */
      }
    }

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "خطای نامشخص";
    try {
      await db.insert(problems).values({ at: jalaliNow(), shiftKey, text: `[سیستمی] ${action}: ${message}`, internal: true });
    } catch {
      /* ثبت خطای فنی نباید عملیات اصلی را متوقف کند */
    }
    return errorResponse(error, {
      source: "api/actions",
      path: "/api/actions",
      requestId: request.headers.get("x-request-id") ?? undefined,
      shiftKey,
    });
  }
}
