/**
 * اجرای سرور با بایند امن (نسخهٔ ۱٫۴٫۱).
 *
 *   node scripts/serve.mjs dev [--webpack] [--host lan|IP]
 *   node scripts/serve.mjs start [--host lan|IP]
 *
 * پیش‌فرض فقط 127.0.0.1 است. حالت شبکهٔ داخلی فقط با BIND=lan یا ‎--host
 * صریح فعال می‌شود (همراه با اخطار فایروال). جزئیات: docs/STATION_NETWORK_FA.md
 */
import { spawn } from "node:child_process";
import { resolveBind } from "../src/lib/netbind.ts";
import { requireLocalSqlite } from "../src/lib/sqlite-cloud.ts";

// پیش‌بررسی مسیر دیتابیس (حالت PGlite): مسیر ابری = توقف پیش از بالا آمدن
if (!/^postgres(ql)?:\/\//i.test((process.env.DATABASE_URL ?? "").trim())) {
  try {
    requireLocalSqlite(process.env.PGLITE_DATA_DIR ?? ".data/pglite");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

const [mode, ...rest] = process.argv.slice(2);
if (mode !== "dev" && mode !== "start") {
  console.error("استفاده: node scripts/serve.mjs dev|start [--webpack] [--host lan|IP]");
  process.exit(1);
}

let hostOverride = "";
const passthrough = [];
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i] === "--host" && rest[i + 1]) {
    hostOverride = rest[i + 1];
    i += 1;
    continue;
  }
  passthrough.push(rest[i]);
}

let host;
try {
  host = (hostOverride ? resolveBind(hostOverride) : resolveBind()).host;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`پورت نامعتبر است: ${process.env.PORT}`);
  process.exit(1);
}

if (host === "0.0.0.0") {
  console.warn(`[net] هشدار: سرور روی همهٔ رابط‌های شبکه باز می‌شود (${host}:${port}) — فقط در شبکهٔ داخلی ایستگاه با فایروال محدود به رنج اداره.`);
} else {
  console.log(`[net] server on ${host}:${port} (loopback-only)`);
}

const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", mode, "-H", host, "-p", String(port), ...passthrough],
  { stdio: "inherit", cwd: process.cwd(), env: { ...process.env, BIND: host } },
);
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
