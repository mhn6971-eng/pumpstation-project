import * as J from "/tmp/jal/jalali.js";
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} | ${name} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); };

// month lengths & leap years
eq("Esfand 1403 (leap) length", J.jalaaliMonthLength(1403, 12), 30);
eq("Esfand 1404 (non-leap) length", J.jalaaliMonthLength(1404, 12), 29);
eq("Esfand 1408 (leap) length", J.jalaaliMonthLength(1408, 12), 30);
eq("Mehr length", J.jalaaliMonthLength(1405, 7), 30);
eq("Farvardin length", J.jalaaliMonthLength(1405, 1), 31);
eq("isLeap 1403", J.isLeapJalaali(1403), true);
eq("isLeap 1404", J.isLeapJalaali(1404), false);

// known conversion pairs
eq("2026-11-04 -> jalali", J.toJalaali(2026, 11, 4), { jy: 1405, jm: 8, jd: 13 });
eq("2025-03-21 -> jalali", J.toJalaali(2025, 3, 21), { jy: 1404, jm: 1, jd: 1 });
eq("jalali 1404/01/01 -> greg", J.toGregorian(1404, 1, 1), { gy: 2025, gm: 3, gd: 21 });
eq("Nowruz 1405", J.toGregorian(1405, 1, 1), { gy: 2026, gm: 3, gd: 21 });

// day arithmetic across year/month boundaries
eq("addDays 1405/12/29 +1", J.addDaysToDay("1405/12/29", 1), "1406/01/01");
eq("addDays 1404/12/30 +1 (leap→next)", J.addDaysToDay("1404/12/30", 1), "1405/01/01");
eq("addDays 1405/01/01 -1", J.addDaysToDay("1405/01/01", -1), "1404/12/30");
eq("addDays 1405/07/01 -1", J.addDaysToDay("1405/07/01", -1), "1405/06/31");
eq("roundtrip 1000 days", (() => { let d = "1405/08/13"; for (let i = 0; i < 1000; i++) d = J.addDaysToDay(d, 1); for (let i = 0; i < 1000; i++) d = J.addDaysToDay(d, -1); return d; })(), "1405/08/13");

// operational day: 7am rotation, Tehran timezone
const op = (iso) => J.operationalDay(new Date(iso));
eq("06:59 Tehran = previous op day", op("2026-11-04T03:29:00Z").day + "/" + op("2026-11-04T03:29:00Z").intervalIndex, "1405/08/12/5");
eq("07:01 Tehran = new op day", op("2026-11-04T03:31:00Z").day + "/" + op("2026-11-04T03:31:00Z").intervalIndex, "1405/08/13/0");
eq("16:00 Tehran interval", op("2026-11-04T12:30:00Z").intervalIndex, 2);
eq("22:00 Tehran interval", op("2026-11-04T18:30:00Z").intervalIndex, 3);
eq("02:00 Tehran interval (23-3)", op("2026-11-04T22:30:00Z").intervalIndex, 4);
eq("04:00 Tehran interval (3-7)", op("2026-11-04T00:30:00Z").intervalIndex, 5);
eq("weekday at 2026-11-04", op("2026-11-04T12:30:00Z").weekday, "چهارشنبه");

// digit conversion
eq("faDigits", J.faDigits("PIT-001 12"), "PIT-۰۰۱ ۱۲");

console.log(fails ? `\n${fails} FAILED` : "\nall jalali tests passed");
