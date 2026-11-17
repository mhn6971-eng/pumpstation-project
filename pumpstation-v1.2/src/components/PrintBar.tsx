"use client";

import { Icon } from "./ui";

export default function PrintBar({ title }: { title: string }) {
  return (
    <div className="report-toolbar no-print">
      <div className="row" style={{ gap: 8 }}>
        <a className="btn" href="/">
          <Icon name="arrow" size={14} /> بازگشت به سامانه
        </a>
        <span className="chip muted" style={{ maxWidth: "100%" }}>{title}</span>
      </div>
      <button type="button" className="btn primary" onClick={() => window.print()}>
        <Icon name="download" size={14} /> چاپ / ذخیره PDF
      </button>
    </div>
  );
}
