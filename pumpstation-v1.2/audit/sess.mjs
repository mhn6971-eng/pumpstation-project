const BASE = "http://127.0.0.1:3000";
const login = async (k, p) => { const r = await fetch(`${BASE}/api/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: k, pin: p }) }); return { cookie: (r.headers.get("set-cookie") || "").split(";")[0], status: r.status }; };
const act = (cookie, action, payload) => fetch(`${BASE}/api/actions`, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ action, payload }) }).then((r) => r.json());
const st = (cookie) => fetch(`${BASE}/api/state`, { headers: { cookie } }).then((r) => r.status);

const A = await login("A", "1111");
const ADM = await login("admin", "9999");
console.log("A session status:", await st(A.cookie));

// change PIN of shift B, check if old B session dies
const B1 = await login("B", "2222");
const chg = await act(ADM.cookie, "admin.pin", { key: "B", pin: "4444" });
console.log("pin changed:", chg.ok, "| old B session after PIN change:", await st(B1.cookie), "(401 would mean revoked)");
const B2 = await login("B", "2222");
console.log("login with OLD pin after change:", B2.status, "(401 expected)");
const B3 = await login("B", "4444");
console.log("login with NEW pin:", B3.status);
await act(ADM.cookie, "admin.pin", { key: "B", pin: "2222" }); // restore

// logout does not revoke token server-side
const logout = await fetch(`${BASE}/api/auth`, { method: "DELETE", headers: { cookie: A.cookie } });
const afterLogout = await st(A.cookie);
console.log("logout status:", logout.status, "| old cookie still valid after logout:", afterLogout, "(200 = session not revoked server-side)");

// two tabs / two clients: last write wins on the same note
const T1 = await login("A", "1111");
const T2 = await login("A", "1111");
await act(T1.cookie, "note.save", { text: "متن تب اول", day: "1405/08/13" });
await act(T2.cookie, "note.save", { text: "متن تب دوم", day: "1405/08/13" });
const s = await fetch(`${BASE}/api/state`, { headers: { cookie: T1.cookie } }).then((r) => r.json());
console.log("note after two tabs:", JSON.stringify(s.note), "→ last write silently wins, first entry lost");
