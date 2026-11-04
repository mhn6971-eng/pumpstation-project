"use client";

import { useState } from "react";
import { useApp } from "./context";
import { Icon, Panel } from "./ui";

export default function ProblemsTab() {
  const { state, act, busy } = useApp();
  const [text, setText] = useState("");
  return (
    <Panel title="خطاها و گزارش مشکل" icon="alert" hint="متن آزاد اپراتور + خطاهای سیستمی (برای توسعه‌دهنده)">
      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.4fr)" }}>
        <div>
          <div className="field"><label htmlFor="problem">شرح مشکل یا خطای مشاهده‌شده</label>
            <textarea id="problem" value={text} onChange={(e) => setText(e.target.value)} placeholder="مثلاً: در بازهٔ ۱۵ تا ۱۹ نمایشگر فشار رانش عددی نشان نداد…" /></div>
          <button type="button" className="btn primary" disabled={busy || text.trim().length < 3} onClick={async () => { if (await act("problem.add", { text })) setText(""); }}><Icon name="plus" size={14} /> ثبت گزارش مشکل</button>
          <div className="note" style={{ marginTop: 10 }}>ردیف‌های با برچسب [سیستمی] خطاهای داخلی برنامه‌اند که به‌صورت خودکار ثبت می‌شوند.</div>
        </div>
        <div className="services-list">
          {state.problems.length === 0 && <div className="empty">گزارش مشکلی ثبت نشده است.</div>}
          {state.problems.map((p) => <div key={p.id} className="service-item"><span style={{ flex: "1 1 220px" }}>{p.text}</span><span className="small muted">{p.shiftKey} — {p.at}</span></div>)}
        </div>
      </div>
    </Panel>
  );
}
