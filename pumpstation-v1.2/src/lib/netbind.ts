/**
 * بایند شبکه و اعتماد به پروکسی — نسخهٔ ۱٫۴٫۱.
 *
 * قانون قفل‌شده: پیش‌فرض فقط 127.0.0.1 است؛ حالت شبکهٔ داخلی فقط با
 * پیکربندی صریح (BIND=lan یا ‎--host) فعال می‌شود.
 *
 * خالص و بدون ایمپورت داخلی: در سرور، اسکریپت‌ها و تست‌ها (audit6) مستقیم
 * قابل استفاده است.
 */

export type BindMode = "loopback" | "lan" | "custom";

/** میزبان بایند از روی BIND: خالی/loopback → حلقه؛ lan → همهٔ رابط‌ها؛ IP → همان IP. */
export function resolveBind(bindRaw?: string): { host: string; mode: BindMode } {
  const raw = (bindRaw ?? process.env.BIND ?? "").trim().toLowerCase();
  if (!raw || raw === "loopback" || raw === "local" || raw === "127.0.0.1" || raw === "localhost") {
    return { host: "127.0.0.1", mode: "loopback" };
  }
  if (raw === "lan" || raw === "0.0.0.0") return { host: "0.0.0.0", mode: "lan" };
  if (parseIpv4(raw) !== null) return { host: raw, mode: "custom" };
  throw new Error(`مقدار BIND نامعتبر است («${raw}»). مجاز: خالی (حلقه)، lan، یا یک IP مثل 192.168.1.10`);
}

/** آیا به هدرهای پروکسی (X-Forwarded-For / X-Real-IP) اعتماد شود؟ فقط پشت Caddy/nginx مشخص. */
export function trustProxyEnabled(env?: Record<string, string | undefined>): boolean {
  const v = (env ?? process.env).TRUST_PROXY;
  return v === "1" || v?.toLowerCase() === "true" || v?.toLowerCase() === "yes";
}

/** آیا بایند مستقیم یا LAN_ALLOW بدون پراکسی نیازمند هشدار دربارهٔ IP مشترک است؟ */
export function needsNetworkIdentityWarning(bindRaw?: string, trustProxy = false, lanAllow = ""): boolean {
  return !trustProxy && (resolveBind(bindRaw).mode !== "loopback" || Boolean(lanAllow.trim()));
}

/** IP متن از هدرها؛ در حالت مستقیم (بدون پروکسی) همیشه "local" است. */
export function trustedClientIp(headers: { get: (name: string) => string | null }, trustProxy: boolean): string {
  if (!trustProxy) return "local";
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd) return fwd;
  // حالت پروکسی ولی بدون هدر: یعنی ضربهٔ مستقیم یا پروکسی بدپیکربندی؛
  // با بایند loopback پشت Caddy فقط حلقه می‌تواند مستقیم بزند (docs/STATION_NETWORK_FA.md).
  return "direct";
}

/** میزبان درخواست؛ X-Forwarded-Host فقط پشت پروکسی مورد اعتماد خوانده می‌شود. */
export function trustedRequestHost(
  headers: { get: (name: string) => string | null },
  fallbackHost: string,
  trustProxy: boolean,
): string {
  const forwarded = trustProxy ? headers.get("x-forwarded-host")?.split(",")[0]?.trim() : null;
  return forwarded || headers.get("host") || fallbackHost;
}

/** IPv4 متنی به عدد ۳۲بیتی؛ نامعتبر → null. */
export function parseIpv4(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}

/** آیا ip داخل cidr است؟ cidr هم می‌تواند IP تکی باشد. IPv6 پشتیبانی نمی‌شود (false). */
export function ipInCidr(ip: string, cidr: string): boolean {
  const clean = cidr.trim();
  const slash = clean.indexOf("/");
  if (slash < 0) return parseIpv4(ip) !== null && parseIpv4(clean) === parseIpv4(ip);
  const base = parseIpv4(clean.slice(0, slash));
  const bits = Number(clean.slice(slash + 1));
  const addr = parseIpv4(ip);
  if (base === null || addr === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = ~((1 << (32 - bits)) - 1) >>> 0;
  return ((base & mask) >>> 0) === ((addr & mask) >>> 0);
}

/** پارس فهرست LAN_ALLOW (جدا با کاما/فاصله)؛ ورودی نامعتبر → خطای فارسی. */
export function parseAllowList(raw: string): string[] {
  const items = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  for (const item of items) {
    const slash = item.indexOf("/");
    const base = slash < 0 ? item : item.slice(0, slash);
    const bits = slash < 0 ? "32" : item.slice(slash + 1);
    if (parseIpv4(base) === null || !/^\d{1,2}$/.test(bits) || Number(bits) > 32) {
      throw new Error(`رنج مجاز نامعتبر در LAN_ALLOW: «${item}» (نمونهٔ درست: 192.168.1.0/24)`);
    }
  }
  return items;
}

function isLoopbackIp(ip: string): boolean {
  return ip === "::1" || ip === "localhost" || ipInCidr(ip, "127.0.0.0/8");
}

/**
 * آیا این IP اجازهٔ اتصال دارد؟
 * - حلقه (127/8 و ‎::1) و حالت مستقیم تک‌دستگاهی ("local") همیشه مجازند.
 * - اگر LAN_ALLOW خالی باشد، همه مجازند (کنترل با فایروال سیستم‌عامل است).
 */
export function lanAllowed(ip: string, allowRaw: string): boolean {
  if (ip === "local" || ip === "direct") return true;
  if (isLoopbackIp(ip)) return true;
  const trimmed = allowRaw.trim();
  if (!trimmed) return true;
  return parseAllowList(trimmed).some((cidr) => ipInCidr(ip, cidr));
}
