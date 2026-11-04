import { PGlite } from "@electric-sql/pglite";
import * as J from "/tmp/jal/jalali.js";
const db = new PGlite(".data/pglite");
const DAYS = Number(process.argv[2] ?? 730);
const end = process.argv[3] ?? "1405/08/13";
const days = [];
for (let i = 0; i < DAYS; i++) days.push(J.addDaysToDay(end, -i));
const tags = ["M-01","M-02","M-03","M-04","M-05","M-06","M-07","M-08"];
const params = ["I1","I2","I3", ...Array.from({length:10},(_,i)=>`T${i+1}`),"BRG-P-DE","BRG-P-NDE","VIB-P-DE","VIB-P-NDE","VIB-M-DE","VIB-M-NDE"];
const ptags = ["PIT-001","PIT-002","PIT-003","PIT-004","FIT-001","LT-01","LT-02"];

const t0 = Date.now();
await db.query(`insert into motor_readings (tag, day, interval_index, param, value, shift_key, recorded_at, updated_at)
  select t, d, i, p, 50 + random()*20, 'A', 'x', 'x'
  from unnest($1::text[]) d cross join unnest($2::text[]) t cross join generate_series(0,5) i cross join unnest($3::text[]) p on conflict do nothing`,
  [days, tags, params]);
console.log("motor_readings inserted in", Date.now() - t0, "ms");
const t1 = Date.now();
await db.query(`insert into process_readings (day, interval_index, tag, value, shift_key, recorded_at, updated_at)
  select d, i, t, 3 + random()*2, 'A', 'x', 'x'
  from unnest($1::text[]) d cross join generate_series(0,5) i cross join unnest($2::text[]) t on conflict do nothing`, [days, ptags]);
console.log("process_readings inserted in", Date.now() - t1, "ms");
const t2 = Date.now();
await db.query(`insert into daily_totals (day, value, shift_key, recorded_at, updated_at)
  select d, 30000 + random()*5000, 'A', 'x', 'x' from unnest($1::text[]) d on conflict do nothing`, [days]);
console.log("daily_totals inserted in", Date.now() - t2, "ms");
await db.query(`insert into alerts (at, day, tag, param, label, value, severity, message, shift_key, seen_at, acted_at, seen_shift, acted_shift)
  select 'x', d, 'M-01', 'T1', 'دما', 100, 'warning', 'bulk test alert', 'A', '', '', '', '' from unnest($1::text[]) d`, [days.slice(0, 2000)]);
await db.query(`insert into activity (at, shift_key, action, detail) select 'x','A','bulk','row' from generate_series(1,5000)`);
const c = await db.query(`select (select count(*) from motor_readings) mr, (select count(*) from process_readings) pr, (select count(*) from daily_totals) dt, (select pg_size_pretty(pg_database_size(current_database()))) size`);
console.log(c.rows[0]);
await db.close();
