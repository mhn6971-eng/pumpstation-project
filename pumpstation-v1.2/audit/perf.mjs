const BASE = (process.env.BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const login = async (k, p) => (await (await fetch(`${BASE}/api/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: k, pin: p }) })).headers.get("set-cookie") || "").split(";")[0];
const time = async (label, fn, n = 3) => {
  const ts = [];
  for (let i = 0; i < n; i++) { const t = Date.now(); await fn(); ts.push(Date.now() - t); }
  ts.sort((a, b) => a - b);
  console.log(`${label}: min=${ts[0]}ms median=${ts[Math.floor(n / 2)]}ms max=${ts[n - 1]}ms`);
  return ts[Math.floor(n / 2)];
};
const A = await login("A", "1111");
const H = { headers: { cookie: A } };
await time("GET / (SSR + full state)", () => fetch(BASE + "/", H).then((r) => r.text()));
await time("GET /api/state", () => fetch(BASE + "/api/state", H).then((r) => r.json()));
await time("GET /api/state (past day)", () => fetch(BASE + "/api/state?day=1404/02/01&interval=2", H).then((r) => r.json()));
await time("GET /api/totals", () => fetch(BASE + "/api/totals?year=1404&month=3", H).then((r) => r.json()));
await time("GET /api/history 14d", () => fetch(BASE + "/api/history?scope=process&tag=PIT-002&days=14", H).then((r) => r.json()));
await time("GET /api/history 90d", () => fetch(BASE + "/api/history?scope=process&tag=PIT-002&days=90", H).then((r) => r.json()));
await time("GET /api/history 1y motor", () => fetch(BASE + "/api/history?scope=motor&tag=M-01&param=T1&days=365", H).then((r) => r.json()));
await time("GET /api/history 10y motor", () => fetch(BASE + "/api/history?scope=motor&tag=M-01&param=T1&days=3650", H).then((r) => r.json()));
await time("POST write (process.set)", () => fetch(BASE + "/api/actions", { method: "POST", headers: { "Content-Type": "application/json", cookie: A }, body: JSON.stringify({ action: "process.set", payload: { tag: "PIT-001", value: 4.2, day: "1405/08/13", intervalIndex: 5 } }) }).then((r) => r.json()));
const r = await fetch(BASE + "/api/state", H).then((x) => x.json());
console.log("state payload size:", (JSON.stringify(r).length / 1024).toFixed(0), "KB; counts:", JSON.stringify(r.counts));
// 10 concurrent users hitting state
const t0 = Date.now();
await Promise.all(Array.from({ length: 10 }, () => fetch(BASE + "/api/state", H).then((x) => x.json())));
console.log("10 concurrent /api/state total:", Date.now() - t0, "ms");
