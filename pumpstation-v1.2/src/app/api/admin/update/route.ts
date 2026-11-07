import { randomBytes } from "node:crypto";
import { appendFile, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { getSessionUser } from "@/lib/auth";
import { currentAppVersion, fetchUpdateManifest, isNewerVersion, readUpdateStatus } from "@/lib/updater";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dataRoot() {
  const configured = process.env.PUMPSTATION_DATA_ROOT?.trim();
  if (configured) return path.resolve(configured);
  const pglite = process.env.PGLITE_DATA_DIR?.trim();
  if (pglite) return path.dirname(path.resolve(pglite));
  return "";
}

async function recordUpdateError(stage: string, error: unknown) {
  const logFile = process.env.PUMPSTATION_UPDATE_LOG_FILE || path.join(dataRoot() || process.cwd(), "logs", "auto-update.log");
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  try {
    await mkdir(path.dirname(logFile), { recursive: true });
    await appendFile(logFile, `${new Date().toISOString()}  ERROR ${stage}: ${detail}\n`, "utf8");
  } catch {
    // Keep the request response useful even if the diagnostic path is unavailable.
  }
}

function visibleUpdateStatus() {
  const status = readUpdateStatus();
  if (status.phase !== "preparing" && status.phase !== "restarting") return status;
  const updatedAt = Date.parse(status.updatedAt ?? "");
  if (Number.isFinite(updatedAt) && Date.now() - updatedAt < 45 * 60 * 1000) return status;
  return { ...status, phase: "failed" as const, message: "فرایند به‌روزرسانی قبلی کامل نشد یا وضعیت آن قدیمی است؛ بررسی تازه را اجرا کنید." };
}

async function adminOnly() {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "ابتدا وارد سامانه شوید" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ ok: false, error: "دسترسی ادمین لازم است" }, { status: 403 });
  return null;
}

export async function GET() {
  const denied = await adminOnly();
  if (denied) return denied;
  const currentVersion = currentAppVersion();
  try {
    const manifest = await fetchUpdateManifest();
    return Response.json({
      ok: true,
      currentVersion,
      latestVersion: manifest.version,
      updateAvailable: isNewerVersion(manifest.version, currentVersion),
      notes: manifest.notes,
      publishedAt: manifest.publishedAt,
      status: visibleUpdateStatus(),
      enabled: Boolean(process.env.PUMPSTATION_HOME && process.env.PUMPSTATION_LAUNCHER && process.env.PGLITE_DATA_DIR),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await recordUpdateError("update check", error);
    return Response.json({
      ok: false,
      currentVersion,
      status: visibleUpdateStatus(),
      error: error instanceof Error ? error.message : "بررسی نسخهٔ جدید ناموفق بود",
      enabled: Boolean(process.env.PUMPSTATION_HOME && process.env.PUMPSTATION_LAUNCHER && process.env.PGLITE_DATA_DIR),
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST() {
  const denied = await adminOnly();
  if (denied) return denied;
  if (!process.env.PUMPSTATION_HOME || !process.env.PUMPSTATION_LAUNCHER || !process.env.PUMPSTATION_LAUNCHER_KIND || !process.env.PGLITE_DATA_DIR) {
    return Response.json({ ok: false, error: "این نصب، راه‌انداز پایدار برای به‌روزرسانی خودکار ندارد. از بستهٔ نصب رسمی و راه‌انداز Pumpstation استفاده کنید." }, { status: 409 });
  }
  if ((process.env.DATABASE_URL ?? "").trim()) {
    return Response.json({ ok: false, error: "به‌روزرسانی خودکار فعلاً فقط برای پایگاه‌دادهٔ محلی PGlite فعال است؛ PostgreSQL سروری تغییر داده نشد." }, { status: 409 });
  }
  const data = dataRoot();
  if (!data) return Response.json({ ok: false, error: "مسیر پایدار دادهٔ برنامه تنظیم نشده است." }, { status: 409 });

  let manifest;
  try {
    manifest = await fetchUpdateManifest();
  } catch (error) {
    await recordUpdateError("update start check", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "دریافت نسخه ناموفق بود" }, { status: 503 });
  }
  const currentVersion = currentAppVersion();
  if (!isNewerVersion(manifest.version, currentVersion)) {
    return Response.json({ ok: false, error: `نسخهٔ جدیدتری از نسخهٔ فعلی (${currentVersion}) پیدا نشد.` }, { status: 409 });
  }

  const state = readUpdateStatus();
  const stateTime = Date.parse(state.updatedAt ?? "");
  const activeUpdate = state.phase === "preparing" || state.phase === "restarting";
  if (activeUpdate && Number.isFinite(stateTime) && Date.now() - stateTime < 45 * 60 * 1000) {
    return Response.json({ ok: false, error: "یک به‌روزرسانی در حال اجراست." }, { status: 409 });
  }

  const runtimeDir = path.join(data, "update-agent");
  const statusFile = process.env.PUMPSTATION_UPDATE_STATUS_FILE || path.join(data, "update-status.json");
  const logFile = process.env.PUMPSTATION_UPDATE_LOG_FILE || path.join(data, "logs", "auto-update.log");
  const lockFile = process.env.PUMPSTATION_UPDATE_LOCK_FILE || path.join(data, "update.lock");
  const runnerSource = path.join(process.cwd(), "scripts", "update-runner.mjs");
  const runnerTarget = path.join(runtimeDir, "update-runner.mjs");
  const token = randomBytes(32).toString("hex");
  try {
    await mkdir(runtimeDir, { recursive: true });
    await mkdir(path.dirname(statusFile), { recursive: true });
    await mkdir(path.dirname(logFile), { recursive: true });
    await copyFile(runnerSource, runnerTarget);
    await writeFile(statusFile, JSON.stringify({ phase: "preparing", message: `آماده‌سازی نسخهٔ ${manifest.version}؛ اطلاعات عملیاتی دست‌نخورده می‌ماند.`, version: manifest.version, updatedAt: new Date().toISOString(), logPath: logFile }, null, 2), "utf8");
    process.env.PUMPSTATION_UPDATE_STOP_TOKEN = token;
    const child = spawn(process.execPath, [runnerTarget], {
      cwd: runtimeDir,
      detached: true,
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        PS_UPDATE_MANIFEST_JSON: JSON.stringify(manifest),
        PS_UPDATE_APP_DIR: process.cwd(),
        PS_UPDATE_STATUS_FILE: statusFile,
        PS_UPDATE_LOG_FILE: logFile,
        PS_UPDATE_LOCK_FILE: lockFile,
        PS_UPDATE_DATA_ROOT: data,
        PS_UPDATE_STOP_TOKEN: token,
      },
    });
    child.unref();
    return Response.json({ ok: true, phase: "preparing", version: manifest.version, message: "بسته در پس‌زمینه آماده می‌شود؛ پس از پشتیبان‌گیری، توقف کوتاه و راه‌اندازی خودکار انجام خواهد شد." }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ساخت فرایند به‌روزرسان ناموفق بود";
    await recordUpdateError("updater launch", error);
    await writeFile(statusFile, JSON.stringify({ phase: "failed", message, updatedAt: new Date().toISOString(), logPath: logFile }, null, 2), "utf8").catch(() => {});
    return Response.json({ ok: false, error: `شروع به‌روزرسان ناموفق بود: ${message}` }, { status: 500 });
  }
}
