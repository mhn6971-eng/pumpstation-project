"use client";

import { useEffect } from "react";

/** صفحهٔ خطای کاربرپسند به‌جای صفحهٔ خام مرورگر (M6) */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("خطای برنامه:", error);
  }, [error]);

  return (
    <main dir="rtl" style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: 24, fontFamily: "inherit" }}>
      <div style={{ maxWidth: 520, textAlign: "center", background: "#fff", border: "1px solid #d9e2e8", borderRadius: 14, padding: 28 }}>
        <h1 style={{ fontSize: 20, marginBottom: 10 }}>مشکلی پیش آمد</h1>
        <p style={{ color: "#4b5b66", lineHeight: 1.9, marginBottom: 18 }}>
          این صفحه به‌درستی باز نشد. داده‌های ثبت‌شدهٔ شما در سرور محفوظ است.
          یک بار دیگر تلاش کنید؛ اگر تکرار شد، موضوع را به ادمین سامانه گزارش دهید.
        </p>
        <button type="button" onClick={reset} style={{ background: "#0e7490", color: "#fff", border: 0, borderRadius: 10, padding: "10px 22px", cursor: "pointer", fontFamily: "inherit" }}>
          تلاش مجدد
        </button>
      </div>
    </main>
  );
}
