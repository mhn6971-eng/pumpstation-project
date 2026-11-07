import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { appendFile, copyFile, mkdir, open, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shifts } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { logActivity } from "@/lib/state";
import { recordEvent } from "@/lib/log";
import { verifyPin } from "@/lib/pin";
import { currentAppVersion, isNewerVersion, readUpdateStatus, type UpdateStatus } from "@/lib/updater";
import { inspectUpdateZip } from "@/lib/update-zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const execFile = promisify(execFileCallback);
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const UPDATE_AGENT_NAME = ".pumpstation-update-agent";

type AdminUser = { key: string; role: string };

function appDir() {
  return path.resolve(process.env.PUMPSTATION_APP_DIR?.trim() || process.cwd());
}

function dataRoot() {
  const configured = process.env.PUMPSTATION_DATA_ROOT?.trim();
  if (configured) return path.resolve(configured);
  const pglite = process.env.PGLITE_DATA_DIR?.trim();
  if (pglite) return path.dirname(path.resolve(pglite));
  return "";
}

function agentDir() {
  // Keep the detached updater outside appDir: Windows cannot rename a directory
  // while the running updater has that directory as its working directory.
  return path.join(path.dirname(appDir()), UPDATE_AGENT_NAME);
}

function statusFile() {
  return path.resolve(process.env.PUMPSTATION_UPDATE_STATUS_FILE?.trim() || path.join(dataRoot() || agentDir(), "update-status.json"));
}

function logFile() {
  return path.resolve(process.env.PUMPSTATION_UPDATE_LOG_FILE?.trim() || path.join(dataRoot() || agentDir(), "logs", "auto-update.log"));
}

function lockFile() {
  return path.resolve(process.env.PUMPSTATION_UPDATE_LOCK_FILE?.trim() || path.join(dataRoot() || agentDir(), "update.lock"));
}

function enabled() {
  return Boolean(
    process.env.PUMPSTATION_HOME && process.env.PUMPSTATION_LAUNCHER &&
    process.env.PUMPSTATION_LAUNCHER_KIND && process.env.PGLITE_DATA_DIR,
  );
}

async function adminOnly(): Promise<AdminUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "ابتدا وارد سامانه شوید" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ ok: false, error: "دسترسی ادمین لازم است" }, { status: 403 });
  return user as AdminUser;
}

function isDenied(value: AdminUser | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

async function writeStatus(status: UpdateStatus) {
  const target = statusFile();
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(status, null, 2), "utf8");
  await rename(temp, target);
}

