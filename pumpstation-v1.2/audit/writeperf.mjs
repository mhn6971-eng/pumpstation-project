const BASE = "http://127.0.0.1:3000";
const r = await fetch(`${BASE}/api/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "C", pin: "3333" }) });
const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
const ts = [];
for (let i = 0; i < 10; i++) {
  const t = Date.now();
  const res = await fetch(`${BASE}/api/actions`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ action: "process.set", payload: { tag: "PIT-001", value: 3 + i / 10, day: "1405/08/13", intervalIndex: 5 } }) });
  const body = await res.json().catch(() => ({}));
  ts.push({ ms: Date.now() - t, status: res.status, err: body?.error });
}
ts.sort((a, b) => a.ms - b.ms);
console.log("writes ms:", ts.map((x) => x.ms).join(", "));
console.log("median:", ts[5].ms, "| statuses:", [...new Set(ts.map((x) => x.status))].join(","), "| errors:", ts.filter(x=>x.err).map(x=>x.err).slice(0,2));
