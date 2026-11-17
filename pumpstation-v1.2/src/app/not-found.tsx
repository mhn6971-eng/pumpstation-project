import Link from "next/link";

export default function NotFound() {
  return (
    <main dir="rtl" style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 24 }}>
      <div style={{ textAlign: "center", background: "#fff", border: "1px solid #d9e2e8", borderRadius: 14, padding: 28, maxWidth: 480 }}>
        <h1 style={{ fontSize: 20, marginBottom: 10 }}>این صفحه پیدا نشد</h1>
        <p style={{ color: "#4b5b66", lineHeight: 1.9, marginBottom: 18 }}>آدرس وارد شده معتبر نیست یا گزارش مورد نظر حذف شده است.</p>
        <Link href="/" style={{ color: "#0e7490", fontWeight: 700 }}>بازگشت به داشبورد</Link>
      </div>
    </main>
  );
}
