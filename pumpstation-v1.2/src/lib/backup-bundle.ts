import { createHash, randomBytes } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import type { Writable } from "node:stream";
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { createInterface } from "node:readline";
import path from "node:path";
import { db } from "@/db";
import { archiveRuns, catalogs, channels, shifts } from "@/db/schema";
import { APP_VERSION } from "@/lib/version";
import { ARCHIVE_DIR } from "@/lib/archive";
import { BUNDLE_SERIAL_TABLES, BUNDLE_TABLES, BACKUP_DIR, CATALOG_DIR } from "@/lib/backup";
import { gt, sql } from "drizzle-orm";
import { badRequest } from "@/lib/errors";

export const BUNDLE_DIR = path.join(BACKUP_DIR, "bundles");
const FORMAT = "pumpstation-recovery-bundle";
const FORMAT_VERSION = 1;
const PAGE_SIZE = 5000;
const RESTORE_BATCH = 400;

type BundleAsset = { path: string; bytes: number; sha256: string };
type BundleTable = { table: string; file: string; rows: number; bytes: number; contentBytes: number; sha256: string; fileSha256: string };
type BundleManifest = {
  format: string;
  formatVersion: number;
  name: string;
  createdAt: string;
  appVersion: string;
  tables: BundleTable[];
  tableCounts: Record<string, number>;
  assets: BundleAsset[];
  missingCatalogFiles: string[];
  missingColdFiles: string[];
  complete: boolean;
  totalBytes: number;
};

function sha256(data: Uint8Array | string) {
  return createHash("sha256").update(data).digest("hex");
}

async function hashFile(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function safeLeaf(value: string) {
  const leaf = path.basename(value.replace(/\\/g, "/"));
  const safe = leaf.replace(/[^\w.-]/g, "_");
  if (!safe || safe === "." || safe === "..") throw new Error("نام فایل نامعتبر است");
  return safe;
}

function safeBundleName(name: string) {
  if (!/^pumpstation-bundle-[a-zA-Z0-9_-]+$/.test(name) || path.basename(name) !== name) {
    throw new Error("نام بستهٔ بازیابی نامعتبر است");
  }
  return name;
}

async function writeLine(stream: Writable, text: string) {
  if (!stream.write(text)) await once(stream, "drain");
}

function tableFileName(name: string) {
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) throw new Error(`نام جدول نامعتبر است: ${name}`);
  return `tables/${name}.jsonl.gz`;
}

async function assetMetadata(root: string, relativePath: string): Promise<BundleAsset> {
  const file = path.join(root, ...relativePath.split("/"));
  const info = await stat(file);
  if (!info.isFile()) throw new Error(`دارایی بسته فایل عادی نیست: ${relativePath}`);
  return { path: relativePath, bytes: info.size, sha256: await hashFile(file) };
}

