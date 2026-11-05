"use client";

import { useEffect, useState } from "react";
import { useApp } from "./context";
import { Icon, Panel } from "./ui";
import { EquipmentForm } from "./RegistryTab";
import TwoFactorPanel from "./TwoFactorPanel";
import MirrorPanel from "./MirrorPanel";

export default function AdminTab() {
  const { state, act, busy, toast, openModal, refresh } = useApp();

  return (
    <div className="grid">
      <div className="kpi-grid">
        <div className="kpi">
          <div className="v" style={{ color: "var(--accent)" }}>نسخه ۱.۴</div>
          <div className="l">تم B «فولاد روشن» — Next.js + PostgreSQL (PGlite/سروری)</div>
        </div>
        <div className="kpi">
          <div className="v">{state.backups.length}</div>
          <div className="l">بک‌آپ موجود</div>
        </div>
        <div className="kpi">
          <div className="v">{state.counts.equipment}</div>
          <div className="l">رکورد تجهیزات</div>
        </div>
        <div className="kpi">
          <div className="v">{state.counts.readings.toLocaleString("en-US")}</div>
          <div className="l">قرائت پارامتر فرآیندی</div>
        </div>
        <div className="kpi">
          <div className="v">{state.counts.services}</div>
          <div className="l">سرویس ثبت‌شده موتور</div>
        </div>
        <div className="kpi">
          <div className="v" style={{ color: "var(--amber)" }}>{state.alerts.filter((a) => !a.actedAt).length}</div>
          <div className="l">هشدار در انتظار اقدام</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}>
        <ShiftPanel />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}>
        <TwoFactorPanel />
        <MirrorPanel />
      </div>

      <Panel title="ست‌پوینت‌ها" icon="gauge" hint="همهٔ ست‌پوینت‌های موتور/سرویس و پارامترهای فرآیندی، یک‌جا">
        <div className="note">آستانه‌های هشدار موتورها و پارامترهای فرآیندی در یک صفحهٔ جدا باز می‌شود؛ ذخیره، اعمال فوری روی داشبورد و هشدارها دارد.</div>
        <button type="button" className="btn primary" onClick={() => openModal("تنظیمات ست‌پوینت", <SetpointsPanel />, { wide: true, sub: "آستانه‌های هشدار" })}><Icon name="gauge" size={14} /> باز کردن تنظیمات ست‌پوینت</button>
      </Panel>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}>
        <ChannelsPanel />
        <PmTemplatesPanel />
      </div>

      <Panel
        title="بک‌آپ کامل و بازیابی"
        icon="database"
        hint="اسنپ‌شات همهٔ جدول‌ها؛ پیش از هر بازیابی نسخه ایمنی ساخته می‌شود"
        actions={
          <>
            <button type="button" className="btn primary" disabled={busy} onClick={() => act("backup.create")}>
              <Icon name="download" size={13} /> بک‌آپ هم‌اکنون
            </button>
          </>
        }
      >
        {state.backups.length === 0 ? (
          <div className="empty">هنوز بک‌آپی ساخته نشده است. اولین بک‌آپ را بسازید.</div>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 300 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>عنوان</th>
                  <th>زمان</th>
                  <th>حجم</th>
                  <th>اقدام</th>
                </tr>
              </thead>
              <tbody>
                {state.backups.map((b) => (
                  <tr key={b.id}>
                    <td className="mono">{b.id}</td>
                    <td className="tiny">{b.label}</td>
                    <td className="mono tiny">{b.createdAt}</td>
                    <td className="mono tiny">{(b.sizeBytes / 1024).toFixed(1)} KB</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <a className="btn tiny" href={`/api/backups/${b.id}`} target="_blank" rel="noreferrer">
                          دانلود
                        </a>
                        <button
                          type="button"
                          className="btn tiny danger"
                          disabled={busy}
                          onClick={() =>
                            openModal(
                              `بازیابی بک‌آپ ${b.id}`,
                              <RestoreConfirm id={b.id} label={b.label} createdAt={b.createdAt} />,
                            )
                          }
                        >
                          بازیابی
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="note warn-note" style={{ marginTop: 10 }}>
          پیش از هر بازیابی، از وضعیت فعلی یک نسخه ایمنی خودکار ساخته می‌شود؛ بنابراین بازیابی، دادهٔ فعلی را نابود نمی‌کند.
        </div>
      </Panel>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)" }}>
        <Panel title="سابقهٔ تغییر مقادیر" icon="shield" hint="هر بازنویسی مقدار، نسخهٔ قبلی را در سابقه نگه می‌دارد">
        <div className="table-wrap" style={{ maxHeight: 260 }}>
          <table className="data">
            <thead>
              <tr>
                <th>زمان</th>
                <th>شیفت</th>
                <th>نوع</th>
                <th>تگ / پارامتر</th>
                <th>مقدار قبلی</th>
                <th>مقدار جدید</th>
              </tr>
            </thead>
            <tbody>
              {state.audits.map((a) => (
                <tr key={a.id}>
                  <td className="mono tiny">{a.at}</td>
                  <td className="tiny">{a.shiftKey}</td>
                  <td className="tiny">{a.scope === "process" ? "فرآیندی" : a.scope === "motor" ? "موتور" : "توتال"}</td>
                  <td className="mono tiny">
                    {a.tag}
                    {a.param && a.param !== a.tag ? ` / ${a.param}` : ""}
                  </td>
                  <td className="mono tiny" style={{ color: "var(--amber)" }}>{a.oldValue}</td>
                  <td className="mono tiny" style={{ color: "var(--green)" }}>{a.newValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.audits.length === 0 && <div className="empty">هنوز مقداری بازنویسی نشده است.</div>}
        </div>
      </Panel>

      <Panel title="لاگ فعالیت‌ها" icon="clock" hint="چه شیفتی، چه زمانی، چه کاری">
          <div className="table-wrap" style={{ maxHeight: 380 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>زمان</th>
                  <th>شیفت</th>
                  <th>عملیات</th>
                  <th>جزئیات</th>
                </tr>
              </thead>
              <tbody>
                {state.activity.map((a) => (
                  <tr key={a.id}>
                    <td className="mono tiny">{a.at}</td>
                    <td className="tiny">{a.shiftKey}</td>
                    <td>{a.action}</td>
                    <td className="tiny muted">{a.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="امنیت و پایداری داده" icon="shield" hint="وضعیت فعلی + پیشنهاد">
          <ul className="small" style={{ lineHeight: 2.1, paddingInlineStart: 18, color: "#cfe0f3" }}>
            <li>PIN شیفت‌ها با scrypt هش می‌شود؛ مقدار خام در دیتابیس نیست.</li>
            <li>کوکی نشست HttpOnly و امضاشده است؛ دسترسی ادمین در سرور بررسی می‌شود.</li>
            <li>هر بازیابی، ابتدا نسخهٔ ایمنی می‌سازد؛ عملیات مخرب تأیید دو مرحله‌ای دارد.</li>
            <li>همهٔ تغییرات در لاگ فعالیت با زمان و شیفت ثبت می‌شوند.</li>
            <li>بک‌آپ JSON کامل (همهٔ جدول‌ها) دانلود و بازیابی می‌شود.</li>
            <li>پیشنهاد برای نسخه نهایی: رمزنگاری AES-256 فایل بک‌آپ، بک‌آپ روزانهٔ خودکار ۳۰ نسخه‌ای و ارسال به کانال بله جداگانه.</li>
            <li>پیشنهاد: محدودیت تلاش ورود و قفل موقت پس از ۵ بار PIN اشتباه.</li>
          </ul>
        </Panel>
      </div>

      <Panel
        title="مدیریت رکوردهای تجهیزات"
        icon="database"
        hint="داده‌محور؛ بدون تغییر کد"
        actions={
          <button type="button" className="btn" onClick={() => openModal("افزودن رکورد تجهیز", <EquipmentForm />)}>
            <Icon name="plus" size={13} /> افزودن تجهیز
          </button>
        }
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="chip muted">{state.equipment.length} رکورد ثبت‌شده در رجیستری</span>
          <span className="chip muted">{state.equipment.filter((e) => e.isAux).length} تجهیز جانبی</span>
          <button
            type="button"
            className="btn tiny ghost"
            onClick={async () => {
              await refresh();
              toast("فهرست به‌روزرسانی شد");
            }}
          >
            به‌روزرسانی فهرست
          </button>
        </div>
      </Panel>
    </div>
  );
}

function SetpointsPanel() {
  const { state, act, busy } = useApp();
  const [form, setForm] = useState({
    serviceInterval: String(state.settings.serviceInterval),
    vibWarn: String(state.settings.vibWarn),
    vibCrit: String(state.settings.vibCrit),
    windingWarn: String(state.settings.windingWarn),
    windingCrit: String(state.settings.windingCrit),
    bearingWarn: String(state.settings.bearingWarn),
    bearingCrit: String(state.settings.bearingCrit),
    currentWarn: String(state.settings.currentWarn),
    currentCrit: String(state.settings.currentCrit),
  });

  return (
    <Panel title="ست‌پوینت‌ها" icon="gauge" hint="اعمال فوری روی داشبورد و هشدارها">
      <div className="panel-title" style={{ fontSize: 14, marginBottom: 8 }}>موتورها و بازهٔ سرویس</div>
      <div className="form-grid">
        {[
          ["serviceInterval", "بازه سرویس (ساعت)"],
          ["vibWarn", "لرزش هشدار (mm/s)"],
          ["vibCrit", "لرزش بحرانی (mm/s)"],
          ["windingWarn", "دمای سیم‌پیچ هشدار (°C)"],
          ["windingCrit", "دمای سیم‌پیچ بحرانی (°C)"],
          ["bearingWarn", "یاتاقان هشدار (°C)"],
          ["bearingCrit", "یاتاقان بحرانی (°C)"],
          ["currentWarn", "جریان هشدار (A)"],
          ["currentCrit", "جریان بحرانی (A)"],
        ].map(([key, label]) => (
          <div className="field" key={key}>
            <label>{label}</label>
            <input
              className="input mono"
              type="number"
              step="any"
              value={form[key as keyof typeof form]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </div>
        ))}
      </div>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
        <button type="button" className="btn primary" disabled={busy} onClick={() => act("admin.settings", { settings: form })}>
          ذخیره ست‌پوینت‌ها
        </button>
      </div>
      <div className="note" style={{ marginTop: 10, fontSize: 10.5 }}>
        تغییر بازه سرویس بلافاصله رنگ‌بندی ۰–۵۰٪ سبز، ۵۰–۹۰٪ زرد و ۹۰–۱۰۰٪ قرمز کارت موتورها را تغییر می‌دهد.
      </div>
      <div className="panel-title" style={{ fontSize: 14, margin: "16px 0 8px" }}>پارامترهای فرآیندی</div>
      <div className="note" style={{ marginBottom: 8 }}>خارج از این محدوده‌ها فقط هشدار بصری است؛ ثبت بلاک نمی‌شود.</div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>تگ</th>
              <th>پارامتر</th>
              <th>هشدار حداقل</th>
              <th>هشدار حداکثر</th>
              <th>بحرانی حداقل</th>
              <th>بحرانی حداکثر</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {state.process.map((p) => (
              <SetpointRow key={p.tag} p={p} busy={busy} onSave={(values) => act("admin.setpoints", { tag: p.tag, ...values })} />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ShiftPanel() {
  const { state, act, busy } = useApp();
  const [pins, setPins] = useState<Record<string, string>>({});
  const [members, setMembers] = useState<Record<string, string>>(
    Object.fromEntries(state.roster.map((r) => [r.key, r.members.join(" و ")])),
  );
  const [override, setOverride] = useState(state.settings.shiftOverride || "auto");

  return (
    <Panel title="افراد، PIN و چرخش شیفت" icon="users" hint="روستر اپراتورها و شیفت فعال">
      <div className="services-list">
        {state.roster.map((r) => (
          <div key={r.key} className="service-item" style={{ alignItems: "center" }}>
            <div style={{ flex: "1 1 160px" }}>
              <b>{r.label}</b>
              <div className="tiny muted">{r.role === "admin" ? "دسترسی مدیریت" : "اپراتور شیفت"}</div>
            </div>
            <input
              className="input"
              style={{ flex: "1 1 200px", fontSize: 11 }}
              value={members[r.key] ?? ""}
              onChange={(e) => setMembers({ ...members, [r.key]: e.target.value })}
              placeholder="نام‌ها"
            />
            <input
              className="input mono"
              style={{ width: 90, fontSize: 11 }}
              placeholder="PIN جدید"
              maxLength={4}
              value={pins[r.key] ?? ""}
              onChange={(e) => setPins({ ...pins, [r.key]: e.target.value.replace(/\D/g, "").slice(0, 4) })}
            />
            <div className="row" style={{ gap: 4 }}>
              <button
                type="button"
                className="btn tiny"
                disabled={busy || !members[r.key]}
                onClick={() => act("admin.members", { key: r.key, members: members[r.key].split(/\s+و\s+|،|,/).filter(Boolean) })}
              >
                نام‌ها
              </button>
              <button type="button" className="btn tiny warn" disabled={busy || (pins[r.key] ?? "").length !== 4} onClick={() => act("admin.pin", { key: r.key, pin: pins[r.key] })}>
                PIN
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label>شیفت فعال</label>
        <div className="row">
          <select className="input" value={override} onChange={(e) => setOverride(e.target.value)}>
            <option value="auto">چرخش خودکار (تغییر ساعت ۷ صبح)</option>
            <option value="A">تثبیت روی شیفت A</option>
            <option value="B">تثبیت روی شیفت B</option>
            <option value="C">تثبیت روی شیفت C</option>
          </select>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => act("admin.shift", { key: override === "auto" ? "" : override })}
          >
            اعمال شیفت
          </button>
        </div>
      </div>
      <div className="note" style={{ fontSize: 10.5 }}>
        شیفت جاری: <b>{state.shift.label}</b> — {state.shift.members.join(" و ") || "بدون عضو"} ({state.shift.auto ? "چرخش خودکار" : "تثبیت‌شده"})
      </div>
    </Panel>
  );
}

function SetpointRow({
  p,
  busy,
  onSave,
}: {
  p: { tag: string; label: string; warnMin: number | null; warnMax: number | null; critMin: number | null; critMax: number | null };
  busy: boolean;
  onSave: (values: Record<string, string>) => Promise<boolean | number>;
}) {
  const [values, setValues] = useState({
    warnMin: p.warnMin === null ? "" : String(p.warnMin),
    warnMax: p.warnMax === null ? "" : String(p.warnMax),
    critMin: p.critMin === null ? "" : String(p.critMin),
    critMax: p.critMax === null ? "" : String(p.critMax),
  });
  return (
    <tr>
      <td className="mono">{p.tag}</td>
      <td className="tiny">{p.label}</td>
      {(["warnMin", "warnMax", "critMin", "critMax"] as const).map((k) => (
        <td key={k}>
          <input
            className="inline-input"
            style={{ width: 76, fontSize: 11 }}
            type="number"
            step="any"
            value={values[k]}
            onChange={(e) => setValues({ ...values, [k]: e.target.value })}
          />
        </td>
      ))}
      <td>
        <button type="button" className="btn tiny" disabled={busy} onClick={() => onSave(values)}>
          ذخیره
        </button>
      </td>
    </tr>
  );
}

function RestoreConfirm({ id, label, createdAt }: { id: number; label: string; createdAt: string }) {
  const { act, busy, closeModal } = useApp();
  return (
    <div>
      <div className="note warn-note" style={{ marginBottom: 12 }}>
        آیا از بازیابی این بک‌آپ مطمئن هستید؟ همهٔ داده‌های فعلی با این نسخه جایگزین می‌شود.
        <br />
        <b>{label}</b> — {createdAt}
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn ghost" onClick={closeModal}>
          انصراف
        </button>
        <button
          type="button"
          className="btn danger"
          disabled={busy}
          onClick={async () => {
            const ok = await act("backup.restore", { id });
            if (ok) {
              closeModal();
              window.location.replace("/");
            }
          }}
        >
          بله، بازیابی کن
        </button>
      </div>
    </div>
  );
}


function ChannelsPanel() {
  const { state, act, busy } = useApp();
  const [forms, setForms] = useState<Record<string, { provider: string; chatId: string; token: string; enabled: boolean }>>(
    Object.fromEntries(state.channels.map((c) => [c.key, { provider: c.provider, chatId: c.chatId, token: "", enabled: c.enabled }])),
  );
  const pending = state.queue.filter((q) => q.status === "pending").length;
  return (
    <Panel title="کانال‌های ارسال (بله / ایتا)" icon="bolt" hint="گزارش روزانه و بک‌آپ در دو کانال جدا"
      actions={<button type="button" className="btn tiny" disabled={busy || !pending} onClick={() => act("queue.retry")}>تلاش مجدد صف ({pending})</button>}>
      {state.channels.map((c) => {
        const f = forms[c.key] ?? { provider: "bale", chatId: "", token: "", enabled: false };
        return (
          <div key={c.key} className="service-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, marginBottom: 8 }}>
            <div className="spread"><b>{c.key === "daily" ? "کانال گزارش روزانه" : "کانال بک‌آپ"}</b><span className={`chip ${c.enabled && c.hasToken ? "live" : "muted"}`}>{c.enabled && c.hasToken ? "فعال" : "تنظیم نشده"}</span></div>
            <div className="form-grid">
              <div className="field"><label>پیام‌رسان</label><select className="input" value={f.provider} onChange={(e) => setForms({ ...forms, [c.key]: { ...f, provider: e.target.value } })}><option value="bale">بله</option><option value="eitaa">ایتا</option></select></div>
              <div className="field"><label>شناسه کانال / chat_id</label><input className="input mono" dir="ltr" value={f.chatId} onChange={(e) => setForms({ ...forms, [c.key]: { ...f, chatId: e.target.value } })} /></div>
              <div className="field"><label>توکن ربات {c.hasToken ? "(ذخیره شده — برای تغییر وارد کنید)" : ""}</label><input className="input mono" dir="ltr" type="password" value={f.token} onChange={(e) => setForms({ ...forms, [c.key]: { ...f, token: e.target.value } })} /></div>
            </div>
            <div className="spread">
              <label className="row small" style={{ gap: 5 }}><input type="checkbox" checked={f.enabled} onChange={(e) => setForms({ ...forms, [c.key]: { ...f, enabled: e.target.checked } })} /> فعال</label>
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn tiny" disabled={busy || !c.enabled || !c.hasToken} title="ارسال یک پیام تستی به همین کانال" onClick={() => { if (window.confirm("یک پیام تستی به این کانال ارسال شود؟")) void act("channel.test", { key: c.key }); }}>تست اتصال</button>
                <button type="button" className="btn tiny primary" disabled={busy} onClick={() => act("admin.channel", { key: c.key, ...f })}>ذخیره کانال</button>
              </div>
            </div>
          </div>
        );
      })}
      <div className="note" style={{ fontSize: 12.5 }}>توکن هرگز به مرورگر برگردانده نمی‌شود. تا زمان دریافت توکن از کارفرما، گزارش‌های «ارسال» در صف می‌مانند و با «تلاش مجدد» ارسال می‌شوند.</div>
    </Panel>
  );
}

function PmTemplatesPanel() {
  const { state, act, busy } = useApp();
  const [editing, setEditing] = useState<{ id?: number; category: string; name: string; items: string } | null>(null);
  return (
    <Panel title="قالب چک‌لیست PM هر دسته" icon="file" hint="فرم کامل PM پس از دریافت از کارفرما این‌جا وارد می‌شود"
      actions={<button type="button" className="btn tiny" onClick={() => setEditing({ category: state.pmTemplates[0]?.category ?? "", name: "", items: "" })}><Icon name="plus" size={12} /> قالب جدید</button>}>
      {editing && (
        <div className="service-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, marginBottom: 10 }}>
          <div className="form-grid">
            <div className="field"><label>دسته</label><select className="input" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>{Array.from(new Set(state.equipment.map((x) => x.category))).map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            <div className="field"><label>نام قالب</label><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
          </div>
          <div className="field"><label>آیتم‌ها (هر خط یک آیتم)</label><textarea value={editing.items} onChange={(e) => setEditing({ ...editing, items: e.target.value })} /></div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost tiny" onClick={() => setEditing(null)}>انصراف</button>
            <button type="button" className="btn tiny primary" disabled={busy} onClick={async () => { if (await act("pm.template", { id: editing.id, category: editing.category, name: editing.name, items: editing.items.split("\n").map((x) => x.trim()).filter(Boolean) })) setEditing(null); }}>ذخیره قالب</button>
          </div>
        </div>
      )}
      <div className="table-wrap" style={{ maxHeight: 320 }}>
        <table className="data"><thead><tr><th>دسته</th><th>قالب</th><th>آیتم‌ها</th><th></th></tr></thead>
          <tbody>{state.pmTemplates.map((t) => <tr key={t.id}><td className="small">{t.category}</td><td>{t.name}</td><td className="small muted">{t.items.length} آیتم</td><td><button type="button" className="btn tiny" onClick={() => setEditing({ id: t.id, category: t.category, name: t.name, items: t.items.join("\n") })}>ویرایش</button></td></tr>)}</tbody></table>
      </div>
    </Panel>
  );
}


/* ============================================================================
 * کارت امنیت و پایداری — سلامت سامانه، دستگاه‌های فعال، بایگانی، بازیابی
 * ========================================================================== */
type HealthFull = {
  ok: boolean;
  version: string;
  uptimeSec: number;
  db: { ok: boolean; latencyMs: number };
  warnings?: string[];
  detail?: {
    dbSizeMB?: number | null;
    diskFreeMB?: number | null;
    backups?: { count: number; lastAt: string | null; ageHours: number | null } | null;
    sessions?: { active: number } | null;
    queue?: { pending: number } | null;
    errors24h?: number;
    events24h?: number;
    rows?: { motor: number; process: number; totals: number; archiveMotor: number; archiveProcess: number } | null;
    migrations?: { name: string; applied_at: string }[];
  };
};

type SessionRow = {
  id: string;
  shiftKey: string;
  role: string;
  ip: string;
  agent: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  current: boolean;
};

type BackupFile = { file: string; bytes: number; modifiedAt: string; sha256: string | null };

function SecurityPanel() {
  const { act, busy, toast, refresh } = useApp();
  const [health, setHealth] = useState<HealthFull | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [chain, setChain] = useState<{ ok: boolean; checked: number; brokenAtId: number | null } | null>(null);
  const [stats, setStats] = useState<{ main: { motor: number; process: number }; archive: { motor: number; process: number }; runs: { id: number; at: string; cutoffDay: string; motorRows: number; processRows: number }[] } | null>(null);
  const [loading, setLoading] = useState(true);

  const call = async (action: string, payload: Record<string, unknown> = {}) => {
    const res = await fetch("/api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
      signal: AbortSignal.timeout(60000),
    });
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  };

  const load = async () => {
    setLoading(true);
    try {
      const [h, s, f, c, d] = await Promise.all([
        fetch("/api/health?full=1", { cache: "no-store", signal: AbortSignal.timeout(30000) }).then((r) => r.json() as Promise<HealthFull>),
        call("session.list", { shifts: true }),
        call("backup.files"),
        call("audit.verify", { limit: 5000 }),
        call("data.stats"),
      ]);
      setHealth(h);
      setSessions((s.sessions as SessionRow[]) ?? []);
      setFiles((f.files as BackupFile[]) ?? []);
      setChain(c as { ok: boolean; checked: number; brokenAtId: number | null });
      setStats((d.archive as typeof stats) ?? null);
    } catch {
      toast("دریافت اطلاعات سلامت ناموفق بود", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // فقط یک‌بار در ورود به تب ادمین
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ago = (ts: number) => {
    const min = Math.round((Date.now() - ts) / 60000);
    if (min < 60) return `${min} دقیقه پیش`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} ساعت پیش`;
    return `${Math.round(h / 24)} روز پیش`;
  };

  return (
    <Panel
      title="امنیت، سلامت و نگه‌داری"
      icon="shield"
      hint="بازبینی وضعیت سرور، دستگاه‌های واردشده، صحت دفتر فعالیت و بایگانی"
      actions={
        <button type="button" className="btn tiny" onClick={() => void load()} disabled={loading}>
          <Icon name="refresh" size={12} /> {loading ? "در حال خواندن…" : "به‌روزرسانی"}
        </button>
      }
    >
      <div className="kpi-grid">
        <div className="kpi">
          <div className="v" style={{ color: health?.ok ? "var(--green)" : "var(--red)" }}>{health?.ok ? "سالم" : "مشکل"}</div>
          <div className="l">وضعیت پایهٔ سامانه — نسخه {health?.version ?? "…"}</div>
        </div>
        <div className="kpi">
          <div className="v">{health?.db?.latencyMs ?? "—"}<span className="tiny muted">ms</span></div>
          <div className="l">زمان پاسخ دیتابیس</div>
        </div>
        <div className="kpi">
          <div className="v">{health?.detail?.dbSizeMB ?? "—"}<span className="tiny muted">MB</span></div>
          <div className="l">حجم دیتابیس</div>
        </div>
        <div className="kpi">
          <div className="v">{health?.detail?.diskFreeMB ?? "—"}<span className="tiny muted">MB</span></div>
          <div className="l">فضای آزاد دیسک</div>
        </div>
        <div className="kpi">
          <div className="v">{health?.detail?.backups?.count ?? 0}</div>
          <div className="l">
            بک‌آپ فایلی{health?.detail?.backups?.ageHours != null ? ` — آخرین ${health.detail.backups.ageHours} ساعت پیش` : ""}
          </div>
        </div>
        <div className="kpi">
          <div className="v">{health?.detail?.sessions?.active ?? 0}</div>
          <div className="l">دستگاه فعال</div>
        </div>
        <div className="kpi">
          <div className="v" style={{ color: (health?.detail?.errors24h ?? 0) > 0 ? "var(--amber)" : undefined }}>{health?.detail?.errors24h ?? 0}</div>
          <div className="l">خطای ثبت‌شده ۲۴ ساعت</div>
        </div>
        <div className="kpi">
          <div className="v" style={{ color: chain?.ok === false ? "var(--red)" : "var(--green)" }}>{chain?.ok === false ? "شکسته" : "سالم"}</div>
          <div className="l">زنجیرهٔ دفتر فعالیت ({chain?.checked ?? 0} ردیف)</div>
        </div>
      </div>

      {!!health?.warnings?.length && (
        <div className="note warn-note" style={{ marginTop: 10 }}>
          {health.warnings.map((w) => (
            <div key={w}>• {w}</div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <button type="button" className="btn tiny primary" disabled={busy} onClick={() => void act("backup.create")}>
          <Icon name="save" size={12} /> بک‌آپ کامل فوری
        </button>
        <button type="button" className="btn tiny" disabled={busy} onClick={async () => { await act("data.optimize"); void load(); }}>
          <Icon name="settings" size={12} /> بهینه‌سازی دیتابیس
        </button>
        <button type="button" className="btn tiny" disabled={busy} onClick={async () => { await act("data.archive", { years: 3 }); void load(); await refresh(); }}>
          <Icon name="archive" size={12} /> بایگانی قدیمی‌تر از ۳ سال
        </button>
        <button type="button" className="btn tiny" disabled={busy} onClick={async () => { await act("session.revoke_others", {}); void load(); }}>
          <Icon name="logout" size={12} /> خروج از سایر دستگاه‌ها
        </button>
        <button type="button" className="btn tiny" disabled={busy} onClick={() => void act("audit.verify", { limit: 20000 }).then(load)}>
          <Icon name="check" size={12} /> بازبینی کامل دفتر فعالیت
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", marginTop: 12 }}>
        <div>
          <h4 style={{ margin: "0 0 6px" }}>دستگاه‌های واردشده</h4>
          <div className="table-wrap" style={{ maxHeight: 240 }}>
            <table className="data">
              <thead>
                <tr><th>شیفت</th><th>نشانی</th><th>آخرین فعالیت</th><th></th></tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="mono">{s.shiftKey}{s.current ? " (این دستگاه)" : ""}</td>
                    <td className="tiny muted" title={s.agent}>{s.ip || "—"}</td>
                    <td className="tiny">{ago(s.lastSeenAt)}</td>
                    <td>
                      <button type="button" className="btn tiny ghost" disabled={busy} onClick={async () => { await act("session.revoke", { id: s.id }); void load(); }}>
                        بستن
                      </button>
                    </td>
                  </tr>
                ))}
                {!sessions.length && <tr><td colSpan={4} className="tiny muted">نشست فعالی ثبت نشده است.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h4 style={{ margin: "0 0 6px" }}>بک‌آپ‌های روی دیسک</h4>
          <div className="table-wrap" style={{ maxHeight: 240 }}>
            <table className="data">
              <thead>
                <tr><th>فایل</th><th>حجم</th><th>چک‌سام</th><th></th></tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.file}>
                    <td className="tiny mono">{f.file.replace("pumpstation-", "")}</td>
                    <td className="tiny">{(f.bytes / 1024).toFixed(0)} KB</td>
                    <td className="tiny" style={{ color: f.sha256 ? "var(--green)" : "var(--amber)" }}>{f.sha256 ? "دارد" : "ندارد"}</td>
                    <td>
                      <button
                        type="button"
                        className="btn tiny ghost"
                        disabled={busy}
                        title="آزمون بازیابی این فایل (بدون اعمال تغییر)"
                        onClick={async () => {
                          const r = await call("backup.verify", { file: f.file });
                          toast(r.ok ? "فایل سالم و قابل بازیابی است" : "فایل مشکل دارد", r.ok ? "ok" : "error");
                        }}
                      >
                        آزمون
                      </button>
                      <button
                        type="button"
                        className="btn tiny ghost"
                        disabled={busy}
                        title="بازیابی کامل از این فایل"
                        onClick={async () => {
                          if (!confirm(`داده‌های فعلی با محتوای «${f.file}» جایگزین شود؟ یک نسخهٔ ایمنی خودکار گرفته می‌شود.`)) return;
                          await act("backup.restore_file", { file: f.file });
                          void load();
                          await refresh();
                        }}
                      >
                        بازیابی
                      </button>
                    </td>
                  </tr>
                ))}
                {!files.length && <tr><td colSpan={4} className="tiny muted">فایلی موجود نیست.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <h4 style={{ margin: "12px 0 6px" }}>بایگانی داده‌ها</h4>
      <div className="note" style={{ fontSize: 11 }}>
        جاری: {stats?.main.motor.toLocaleString("en-US") ?? 0} قرائت موتور و {stats?.main.process.toLocaleString("en-US") ?? 0} قرائت فرایندی — بایگانی‌شده: {stats?.archive.motor.toLocaleString("en-US") ?? 0} و {stats?.archive.process.toLocaleString("en-US") ?? 0}.
        {!!stats?.runs.length && <span> آخرین بایگانی {stats.runs[stats.runs.length - 1].at} تا {stats.runs[stats.runs.length - 1].cutoffDay}.</span>}
      </div>
    </Panel>
  );
}
