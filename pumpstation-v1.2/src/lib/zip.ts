import { deflateRawSync } from "node:zlib";

/** ZIP UTF-8; stored برای سازگاری بک‌آپ و deflate برای بسته‌های گزارش فشرده. */
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

function makeZip(entries: ZipEntry[], method: 0 | 8): Uint8Array {
  if (!entries.length) throw new Error("ZIP خالی ساخته نمی‌شود");
  if (entries.length > 0xffff) throw new Error("تعداد فایل‌های ZIP از حد پشتیبانی‌شده بیشتر است");
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = ((((now.getFullYear() - 1980) & 0x7f) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const push = (arr: Uint8Array) => {
    if (offset + arr.length > 0xffffffff) throw new Error("ZIP64 پشتیبانی نمی‌شود؛ اندازهٔ آرشیو از حد ۴ گیگابایت گذشته است");
    chunks.push(arr);
    offset += arr.length;
  };
  const SIG_LOCAL = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  const SIG_CENTRAL = new Uint8Array([0x50, 0x4b, 0x01, 0x02]);
  for (const e of entries) {
    const name = enc.encode(e.name);
    if (!name.length || name.length > 0xffff) throw new Error(`نام نامعتبر برای ZIP: ${e.name}`);
    const data = e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data);
    const packed = method === 8 ? new Uint8Array(deflateRawSync(data, { level: 6 })) : data;
    if (data.length > 0xffffffff || packed.length > 0xffffffff || offset > 0xffffffff) {
      throw new Error("ZIP64 پشتیبانی نمی‌شود؛ اندازهٔ آرشیو از حد ۴ گیگابایت گذشته است");
    }
    const crc = crc32(data);
    const headerOffset = offset;
    push(SIG_LOCAL);
    push(u16(20));
    push(u16(0x0800)); // نام‌ها UTF-8
    push(u16(method));
    push(u16(dosTime));
    push(u16(dosDate));
    push(u32(crc));
    push(u32(packed.length));
    push(u32(data.length));
    push(u16(name.length));
    push(u16(0));
    push(name);
    push(packed);
    central.push(
      SIG_CENTRAL, u16(20), u16(20), u16(0x0800), u16(method), u16(dosTime), u16(dosDate),
      u32(crc), u32(packed.length), u32(data.length), u16(name.length),
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

/** ZIP بدون فشرده‌سازی؛ برای بستهٔ بک‌آپ که خودش JSON فشرده/چک‌سام دارد. */
export function zipStored(entries: ZipEntry[]): Uint8Array {
  return makeZip(entries, 0);
}

/** ZIP با DEFLATE واقعی؛ برای آرشیوهای گزارش روزانه. */
export function zipDeflated(entries: ZipEntry[]): Uint8Array {
  return makeZip(entries, 8);
}