async function addAsset(stage: string, source: string, relativePath: string, assets: BundleAsset[]) {
  const target = path.join(stage, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  const item = await assetMetadata(stage, relativePath);
  const samePath = assets.find((asset) => asset.path === item.path);
  if (samePath && samePath.sha256 !== item.sha256) throw new Error(`دو فایل متفاوت نام یکسان دارند: ${relativePath}`);
  if (!samePath) assets.push(item);
  return item;
}

function transformExportRow(table: string, raw: Record<string, unknown>, assets: BundleAsset[], missingCatalogFiles: string[], coldFiles: Set<string>, missingColdFiles: Set<string>) {
  const row = { ...raw };
  if (table === "channels") row.token = "";
  if (table === "shifts") {
    row.totpSecret = "";
    row.totpPending = "";
    row.totpEnabled = false;
    row.totpBackupCodes = [];
    row.totpEnabledAt = "";
  }
  if (table === "catalogs") {
    const storedPath = String(row.path ?? "");
    if (storedPath) {
      let fileName = "";
      try { fileName = safeLeaf(storedPath); } catch { /* فایل نامعتبر به‌عنوان مفقود ثبت می‌شود */ }
      const assetPath = fileName ? `assets/catalogs/${fileName}` : "";
      const asset = assets.find((item) => item.path === assetPath);
      if (asset) {
        row.path = fileName;
        row.sha256 = asset.sha256;
      } else {
        missingCatalogFiles.push(`${String(row.tag ?? "")} — ${String(row.name ?? "کاتالوگ")}`);
        row.path = "";
        row.data = "";
      }
    } else if (!String(row.data ?? "")) {
      missingCatalogFiles.push(`${String(row.tag ?? "")} — ${String(row.name ?? "کاتالوگ")}`);
    }
  }
  if (table === "archiveRuns") {
    const stored = String(row.file ?? "");
    let fileName = "";
    try { fileName = stored ? safeLeaf(stored) : ""; } catch { /* مسیر قدیمی/نامعتبر */ }
    if (fileName && coldFiles.has(fileName)) row.file = fileName;
    else {
      if (stored) missingColdFiles.add(fileName || stored);
      row.file = "";
    }
  }
  return row;
}

async function writeTableSnapshot(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], stage: string, name: string, table: unknown, assets: BundleAsset[], missingCatalogFiles: string[], coldFiles: Set<string>, missingColdFiles: Set<string>): Promise<BundleTable> {
  const relativePath = tableFileName(name);
  const fullPath = path.join(stage, ...relativePath.split("/"));
  await mkdir(path.dirname(fullPath), { recursive: true });
  const gzip = createGzip({ level: 6 });
  const output = createWriteStream(fullPath);
  gzip.pipe(output);
  const gzipDone = finished(gzip);
  const outputDone = finished(output);
  const hash = createHash("sha256");
  let contentBytes = 0;
  let rowsWritten = 0;
  let cursor: unknown = undefined;
  const sortColumn = name === "motors" ? "tag" : ["channels", "shifts", "settings"].includes(name) ? "key" : "id";
  const sortField = (table as Record<string, unknown>)[sortColumn] as never;
  try {
    for (;;) {
      const query = tx.select().from(table as never);
      const page = cursor === undefined
        ? await query.orderBy(sortField).limit(PAGE_SIZE)
        : await query.where(gt(sortField, cursor as never)).orderBy(sortField).limit(PAGE_SIZE);
      const rows = page as unknown as Record<string, unknown>[];
      if (!rows.length) break;
      for (const raw of rows) {
        const line = `${JSON.stringify(transformExportRow(name, raw, assets, missingCatalogFiles, coldFiles, missingColdFiles))}\n`;
        const lineBytes = Buffer.byteLength(line, "utf8");
        hash.update(line);
        contentBytes += lineBytes;
        await writeLine(gzip, line);
        rowsWritten += 1;
      }
      cursor = rows[rows.length - 1][sortColumn];
      if (rows.length < PAGE_SIZE) break;
    }
    gzip.end();
    await Promise.all([gzipDone, outputDone]);
  } catch (error) {
    gzip.destroy(error instanceof Error ? error : undefined);
    output.destroy(error instanceof Error ? error : undefined);
    await Promise.allSettled([gzipDone, outputDone]);
    throw error;
  }
  const info = await stat(fullPath);
  return { table: name, file: relativePath, rows: rowsWritten, bytes: info.size, contentBytes, sha256: hash.digest("hex"), fileSha256: await hashFile(fullPath) };
}

