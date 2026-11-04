import { PGlite } from "@electric-sql/pglite";
const db = new PGlite(".data/pglite");
try {
  const r = await db.query("select count(*)::int as n from process_readings");
  console.log("OK", r.rows);
} catch (e) {
  console.log("ERR", e?.message);
}
try { await db.close(); } catch (e) { console.log("close err", e?.message); }
