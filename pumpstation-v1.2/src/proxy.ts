import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

/** سقف حجم بدنه برای همهٔ مسیرهای API — پیش از خواندن بدنه رد می‌شود */
const MAX_BODY_BYTES = 256 * 1024;

/** سقف درخواست هر IP در دقیقه (ضدسیل ساده و ارزان) */
const IP_LIMIT = 600;
const IP_WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

/** صفحاتی که حتماً نشست می‌خواهند؛ پیش از رندر کردن، به صفحهٔ ورود فرستاده می‌شوند */
const PROTECTED = [/^\/totals(\/|$)/, /^\/report(\/|$)/];

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function ipOf(request: NextRequest) {
  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  );
}

function hostOf(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    request.nextUrl.host
  );
}

/**
 * محافظت CSRF: مرورگرها برای درخواست‌های بین‌سایتی هدر Origin می‌فرستند.
 * اگر Origin با میزبان خودمان نخواند، درخواست رد می‌شود. کلاینت‌های غیرمرورگری
 * (مثل اسکریپت پشتیبان‌گیری) Origin ندارند و همچنان به کوکی معتبر نیاز دارند.
 */
function crossSite(request: NextRequest) {
  if (!MUTATING.has(request.method)) return false;
  const origin = request.headers.get("origin");
  const host = hostOf(request);
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) return true;
      return false;
    } catch {
      return true;
    }
  }
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin", "same-site", "none"].includes(site)) return true;
  return false;
}

function rateLimited(ip: string) {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
  }
  const b = buckets.get(ip);
  if (!b || now > b.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
    return 0;
  }
  b.count += 1;
  if (b.count > IP_LIMIT) return Math.ceil((b.resetAt - now) / 1000);
  return 0;
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = request.headers.get("x-request-id") || randomUUID();

  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);

  if (pathname.startsWith("/api/")) {
    // ضدسیل: درخواست‌های بیش از حد از یک IP
    const retry = rateLimited(ipOf(request));
    if (retry > 0) {
      return NextResponse.json(
        { ok: false, error: "تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد تلاش کنید", requestId },
        { status: 429, headers: { "retry-after": String(retry), "x-request-id": requestId } },
      );
    }

    // سقف حجم بدنه
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) {
      return NextResponse.json(
        { ok: false, error: "حجم درخواست بیش از حد مجاز است (حداکثر ۲۵۶ کیلوبایت)", requestId },
        { status: 413, headers: { "x-request-id": requestId } },
      );
    }

    // CSRF
    if (crossSite(request)) {
      return NextResponse.json(
        { ok: false, error: "درخواست از مبدأ نامعتبر رد شد", code: "bad_origin", requestId },
        { status: 403, headers: { "x-request-id": requestId } },
      );
    }
  }

  if (PROTECTED.some((re) => re.test(pathname)) && !request.cookies.get("ps_session")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/api/:path*", "/totals/:path*", "/totals", "/report/:path*"],
};
