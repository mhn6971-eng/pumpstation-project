const BASE = (process.env.BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const out = [];
const log = (name, pass, detail) => { out.push({ name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} | ${name} | ${detail}`); };
async function login(key, pin) {
  const r = await fetch(`${BASE}/api/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, pin }) });
  return (r.headers.get("set-cookie") || "").split(";")[0];
}
const act = async (cookie, action, payload) => {
  const r = await fetch(`${BASE}/api/actions`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ action, payload }) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const state = (cookie, q = "") => fetch(`${BASE}/api/state${q}`, { headers: { cookie } }).then((r) => r.json());

(async () => {
  const A = await login("A", "1011");
  const ADM = await login("admin", "9009");
  await fetch(`${BASE}/api/actions`, { method: "POST", headers: { "Content-Type": "application/json", cookie: ADM.cookie }, body: JSON.stringify({ action: "admin.unlock", payload: { key: "all" } }) });
  const day = "1405/08/14";

  // ---- concurrency: same cell from two "tabs" ----
  await Promise.all(Array.from({ length: 8 }, (_, i) => act(A, "motor.values", { tag: "EM-02", day, intervalIndex: 2, values: { I1: 200 + i } })));
  await Promise.all(Array.from({ length: 8 }, (_, i) => act(A, "process.set", { tag: "PIT-003", value: 3 + i, day, intervalIndex: 2 })));
  // ---- 6 parallel entries for a brand-new day total (unique(day) constraint) ----
  const totals = await Promise.all(Array.from({ length: 6 }, (_, i) => act(A, "total.set", { value: 1000 + i, day: "1405/09/01" })));
  log("parallel total.set on empty day", totals.every((t) => t.body?.ok), JSON.stringify(totals.map((t) => t.body?.error ?? "ok")));

  // ---- backup / restore round-trip ----
  const before = await state(A);
  const bk = await act(ADM, "backup.create", {});
  log("create backup", bk.body?.ok === true, `id=${bk.body?.id}`);
  // add data after backup
  const extra = await act(A, "total.set", { value: 4242, day: "1405/09/02" });
  const restore = await act(ADM, "backup.restore", { id: bk.body?.id });
  const after = await state(A);
  log("restore executes", restore.body?.ok === true, `status=${restore.status} err=${restore.body?.error ?? "-"}`);
  log("restore rolls data back", after.counts.equipment === before.counts.equipment, `equipment ${before.counts.equipment}->${after.counts.equipment}, readings ${before.counts.readings}->${after.counts.readings}`);
  // now insert new rows after restore — sequence collision?
  const post1 = await act(A, "problem.add", { text: "تست بعد از بازیابی یک" });
  const post2 = await act(A, "problem.add", { text: "تست بعد از بازیابی دو" });
  log("insert after restore", post1.body?.ok && post2.body?.ok, `first=${post1.body?.error ?? "ok"} second=${post2.body?.error ?? "ok"}`);
  const post3 = await act(A, "report.create", { kind: "daily", day });
  log("create report after restore", post3.body?.ok === true, `err=${post3.body?.error ?? "ok"} id=${post3.body?.id}`);

  // ---- report authorization (object level) ----
  const rep = await fetch(`${BASE}/report/${post3.body?.id ?? 1}`, { headers: { cookie: A } });
  log("report page opens for operator", rep.status === 200, `status=${rep.status}`);
  const B = await login("B", "2022");
  const repB = await fetch(`${BASE}/report/${post3.body?.id ?? 1}`, { headers: { cookie: B } });
  log("other shift can read report by id", repB.status === 200, `status=${repB.status} — reports are not scoped per shift (by design?)`);

  // ---- upload validation ----
  const fd = new FormData();
  fd.append("tag", "EM-01");
  fd.append("file", new Blob([Buffer.from("<html><script>alert(1)</script></html>")], { type: "application/pdf" }), "fake.pdf");
  const up = await fetch(`${BASE}/api/catalogs`, { method: "POST", headers: { cookie: ADM }, body: fd });
  const upBody = await up.json().catch(() => null);
  log("fake PDF (HTML content) rejected", up.status === 400, `status=${up.status} ${upBody?.ok ? "ACCEPTED — content not validated (bug)" : "err=" + upBody?.error}`);
  if (upBody?.ok) {
    const file = await fetch(`${BASE}/api/catalogs?id=${upBody.id}`, { headers: { cookie: A } });
    log("stored file served with forced content-type", true, `ct=${file.headers.get("content-type")} disp=${file.headers.get("content-disposition")} nosniff=${file.headers.get("x-content-type-options") ?? "MISSING"}`);
  }
  const fd2 = new FormData();
  fd2.append("tag", "EM-01");
  fd2.append("file", new Blob([Buffer.alloc(9 * 1024 * 1024)], { type: "application/pdf" }), "big.pdf");
  const up2 = await fetch(`${BASE}/api/catalogs`, { method: "POST", headers: { cookie: ADM }, body: fd2 });
  log("oversize upload rejected", [400, 413].includes(up2.status), `status=${up2.status} (413 = توسط سقف حجم بدنه رد شد)`);

  // ---- offline queue (simulated: channel unconfigured) ----
  const send = await act(A, "report.send", { kind: "daily" });
  log("send with unconfigured channel queues", send.body?.ok === true, `msg=${send.body?.message}`);

  // ---- bad interval / unknown action / malformed body ----
  const badInt = await act(A, "process.set", { tag: "PIT-001", value: 1, day, intervalIndex: 99 });
  log("interval 99 rejected", badInt.status === 400, `${badInt.body?.error}`);
  const badAct = await act(A, "system.nuke", {});
  log("unknown action rejected", badAct.status === 400, `${badAct.body?.error}`);
  const malformed = await fetch(`${BASE}/api/actions`, { method: "POST", headers: { "Content-Type": "application/json", cookie: A }, body: "{oops" });
  log("malformed JSON handled", malformed.status === 400, `status=${malformed.status}`);
  const noType = await fetch(`${BASE}/api/actions`, { method: "POST", headers: { cookie: A }, body: "action=total.set" });
  log("non-JSON content-type handled", noType.status === 400, `status=${noType.status}`);

  // ---- security headers ----
  const home = await fetch(`${BASE}/`, { headers: { cookie: A } });
  const hdrs = ["content-security-policy", "x-frame-options", "x-content-type-options", "strict-transport-security", "referrer-policy"];
  log("security headers present", hdrs.some((h) => home.headers.get(h)), hdrs.map((h) => `${h}=${home.headers.get(h) ?? "-"}`).join(", "));

  // ---- payload size / DoS ----
  const big = await fetch(`${BASE}/api/actions`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie: A },
    body: JSON.stringify({ action: "note.save", payload: { text: "x".repeat(6 * 1024 * 1024) } }),
  });
  log("6MB body rejected", big.status !== 200, `status=${big.status} ${big.status === 200 ? "ACCEPTED (no body-size limit)" : ""}`);

  console.log(`\ntotal=${out.length} pass=${out.filter((o) => o.pass).length} fail=${out.filter((o) => !o.pass).length}`);
  console.log(JSON.stringify(out.filter((o) => !o.pass).map((o) => o.name), null, 1));
})();
