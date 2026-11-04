import { and, eq } from "drizzle-orm";
import { db } from "@/db";
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
  catalogs,
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
import { getSessionUser } from "@/lib/auth";
import { hashPin } from "@/lib/pin";
import { ensureSeed, getAllSettings, saveSettings } from "@/db/seed";
import { effectiveShift, getProcessThresholds, logActivity, thresholdSeverity } from "@/lib/state";
import { buildOperationalPayload, buildRegistryPayload, buildTrendPayload, createReport, latestMotorRecords, normalizeRange, REPORT_KINDS } from "@/lib/reporting";
import { addDaysToDay, jalaliNow, operationalDay } from "@/lib/jalali";
import { CATEGORIES, MOTORS, MOTOR_PARAMS, MOTOR_STATE_FA, PROCESS_PARAMS, type Settings } from "@/lib/domain";

export const dynamic = "force-dynamic";

type Payload = Record<string, unknown>;

function num(value: unknown): number {
  const n = typeof value === "string" ? Number(value.replace(/,/g, "").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))) : Number(value);
  if (!Number.isFinite(n)) throw new Error("مقدار عددی معتبر وارد کنید");
  if (Math.abs(n) > 10_000_000) throw new Error("مقدار خارج از محدودهٔ منطقی است");
  return n;
}
function optNum(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  return num(value);
}
function str(value: unknown, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

async function addAlert(input: { tag: string; param: string; label: string; value: number; severity: "warning" | "critical"; message: string; day: string; shiftKey: string }) {
  await db.insert(alerts).values({ ...input, at: jalaliNow(), seenAt: "", actedAt: "" });
}

async function audit(shiftKey: string, scope: string, tag: string, param: string, oldValue: unknown, newValue: unknown) {
  await db.insert(valueAudits).values({ at: jalaliNow(), shiftKey, scope, tag, param, oldValue: String(oldValue), newValue: String(newValue) });
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
    const url = ch.provider === "eitaa" ? `https://eitaayar.ir/api/${ch.token}/sendMessage` : `https://tapi.bale.ai/bot${ch.token}/sendMessage`;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: ch.chatId, text }), signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`پاسخ ${res.status}`);
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
  let body: { action?: string; payload?: Payload };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "درخواست نامعتبر" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const p: Payload = body.payload ?? {};
  const isAdmin = user.role === "admin";
  const shift = isAdmin ? await effectiveShift() : { key: user.key, label: user.label, members: user.members };
  const shiftKey = user.key;
  const op = operationalDay();
  const day = typeof p.day === "string" && /^\d{4}\/\d{2}\/\d{2}$/.test(p.day) ? p.day : op.day;
  const interval = Number.isInteger(p.intervalIndex) && Number(p.intervalIndex) >= 0 && Number(p.intervalIndex) <= 5 ? Number(p.intervalIndex) : op.intervalIndex;
  const requireAdmin = () => {
    if (!isAdmin) throw new Error("دسترسی ادمین لازم است");
  };

  try {
    switch (action) {
      case "process.set": {
        const tag = str(p.tag, 20);
        const meta = PROCESS_PARAMS.find((x) => x.tag === tag);
        if (!meta) throw new Error("پارامتر نامعتبر است");
        const value = num(p.value);
        const existing = (await db.select().from(processReadings).where(and(eq(processReadings.day, day), eq(processReadings.intervalIndex, interval), eq(processReadings.tag, tag))).limit(1))[0];
        if (existing) {
          await audit(shiftKey, "process", tag, tag, existing.value, value);
          await db.update(processReadings).set({ value, updatedAt: jalaliNow(), shiftKey }).where(eq(processReadings.id, existing.id));
        } else {
          await db.insert(processReadings).values({ day, intervalIndex: interval, tag, value, shiftKey, recordedAt: jalaliNow(), updatedAt: jalaliNow() });
        }
        const thresholds = await getProcessThresholds();
        const severity = thresholdSeverity(value, thresholds[tag]);
        if (severity !== "ok") await addAlert({ tag, param: tag, label: meta.label, value, severity, message: `${tag} / ${meta.label} = ${value} ${meta.unit} — خارج از ${severity === "critical" ? "حد بحرانی" : "حد هشدار"}`, day, shiftKey });
        await logActivity(shiftKey, "ثبت پارامتر فرآیندی", `${tag} = ${value} — ${day} بازه ${interval + 1}`);
        return Response.json({ ok: true });
      }

      case "total.set": {
        const value = num(p.value);
        const existing = (await db.select().from(dailyTotals).where(eq(dailyTotals.day, day)).limit(1))[0];
        if (existing) {
          await audit(shiftKey, "total", "TOTAL-FIT", "total", existing.value, value);
          await db.update(dailyTotals).set({ value, updatedAt: jalaliNow(), shiftKey }).where(eq(dailyTotals.id, existing.id));
        } else {
          await db.insert(dailyTotals).values({ day, value, shiftKey, recordedAt: jalaliNow(), updatedAt: jalaliNow() });
        }
        await logActivity(shiftKey, "ثبت توتال روزانه", `${day} = ${value} m³`);
        return Response.json({ ok: true });
      }

      case "motor.values": {
        const tag = str(p.tag, 10);
        if (!MOTORS.some((m) => m.tag === tag)) throw new Error("موتور نامعتبر است");
        const values = (p.values ?? {}) as Record<string, unknown>;
        const cfg = await getAllSettings();
        let saved = 0;
        for (const [param, raw] of Object.entries(values)) {
          const meta = MOTOR_PARAMS.find((x) => x.key === param);
          if (!meta || raw === "" || raw === null || raw === undefined) continue;
          const value = num(raw);
          const existing = (await db.select().from(motorReadings).where(and(eq(motorReadings.tag, tag), eq(motorReadings.day, day), eq(motorReadings.intervalIndex, interval), eq(motorReadings.param, param))).limit(1))[0];
          if (existing) {
            await audit(shiftKey, "motor", tag, param, existing.value, value);
            await db.update(motorReadings).set({ value, updatedAt: jalaliNow(), shiftKey }).where(eq(motorReadings.id, existing.id));
          } else {
            await db.insert(motorReadings).values({ tag, day, intervalIndex: interval, param, value, shiftKey, recordedAt: jalaliNow(), updatedAt: jalaliNow() });
          }
          saved += 1;
          const limit =
            meta.type === "vib" ? { warn: cfg.vibWarn, crit: cfg.vibCrit, label: `لرزش ${meta.label}`, unit: "mm/s" }
            : meta.type === "bearing" ? { warn: cfg.bearingWarn, crit: cfg.bearingCrit, label: `دمای ${meta.label}`, unit: "°C" }
            : meta.type === "temp" ? { warn: cfg.windingWarn, crit: cfg.windingCrit, label: `دمای سیم‌پیچ ${meta.key}`, unit: "°C" }
            : { warn: cfg.currentWarn, crit: cfg.currentCrit, label: `جریان ${meta.label}`, unit: "A" };
          const severity = value > limit.crit ? "critical" : value > limit.warn ? "warning" : "ok";
          if (severity !== "ok") await addAlert({ tag, param, label: limit.label, value, severity, message: `${tag} / ${limit.label} = ${value} ${limit.unit} — بالاتر از حد ${severity === "critical" ? "بحرانی" : "هشدار"}`, day, shiftKey });
        }
        if (!saved) throw new Error("هیچ مقداری برای ثبت وارد نشده است");
        await logActivity(shiftKey, "ثبت داده موتور", `${tag} — ${saved} پارامتر — ${day} بازه ${interval + 1}`);
        return Response.json({ ok: true, message: `${saved} مقدار ثبت شد` });
      }

      case "motor.state": {
        const tag = str(p.tag, 10);
        const state = str(p.state, 10);
        if (!Object.keys(MOTOR_STATE_FA).includes(state)) throw new Error("وضعیت نامعتبر است");
        const row = (await db.select().from(motors).where(eq(motors.tag, tag)).limit(1))[0];
        if (!row) throw new Error("موتور پیدا نشد");
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
        if (!row) throw new Error("موتور پیدا نشد");
        if (hours < row.totalHours && !isAdmin) throw new Error("شمارنده کمتر از مقدار قبلی است؛ اصلاح فقط توسط ادمین با ذکر دلیل");
        if (hours < row.totalHours && !str(p.reason)) throw new Error("برای اصلاح شمارنده، دلیل را بنویسید");
        await audit(shiftKey, "hours", tag, "HMI", row.totalHours, hours);
        await db.update(motors).set({ totalHours: hours }).where(eq(motors.tag, tag));
        await logActivity(shiftKey, hours < row.totalHours ? "اصلاح شمارنده HMI (ادمین)" : "ثبت شمارنده HMI", `${tag}: ${row.totalHours} ← ${hours} ${str(p.reason)}`);
        return Response.json({ ok: true });
      }

      case "motor.service": {
        const tag = str(p.tag, 10);
        const row = (await db.select().from(motors).where(eq(motors.tag, tag)).limit(1))[0];
        if (!row) throw new Error("موتور پیدا نشد");
        const hours = p.hours === undefined || p.hours === "" ? row.totalHours : num(p.hours);
        const workers = str(p.workers, 200);
        const note = str(p.note, 1500);
        const brushRaw = (p.brush ?? {}) as Record<string, unknown>;
        const brush: Record<string, number> = {};
        for (const ph of ["U", "V", "W"]) for (let i = 1; i <= 8; i += 1) {
          const v = optNum(brushRaw[`${ph}${i}`]);
          if (v !== null) brush[`${ph}${i}`] = v;
        }
        const sid = (await db.insert(motorServices).values({ tag, day, hours, workers, note, brush, at: jalaliNow(), shiftKey, shiftLabel: shift.label }).returning({ id: motorServices.id }))[0].id;
        await db.update(motors).set({ totalHours: Math.max(hours, row.totalHours), lastServiceHours: hours, state: "off", stateChangedAt: jalaliNow() }).where(eq(motors.tag, tag));
        await db.insert(motorStateLogs).values({ tag, fromState: row.state, toState: "off", at: jalaliNow(), shiftKey });
        await db.insert(equipmentReports).values({ tag, kind: "motor_service", reason: `سرویس ماهانه — ساعت ${hours}${note ? ` — ${note}` : ""}`, operator: workers || shift.label, shiftKey, at: jalaliNow() });
        await db.update(equipment).set({ description: `سرویس ماهانه انجام شد (ساعت ${hours})${note ? ` — ${note}` : ""}`, descriptionAt: jalaliNow(), descriptionBy: workers || shift.label, status: "ready", updatedAt: jalaliNow() }).where(eq(equipment.tag, tag));
        const latest = await latestMotorRecords(tag);
        const rid = await createReport({ kind: "motor_service", day, shift, title: `سرویس موتور ${tag} — ${day}`, payload: { serviceId: sid, tag, pumpTag: row.pumpTag, day, hours, workers, note, brush, megger: latest.megger, oil: latest.oil, generatedAt: jalaliNow() } });
        await logActivity(shiftKey, "ثبت سرویس موتور", `${tag} — ساعت ${hours} — ${workers}`);
        return Response.json({ ok: true, id: rid, message: "سرویس ثبت و گزارش آن ساخته شد" });
      }

      case "motor.megger": {
        const tag = str(p.tag, 10);
        if (!MOTORS.some((m) => m.tag === tag)) throw new Error("موتور نامعتبر است");
        const testVoltage = Number(p.testVoltage ?? 1000);
        if (![500, 1000, 2500, 5000].includes(testVoltage)) throw new Error("ولتاژ تست نامعتبر است");
        const rec = {
          tag, day, testVoltage,
          statorU: optNum(p.statorU), statorV: optNum(p.statorV), statorW: optNum(p.statorW),
          rotorU: optNum(p.rotorU), rotorV: optNum(p.rotorV), rotorW: optNum(p.rotorW),
          windingTemp: optNum(p.windingTemp), pi: optNum(p.pi),
          workers: str(p.workers, 200), note: str(p.note, 1000), at: jalaliNow(), shiftKey,
        };
        if ([rec.statorU, rec.statorV, rec.statorW, rec.rotorU, rec.rotorV, rec.rotorW, rec.windingTemp, rec.pi].every((v) => v === null)) throw new Error("حداقل یک مقدار تست را وارد کنید");
        const id = (await db.insert(meggerTests).values(rec).returning({ id: meggerTests.id }))[0].id;
        const rid = await createReport({ kind: "megger", day, shift, title: `تست مگر ${tag} — ${day}`, payload: { ...rec, meggerId: id, generatedAt: jalaliNow() } });
        await logActivity(shiftKey, "ثبت تست مگر", `${tag} — ${testVoltage} V`);
        return Response.json({ ok: true, id: rid });
      }

      case "motor.oil": {
        const tag = str(p.tag, 10);
        if (!MOTORS.some((m) => m.tag === tag)) throw new Error("موتور نامعتبر است");
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
        if (!["ready", "in_service"].includes(status)) throw new Error("وضعیت نامعتبر است");
        const row = (await db.select().from(equipment).where(eq(equipment.tag, tag)).limit(1))[0];
        if (!row) throw new Error("تجهیز پیدا نشد");
        if (status === "in_service" && reason.length < 3) throw new Error("برای «در حال سرویس» توضیحات/دلیل سرویس را بنویسید");
        await db.update(equipment).set({ status, description: reason || row.description, descriptionAt: reason ? jalaliNow() : row.descriptionAt, descriptionBy: reason ? shift.label : row.descriptionBy, updatedAt: jalaliNow() }).where(eq(equipment.tag, tag));
        await db.insert(equipmentReports).values({ tag, kind: status === "in_service" ? "service" : "ready", reason: reason || "بازگشت به آماده به کار", operator: shift.label, shiftKey, at: jalaliNow() });
        if (row.isMotor) {
          await db.update(motors).set({ state: status === "in_service" ? "service" : "off", stateChangedAt: jalaliNow() }).where(eq(motors.tag, tag));
        }
        await logActivity(shiftKey, status === "in_service" ? "تجهیز به حال سرویس رفت" : "تجهیز آماده به کار شد", `${tag} — ${reason}`);
        return Response.json({ ok: true });
      }

      case "equipment.report": {
        const tag = str(p.tag, 40);
        const reason = str(p.reason, 1500);
        if (reason.length < 3) throw new Error("متن گزارش سرویس را بنویسید");
        const row = (await db.select().from(equipment).where(eq(equipment.tag, tag)).limit(1))[0];
        if (!row) throw new Error("تجهیز پیدا نشد");
        await db.insert(equipmentReports).values({ tag, kind: "report", reason, operator: shift.label, shiftKey, at: jalaliNow() });
        await db.update(equipment).set({ description: reason, descriptionAt: jalaliNow(), descriptionBy: shift.label, updatedAt: jalaliNow() }).where(eq(equipment.tag, tag));
        await logActivity(shiftKey, "گزارش سرویس دستی", `${tag} — ${reason}`);
        return Response.json({ ok: true });
      }

      case "equipment.save": {
        requireAdmin();
        const id = p.id ? Number(p.id) : null;
        const tag = str(p.tag, 40).toUpperCase();
        if (tag.length < 2) throw new Error("تگ تجهیز را وارد کنید");
        const category = str(p.category, 100);
        if (!CATEGORIES.includes(category) && !category) throw new Error("دسته را انتخاب کنید");
        const data = {
          tag, name: str(p.name, 200) || tag, category, spec: str(p.spec, 400), plate: str(p.plate, 400), partNumbers: str(p.partNumbers, 600), location: str(p.location, 200),
          isAux: p.isAux === true, safetyCritical: p.safetyCritical === true, updatedAt: jalaliNow(),
        };
        const dup = (await db.select().from(equipment).where(eq(equipment.tag, tag)).limit(1))[0];
        if (id) {
          if (dup && dup.id !== id) throw new Error("این تگ برای تجهیز دیگری ثبت شده است");
          await db.update(equipment).set(data).where(eq(equipment.id, id));
          await logActivity(shiftKey, "ویرایش رکورد تجهیز", tag);
        } else {
          if (dup) throw new Error("این تگ قبلاً ثبت شده است");
          await db.insert(equipment).values({ ...data, status: "ready", description: "", descriptionAt: "", descriptionBy: "", deletedAt: "" });
          await logActivity(shiftKey, "افزودن رکورد تجهیز", `${tag} — ${category}`);
        }
        return Response.json({ ok: true });
      }

      case "equipment.delete": {
        requireAdmin();
        const id = Number(p.id);
        const row = (await db.select().from(equipment).where(eq(equipment.id, id)).limit(1))[0];
        if (!row) throw new Error("تجهیز پیدا نشد");
        if (row.isMotor) throw new Error("موتورهای اصلی حذف‌شدنی نیستند");
        await db.update(equipment).set({ deletedAt: jalaliNow(), updatedAt: jalaliNow() }).where(eq(equipment.id, id));
        await logActivity(shiftKey, "حذف (نرم) تجهیز", `${row.tag} — ${str(p.reason, 300)}`);
        return Response.json({ ok: true, message: "تجهیز از فهرست برداشته شد (سابقه حفظ می‌شود)" });
      }

      case "catalog.delete": {
        requireAdmin();
        const id = Number(p.id);
        await db.delete(catalogs).where(eq(catalogs.id, id));
        await logActivity(shiftKey, "حذف کاتالوگ", String(id));
        return Response.json({ ok: true });
      }

      case "pm.template": {
        requireAdmin();
        const id = p.id ? Number(p.id) : null;
        const category = str(p.category, 100);
        const name = str(p.name, 200);
        const items = Array.isArray(p.items) ? p.items.map((x) => str(x, 200)).filter(Boolean) : [];
        if (!name || !items.length) throw new Error("نام قالب و حداقل یک آیتم لازم است");
        if (id) await db.update(pmTemplates).set({ category, name, items, updatedAt: jalaliNow() }).where(eq(pmTemplates.id, id));
        else await db.insert(pmTemplates).values({ category, name, items, updatedAt: jalaliNow() });
        await logActivity(shiftKey, "ویرایش قالب PM", `${category} — ${name}`);
        return Response.json({ ok: true });
      }

      case "pm.record": {
        const tag = str(p.tag, 40);
        const row = (await db.select().from(equipment).where(eq(equipment.tag, tag)).limit(1))[0];
        if (!row) throw new Error("تجهیز پیدا نشد");
        const results = (p.results ?? {}) as Record<string, unknown>;
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(results)) clean[str(k, 200)] = str(v, 300);
        if (!Object.keys(clean).length) throw new Error("حداقل یک آیتم چک‌لیست را تکمیل کنید");
        const rec = { tag, templateName: str(p.templateName, 200), results: clean, workers: str(p.workers, 200), note: str(p.note, 1500), day, at: jalaliNow(), shiftKey };
        const id = (await db.insert(pmRecords).values(rec).returning({ id: pmRecords.id }))[0].id;
        await db.insert(equipmentReports).values({ tag, kind: "pm", reason: `PM: ${rec.templateName}${rec.note ? ` — ${rec.note}` : ""}`, operator: rec.workers || shift.label, shiftKey, at: jalaliNow() });
        const rid = await createReport({ kind: "pm", day, shift, title: `PM ${tag} — ${day}`, payload: { ...rec, pmId: id, name: row.name, category: row.category, generatedAt: jalaliNow() } });
        await logActivity(shiftKey, "ثبت PM", `${tag} — ${rec.templateName}`);
        return Response.json({ ok: true, id: rid });
      }

      case "alert.ack": {
        const id = Number(p.id);
        const kind = str(p.kind, 10);
        const row = (await db.select().from(alerts).where(eq(alerts.id, id)).limit(1))[0];
        if (!row) throw new Error("هشدار پیدا نشد");
        if (kind === "seen") await db.update(alerts).set({ seenAt: jalaliNow(), seenShift: shift.label }).where(eq(alerts.id, id));
        else if (kind === "acted") await db.update(alerts).set({ actedAt: jalaliNow(), actedShift: shift.label, ...(row.seenAt ? {} : { seenAt: jalaliNow(), seenShift: shift.label }) }).where(eq(alerts.id, id));
        else throw new Error("نوع تأیید نامعتبر است");
        await logActivity(shiftKey, kind === "seen" ? "تأیید «دیدم» هشدار" : "تأیید «اقدام کردم» هشدار", String(id));
        return Response.json({ ok: true });
      }

      case "note.save": {
        const text = str(p.text, 4000);
        const existing = (await db.select().from(operatorNotes).where(and(eq(operatorNotes.day, day), eq(operatorNotes.shiftKey, shiftKey))).limit(1))[0];
        if (existing) await db.update(operatorNotes).set({ text, updatedAt: jalaliNow() }).where(eq(operatorNotes.id, existing.id));
        else await db.insert(operatorNotes).values({ day, shiftKey, text, updatedAt: jalaliNow() });
        await logActivity(shiftKey, "ثبت گزارش دستی اپراتور", day);
        return Response.json({ ok: true });
      }

      case "problem.add": {
        const text = str(p.text, 2000);
        if (text.length < 3) throw new Error("متن گزارش مشکل را کامل‌تر بنویسید");
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
          if (tScope === "motor" && !tCompare && !MOTORS.some((m) => m.tag === tTag)) throw new Error("موتور نامعتبر است");
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
        throw new Error("نوع گزارش نامعتبر است");
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
            const url = ch.provider === "eitaa" ? `https://eitaayar.ir/api/${ch.token}/sendMessage` : `https://tapi.bale.ai/bot${ch.token}/sendMessage`;
            const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: ch.chatId, text: `${report?.title ?? ""}\n${report?.operators ?? ""}` }), signal: AbortSignal.timeout(15000) });
            if (!res.ok) throw new Error(`پاسخ ${res.status}`);
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
        if (!["daily", "backup"].includes(key)) throw new Error("کانال نامعتبر است");
        const existing = (await db.select().from(channels).where(eq(channels.key, key)).limit(1))[0];
        const token = str(p.token, 300);
        await db.update(channels).set({ provider: str(p.provider, 10) === "eitaa" ? "eitaa" : "bale", chatId: str(p.chatId, 100), token: token || existing?.token || "", enabled: p.enabled === true }).where(eq(channels.key, key));
        await logActivity(shiftKey, "ویرایش کانال ارسال", key);
        return Response.json({ ok: true });
      }

      case "admin.settings": {
        requireAdmin();
        const incoming = (p.settings ?? {}) as Partial<Record<keyof Settings, unknown>>;
        const clean: Partial<Settings> = {};
        for (const key of ["serviceInterval", "vibWarn", "vibCrit", "windingWarn", "windingCrit", "bearingWarn", "bearingCrit", "currentWarn", "currentCrit"] as const) {
          if (incoming[key] !== undefined) clean[key] = num(incoming[key]);
        }
        if (clean.serviceInterval !== undefined && clean.serviceInterval < 100) throw new Error("بازه سرویس باید حداقل ۱۰۰ ساعت باشد");
        if (clean.vibWarn !== undefined && clean.vibCrit !== undefined && clean.vibWarn >= clean.vibCrit) throw new Error("حد هشدار لرزش باید کمتر از حد بحرانی باشد");
        await saveSettings(clean);
        await logActivity(shiftKey, "ویرایش تنظیمات/ست‌پوینت", JSON.stringify(clean));
        return Response.json({ ok: true });
      }

      case "admin.setpoints": {
        requireAdmin();
        const tag = str(p.tag, 20);
        if (!PROCESS_PARAMS.some((x) => x.tag === tag)) throw new Error("پارامتر نامعتبر است");
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
        if (!["A", "B", "C", "admin"].includes(key)) throw new Error("شیفت نامعتبر است");
        if (!/^\d{4}$/.test(pin)) throw new Error("PIN باید دقیقاً چهار رقم باشد");
        await db.update(shifts).set({ pin: hashPin(pin) }).where(eq(shifts.key, key));
        await logActivity(shiftKey, "تغییر PIN شیفت", key);
        return Response.json({ ok: true });
      }

      case "admin.members": {
        requireAdmin();
        const key = str(p.key, 10);
        const members = Array.isArray(p.members) ? p.members.map((m) => str(m, 80)).filter(Boolean).slice(0, 4) : [];
        if (!members.length) throw new Error("حداقل یک نام لازم است");
        await db.update(shifts).set({ members }).where(eq(shifts.key, key));
        await logActivity(shiftKey, "ویرایش اعضای شیفت", `${key}: ${members.join(" و ")}`);
        return Response.json({ ok: true });
      }

      case "admin.shift": {
        requireAdmin();
        const key = p.key === null || p.key === "" || p.key === "auto" ? "" : str(p.key, 5);
        if (key && !["A", "B", "C"].includes(key)) throw new Error("شیفت نامعتبر است");
        await saveSettings({ shiftOverride: key });
        await logActivity(shiftKey, "تنظیم شیفت فعال", key || "چرخش خودکار");
        return Response.json({ ok: true });
      }

      case "backup.create": {
        requireAdmin();
        const payload = await snapshotAll();
        const size = Buffer.byteLength(JSON.stringify(payload), "utf8");
        const row = await db.insert(backups).values({ label: `بک‌آپ دستی ${jalaliNow()}`, createdAt: jalaliNow(), sizeBytes: size, payload }).returning({ id: backups.id });
        await logActivity(shiftKey, "ساخت بک‌آپ کامل", `${row[0]?.id ?? "-"} — ${(size / 1024).toFixed(1)} KB`);
        return Response.json({ ok: true, id: row[0]?.id });
      }

      case "backup.restore": {
        requireAdmin();
        const id = Number(p.id);
        const row = (await db.select().from(backups).where(eq(backups.id, id)).limit(1))[0];
        if (!row) throw new Error("بک‌آپ پیدا نشد");
        const safety = await snapshotAll();
        await db.insert(backups).values({ label: `نسخه ایمنی قبل از بازیابی ${jalaliNow()}`, createdAt: jalaliNow(), sizeBytes: Buffer.byteLength(JSON.stringify(safety), "utf8"), payload: safety });
        await restoreAll(row.payload as Snapshot);
        await logActivity(shiftKey, "بازیابی بک‌آپ", `شناسه ${id}`);
        return Response.json({ ok: true });
      }

      default:
        return Response.json({ ok: false, error: "عملیات ناشناخته" }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "خطای نامشخص";
    try {
      await db.insert(problems).values({ at: jalaliNow(), shiftKey, text: `[سیستمی] ${action}: ${message}`, internal: true });
    } catch {
      /* ثبت خطای فنی نباید عملیات اصلی را متوقف کند */
    }
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}

type Snapshot = Record<string, unknown[]>;
const TABLES = {
  valueAudits, processReadings, dailyTotals, motorReadings, motorStateLogs, motorServices, meggerTests, oilChanges, equipmentReports,
  pmRecords, pmTemplates, catalogs, alerts, activity, problems, sendQueue, reports, operatorNotes, motors, equipment, channels, shifts, settings,
};

async function snapshotAll(): Promise<Snapshot> {
  const out: Snapshot = {};
  for (const [name, table] of Object.entries(TABLES)) out[name] = await db.select().from(table);
  return out;
}

async function restoreAll(snapshot: Snapshot) {
  for (const [name, table] of Object.entries(TABLES)) {
    const rows = Array.isArray(snapshot[name]) ? (snapshot[name] as Record<string, unknown>[]) : null;
    if (!rows) continue;
    await db.delete(table);
    if (rows.length) await db.insert(table).values(rows as never);
  }
}
