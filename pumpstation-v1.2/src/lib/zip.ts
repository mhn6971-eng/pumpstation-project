/**
 * ساخت ZIP ساده (stored = بدون فشرده‌سازی، چندفایلی) بدون هیچ وابستگی.
 * کاربرد: «ارسال بکاپ به کانال بله» — فایل JSON بکاپ + رسید sha256 در یک ZIP.
 * عمداً leaf است تا در تست‌ها مستقیم قابل فراخوانی باشد.
 * اعتبارسنجی: خروجی با ابزار واقعی `unzip -l` باز شده است.
 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; data: Uint8Array };

const u16 = (v: number) => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v & 0xffff, true);
  return b;
};
const u32 = (v: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0, true);
  return b;
};

export function zipStored(entries: ZipEntry[]): Uint8Array {
  if (!entries.length) throw new Error("ZIP خالی ساخته نمی‌شود");
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = ((((now.getFullYear() - 1980) & 0x7f) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const push = (arr: Uint8Array) => {
    chunks.push(arr);
    offset += arr.length;
  };
  const SIG_LOCAL = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  const SIG_CENTRAL = new Uint8Array([0x50, 0x4b, 0x01, 0x02]);
  for (const e of entries) {
    const name = enc.encode(e.name);
    if (!name.length || name.length > 0xffff) throw new Error(`نام نامعتبر برای ZIP: ${e.name}`);
    const crc = crc32(e.data);
    const headerOffset = offset;
    push(SIG_LOCAL);
    push(u16(20));
    push(u16(0x0800)); // نام‌ها UTF-8
    push(u16(0)); // stored
    push(u16(dosTime));
    push(u16(dosDate));
    push(u32(crc));
    push(u32(e.data.length));
    push(u32(e.data.length));
    push(u16(name.length));
    push(u16(0));
    push(name);
    push(e.data);
    central.push(
      SIG_CENTRAL, u16(20), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
      u32(crc), u32(e.data.length), u32(e.data.length), u16(name.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(headerOffset), name,
    );
  }
  const cdStart = offset;
  for (const c of central) push(c);
  const cdSize = offset - cdStart;
  push(new Uint8Array([0x50, 0x4b, 0x05, 0x06]));
  push(u16(0));
  push(u16(0));
  push(u16(entries.length));
  push(u16(entries.length));
  push(u32(cdSize));
  push(u32(cdStart));
  push(u16(0));
  const out = new Uint8Array(offset);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
