import { NextResponse, type NextRequest } from "next/server";

/** سقف حجم بدنه برای همهٔ مسیرهای API (H2) — پیش از خواندن بدنه رد می‌شود */
const MAX_BODY_BYTES = 256 * 1024;

/** صفحاتی که حتماً نشست می‌خواهند؛ پیش از رندر کردن، به صفحهٔ ورود فرستاده می‌شوند */
const PROTECTED = [/^\/totals(\/|$)/, /^\/report(\/|$)/];

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES && pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: "حجم درخواست بیش از حد مجاز است (حداکثر ۲۵۶ کیلوبایت)" },
      { status: 413 },
    );
  }

  if (PROTECTED.some((re) => re.test(pathname)) && !request.cookies.get("ps_session")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/totals/:path*", "/totals", "/report/:path*"],
};