/** پوشهٔ قابل‌انتقال، با جدول‌بندیِ جریانی تا آرشیو بزرگ یک‌جا وارد RAM نشود. */
export async function writeBackupBundle() {
  await mkdir(BUNDLE_DIR, { recursive: true });
  const suffix = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
  const name = `pumpstation-bundle-${suffix}`;
  const stage = path.join(BUNDLE_DIR, `.${name}.tmp`);
  const destination = path.join(BUNDLE_DIR, name);
  await mkdir(stage, { recursive: true });

  try {
    const assets: BundleAsset[] = [];
    const missingCatalogFiles: string[] = [];
    const missingColdFiles = new Set<string>();
    const coldFiles = new Set<string>();
    const tableFiles: BundleTable[] = [];
    await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level repeatable read`);
      const catalogRows = await tx.select().from(catalogs);
      for (const row of catalogRows) {
        const storedPath = String(row.path ?? "");
        if (!storedPath) continue;
        let fileName = "";
        try { fileName = safeLeaf(storedPath); } catch { /* تبدیل پایین‌تر به هشدار می‌شود */ }
        const source = fileName ? path.join(CATALOG_DIR, fileName) : "";
        const actual = source ? await stat(source).then((s) => s.isFile() ? hashFile(source) : "").catch(() => "") : "";
        if (!actual || (row.sha256 && actual !== row.sha256)) continue;
        await addAsset(stage, source, `assets/catalogs/${fileName}`, assets);
      }
      const runs = await tx.select({ file: archiveRuns.file }).from(archiveRuns);
      for (const run of runs) {
        const stored = String(run.file ?? "");
        if (!stored) continue;
        let fileName = "";
        try { fileName = safeLeaf(stored); } catch { /* ثبت پایین‌تر به‌عنوان فایل سرد مفقود می‌شود */ }
        const source = fileName ? path.join(ARCHIVE_DIR, fileName) : "";
        const info = source ? await stat(source).catch(() => null) : null;
        if (!info?.isFile() || !fileName.endsWith(".jsonl.gz")) {
          missingColdFiles.add(fileName || stored);
          continue;
        }
        await addAsset(stage, source, `assets/archive/${fileName}`, assets);
        coldFiles.add(fileName);
      }
      for (const [name, table] of Object.entries(BUNDLE_TABLES)) {
        tableFiles.push(await writeTableSnapshot(tx, stage, name, table, assets, missingCatalogFiles, coldFiles, missingColdFiles));
      }
    });

    const tableCounts = Object.fromEntries(tableFiles.map((item) => [item.table, item.rows]));
    const totalBytes = tableFiles.reduce((sum, item) => sum + item.bytes, 0) + assets.reduce((sum, item) => sum + item.bytes, 0);
    const manifest: BundleManifest = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      name,
      createdAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      tables: tableFiles,
      tableCounts,
      assets,
      missingCatalogFiles: [...new Set(missingCatalogFiles)],
      missingColdFiles: [...missingColdFiles],
      complete: missingCatalogFiles.length === 0,
      totalBytes,
    };
    await writeFile(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    await rename(stage, destination);
    return {
      name,
      bytes: totalBytes,
      rows: Object.values(tableCounts).reduce((sum, count) => sum + count, 0),
      assets: assets.length,
      complete: manifest.complete,
      warnings: [...manifest.missingCatalogFiles.map((file) => `PDF مفقود/ناسازگار: ${file}`), ...manifest.missingColdFiles.map((file) => `فایل سرد مفقود: ${file}`)],
    };
  } catch (error) {
    await rm(stage, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function readManifest(root: string, name: string): Promise<BundleManifest> {
  const safe = safeBundleName(name);
  const raw = JSON.parse(await readFile(path.join(root, safe, "manifest.json"), "utf8")) as BundleManifest;
  if (raw.format !== FORMAT || raw.formatVersion !== FORMAT_VERSION || raw.name !== safe || !Array.isArray(raw.tables) || !Array.isArray(raw.assets)) {
    throw new Error("قالب بستهٔ بازیابی پشتیبانی نمی‌شود یا manifest مخدوش است");
  }
  return raw;
}

async function scanTableFile(root: string, item: BundleTable, onRow: (row: Record<string, unknown>) => void | Promise<void>) {
  const relative = item.file;
  if (relative !== tableFileName(item.table)) throw new Error(`مسیر جدول ناامن است: ${relative}`);
  const fullPath = path.join(root, ...relative.split("/"));
  const fileInfo = await stat(fullPath);
  if (!fileInfo.isFile() || fileInfo.size !== item.bytes) throw new Error(`حجم فایل فشردهٔ ${item.table} ناسازگار است`);
  const fileHash = createHash("sha256");
  const hash = createHash("sha256");
  let contentBytes = 0;
  let rows = 0;
  const input = createReadStream(fullPath);
  input.on("data", (chunk) => fileHash.update(chunk));
  const gunzip = input.pipe(createGunzip());
  const lines = createInterface({ input: gunzip, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const normalized = `${line}\n`;
      hash.update(normalized);
      contentBytes += Buffer.byteLength(normalized, "utf8");
      if (!line) continue;
      let row: unknown;
      try { row = JSON.parse(line); } catch { throw new Error(`JSON سطر ${rows + 1} در ${item.table} خراب است`); }
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`ردیف نامعتبر در جدول ${item.table}`);
      await onRow(row as Record<string, unknown>);
      rows += 1;
    }
  } finally {
    lines.close();
    if (!input.destroyed) input.destroy();
    if (!gunzip.destroyed) gunzip.destroy();
  }
  if (rows !== item.rows || contentBytes !== item.contentBytes || hash.digest("hex") !== item.sha256 || fileHash.digest("hex") !== item.fileSha256) {
    throw new Error(`شمار ردیف، حجم یا checksum محتوای جدول ${item.table} ناسازگار است`);
  }
  return rows;
}

async function verifyAt(root: string, name: string) {
  const manifest = await readManifest(root, name);
  const expectedNames = Object.keys(BUNDLE_TABLES).sort();
  const actualNames = manifest.tables.map((item) => item.table).sort();
  if (expectedNames.join("|") !== actualNames.join("|")) throw new Error("فهرست جدول‌های بسته ناقص یا تکراری است");

  const assetSet = new Set<string>();
  let bytes = 0;
  for (const asset of manifest.assets) {
    const parts = String(asset.path ?? "").split("/");
    if (parts.length !== 3 || parts[0] !== "assets" || !["catalogs", "archive"].includes(parts[1]) || safeLeaf(parts[2]) !== parts[2]) {
      throw new Error(`مسیر دارایی ناامن/نامعتبر است: ${asset.path}`);
    }
    if (assetSet.has(asset.path)) throw new Error(`دارایی تکراری در manifest: ${asset.path}`);
    assetSet.add(asset.path);
    const actual = await assetMetadata(path.join(root, name), asset.path);
    if (actual.bytes !== asset.bytes || actual.sha256 !== asset.sha256) throw new Error(`checksum یا حجم دارایی ناسازگار است: ${asset.path}`);
    bytes += actual.bytes;
  }

  let missingCatalogs = 0;
  const catalogPaths = new Set(manifest.assets.filter((asset) => asset.path.startsWith("assets/catalogs/")).map((asset) => asset.path.slice("assets/catalogs/".length)));
  const counts: Record<string, number> = {};
  for (const item of manifest.tables) {
    if (manifest.tableCounts[item.table] !== item.rows) throw new Error(`شمار ردیف‌های ${item.table} با manifest نمی‌خواند`);
    counts[item.table] = await scanTableFile(path.join(root, name), item, (row) => {
      if (item.table === "channels" && row.token !== "") throw new Error("توکن کانال در بستهٔ خارجی باید خالی باشد");
      if (item.table === "catalogs") {
        const storedPath = String(row.path ?? "");
        if (storedPath && !catalogPaths.has(safeLeaf(storedPath))) throw new Error(`PDF کاتالوگ داخل بسته نیست: ${storedPath}`);
        if (!storedPath && !String(row.data ?? "")) missingCatalogs += 1;
      }
    });
    bytes += item.bytes;
  }
  if (manifest.complete !== (missingCatalogs === 0) || manifest.complete !== (manifest.missingCatalogFiles.length === 0)) {
    throw new Error("وضعیت کامل‌بودن بسته با فهرست PDFهای مفقود نمی‌خواند");
  }
  if (manifest.totalBytes !== bytes) throw new Error("حجم کل بسته با manifest نمی‌خواند");
  return { manifest, bytes, counts };
}

/** بررسی کامل جریانی؛ هیچ تغییری در دیتابیس اعمال نمی‌شود. */
export async function verifyBackupBundle(name: string) {
  const { manifest, bytes, counts } = await verifyAt(BUNDLE_DIR, name);
  return {
    name: manifest.name,
    createdAt: manifest.createdAt,
    appVersion: manifest.appVersion,
    complete: manifest.complete,
    bytes,
    rows: Object.values(counts).reduce((sum, count) => sum + count, 0),
    assets: manifest.assets.length,
    tableCounts: counts,
    warnings: [...manifest.missingCatalogFiles.map((file) => `PDF مفقود/ناسازگار: ${file}`), ...manifest.missingColdFiles.map((file) => `فایل سرد مفقود: ${file}`)],
  };
}

export async function listBackupBundles() {
  await mkdir(BUNDLE_DIR, { recursive: true });
  const entries = await readdir(BUNDLE_DIR, { withFileTypes: true });
  const out: { name: string; createdAt: string; bytes: number; rows: number; assets: number; complete: boolean; warnings: number }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("pumpstation-bundle-")) continue;
    try {
      const manifest = await readManifest(BUNDLE_DIR, entry.name);
      out.push({
        name: manifest.name,
        createdAt: manifest.createdAt,
        bytes: manifest.totalBytes,
        rows: Object.values(manifest.tableCounts).reduce((sum, count) => sum + count, 0),
        assets: manifest.assets.length,
        complete: manifest.complete,
        warnings: manifest.missingCatalogFiles.length + manifest.missingColdFiles.length,
      });
    } catch {
      out.push({ name: entry.name, createdAt: "", bytes: 0, rows: 0, assets: 0, complete: false, warnings: 1 });
    }
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

async function installAsset(source: string, targetDir: string, preferredName: string, expectedHash: string) {
  await mkdir(targetDir, { recursive: true });
  const base = safeLeaf(preferredName);
  const stem = `${expectedHash.slice(0, 12)}-${base}`.slice(0, 230);
  let target = path.join(targetDir, stem);
  const currentHash = await hashFile(target).catch(() => "");
  if (currentHash === expectedHash) return path.basename(target);
  if (currentHash) target = path.join(targetDir, `${Date.now()}-${stem}`.slice(0, 240));
  await copyFile(source, target, constants.COPYFILE_EXCL);
  return path.basename(target);
}

async function restoreSnapshotFromBundle(root: string, manifest: BundleManifest, name: string) {
  const catalogNames = new Map<string, string>();
  const archiveNames = new Map<string, string>();

  for (const asset of manifest.assets) {
    const source = path.join(root, name, ...asset.path.split("/"));
    if (asset.path.startsWith("assets/catalogs/")) {
      const original = asset.path.slice("assets/catalogs/".length);
      catalogNames.set(original, await installAsset(source, CATALOG_DIR, original, asset.sha256));
    } else {
      const original = asset.path.slice("assets/archive/".length);
      archiveNames.set(original, await installAsset(source, ARCHIVE_DIR, original, asset.sha256));
    }
  }

  let localTotpKeys: string[] = [];
  await db.transaction(async (tx) => {
    const localShifts = await tx.select().from(shifts);
    const totpMap = new Map(localShifts.map((item) => [item.key, item]));
    localTotpKeys = localShifts.filter((item) => item.totpEnabled).map((item) => item.key);
    const localChannels = await tx.select({ key: channels.key, provider: channels.provider, chatId: channels.chatId, token: channels.token }).from(channels);
    const tokenMap = new Map(localChannels.map((item) => [`${item.key}\0${item.provider}\0${item.chatId}`, item.token]));
    for (const item of manifest.tables) {
      const table = BUNDLE_TABLES[item.table as keyof typeof BUNDLE_TABLES];
      await tx.delete(table as never);
      let batch: Record<string, unknown>[] = [];
      const flush = async () => {
        if (batch.length) await tx.insert(table as never).values(batch as never);
        batch = [];
      };
      await scanTableFile(path.join(root, name), item, async (original) => {
        const row = { ...original };
        if (item.table === "channels") {
          const key = `${String(row.key ?? "")}\0${String(row.provider ?? "")}\0${String(row.chatId ?? "")}`;
          const token = tokenMap.get(key) ?? "";
          row.token = token;
        }
        if (item.table === "shifts") {
          const local = totpMap.get(String(row.key ?? ""));
          row.totpSecret = local?.totpSecret ?? "";
          row.totpPending = local?.totpPending ?? "";
          row.totpEnabled = local?.totpEnabled ?? false;
          row.totpBackupCodes = local?.totpBackupCodes ?? [];
          row.totpEnabledAt = local?.totpEnabledAt ?? "";
        }
        if (item.table === "catalogs" && row.path) {
          const restored = catalogNames.get(safeLeaf(String(row.path)));
          row.path = restored ?? "";
          if (!restored) row.data = "";
        }
        if (item.table === "archiveRuns") {
          const restored = row.file ? archiveNames.get(safeLeaf(String(row.file))) : "";
          row.file = restored ? path.join(ARCHIVE_DIR, restored) : "";
        }
        batch.push(row);
        if (batch.length >= RESTORE_BATCH) await flush();
      });
      await flush();
    }
    for (const table of BUNDLE_SERIAL_TABLES) {
      await tx.execute(sql.raw(`select setval(pg_get_serial_sequence('${table}','id'), greatest(coalesce((select max(id) from ${table}),0),1))`));
    }
    for (const item of manifest.tables) {
      const table = BUNDLE_TABLES[item.table as keyof typeof BUNDLE_TABLES];
      const counts = (await tx.select({ count: sql<number>`count(*)::int` }).from(table as never)) as unknown as { count: number }[];
      const row = counts[0];
      if ((row?.count ?? 0) !== item.rows) throw new Error(`تعداد ردیف‌های بازیابی‌شدهٔ ${item.table} نادرست است`);
    }
  });
  return localTotpKeys;
}

/** بازیابی بسته؛ یک snapshot ایمنی ساخته و فایل‌های هدف با نام یکتا نصب می‌شوند. */
export async function restoreBackupBundle(name: string, opts: { allowIncomplete?: boolean } = {}) {
  const verified = await verifyAt(BUNDLE_DIR, name);
  const hasMissingAssets = verified.manifest.missingCatalogFiles.length > 0 || verified.manifest.missingColdFiles.length > 0;
  if (hasMissingAssets && !opts.allowIncomplete) {
    throw badRequest("بسته فایل PDF یا آرشیو سرد مفقود دارد؛ برای ادامه باید هشدار را صریحاً تأیید کنید");
  }
  const safety = await writeBackupBundle();
  const totpPreserved = await restoreSnapshotFromBundle(BUNDLE_DIR, verified.manifest, name);
  const channelsNeedSetup = (await db.select().from(channels)).filter((row) => row.enabled && !row.token).map((row) => row.key);
  const warnings = [
    "رازها و کدهای TOTP در بستهٔ خارجی ذخیره نمی‌شوند؛ تنظیمات دستگاه مقصد حفظ شد. در دستگاه تازه، ورود دوعاملی را دوباره تنظیم کنید.",
    ...verified.manifest.missingCatalogFiles.map((file) => `PDF مفقود/ناسازگار: ${file}`),
    ...verified.manifest.missingColdFiles.map((file) => `فایل سرد مفقود: ${file}`),
  ];
  return {
    name: verified.manifest.name,
    complete: verified.manifest.complete,
    bytes: verified.bytes,
    rows: Object.values(verified.counts).reduce((sum, count) => sum + count, 0),
    warnings,
    channelsNeedSetup,
    totpPreserved,
    safetyBundle: safety.name,
  };
}

export async function copyLatestBundleTo(targetRoot: string) {
  const bundles = await listBackupBundles();
  const latest = bundles[0];
  if (!latest) return null;
  const source = path.resolve(BUNDLE_DIR, latest.name);
  const destinationRoot = path.resolve(targetRoot, "bundles");
  const destination = path.join(destinationRoot, latest.name);
  if (destination === source) return { name: latest.name, bytes: latest.bytes, complete: latest.complete };
  if (destination.startsWith(`${source}${path.sep}`)) throw new Error("مسیر آینه داخل بستهٔ مبدأ قرار گرفته است؛ MIRROR_DIR را جداگانه تنظیم کنید");
  // Do not propagate a damaged source, and do not trust a matching manifest as proof
  // that an existing destination bundle's table files and assets are intact.
  const sourceVerified = await verifyAt(BUNDLE_DIR, latest.name);
  await mkdir(path.dirname(destination), { recursive: true });
  const existing = await stat(destination).catch(() => null);
  if (!existing) {
    await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  } else {
    const sourceManifest = await readFile(path.join(source, "manifest.json"), "utf8");
    const mirrorManifest = await readFile(path.join(destination, "manifest.json"), "utf8");
    if (sourceManifest !== mirrorManifest) throw new Error(`بستهٔ هم‌نام روی آینه با مبدأ متفاوت است: ${latest.name}`);
  }
  const destinationVerified = await verifyAt(destinationRoot, latest.name);
  if (
    destinationVerified.manifest.name !== sourceVerified.manifest.name ||
    destinationVerified.bytes !== sourceVerified.bytes ||
    destinationVerified.manifest.totalBytes !== sourceVerified.manifest.totalBytes
  ) {
    throw new Error(`صحت کامل بستهٔ آینه‌شده با مبدأ یکسان نیست: ${latest.name}`);
  }
  return { name: latest.name, bytes: destinationVerified.bytes, complete: destinationVerified.manifest.complete };
}
