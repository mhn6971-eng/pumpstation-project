const BASE = (process.env.BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
};
const login = async (key, pin) => {
  const response = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, pin }),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, cookie: (response.headers.get("set-cookie") || "").split(";")[0] };
};
const act = async (cookie, action, payload) => {
  const response = await fetch(`${BASE}/api/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ action, payload }),
    signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const state = (cookie, query = "") => fetch(`${BASE}/api/state${query}`, {
  headers: { cookie },
  signal: AbortSignal.timeout(15000),
}).then((response) => response.json());

const [operator, second, third, admin] = await Promise.all([
  login("A", "1011"), login("B", "2022"), login("C", "3033"), login("admin", "9009"),
]);
check("operator/admin logins", [operator, second, third, admin].every((user) => user.status === 200 && Boolean(user.cookie)), [operator, second, third, admin].map((user) => user.status).join(","));
if (![operator, second, third, admin].every((user) => user.cookie)) {
  console.log(`total=${results.length} pass=${results.filter(Boolean).length} fail=${results.filter((ok) => !ok).length}`);
  process.exit(1);
}

const before = await state(operator.cookie);
const day = before.now?.day ?? "1405/10/01";
const users = [operator, second, third];
const processWrites = await Promise.all(Array.from({ length: 9 }, (_, i) =>
  act(users[i % users.length].cookie, "process.set", { tag: "PIT-004", day, intervalIndex: 3, value: 2 + i / 10 }),
));
check("9 concurrent process.set requests complete", processWrites.every((r) => r.status === 200 && r.body?.ok === true), processWrites.map((r) => `${r.status}:${r.body?.error ?? "ok"}`).join(","));
const afterProcess = await state(operator.cookie, `?day=${day}&interval=3`);
console.log("process readings:", before.counts.readings, "->", afterProcess.counts.readings, "(same unique cell is expected)");

const motorWrites = await Promise.all(Array.from({ length: 9 }, (_, i) =>
  act(users[i % users.length].cookie, "motor.values", { tag: "M-03", day, intervalIndex: 3, values: { I1: 300 + i } }),
));
check("9 concurrent motor.values requests complete", motorWrites.every((r) => r.status === 200 && r.body?.ok === true), motorWrites.map((r) => `${r.status}:${r.body?.error ?? "ok"}`).join(","));

// Exercise the previously reported deadlock shape: two service transactions
// touching different motors and their shared report/activity tables at once.
const services = await Promise.allSettled([
  act(operator.cookie, "motor.service", { tag: "M-01", day, note: `audit-concurrency-${Date.now()}-M01` }),
  act(second.cookie, "motor.service", { tag: "M-02", day, note: `audit-concurrency-${Date.now()}-M02` }),
]);
const serviceDetails = services.map((result) => result.status === "fulfilled" ? `${result.value.status}:${result.value.body?.error ?? (result.value.body?.ok ? "ok" : "failed")}` : `rejected:${String(result.reason)}`);
check("parallel motor.service on two different motors completes", services.every((result) => result.status === "fulfilled" && result.value.status === 200 && result.value.body?.ok === true), serviceDetails.join(" | "));

const chain = await act(admin.cookie, "audit.verify", { limit: 5000 });
check("activity hash chain remains valid after concurrent writes", chain.status === 200 && chain.body?.ok === true && chain.body?.brokenAtId === null, `checked=${chain.body?.checked ?? 0}`);

const pass = results.filter(Boolean).length;
console.log(`total=${results.length} pass=${pass} fail=${results.length - pass}`);
if (pass !== results.length) process.exit(1);
