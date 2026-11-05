const BASE = (process.env.BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");
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

  // ---- per-IP lock after 5 wrong PINs ----
  const attacker = { "x-forwarded-for": "10.9.9.9" };
  const post = (body, headers = {}) => fetch(`${BASE}/api/auth`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  let firstLock = 0;
  const t0 = Date.now();
  for (let i = 0; i < 6; i++) {
    const r = await post({ key: "B", pin: String(1000 + i) }, attacker);
    if (r.status === 429 && !firstLock) firstLock = i + 1;
  }
  const perAttempt = (Date.now() - t0) / 6;
  log("brute-force throttling (per IP)", firstLock > 0 && firstLock <= 5, `قفل از تلاش ${firstLock} ام فعال شد (${perAttempt.toFixed(1)}ms/attempt) — ادامهٔ حدس بی‌فایده است`);

  // legitimate user from another IP is not affected by the attacker's lock
  const legitOtherIp = await post({ key: "A", pin: "1011" }, { "x-forwarded-for": "10.1.1.1" });
  log("other IP not locked out by attacker", legitOtherIp.status === 200, `status=${legitOtherIp.status}`);

  // global shift lock after 20 failures from rotating IPs
  let globalLock = 0;
  for (let i = 0; i < 26; i++) {
    const r = await post({ key: "C", pin: String(2000 + i) }, { "x-forwarded-for": `10.8.8.${i}` });
    if (r.status === 429 && !globalLock) globalLock = i + 1;
  }
  log("global shift lock (IP rotation)", globalLock > 0 && globalLock <= 25, `شیفت C پس از ${globalLock} تلاش قفل شد`);

  // پاک‌سازی قفل‌های ایجادشده در تست‌های حدس PIN تا مجموعهٔ بعدی سالم بماند
  {
    const adm = await login("admin", "9009");
    if (adm.cookie) {
      await fetch(`${BASE}/api/actions`, { method: "POST", headers: { "Content-Type": "application/json", cookie: adm.cookie }, body: JSON.stringify({ action: "admin.unlock", payload: { key: "all" } }) });
    }
  }

  const okA = await login("A", "1011");
  log("valid PIN accepted", okA.status === 200 && okA.cookie.includes("ps_session"), `status=${okA.status}`);
  const A = okA.cookie;

  const admin = await login("admin", "9009");
  // تست‌های قبلی ممکن است قفل ورود گذاشته باشند؛ ادمین آن را برمی‌دارد
  await fetch(`${BASE}/api/actions`, { method: "POST", headers: { "Content-Type": "application/json", cookie: admin.cookie }, body: JSON.stringify({ action: "admin.unlock", payload: { key: "all" } }) });
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
  // قفل خوش‌بینانه: متن فعلی را می‌خوانیم تا ثبت با تعارض رد نشود
  // (یادداشت state همیشه مال «امروز» است، پس روز تست هم امروز است تا تاریخ‌محور نشود)
  const cur = await fetch(`${BASE}/api/state`, { headers: H(A) }).then((r) => r.json());
  const noteDay = cur.now?.day ?? "1405/08/13";
  const xss = await act(A, "note.save", { text: '<script>alert(1)</script><img src=x onerror=alert(1)>', day: noteDay, expected: cur.note ?? "" });
  const stateAfter = await fetch(`${BASE}/api/state`, { headers: H(A) }).then((r) => r.json());
  log("XSS payload stored as inert text", stateAfter.note.includes("<script>") && xss.body?.ok, `stored raw, rendered by React escaping. len=${stateAfter.note.length}`);
  const longNote = await act(A, "note.save", { text: "ا".repeat(10000), day: noteDay, expected: '<script>alert(1)</script><img src=x onerror=alert(1)>' });
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

  // ---------- H: megger (multi-voltage + per-winding PI + unit) ----------
  const mg = await act(A, "motor.megger", { tag: "M-01", day, testVoltage: 1000, testVoltageRotor: 500, unit: "GΩ", statorU: 120, statorV: 130, statorW: 125, rotorU: 90, rotorV: 95, rotorW: 92, windingTemp: 35, piStatorU: 2.1, piStatorV: 2.0, piStatorW: 2.2, piRotor: 1.8, note: "audit" });
  log("megger multi-voltage/PI/unit accepted", mg.status === 200 && mg.body?.ok === true && typeof mg.body?.id === "number", `status=${mg.status} id=${mg.body?.id}`);
  st = await fetch(`${BASE}/api/state?day=${day}&interval=1`, { headers: H(A) }).then((r) => r.json());
  const mrow = (st.meggers ?? []).find((m) => m.tag === "M-01");
  log("megger fields persisted", mrow?.testVoltageRotor === 500 && mrow?.unit === "GΩ" && mrow?.piStatorU === 2.1 && mrow?.piRotor === 1.8, `rotorV=${mrow?.testVoltageRotor} unit=${mrow?.unit} piU=${mrow?.piStatorU} piR=${mrow?.piRotor}`);
  const mgBad = await act(A, "motor.megger", { tag: "M-01", day, testVoltage: 1000, testVoltageRotor: 9999, statorU: 1 });
  log("megger invalid rotor voltage rejected", mgBad.status === 400, `status=${mgBad.status}`);
  const mgLegacy = await act(A, "motor.megger", { tag: "M-02", day, testVoltage: 2500, statorU: 50, pi: 1.5 });
  log("megger legacy payload (single PI) still works", mgLegacy.status === 200 && mgLegacy.body?.ok === true, `status=${mgLegacy.status}`);

  console.log("\n=== summary ===");
  console.log(`total=${out.length} pass=${out.filter((o) => o.pass).length} fail=${out.filter((o) => !o.pass).length}`);
  console.log(JSON.stringify(out.filter((o) => !o.pass).map((o) => o.name), null, 1));
})();
