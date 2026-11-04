import { createHash } from "node:crypto";
import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { activity } from "@/db/schema";
import { jalaliNow } from "@/lib/jalali";

/**
 * زنجیرهٔ هش برای دفتر فعالیت (Tamper-evident log)
 * -------------------------------------------------
 * هر ردیف هشِ خودش را از هشِ ردیف قبلی می‌سازد؛ اگر کسی ردیفی را در دیتابیس
 * دستی تغییر دهد یا حذف کند، زنجیره می‌شکند و در «بررسی سلامت دفتر» مشخص می‌شود.
 */

const GENESIS = "genesis";

export function chainHash(prev: string, at: string, shiftKey: string, action: string, detail: string) {
  return createHash("sha256").update(`${prev}\u0000${at}\u0000${shiftKey}\u0000${action}\u0000${detail}`).digest("hex");
}

type Db = typeof db;

export async function appendActivity(d: Db, shiftKey: string, action: string, detail = "") {
  const last = (await d.select({ hash: activity.hash }).from(activity).orderBy(desc(activity.id)).limit(1))[0];
  const prev = last?.hash || GENESIS;
  const at = jalaliNow();
  const hash = chainHash(prev, at, shiftKey, action, detail);
  await d.insert(activity).values({ at, shiftKey, action, detail, prevHash: prev, hash });
  return hash;
}

export type ChainReport = {
  checked: number;
  ok: boolean;
  brokenAtId: number | null;
  firstCheckedId: number | null;
  lastCheckedId: number | null;
  legacyRows: number;
};

/** بررسی زنجیره از قدیم به جدید؛ فقط آخرین `limit` ردیف بررسی می‌شود */
export async function verifyActivityChain(limit = 5000): Promise<ChainReport> {
  const rows = await db
    .select({ id: activity.id, at: activity.at, shiftKey: activity.shiftKey, action: activity.action, detail: activity.detail, prevHash: activity.prevHash, hash: activity.hash })
    .from(activity)
    .orderBy(asc(activity.id));
  const slice = rows.slice(-limit);
  let prev = slice.length && slice[0].id === rows[0]?.id ? GENESIS : rows[Math.max(0, rows.length - slice.length - 1)]?.hash || GENESIS;
  let legacy = 0;
  for (const row of slice) {
    if (!row.hash) {
      legacy += 1;
      prev = row.hash || prev;
      continue;
    }
    const expected = chainHash(prev, row.at, row.shiftKey, row.action, row.detail);
    if (row.prevHash !== prev || expected !== row.hash) {
      return { checked: slice.length, ok: false, brokenAtId: row.id, firstCheckedId: slice[0]?.id ?? null, lastCheckedId: slice[slice.length - 1]?.id ?? null, legacyRows: legacy };
    }
    prev = row.hash;
  }
  return { checked: slice.length, ok: true, brokenAtId: null, firstCheckedId: slice[0]?.id ?? null, lastCheckedId: slice[slice.length - 1]?.id ?? null, legacyRows: legacy };
}