async function hashFile(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function readLogTail(file: string) {
  try {
    const handle = await open(file, "r");
    try {
      const size = (await handle.stat()).size;
      const length = Math.min(size, 128 * 1024);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, Math.max(0, size - length));
      return buffer.toString("utf8").split(/\r?\n/).slice(-100).join("\n");
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

function visibleStatus(): UpdateStatus {
  const status = readUpdateStatus();
  if (status.phase !== "preparing" && status.phase !== "restarting") return status;
  const updatedAt = Date.parse(status.updatedAt ?? "");
  if (Number.isFinite(updatedAt) && Date.now() - updatedAt < 45 * 60 * 1000) return status;
  return { ...status, phase: "failed", message: "وضعیت به‌روزرسانی قبلی بیش از ۴۵ دقیقه قدیمی است؛ لاگ را بررسی و سامانه را دستی کنترل کنید." };
}

function active(status: UpdateStatus) {
  if (status.phase !== "preparing" && status.phase !== "restarting") return false;
  const updatedAt = Date.parse(status.updatedAt ?? "");
  return Number.isFinite(updatedAt) && Date.now() - updatedAt < 45 * 60 * 1000;
}

function checkRuntime() {
  if (!enabled()) return "این نصب راه‌انداز پایدار ندارد؛ به‌روزرسانی ZIP در این شیوهٔ اجرا فعال نیست.";
  if ((process.env.DATABASE_URL ?? "").trim()) return "به‌روزرسانی خودکار فقط برای پایگاه‌دادهٔ محلی PGlite فعال است؛ PostgreSQL سروری تغییر داده نشد.";
  const kind = process.env.PUMPSTATION_LAUNCHER_KIND;
  if (kind !== "wscript" && kind !== "powershell") return "نوع راه‌انداز نصب‌شده پشتیبانی نمی‌شود.";
  if (!existsSync(process.env.PUMPSTATION_LAUNCHER ?? "")) return "فایل راه‌انداز پایدار پیدا نشد.";
  if (!existsSync(path.join(appDir(), "package.json"))) return "پوشهٔ برنامهٔ فعال پیدا نشد.";
  return "";
}

declare global {
  var __psDesktopShortcutRefresh: Promise<void> | undefined;
}

async function refreshProductionShortcutOnce() {
  if (process.platform !== "win32" || process.env.PUMPSTATION_LAUNCHER_KIND !== "powershell") return;
  if (!globalThis.__psDesktopShortcutRefresh) {
    globalThis.__psDesktopShortcutRefresh = (async () => {
      const installRoot = path.dirname(path.resolve(process.env.PUMPSTATION_LAUNCHER ?? ""));
      if (process.env.PUMPSTATION_HOME && path.resolve(process.env.PUMPSTATION_HOME) !== installRoot) return;
      const launcherSource = path.join(appDir(), "launch-pumpstation.ps1");
      const wrapperSource = path.join(appDir(), "launch-pumpstation.vbs");
      if (!existsSync(launcherSource) || !existsSync(wrapperSource)) return;
      await copyFile(launcherSource, path.join(installRoot, "launch-pumpstation.ps1"));
      await copyFile(wrapperSource, path.join(installRoot, "launch-pumpstation.vbs"));

      const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
      const wscript = path.join(process.env.SystemRoot ?? "C:\Windows", "System32", "wscript.exe");
      const wrapper = path.join(installRoot, "launch-pumpstation.vbs");
      const icon = path.join(appDir(), "public", "brand", "logo.ico");
      const script = [
        "$ErrorActionPreference='Stop'",
        "$shell=New-Object -ComObject WScript.Shell",
        `$target=${psQuote(wscript)}`,
        `$vbs=${psQuote(wrapper)}`,
        `$icon=${psQuote(icon)}`,
        "$targets=@((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Pumpstation.lnk'),(Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\\Pumpstation.lnk'))",
        "foreach($p in $targets){$parent=Split-Path -Parent $p;New-Item -ItemType Directory -Path $parent -Force|Out-Null;$s=$shell.CreateShortcut($p);$s.TargetPath=$target;$s.Arguments=([char]34+$vbs+[char]34);$s.WorkingDirectory=Split-Path -Parent $vbs;$s.Description='اجرای سامانهٔ Pumpstation';if(Test-Path -LiteralPath $icon){$s.IconLocation=$icon+',0'};$s.Save()}",
      ].join(";");
      await execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], {
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
    })().catch(async (error) => {
      await appendFile(logFile(), `${new Date().toISOString()}  WARN shortcut refresh failed: ${error instanceof Error ? error.message : error}\n`).catch(() => {});
    });
  }
  await globalThis.__psDesktopShortcutRefresh;
}

export async function GET() {
  const user = await adminOnly();
  if (isDenied(user)) return user;
  await refreshProductionShortcutOnce();
  const currentVersion = currentAppVersion();
  return NextResponse.json({
    ok: true,
    currentVersion,
    status: visibleStatus(),
    enabled: !checkRuntime(),
    logTail: await readLogTail(logFile()),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await adminOnly();
  if (isDenied(user)) return user;
  const unavailable = checkRuntime();
  if (unavailable) return NextResponse.json({ ok: false, error: unavailable }, { status: 409 });

  const contentType = request.headers.get("content-type") ?? "";
  const currentVersion = currentAppVersion();
  const current = visibleStatus();
  if (active(current)) return NextResponse.json({ ok: false, error: "یک به‌روزرسانی در حال اجراست." }, { status: 409 });

  // Phase 1: accept an administrator-selected ZIP, inspect it without extracting,
  // then keep the exact archive outside the application directory.
  if (contentType.toLowerCase().includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ ok: false, error: "فرم فایل ZIP قابل‌خواندن نیست." }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "فایل ZIP انتخاب نشده است." }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".zip")) return NextResponse.json({ ok: false, error: "فقط فایل با پسوند ZIP پذیرفته می‌شود." }, { status: 400 });
    if (file.size < 1024 || file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ ok: false, error: "حجم فایل ZIP باید بین ۱ کیلوبایت و ۱۰۰ مگابایت باشد." }, { status: 413 });
    }

    let bytes: Buffer;
    let packageInfo;
    try {
      bytes = Buffer.from(await file.arrayBuffer());
      packageInfo = await inspectUpdateZip(bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : "ساختار ZIP معتبر نیست";
      return NextResponse.json({ ok: false, error: `فایل ZIP پذیرفته نشد: ${message}` }, { status: 400 });
    }

    if (!isNewerVersion(packageInfo.version, currentVersion)) {
      const relation = packageInfo.version === currentVersion ? "با نسخهٔ نصب‌شده برابر است" : "از نسخهٔ نصب‌شده قدیمی‌تر است";
      return NextResponse.json({ ok: false, error: `نسخهٔ ZIP (${packageInfo.version}) ${relation}.` }, { status: 409 });
    }

    const id = randomUUID();
    const uploadDir = path.join(agentDir(), "uploads");
    const archive = path.join(uploadDir, `${id}.zip`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    try {
      await mkdir(uploadDir, { recursive: true });
      await writeFile(archive, bytes, { flag: "wx" });
    } catch (error) {
      return NextResponse.json({ ok: false, error: `ذخیرهٔ فایل برای به‌روزرسانی ناموفق بود: ${error instanceof Error ? error.message : "خطای دیسک"}` }, { status: 500 });
    }

    const nextStatus: UpdateStatus = {
      phase: "staged",
      message: `فایل ${file.name.slice(0, 180)} بررسی شد و برای تأیید آماده است.`,
      version: packageInfo.version,
      updatedAt: new Date().toISOString(),
      stageId: id,
      fileName: file.name.slice(0, 180),
      sha256,
      sizeBytes: bytes.length,
      entryCount: packageInfo.entryCount,
      logPath: logFile(),
    };
    try {
      await writeStatus(nextStatus);
    } catch (error) {
      await rm(archive, { force: true }).catch(() => {});
      return NextResponse.json({ ok: false, error: `وضعیت فایل ذخیره نشد: ${error instanceof Error ? error.message : "خطا"}` }, { status: 500 });
    }

    // Remove only older, unreferenced upload archives; never touch the active app/data.
    for (const name of await readdir(uploadDir).catch(() => [])) {
      if (name !== `${id}.zip` && /^[0-9a-f-]{36}\.zip$/i.test(name)) {
        await rm(path.join(uploadDir, name), { force: true }).catch(() => {});
      }
    }

    return NextResponse.json({
      ok: true,
      staged: true,
      stageId: id,
      currentVersion,
      newVersion: packageInfo.version,
      fileName: nextStatus.fileName,
      sizeBytes: bytes.length,
      sha256,
      entryCount: packageInfo.entryCount,
    });
  }

  // Phase 2: a separate PIN and explicit confirmation are required to apply it.
  let body: { pin?: unknown; confirm?: unknown; stageId?: unknown } | null;
  try {
    body = await request.json() as { pin?: unknown; confirm?: unknown; stageId?: unknown };
  } catch {
    body = null;
  }
  if (!body || body.confirm !== true || typeof body.pin !== "string" || typeof body.stageId !== "string") {
    return NextResponse.json({ ok: false, error: "تأیید، شناسهٔ فایل و PIN مدیر لازم است." }, { status: 400 });
  }
  if (!/^[0-9]{4,6}$/.test(body.pin.trim())) return NextResponse.json({ ok: false, error: "PIN باید ۴ تا ۶ رقم باشد." }, { status: 400 });
  if (body.stageId !== current.stageId || current.phase !== "staged" || !current.version || !current.sha256) {
    return NextResponse.json({ ok: false, error: "فایل آماده‌شده منقضی شده است؛ ZIP را دوباره انتخاب کنید." }, { status: 409 });
  }
  const row = (await db.select().from(shifts).where(eq(shifts.key, user.key)).limit(1))[0];
  if (!row || !verifyPin(body.pin.trim(), row.pin)) return NextResponse.json({ ok: false, error: "PIN مدیر نادرست است." }, { status: 401 });
  if (!isNewerVersion(current.version, currentVersion)) return NextResponse.json({ ok: false, error: "نسخهٔ آماده دیگر از نسخهٔ نصب‌شده جدیدتر نیست." }, { status: 409 });

  const uploadDir = path.join(agentDir(), "uploads");
  const stagedZip = path.join(uploadDir, `${current.stageId}.zip`);
  try {
    const details = await stat(stagedZip);
    if (details.size !== current.sizeBytes || details.size > MAX_UPLOAD_BYTES) throw new Error("اندازهٔ فایل تغییر کرده یا معتبر نیست");
    const actualHash = await hashFile(stagedZip);
    if (actualHash !== current.sha256) throw new Error("SHA-256 فایل با مقدار ثبت‌شده یکسان نیست");
  } catch (error) {
    return NextResponse.json({ ok: false, error: `فایل آماده برای اعمال نیست: ${error instanceof Error ? error.message : "خطای فایل"}` }, { status: 409 });
  }

  const data = dataRoot();
  if (!data) return NextResponse.json({ ok: false, error: "مسیر پایدار دادهٔ برنامه تنظیم نشده است." }, { status: 409 });
  const runtimeDir = path.join(agentDir(), "runtime");
  const runnerSource = path.join(appDir(), "scripts", "update-runner.mjs");
  const runnerTarget = path.join(runtimeDir, "update-runner.mjs");
  const token = randomBytes(32).toString("hex");
  const nextStatus: UpdateStatus = {
    ...current,
    phase: "preparing",
    message: `بستهٔ نسخهٔ ${current.version} بررسی شد؛ آماده‌سازی پیش از توقف سامانه آغاز می‌شود.`,
    updatedAt: new Date().toISOString(),
    logPath: logFile(),
  };

  try {
    await mkdir(runtimeDir, { recursive: true });
    await mkdir(path.dirname(statusFile()), { recursive: true });
    await mkdir(path.dirname(logFile()), { recursive: true });
    await copyFile(runnerSource, runnerTarget);
    await writeStatus(nextStatus);
    process.env.PUMPSTATION_UPDATE_STOP_TOKEN = token;
    const child = spawn(process.execPath, [runnerTarget], {
      cwd: runtimeDir,
      detached: true,
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        PS_UPDATE_MANIFEST_JSON: JSON.stringify({ version: current.version, sha256: current.sha256 }),
        PS_UPDATE_LOCAL_ZIP: stagedZip,
        PS_UPDATE_EXPECTED_VERSION: current.version,
        PS_UPDATE_EXPECTED_SHA256: current.sha256,
        PS_UPDATE_APP_DIR: appDir(),
        PS_UPDATE_STATUS_FILE: statusFile(),
        PS_UPDATE_LOG_FILE: logFile(),
        PS_UPDATE_LOCK_FILE: lockFile(),
        PS_UPDATE_DATA_ROOT: data,
        PS_UPDATE_STOP_TOKEN: token,
      },
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", (error) => reject(error));
    });
    child.unref();
  } catch (error) {
    const message = error instanceof Error ? error.message : "ساخت فرایند به‌روزرسانی ناموفق بود";
    await appendFile(logFile(), `${new Date().toISOString()}  ERROR updater launch: ${message}\n`).catch(() => {});
    await writeStatus({ ...nextStatus, phase: "failed", message: `شروع به‌روزرسانی ناموفق بود: ${message}`, updatedAt: new Date().toISOString() }).catch(() => {});
    return NextResponse.json({ ok: false, error: `شروع به‌روزرسانی ناموفق بود: ${message}` }, { status: 500 });
  }

  await Promise.all([
    logActivity(user.key, "شروع به‌روزرسانی برنامه از ZIP", `از ${currentVersion} به ${current.version}`).catch(() => {}),
    recordEvent({ level: "info", source: "update", message: `ZIP update started: ${currentVersion} → ${current.version}`, shiftKey: user.key }).catch(() => {}),
  ]);
  return NextResponse.json({
    ok: true,
    restarting: true,
    newVersion: current.version,
    currentVersion,
    message: "نسخه بررسی شد. برنامه پیش از توقف، ساخت و وابستگی‌ها را آماده می‌کند؛ سپس داده‌ها پشتیبان‌گیری و سامانه راه‌اندازی مجدد می‌شود.",
  }, { status: 202 });
}

export async function DELETE() {
  const user = await adminOnly();
  if (isDenied(user)) return user;
  const status = visibleStatus();
  if (active(status)) return NextResponse.json({ ok: false, error: "به‌روزرسانی در حال اجراست و لغو نمی‌شود." }, { status: 409 });
  if (status.phase === "staged" && status.stageId && /^[0-9a-f-]{36}$/i.test(status.stageId)) {
    await rm(path.join(agentDir(), "uploads", `${status.stageId}.zip`), { force: true }).catch(() => {});
  }
  await writeStatus({ phase: "idle", message: "فایل آماده‌شده لغو شد.", updatedAt: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
