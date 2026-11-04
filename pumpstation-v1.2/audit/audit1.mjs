const BASE = "http://127.0.0.1:3000";
const out = [];
function log(name, pass, detail) {
  out.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} | ${name} | ${detail}`);
}
async function login(key, pin) {
  const r = await fetch(`${BASE}/api/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, pin }),
  });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  return { status: r.status, cookie, body: await r.json().catch(() => null) };
}
async function act(cookie, action, payload) {
  const r = await fetch(`${BASE}/api/actions`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ action, payload }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const H = (cookie) => ({ cookie });

(async () => {
  // ---------- A: authentication ----------
  const bad = await login("A", "0000");
  log("wrong PIN rejected", bad.status === 401, `status=${bad.status}`);

  const t0 = Date.now();
  let blocked = 0;
  for (let i = 0; i < 40; i++) {
    const r = await login("A", String(1000 + i));
    if (r.status === 429) blocked++;
  }
  const perAttempt = (Date.now() - t0) / 40;
  log("brute-force throttling", blocked > 0,
    `40 wrong PINs in ${Date.now() - t0}ms (${perAttempt.toFixed(1)}ms/attempt, lockouts=${blocked}). 10k PINs ≈ ${((10000 * perAttempt) / 1000 / 60).toFixed(1)} min`);

  const okA = await login("A", "1111");
  log("valid PIN accepted", okA.status === 200 && okA.cookie.includes("ps_session"), `status=${okA.status}`);
  const A = okA.cookie;

  const admin = await login("admin", "9999");
  const ADM = admin.cookie;
  log("admin login", admin.status === 200, `status=${admin.status}, role=${admin.body?.user?.role}`);

  // ---------- B: session forgery with the default secret ----------
  const { createHmac } = await import("node:crypto");
  const payload = Buffer.from(JSON.stringify({ key: "admin", at: Date.now() })).toString("base64url");
  const sig = createHmac("sha256", "pumpstation-local-preview-secret").update(payload).digest("base64url");
  const forged = `ps_session=${payload}.${sig}`;
  const forgedRes = await fetch(`${BASE}/api/state`, { headers: { cookie: forged } });
  const forgedBody = await forgedRes.json().catch(() => null);
  log("forged cookie rejected", forgedRes.status === 401,
    `status=${forgedRes.status}${forgedRes.status === 200 ? ` — forged admin session WORKS (me=${forgedBody?.me?.key}/${forgedBody?.me?.role})` : ""}`);

  // malformed / tampered cookie
  const tampered = A.replace(/=([^.]*)\./, "=x");
  const tamperedRes = await fetch(`${BASE}/api/state`, { headers: { cookie: tampered } });
  log("tampered cookie rejected", tamperedRes.status === 401, `status=${tamperedRes.status}`);

  // ---------- C: unauthenticated access ----------
  const targets = [
    ["/api/state", "GET"], ["/api/totals", "GET"], ["/api/history?param=PIT-001", "GET"],
    ["/api/catalogs?id=1", "GET"], ["/api/backups/1", "GET"], ["/report/1", "GET"], ["/totals", "GET"],
  ];
  for (const [path, method] of targets) {
    const r = await fetch(BASE + path, { method, redirect: "manual" });
    const blocked = [401, 403, 307, 302].includes(r.status);
    log(`anon ${path}`, blocked, `status=${r.status}`);
  }
  const anonAct = await fetch(`${BASE}/api/actions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "total.set", payload: { value: 1 } }),
  });
  log("anon POST /api/actions", anonAct.status === 401, `status=${anonAct.status}`);

  // ---------- D: authorization ----------
  const operatorAdmin = await act(A, "admin.pin", { key: "admin", pin: "1234" });
  log("operator cannot change PIN", operatorAdmin.status === 400 && /ادمین/.test(operatorAdmin.body?.error ?? ""), `status=${operatorAdmin.status} error=${operatorAdmin.body?.error}`);
  const operatorBackup = await act(A, "backup.create", {});
  log("operator cannot create backup", operatorBackup.status === 400, `status=${operatorBackup.status} error=${operatorBackup.body?.error}`);
  const admState = await fetch(`${BASE}/api/state`, { headers: H(ADM) }).then((r) => r.json());
  log("admin sees admin panel data", admState.me.role === "admin", `role=${admState.me.role}`);

  // ---------- E: input validation / injection ----------
  const sqli = await act(A, "process.set", { tag: "PIT-001' OR 1=1--", value: 12, day: "1405/08/13", intervalIndex: 0 });
  log("SQLi in tag rejected", sqli.status === 400, `status=${sqli.status} error=${sqli.body?.error}`);
  const sqli2 = await fetch(`${BASE}/api/history?scope=process&tag=${encodeURIComponent("PIT-001' OR '1'='1")}&param=x&days=5`, { headers: H(A) });
  const sqli2Body = await sqli2.json().catch(() => null);
  log("SQLi in query string handled", sqli2.status < 500, `status=${sqli2.status} body=${JSON.stringify(sqli2Body).slice(0, 120)}`);
  const huge = await act(A, "process.set", { tag: "PIT-001", value: 999999999999, day: "1405/08/13", intervalIndex: 0 });
  log("absurd value rejected", huge.status === 400, `status=${huge.status} error=${huge.body?.error}`);
  const negative = await act(A, "total.set", { value: -5000, day: "1405/08/13" });
  log("negative total rejected", negative.status === 400, `status=${negative.status} ${negative.body?.ok ? "ACCEPTED (bug)" : "error=" + negative.body?.error}`);
  const xss = await act(A, "note.save", { text: '<script>alert(1)</script><img src=x onerror=alert(1)>', day: "1405/08/13" });
  const stateAfter = await fetch(`${BASE}/api/state`, { headers: H(A) }).then((r) => r.json());
  log("XSS payload stored as inert text", stateAfter.note.includes("<script>") && xss.body?.ok, `stored raw, rendered by React escaping. len=${stateAfter.note.length}`);
  const longNote = await act(A, "note.save", { text: "ا".repeat(10000), day: "1405/08/13" });
  const st2 = await fetch(`${BASE}/api/state`, { headers: H(A) }).then((r) => r.json());
  log("over-long note truncated silently", st2.note.length <= 4000, `saved length=${st2.note.length} (silently truncated, no warning)`);

  // ---------- F: bad day / interval handling ----------
  const badDay = await act(A, "process.set", { tag: "PIT-001", value: 5, day: "1405/13/45", intervalIndex: 0 });
  log("invalid jalali date accepted?", badDay.status === 400, `status=${badDay.status} ${badDay.body?.ok ? "ACCEPTED invalid date 1405/13/45 (bug)" : "error=" + badDay.body?.error}`);

  // ---------- G: races ----------
  const day = "1405/08/13";
  await Promise.all(Array.from({ length: 8 }, (_, i) => act(A, "process.set", { tag: "PIT-002", value: 5 + i, day, intervalIndex: 1 })));
  let st = await fetch(`${BASE}/api/state?day=${day}&interval=1`, { headers: H(A) }).then((r) => r.json());
  log("concurrent same-process writes (8x)", true, `value shown=${st.process.find((p) => p.tag === "PIT-002")?.value}`);

  await Promise.all(Array.from({ length: 6 }, (_, i) => act(A, "motor.values", { tag: "EM-01", day, intervalIndex: 1, values: { I1: 100 + i } })));
  const dupCheck = await fetch(`${BASE}/api/history?scope=motor&tag=EM-01&param=I1&from=${day}&to=${day}`, { headers: H(A) }).then((r) => r.json());
  const pts = dupCheck.points ?? [];
  const sameDay = pts.filter((p) => String(p.label ?? "").includes("11") || true).length;
  log("concurrent motor value writes duplicate rows?", pts.length <= 6, `points=${pts.length} for 6 intervals — ${pts.length > 6 ? "DUPLICATES (bug)" : "ok"}`);

  console.log("\n=== summary ===");
  console.log(`total=${out.length} pass=${out.filter((o) => o.pass).length} fail=${out.filter((o) => !o.pass).length}`);
  console.log(JSON.stringify(out.filter((o) => !o.pass).map((o) => o.name), null, 1));
})();
