/**
 * تست‌های نسخه ۱.۳ — تاب‌آوری، نشست سروری، ETag، شناسهٔ یکتا، CSRF، بایگانی و خروجی CSV
 * اجرا: node audit/audit3.mjs   (سرور باید روی 127.0.0.1:3000 بالا باشد)
 */
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
let pass = 0;
const fails = [];
function log(name, ok, extra = "") {
  if (ok) pass += 1;
  else fails.push(`${name} ${extra}`);
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${extra ? ` | ${extra}` : ""}`);
}

async function login(key, pin) {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, pin }),
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  return { status: res.status, cookie, body: await res.json().catch(() => ({})) };
}

async function act(cookie, action, payload = {}, headers = {}) {
  const res = await fetch(`${BASE}/api/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie, ...headers },
    body: JSON.stringify({ action, payload }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
}

/* ---------------------------------------------------------------- ۱) سلامت */
{
  const res = await fetch(`${BASE}/api/health`);
  const body = await res.json();
  log("health basic", res.status === 200 && body.ok === true, `version=${body.version} db=${body.db?.latencyMs}ms`);
  log("health has no secrets", !JSON.stringify(body).includes("secret"));
}

const admin = await login("admin", "9009");
// تست‌های قبلی ممکن است قفل ورود گذاشته باشند؛ ادمین آن را برمی‌دارد
if (admin.cookie) {
  const unlock = await act(admin.cookie, "admin.unlock", { key: "all" });
  log("admin can clear login locks", unlock.body.ok === true, `cleared=${unlock.body.cleared}`);
}
const opA = await login("A", "1011");
log("admin login", admin.status === 200 && admin.cookie, `status=${admin.status}`);
log("operator login", opA.status === 200 && opA.cookie);

{
  const full = await fetch(`${BASE}/api/health?full=1`, { headers: { cookie: admin.cookie } }).then((r) => r.json());
  log("health full (admin)", full.detail && typeof full.detail.dbSizeMB === "number", `warnings=${(full.warnings ?? []).length}`);
  const denied = await fetch(`${BASE}/api/health?full=1`, { headers: { cookie: opA.cookie } }).then((r) => r.json());
  log("health full denied for operator", !denied.detail, denied.note ? "پیام راهنما" : "");
}

/* ------------------------------------------------------- ۲) نشست سروری */
{
  const list = await act(admin.cookie, "session.list", { shifts: true });
  log("session.list", Array.isArray(list.body.sessions) && list.body.sessions.length > 0, `count=${list.body.sessions?.length}`);
  // یک نشست اختصاصی برای شیفت C می‌سازیم تا ابطال تک‌نشست را دقیق بسنجیم
  const victim = await login("C", "3033");
  const me = await fetch(`${BASE}/api/auth`, { headers: { cookie: victim.cookie } }).then((r) => r.json());
  const fresh = await act(admin.cookie, "session.list", { shifts: true });
  const target = fresh.body.sessions.find((s) => s.id.startsWith(me.sessionId ?? "-"));
  if (target) {
    const revoked = await act(admin.cookie, "session.revoke", { id: target.id });
    log("session.revoke", revoked.body.ok === true);
    const probe = await fetch(`${BASE}/api/state`, { headers: { cookie: victim.cookie } });
    log("revoked session rejected", probe.status === 401, `status=${probe.status}`);
  } else {
    log("session.revoke", false, "نشست هدف پیدا نشد");
  }

  const third = await login("B", "2022");
  const before = await fetch(`${BASE}/api/state`, { headers: { cookie: third.cookie } }).then((r) => r.status);
  const revokeOthers = await act(admin.cookie, "session.revoke_others", { key: "B" });
  const after = await fetch(`${BASE}/api/state`, { headers: { cookie: third.cookie } }).then((r) => r.status);
  log("revoke_others closes shift sessions", before === 200 && after === 401, `before=${before} after=${after} count=${revokeOthers.body.count}`);
}

/* ------------------------------------------------- ۳) شناسهٔ یکتای عملیات */
{
  const key = `test-${Date.now()}`;
  const payload = { tag: "PIT-001", value: 2.4, day: "1405/08/13", intervalIndex: 5 };
  const first = await act(opA.cookie, "process.set", payload, { "Idempotency-Key": key });
  const second = await act(opA.cookie, "process.set", payload, { "Idempotency-Key": key });
  log("idempotency first accepted", first.body.ok === true);
  log("idempotency replay flagged", second.headers.get("idempotent-replay") === "1" && second.body.ok === true);
}

/* --------------------------------------------------------- ۴) محافظت CSRF */
{
  const res = await fetch(`${BASE}/api/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: opA.cookie, Origin: "https://evil.example" },
    body: JSON.stringify({ action: "process.set", payload: { tag: "PIT-001", value: 2.5 } }),
  });
  log("cross-site POST blocked", res.status === 403, `status=${res.status}`);
  const ok = await fetch(`${BASE}/api/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: opA.cookie, Origin: BASE },
    body: JSON.stringify({ action: "process.set", payload: { tag: "PIT-001", value: 2.6, day: "1405/08/13", intervalIndex: 5 } }),
  });
  log("same-origin POST allowed", ok.status === 200, `status=${ok.status}`);
}

