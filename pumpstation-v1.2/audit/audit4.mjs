/**
 * سناریوهای فاجعه و بازیابی (نسخه ۱.۳)
 * اجرا: node audit/audit4.mjs   (سرور روی 127.0.0.1:3000)
 *
 * ⚠️ این تست داده‌ها را به عقب برمی‌گرداند (بازیابی از فایل بک‌آپ). فقط روی دیتابیس آزمایشی.
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
  return { status: res.status, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] };
}

async function act(cookie, action, payload = {}) {
  const res = await fetch(`${BASE}/api/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ action, payload }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const state = (cookie) => fetch(`${BASE}/api/state`, { headers: { cookie } }).then((r) => r.json());

const admin = await login("admin", "9999");
await act(admin.cookie, "admin.unlock", { key: "all" });

/* ۱) وضعیت پایه و نسخهٔ ایمنی */
{
  const before = await state(admin.cookie);
  const textA = `متن مبنا ${Date.now()}`;
  await act(admin.cookie, "note.save", { text: textA, expected: before.note ?? "" });

  const backup = await act(admin.cookie, "backup.create", {});
  log("backup.create", backup.body.ok === true, `file=${backup.body.file}`);
  const file = backup.body.file;
  log("backup file name returned", typeof file === "string" && file.length > 5);

  /* ۲) تغییر داده پس از بک‌آپ */
  const textB = `تغییر بعد از بک‌آپ ${Date.now()}`;
  await act(admin.cookie, "note.save", { text: textB, expected: textA });
  const mid = await state(admin.cookie);
  log("note changed after backup", mid.note === textB);

  /* ۳) بازیابی از فایل — باید به متن زمان بک‌آپ برگردد */
  const restore = await act(admin.cookie, "backup.restore_file", { file });
  log("restore from file ok", restore.body.ok === true, restore.body.error ?? `${restore.body.rows} ردیف`);

  const afterState = await fetch(`${BASE}/api/state`, { headers: { cookie: admin.cookie } });
  log("session survives restore", afterState.status === 200, `status=${afterState.status}`);
  const after = await afterState.json();
  log("note rolled back to backup content", after.note === textA, `note=${String(after.note).slice(0, 24)}…`);

  /* ۴) دادهٔ حیاتی بعد از بازیابی سالم است */
  log("equipment intact after restore", Array.isArray(after.equipment) && after.equipment.length > 50, `count=${after.equipment.length}`);
  log("motors intact after restore", Array.isArray(after.motors) && after.motors.length >= 3);

  /* ۵) فایل مخدوش رد می‌شود */
  const bogus = await act(admin.cookie, "backup.restore_file", { file: "../../etc/passwd" });
  log("path traversal in restore blocked", bogus.status === 400 || bogus.body.ok === false, `status=${bogus.status}`);
}

/* ۶) بازیابی نسخهٔ داخلی (جدول backups) */
{
  const list = await state(admin.cookie);
  const id = list.backups[0]?.id;
  if (id) {
    const restore = await act(admin.cookie, "backup.restore", { id });
    log("restore internal backup", restore.body.ok === true, restore.body.error ?? "");
    const after = await fetch(`${BASE}/api/state`, { headers: { cookie: admin.cookie } });
    log("state healthy after internal restore", after.status === 200, `status=${after.status}`);
  } else {
    log("restore internal backup", false, "بک‌آپی در فهرست نبود");
  }
}

console.log(`\n=== summary ===\ntotal=${pass + fails.length} pass=${pass} fail=${fails.length}`);
if (fails.length) console.log(fails);
process.exit(fails.length ? 1 : 0);
