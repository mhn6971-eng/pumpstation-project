/**
 * audit6 — آزمون‌های نسخهٔ ۱٫۴٫۱ (روستر محلی، بایند شبکه، نگهبان مسیر، ورود گروهی).
 * پیش‌نیاز: سرور روی http://127.0.0.1:3000 با PINهای آزمایشی بالا باشد.
 * تاریخ‌محور نیست: روز جاری از خودِ state خوانده می‌شود.
 */
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolveBind, trustProxyEnabled, trustedClientIp, parseIpv4, ipInCidr, parseAllowList, lanAllowed } from "../src/lib/netbind.ts";
import { validateRoster, loadRosterFile, resolveRoster } from "../src/lib/roster.ts";
import { detectCloudPath, requireLocalSqlite } from "../src/lib/sqlite-cloud.ts";

const BASE = "http://127.0.0.1:3000";
const results = [];
const t = (name, ok, extra = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${extra ? ` | ${extra}` : ""}`);
};
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};
const headersOf = (obj) => ({ get: (n) => obj[n.toLowerCase()] ?? null });

// ---------- الف) بایند شبکه و IP ----------
t("bind default is loopback", JSON.stringify(resolveBind("")) === JSON.stringify({ host: "127.0.0.1", mode: "loopback" }));
t("bind lan", resolveBind("lan").host === "0.0.0.0");
t("bind custom ip", resolveBind("192.168.1.10").mode === "custom");
t("bind invalid throws", throws(() => resolveBind("nonsense")));
t("trust proxy 1/true/unset", trustProxyEnabled({ TRUST_PROXY: "1" }) && trustProxyEnabled({ TRUST_PROXY: "true" }) && !trustProxyEnabled({}));
t("direct mode ignores headers", trustedClientIp(headersOf({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" }), false) === "local");
t("trusted real-ip wins", trustedClientIp(headersOf({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "9.9.9.9" }), true) === "9.9.9.9");
t("trusted xff first", trustedClientIp(headersOf({ "x-forwarded-for": "10.9.9.5, 9.9.9.9" }), true) === "10.9.9.5");
t("trusted without header is direct", trustedClientIp(headersOf({}), true) === "direct");
t("ipv4 parse ok/bad", parseIpv4("192.168.1.1") === 3232235777 && parseIpv4("999.1.1.1") === null && parseIpv4("::1") === null);
t("cidr in/out", ipInCidr("192.168.1.50", "192.168.1.0/24") && !ipInCidr("192.168.2.5", "192.168.1.0/24"));
t("cidr exact and /32", ipInCidr("10.9.9.5", "10.9.9.5") && !ipInCidr("10.9.9.6", "10.9.9.5"));
t("allowlist multi/invalid", parseAllowList("10.0.0.0/8, 192.168.1.0/24").length === 2 && throws(() => parseAllowList("10.0.0.0/33")));
t("lan allows local/direct/loopback", lanAllowed("local", "10.0.0.0/8") && lanAllowed("direct", "10.0.0.0/8") && lanAllowed("127.0.0.1", "10.0.0.0/8") && lanAllowed("::1", "10.0.0.0/8"));
t("lan allow/deny by range", lanAllowed("10.9.9.5", "10.9.9.0/24") && !lanAllowed("192.168.9.9", "10.9.9.0/24"));
t("empty allowlist allows all", lanAllowed("192.168.9.9", ""));

// ---------- ب) روستر ----------
const sample = resolveRoster();
t("sample roster resolves", sample.source === "sample" && sample.roster.length === 4);
t("sample test PINs", sample.roster.find((e) => e.key === "A")?.pin === "1011" && sample.roster.find((e) => e.key === "admin")?.pin === "9009");
t("roster without admin rejected", throws(() => validateRoster([{ key: "A", label: "x", role: "operator", pin: "1011", members: ["m"] }], "t")));
t("roster bad pin rejected", throws(() => validateRoster([{ key: "admin", label: "x", role: "admin", pin: "abc", members: ["m"] }], "t")));
t("roster dup key rejected", throws(() => validateRoster([
  { key: "admin", label: "x", role: "admin", pin: "9009", members: ["m"] },
  { key: "admin", label: "y", role: "admin", pin: "9009", members: ["m"] },
], "t")));
t("roster empty members rejected", throws(() => validateRoster([{ key: "admin", label: "x", role: "admin", pin: "9009", members: [] }], "t")));
writeFileSync("/tmp/audit6-good.json", JSON.stringify({ roster: [
  { key: "A", label: "ش", role: "operator", pin: "5555", members: ["x"] },
  { key: "admin", label: "ا", role: "admin", pin: "666666", members: ["y"] },
] }));
writeFileSync("/tmp/audit6-bad.json", JSON.stringify({ roster: [{ key: "A" }] }));
process.env.ROSTER_FILE = "/tmp/audit6-good.json";
const local = resolveRoster();
t("local roster wins", local.source === "local" && local.roster[0].pin === "5555");
process.env.ROSTER_FILE = "/tmp/audit6-bad.json";
t("invalid local blocks", throws(() => resolveRoster()));
delete process.env.ROSTER_FILE;
t("sample file loads", loadRosterFile("data/roster.sample.json").length === 4);

// ---------- ج) نگهبان مسیر ابری ----------
t("cloud paths detected",
  detectCloudPath("C:\\Users\\op\\Google Drive\\ps") === "Google Drive" &&
  detectCloudPath("/home/u/OneDrive - Co/ps") === "OneDrive" &&
  detectCloudPath("/x/Dropbox/ps") === "Dropbox" &&
  detectCloudPath("D:\\iCloud Drive\\ps") === "iCloud");
t("normal paths pass", detectCloudPath(".data/pglite") === null && detectCloudPath("/tmp/sandbox/ps") === null);
t("cloud path throws", throws(() => requireLocalSqlite("/x/Dropbox/ps")));
t("cloud override works", (() => { requireLocalSqlite("/x/Dropbox/ps", { PGLITE_ALLOW_CLOUD: "1" }); return true; })());

// ---------- د) HTTP ----------
async function login(key, pin, extraHeaders = {}) {
  const r = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify({ key, pin }),
  });
  const text = await r.text();
  return { status: r.status, cookie: (r.headers.get("set-cookie") || "").split(";")[0], text };
}
const adm = await login("admin", "9009");
t("login with test PIN", adm.status === 200 && !!adm.cookie);
const spoof = await login("admin", "9009", { "X-Forwarded-For": "9.9.9.9", "X-Real-IP": "8.8.8.8" });
t("spoofed headers ignored", spoof.status === 200 && !spoof.text.includes("9.9.9.9") && !spoof.text.includes("8.8.8.8"));
const state = await fetch(`${BASE}/api/state`, { headers: { cookie: adm.cookie } }).then((r) => r.json());
const today = state.now?.day ?? "";
t("today available", /^\d{4}\/\d{2}\/\d{2}$/.test(today), today);
const noteText = `audit6-probe-${Date.now()}`;
const noteRes = await fetch(`${BASE}/api/actions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie: adm.cookie },
  body: JSON.stringify({ action: "note.save", payload: { text: noteText, day: today, expected: state.note ?? "" } }),
});
t("note.save ok", noteRes.ok);
const state2 = await fetch(`${BASE}/api/state`, { headers: { cookie: adm.cookie } }).then((r) => r.json());
t("state note is plain text (no channel object)", typeof state2.note === "string" && state2.note.includes(noteText));
const procRes = await fetch(`${BASE}/api/actions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", cookie: adm.cookie },
  body: JSON.stringify({ action: "process.set", payload: { tag: "PIT-001", value: 3.33, day: today, intervalIndex: 0 } }),
});
t("process.set ok", procRes.ok);

// ---------- هـ) اسکریپت‌ها ----------
const run = (args, env = {}) => new Promise((resolve) => {
  execFile("node", args, { cwd: process.cwd(), timeout: 90000, env: { ...process.env, ...env } }, (error, stdout, stderr) => {
    resolve({ code: error ? (error.code ?? 1) : 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
  });
});
writeFileSync("/tmp/audit6-rows.csv", `day,interval,scope,tag,param,value\n${today},0,process,PIT-001,,3.21\n${today},1,motor,M-01,I1,12.5\n`);
const dryGood = await run(["scripts/bulk-import.mjs", "--file", "/tmp/audit6-rows.csv", "--dry-run"]);
t("bulk-import dry-run clean", dryGood.code === 0 && dryGood.stdout.includes("درخواست‌ها: 2"), dryGood.stdout.split("\n")[0] ?? "");
writeFileSync("/tmp/audit6-rows-bad.csv", "day,interval,scope,tag,param,value\nbad-day,0,process,PIT-001,,1.0\n");
const dryBad = await run(["scripts/bulk-import.mjs", "--file", "/tmp/audit6-rows-bad.csv", "--dry-run"]);
t("bulk-import dry-run flags bad row", dryBad.code === 1 && dryBad.stdout.includes("سطر خراب: 1"));
const noConfirm = await run(["scripts/bulk-import.mjs", "--file", "/tmp/audit6-rows.csv", "--shift", "A", "--pin", "1011"]);
t("bulk-import refuses without --confirm-test", noConfirm.code === 1 && noConfirm.stderr.includes("--confirm-test"));
const seederNoConfirm = await run(["audit/bulk.mjs", "--db", "/tmp/audit6-seed"]);
t("bulk seeder refuses without --confirm-test", seederNoConfirm.code === 1);
const seederCloud = await run(["audit/bulk.mjs", "--db", "/tmp/Dropbox/seed", "--confirm-test"]);
t("bulk seeder refuses cloud path", seederCloud.code === 1 && seederCloud.stderr.includes("Dropbox"));
const serveBogus = await run(["scripts/serve.mjs", "bogus"]);
t("serve.mjs bogus mode exits 1", serveBogus.code === 1);
const serveBadBind = await run(["scripts/serve.mjs", "dev"], { BIND: "nonsense" });
t("serve.mjs invalid BIND exits 1", serveBadBind.code === 1 && serveBadBind.stderr.includes("BIND"));
const serveCloud = await run(["scripts/serve.mjs", "dev"], { PGLITE_DATA_DIR: "/tmp/OneDrive-x/ps" });
t("serve.mjs cloud path exits 1", serveCloud.code === 1 && serveCloud.stderr.includes("OneDrive"));

// ---------- جمع‌بندی ----------
const pass = results.filter((r) => r.ok).length;
console.log("\n=== summary ===");
console.log(`total=${results.length} pass=${pass} fail=${results.length - pass}`);
console.log(JSON.stringify(results.filter((r) => !r.ok).map((r) => r.name)));
process.exit(results.length - pass ? 1 : 0);