/* ------------------------------------------------------------- ۵) ETag/304 */
{
  const first = await fetch(`${BASE}/api/state`, { headers: { cookie: opA.cookie } });
  const etag = first.headers.get("etag");
  const second = await fetch(`${BASE}/api/state`, { headers: { cookie: opA.cookie, "if-none-match": etag ?? "" } });
  log("state returns ETag", Boolean(etag));
  log("state 304 when unchanged", second.status === 304, `status=${second.status}`);
}

/* ------------------------------------------------------------ ۶) خروجی CSV */
{
  const denied = await fetch(`${BASE}/api/export?table=equipment`, { headers: { cookie: opA.cookie } });
  log("export denied for operator", denied.status === 403, `status=${denied.status}`);
  const res = await fetch(`${BASE}/api/export?table=equipment`, { headers: { cookie: admin.cookie } });
  const text = await res.text();
  log("export CSV for admin", res.status === 200 && text.includes("tag") && text.split("\n").length > 3, `lines=${text.split("\n").length}`);
  const bad = await fetch(`${BASE}/api/export?table=nope`, { headers: { cookie: admin.cookie } });
  log("export rejects unknown table", bad.status === 400, `status=${bad.status}`);
}

/* ------------------------------------------------------------- ۷) بایگانی */
{
  const before = await act(admin.cookie, "data.stats", {});
  const archived = await act(admin.cookie, "data.archive", { years: 1 });
  log("archive runs", archived.body.ok === true, `motor=${archived.body.motorRows} process=${archived.body.processRows}`);
  const after = await act(admin.cookie, "data.stats", {});
  const moved = (after.body.archive?.archive?.motor ?? 0) >= (before.body.archive?.archive?.motor ?? 0);
  log("archive stats update", moved, `archiveMotor=${after.body.archive?.archive?.motor}`);
  if ((archived.body.motorRows ?? 0) > 0) {
    // ردیف‌های بایگانی‌شده باید در نمودار چندساله دیده شوند (نمای ترکیبی)
    const trend = await fetch(`${BASE}/api/history?scope=motor&tag=M-01&param=T1&days=3650`, { headers: { cookie: admin.cookie } }).then((r) => r.json());
    log("archived rows still visible in charts", Array.isArray(trend.points) && trend.points.length > 0, `points=${trend.points?.length}`);
  }
}

/* ------------------------------------------------- ۸) دفتر فعالیت و خطاها */
{
  const chain = await act(admin.cookie, "audit.verify", { limit: 5000 });
  log("activity hash chain valid", chain.body.ok === true && chain.body.brokenAtId === null, `checked=${chain.body.checked}`);
  const events = await act(admin.cookie, "events.list", {});
  log("events.list", Array.isArray(events.body.events));
}

/* ------------------------------------------- ۹) سطل بازیافت تجهیزات */
{
  const tag = `TST-${Date.now().toString().slice(-6)}`;
  const created = await act(admin.cookie, "equipment.save", { tag, name: "تجهیز آزمایشی", category: "پمپ‌ها" });
  const list = await fetch(`${BASE}/api/state`, { headers: { cookie: admin.cookie } }).then((r) => r.json());
  const row = list.equipment.find((e) => e.tag === tag);
  log("equipment created", created.body.ok === true && Boolean(row));
  if (row) {
    await act(admin.cookie, "equipment.delete", { id: row.id, reason: "تست" });
    const trash = await act(admin.cookie, "equipment.trash", {});
    const inTrash = trash.body.items?.some((x) => x.id === row.id);
    log("equipment moved to trash", Boolean(inTrash));
    const restored = await act(admin.cookie, "equipment.restore", { id: row.id });
    log("equipment restored", restored.body.ok === true);
    await act(admin.cookie, "equipment.delete", { id: row.id, reason: "پاک‌سازی تست" });
  }
}

/* ------------------------------------- ۱۰) نگه‌داری: بهینه‌سازی و بک‌آپ */
{
  const files = await act(admin.cookie, "backup.files", {});
  log("backup.files", Array.isArray(files.body.files));
  if (files.body.files?.length) {
    const verify = await act(admin.cookie, "backup.verify", { file: files.body.files[0].file });
    log("backup.verify", verify.body.ok === true && verify.body.checksumOk === true, `counts=${Object.keys(verify.body.counts ?? {}).length}`);
  }
  const optimize = await act(admin.cookie, "data.optimize", {});
  log("data.optimize", optimize.body.ok === true, optimize.body.message ?? "");
}

/* ------------------------------------------------- ۱۱) موارد منفی */
{
  const unknown = await act(admin.cookie, "not.an.action", {});
  log("unknown action 400", unknown.status === 400, `status=${unknown.status}`);
  const huge = await fetch(`${BASE}/api/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: admin.cookie },
    body: JSON.stringify({ action: "note.save", payload: { text: "x".repeat(400_000) } }),
  });
  log("oversize body rejected", [400, 413].includes(huge.status), `status=${huge.status}`);
  const badDay = await act(admin.cookie, "process.set", { tag: "PIT-001", value: 1, day: "1405/13/45" });
  log("invalid jalali day rejected", badDay.status === 400, `status=${badDay.status}`);
}

console.log(`\n=== summary ===\ntotal=${pass + fails.length} pass=${pass} fail=${fails.length}`);
if (fails.length) console.log(fails);
process.exit(fails.length ? 1 : 0);
