import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "سامانه پایش ایستگاه پمپاژ زیرزمینی | آب منطقه‌ای اصفهان",
  description: "پایش پارامترهای فرآیندی، هشت موتور اصلی، تجهیزات جانبی و رجیستری تجهیزات ایستگاه پمپاژ.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
