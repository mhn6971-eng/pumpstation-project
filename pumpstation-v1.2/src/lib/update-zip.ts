import yauzl from "yauzl";

const ARCHIVE_ROOT = "pumpstation-v1.2/";
const MAX_ENTRIES = 20_000;
const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const MAX_ENTRY_BYTES = 150 * 1024 * 1024;
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;
const MAX_COMPRESSION_RATIO = 250;

export type UpdateZipInfo = {
  name: "pumpstation-monitoring";
  version: string;
  entryCount: number;
  uncompressedBytes: number;
};

function validateEntryName(name: string) {
  if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw new Error(`نام مسیر نامعتبر در ZIP: ${JSON.stringify(name.slice(0, 180))}`);
  }
  if (!name.startsWith(ARCHIVE_ROOT)) throw new Error(`همهٔ فایل‌ها باید داخل پوشهٔ ${ARCHIVE_ROOT.slice(0, -1)} باشند`);
  const components = name.split("/").filter(Boolean);
  if (name === ARCHIVE_ROOT) return;
  if (components.length < 2 || components.some((part) => part === "." || part === "..")) {
    throw new Error(`مسیر نسبی یا خالی در ZIP مجاز نیست: ${name.slice(0, 180)}`);
  }
  for (const part of components) {
    if (/[<>:"|?*\u0000-\u001f]/.test(part) || /[. ]$/.test(part)) {
      throw new Error(`نام فایل با ویندوز سازگار یا امن نیست: ${name.slice(0, 180)}`);
    }
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part)) {
      throw new Error(`نام رزروشدهٔ ویندوز در ZIP مجاز نیست: ${name.slice(0, 180)}`);
    }
    if (["node_modules", ".next", ".data", ".git"].includes(part.toLowerCase()) || part.toLowerCase().startsWith(".env")) {
      throw new Error(`بسته نباید داده یا فایل اجرایی محلی را شامل شود: ${name.slice(0, 180)}`);
    }
  }
  if (components.some((part) => part.toLowerCase() === "roster.local.json")) {
    throw new Error("فایل روستر واقعی نباید در ZIP به‌روزرسانی باشد");
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[value] = crc >>> 0;
  }
  return table;
})();

async function readAndVerifyEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, collect: boolean) {
  const stream = await zip.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let size = 0;
  let crc = 0xffffffff;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_ENTRY_BYTES || (collect && size > MAX_PACKAGE_JSON_BYTES)) {
      throw new Error(collect ? "package.json بزرگ‌تر از حد مجاز است" : "یک فایل ZIP بیش از حد بزرگ است");
    }
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    if (collect) chunks.push(bytes);
  }
  const actualCrc = (crc ^ 0xffffffff) >>> 0;
  if (size !== entry.uncompressedSize || actualCrc !== (entry.crc32 >>> 0)) throw new Error(`محتوای فایل با اطلاعات ZIP سازگار نیست: ${entry.fileName.slice(0, 180)}`);
  return { size, data: collect ? Buffer.concat(chunks) : undefined };
}

/** Inspect a selected update archive without extracting it. Paths, types and expansion limits are checked first. */
export async function inspectUpdateZip(buffer: Buffer): Promise<UpdateZipInfo> {
  if (buffer.byteLength < 4 || buffer.byteLength > 100 * 1024 * 1024) throw new Error("حجم فایل ZIP خارج از محدودهٔ مجاز است");
  const zip = await yauzl.fromBufferPromise(buffer, {
    autoClose: true,
    lazyEntries: true,
    decodeStrings: true,
    validateEntrySizes: true,
    strictFileNames: true,
  });

  const seen = new Set<string>();
  const required = new Set([
    `${ARCHIVE_ROOT}package.json`,
    `${ARCHIVE_ROOT}package-lock.json`,
    `${ARCHIVE_ROOT}scripts/init-db.mjs`,
    `${ARCHIVE_ROOT}scripts/serve.mjs`,
    `${ARCHIVE_ROOT}scripts/update-runner.mjs`,
    `${ARCHIVE_ROOT}launch-pumpstation.ps1`,
    `${ARCHIVE_ROOT}launch-pumpstation.vbs`,
  ]);
  let packageJson: unknown;
  let entryCount = 0;
  let uncompressedBytes = 0;

  try {
    for await (const entry of zip.eachEntry()) {
      entryCount += 1;
      if (entryCount > MAX_ENTRIES) throw new Error("تعداد فایل‌های ZIP از حد مجاز بیشتر است");
      validateEntryName(entry.fileName);
      const key = entry.fileName.toLocaleLowerCase("en-US");
      if (seen.has(key)) throw new Error(`نام تکراری یا ناسازگار با ویندوز در ZIP: ${entry.fileName.slice(0, 180)}`);
      seen.add(key);

      const isDirectory = entry.fileName.endsWith("/");
      const fileType = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (fileType === 0xa000 || (fileType !== 0 && fileType !== 0x8000 && fileType !== 0x4000)) {
        throw new Error(`پیوند یا نوع فایل ویژه در ZIP مجاز نیست: ${entry.fileName.slice(0, 180)}`);
      }
      if (entry.isEncrypted()) throw new Error("ZIP رمزگذاری‌شده پشتیبانی نمی‌شود");
      if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) throw new Error("روش فشرده‌سازی ZIP پشتیبانی نمی‌شود");
      if (entry.uncompressedSize > MAX_ENTRY_BYTES) throw new Error(`یک فایل ZIP بیش از حد بزرگ است: ${entry.fileName.slice(0, 180)}`);
      if (entry.uncompressedSize > 0 && entry.compressedSize === 0) throw new Error(`اندازهٔ فشردهٔ فایل معتبر نیست: ${entry.fileName.slice(0, 180)}`);
      if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO) {
        throw new Error(`نسبت فشرده‌سازی غیرعادی در ZIP: ${entry.fileName.slice(0, 180)}`);
      }
      if (isDirectory) {
        if (entry.uncompressedSize !== 0 || entry.compressedSize !== 0) throw new Error(`پوشهٔ ZIP نباید داده داشته باشد: ${entry.fileName.slice(0, 180)}`);
        continue;
      }

      const isPackageJson = entry.fileName === `${ARCHIVE_ROOT}package.json`;
      const verified = await readAndVerifyEntry(zip, entry, isPackageJson);
      uncompressedBytes += verified.size;
      if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) throw new Error("حجم بازشدهٔ ZIP بیش از ۵۰۰ مگابایت است");
      required.delete(entry.fileName);
      if (isPackageJson && verified.data) {
        try {
          packageJson = JSON.parse(verified.data.toString("utf8")) as unknown;
        } catch {
          throw new Error("package.json داخل ZIP قابل‌خواندن نیست");
        }
      }
    }
  } finally {
    if (zip.isOpen) zip.close();
  }

  if (required.size) throw new Error(`فایل ضروری در ZIP موجود نیست: ${[...required][0]}`);
  if (!packageJson || typeof packageJson !== "object") throw new Error("package.json در ریشهٔ پوشهٔ برنامه پیدا نشد");
  const pkg = packageJson as { name?: unknown; version?: unknown };
  if (pkg.name !== "pumpstation-monitoring") throw new Error("این ZIP برای برنامهٔ Pumpstation نیست");
  if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error("شمارهٔ نسخهٔ ZIP معتبر نیست");

  return {
    name: "pumpstation-monitoring",
    version: pkg.version,
    entryCount,
    uncompressedBytes,
  };
}
