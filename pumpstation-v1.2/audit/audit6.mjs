/**
 * audit6 — آزمون‌های نسخهٔ ۱٫۴٫۱ (روستر محلی، بایند شبکه، نگهبان مسیر، ورود گروهی).
 * پیش‌نیاز: سرور روی http://127.0.0.1:3000 با PINهای آزمایشی بالا باشد.
 * تاریخ‌محور نیست: روز جاری از خودِ state خوانده می‌شود.
 */
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { resolveBind, trustProxyEnabled, trustedClientIp, parseIpv4, ipInCidr, parseAllowList, lanAllowed } from "../src/lib/netbind.ts";
import { validateRoster, loadRosterFile, resolveRoster } from "../src/lib/roster.ts";
import { detectCloudPath, requireLocalSqlite } from "../src/lib/sqlite-cloud.ts";
import { createServer } from "node:http";
import { botApiBase, botSendDocumentUrl, botSendUrl, sendBotDocument, sendBotText } from "../src/lib/bot.ts";
import { crc32, zipStored } from "../src/lib/zip.ts";

const BASE = (process.env.BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");
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

// ---------- و) ربات بله/ایتا (mock محلی، بدون اینترنت) ----------
t("bot bale url", botSendUrl("bale", "TOK") === "https://tapi.bale.ai/botTOK/sendMessage");
t("bot eitaa url", botSendUrl("eitaa", "TOK") === "https://eitaayar.ir/api/TOK/sendMessage");
const mockHits = [];
const mock = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    mockHits.push({ url: req.url, body });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
process.env.BALE_API_BASE = `http://127.0.0.1:${mock.address().port}`;
t("bot base override", botApiBase("bale") === process.env.BALE_API_BASE);
await sendBotText({ provider: "bale", token: "T1", chatId: "-100", text: "سلام" });
const hitBody = JSON.parse(mockHits[0].body);
t("bot post path+payload", mockHits.length === 1 && mockHits[0].url === "/botT1/sendMessage" && hitBody.chat_id === "-100" && hitBody.text === "سلام");
mock.close();
const slow = createServer(() => {});
await new Promise((r) => slow.listen(0, "127.0.0.1", r));
process.env.BALE_API_BASE = `http://127.0.0.1:${slow.address().port}`;
let timedOut = false;
try { await sendBotText({ provider: "bale", token: "T", chatId: "1", text: "x", timeoutMs: 300 }); } catch { timedOut = true; }
t("bot timeout aborts", timedOut);
slow.close();
const errSrv = createServer((req, res) => { res.writeHead(500); res.end("boom"); });
await new Promise((r) => errSrv.listen(0, "127.0.0.1", r));
process.env.BALE_API_BASE = `http://127.0.0.1:${errSrv.address().port}`;
let httpErr = "";
try { await sendBotText({ provider: "bale", token: "T", chatId: "1", text: "x" }); } catch (e) { httpErr = e instanceof Error ? e.message : ""; }
t("bot http error surfaces", httpErr.includes("پاسخ 500"));
errSrv.close();
delete process.env.BALE_API_BASE;

// ---------- ز) بایگانی نامحدود (قانون مقدس) ----------
const archiveSrc = readFileSync("src/lib/archive.ts", "utf8");
t("archive default unlimited", archiveSrc.includes("keep: number = Infinity"));
t("archive guard rejects <500", archiveSrc.includes("keep < 500") && archiveSrc.includes("throw new Error"));
const routeSrc = readFileSync("src/app/api/actions/route.ts", "utf8");
t("archive log says pruning disabled", routeSrc.includes("پیرایش نسخه‌های قدیمی غیرفعال است"));
mkdirSync(".data/backups/archive", { recursive: true });
for (let i = 0; i < 25; i += 1) writeFileSync(`.data/backups/archive/audit6-dummy-${String(i).padStart(2, "0")}.jsonl.gz`, "dummy");
const archRes = await fetch(`${BASE}/api/actions`, { method: "POST", headers: { "Content-Type": "application/json", cookie: adm.cookie }, body: JSON.stringify({ action: "data.archive", payload: { years: 10 } }) });
const archBody = await archRes.json().catch(() => null);
const dummiesLeft = readdirSync(".data/backups/archive").filter((f) => f.startsWith("audit6-dummy-")).length;
for (let i = 0; i < 25; i += 1) { try { unlinkSync(`.data/backups/archive/audit6-dummy-${String(i).padStart(2, "0")}.jsonl.gz`); } catch {} }
t("archive keeps 25 versions", archRes.status === 200 && archBody?.ok === true && dummiesLeft === 25, `left=${dummiesLeft}`);

// ---------- ح) shebang خط اول اسکریپت‌ها ----------
const SHEBANG_FILES = ["audit/audit5.mjs", "scripts/mirror-backup.mjs", "scripts/pg-init.mjs", "scripts/pg-dump.mjs", "scripts/pg-import-json.mjs"];
t("shebang first line in 5 scripts", SHEBANG_FILES.every((f) => readFileSync(f, "utf8").split("\n")[0] === "#!/usr/bin/env node"));

// ---------- ط) مهاجرت تازه شامل شش ستون مگر است (معادل 0005_fix_megger) ----------
const migDir = "/tmp/audit6-mig";
rmSync(migDir, { recursive: true, force: true });
const migRun = await run(["scripts/init-db.mjs"], { PGLITE_DATA_DIR: migDir });
let migCols = false;
if (migRun.code === 0) {
  const { PGlite } = await import("@electric-sql/pglite");
  const probe = new PGlite(migDir);
  try {
    await probe.query("SELECT test_voltage_rotor, pi_stator_u, pi_stator_v, pi_stator_w, pi_rotor, unit FROM megger_tests LIMIT 0");
    migCols = true;
  } catch {}
  await probe.close();
}
rmSync(migDir, { recursive: true, force: true });
t("fresh migrate applies 0000..0005", migRun.code === 0 && migRun.stdout.includes("0005_megger_pi"), migRun.stdout.trim().split("\n").pop() ?? "");
t("fresh migrate has 6 megger columns", migCols);

// ---------- ی) PM: قالب + رکورد + PDF (ایراد ۱) ----------
const tplRes = await fetch(`${BASE}/api/actions`, { method: "POST", headers: { "Content-Type": "application/json", cookie: adm.cookie }, body: JSON.stringify({ action: "pm.template", payload: { category: "تست", name: "قالب تست audit6", items: ["آیتم ۱", "آیتم ۲"] } }) });
t("pm.template creates", tplRes.status === 200 && (await tplRes.json().catch(() => null))?.ok === true);
const opA = await login("A", "1011");
const recRes = await fetch(`${BASE}/api/actions`, { method: "POST", headers: { "Content-Type": "application/json", cookie: opA.cookie }, body: JSON.stringify({ action: "pm.record", payload: { tag: "M-01", templateName: "قالب تست audit6", results: { "آیتم ۱": "سالم" }, workers: "تست", note: "" } }) });
const recBody = await recRes.json().catch(() => null);
t("pm.record creates + report id", recRes.status === 200 && typeof recBody?.id === "number", `report=${recBody?.id}`);
let pmPdf = false;
if (typeof recBody?.id === "number") {
  const pdf = await fetch(`${BASE}/report/${recBody.id}`, { headers: { cookie: opA.cookie } });
  pmPdf = pdf.status === 200 && (await pdf.text()).includes("PM M-01");
}
t("pm report page renders", pmPdf);

// ---------- ک) ارسال فایل به بله + ZIP (بخش ۴) ----------
t("bot doc bale url", botSendDocumentUrl("bale", "TOK") === "https://tapi.bale.ai/botTOK/sendDocument");
t("bot doc eitaa url", botSendDocumentUrl("eitaa", "TOK") === "https://eitaayar.ir/api/TOK/sendDocument");
const docHits = [];
const docMock = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    docHits.push({ url: req.url, ctype: req.headers["content-type"] ?? "", body: Buffer.concat(chunks) });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
});
await new Promise((r) => docMock.listen(0, "127.0.0.1", r));
process.env.BALE_API_BASE = `http://127.0.0.1:${docMock.address().port}`;
const docBytes = new TextEncoder().encode("<html>گزارش تست</html>");
await sendBotDocument({ provider: "bale", token: "T9", chatId: "-100", filename: "r.html", data: docBytes, caption: "کپشن" });
const dh = docHits[0];
t("bot doc multipart received", docHits.length === 1 && dh.url === "/botT9/sendDocument" && dh.ctype.includes("multipart/form-data") && dh.body.includes('filename="r.html"') && dh.body.includes("-100") && dh.body.includes(docBytes));
docMock.close();
let bigErr = "";
try { await sendBotDocument({ provider: "bale", token: "T", chatId: "1", filename: "big.bin", data: new Uint8Array(51 * 1024 * 1024) }); } catch (e) { bigErr = e instanceof Error ? e.message : ""; }
t("bot doc 51MB rejected", bigErr.includes("۵۰ مگابایت"));
const docErrSrv = createServer((req, res) => { res.writeHead(500); res.end("boom"); });
await new Promise((r) => docErrSrv.listen(0, "127.0.0.1", r));
process.env.BALE_API_BASE = `http://127.0.0.1:${docErrSrv.address().port}`;
let docHttpErr = "";
try { await sendBotDocument({ provider: "bale", token: "T", chatId: "1", filename: "x.bin", data: new Uint8Array([1, 2, 3]) }); } catch (e) { docHttpErr = e instanceof Error ? e.message : ""; }
t("bot doc http error surfaces", docHttpErr.includes("پاسخ 500"));
docErrSrv.close();
delete process.env.BALE_API_BASE;
t("zip crc32 vector", crc32(new TextEncoder().encode("123456789")) === 0xcbf43926);
const zipOut = zipStored([{ name: "a.json", data: new TextEncoder().encode('{"a":1}') }, { name: "b.sha256", data: new TextEncoder().encode("deadbeef") }]);
const zipText = Buffer.from(zipOut).toString("latin1");
const eocdAt = zipOut.length - 22;
t("zip stored structure", zipOut[0] === 0x50 && zipOut[1] === 0x4b && zipText.includes("a.json") && zipText.includes("b.sha256") && zipOut[eocdAt] === 0x50 && zipOut[eocdAt + 1] === 0x4b && zipOut[eocdAt + 2] === 0x05 && zipOut[eocdAt + 3] === 0x06 && zipOut[eocdAt + 8] === 2 && zipOut[eocdAt + 10] === 2);

// ---------- جمع‌بندی ----------
const pass = results.filter((r) => r.ok).length;
console.log("\n=== summary ===");
console.log(`total=${results.length} pass=${pass} fail=${results.length - pass}`);
console.log(JSON.stringify(results.filter((r) => !r.ok).map((r) => r.name)));
process.exit(results.length - pass ? 1 : 0);
