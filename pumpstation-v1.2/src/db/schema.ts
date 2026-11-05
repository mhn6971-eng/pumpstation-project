import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  boolean,
  jsonb,
  bigint,
  index,
  uniqueIndex,
  pgView,
} from "drizzle-orm/pg-core";

/** کاربران/شیفت‌ها: هر شیفت یک PIN چهاررقمی مشترک (هش‌شده) */
export const shifts = pgTable("shifts", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  role: text("role").notNull().default("operator"),
  pin: text("pin").notNull(),
  members: jsonb("members").$type<string[]>().notNull().default([]),
  /** راز فعال ورود دوعاملی (Base32) — خالی یعنی فعال نیست */
  totpSecret: text("totp_secret").notNull().default(""),
  /** راز در حال ثبت (پس از اسکن، پیش از تأیید اولین کد) */
  totpPending: text("totp_pending").notNull().default(""),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  /** کدهای پشتیبان یک‌بارمصرف (هش‌شده) */
  totpBackupCodes: jsonb("totp_backup_codes").$type<string[]>().notNull().default([]),
  totpEnabledAt: text("totp_enabled_at").notNull().default(""),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
});

/** رجیستری تجهیزات؛ موتورهای اصلی هم رکورد اینجا دارند (isMotor) */
export const equipment = pgTable("equipment", {
  id: serial("id").primaryKey(),
  tag: text("tag").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  spec: text("spec").default("").notNull(),
  plate: text("plate").default("").notNull(),
  partNumbers: text("part_numbers").default("").notNull(),
  location: text("location").default("").notNull(),
  status: text("status").notNull().default("ready"),
  isAux: boolean("is_aux").notNull().default(false),
  isMotor: boolean("is_motor").notNull().default(false),
  safetyCritical: boolean("safety_critical").notNull().default(false),
  description: text("description").default("").notNull(),
  descriptionAt: text("description_at").default("").notNull(),
  descriptionBy: text("description_by").default("").notNull(),
  deletedAt: text("deleted_at").default("").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const motors = pgTable("motors", {
  tag: text("tag").primaryKey(),
  pumpTag: text("pump_tag").notNull(),
  state: text("state").notNull().default("off"),
  totalHours: doublePrecision("total_hours").notNull().default(0),
  lastServiceHours: doublePrecision("last_service_hours").notNull().default(0),
  stateChangedAt: text("state_changed_at").notNull(),
});

export const processReadings = pgTable("process_readings", {
  id: serial("id").primaryKey(),
  day: text("day").notNull(),
  intervalIndex: integer("interval_index").notNull(),
  tag: text("tag").notNull(),
  value: doublePrecision("value").notNull(),
  shiftKey: text("shift_key").notNull(),
  recordedAt: text("recorded_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  index("process_readings_day_idx").on(t.day),
  uniqueIndex("process_readings_cell_uq").on(t.day, t.intervalIndex, t.tag),
]);

export const dailyTotals = pgTable("daily_totals", {
  id: serial("id").primaryKey(),
  day: text("day").notNull().unique(),
  value: doublePrecision("value").notNull(),
  shiftKey: text("shift_key").notNull(),
  recordedAt: text("recorded_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const motorReadings = pgTable("motor_readings", {
  id: serial("id").primaryKey(),
  tag: text("tag").notNull(),
  day: text("day").notNull(),
  intervalIndex: integer("interval_index").notNull(),
  param: text("param").notNull(),
  value: doublePrecision("value").notNull(),
  shiftKey: text("shift_key").notNull(),
  recordedAt: text("recorded_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  index("motor_readings_day_idx").on(t.day),
  index("motor_readings_tag_day_param_idx").on(t.tag, t.day, t.param),
  uniqueIndex("motor_readings_cell_uq").on(t.tag, t.day, t.intervalIndex, t.param),
]);

export const motorStateLogs = pgTable("motor_state_logs", {
  id: serial("id").primaryKey(),
  tag: text("tag").notNull(),
  fromState: text("from_state").notNull(),
  toState: text("to_state").notNull(),
  at: text("at").notNull(),
  shiftKey: text("shift_key").notNull(),
});

/** سرویس ماهانه موتور اصلی: ۲۴ قرائت ذغال (۸ برس × ۳ فاز) + ساعت HMI */
export const motorServices = pgTable("motor_services", {
  id: serial("id").primaryKey(),
  tag: text("tag").notNull(),
  day: text("day").notNull(),
  hours: doublePrecision("hours").notNull(),
  workers: text("workers").default("").notNull(),
  note: text("note").default("").notNull(),
  brush: jsonb("brush").$type<Record<string, number>>().notNull().default({}),
  at: text("at").notNull(),
  shiftKey: text("shift_key").notNull(),
  shiftLabel: text("shift_label").default("").notNull(),
});

/** تست مگر (مقاومت عایقی) — فقط ۴ آیتم قفل‌شده + ولتاژ تست */
export const meggerTests = pgTable("megger_tests", {
  id: serial("id").primaryKey(),
  tag: text("tag").notNull(),
  day: text("day").notNull(),
  statorU: doublePrecision("stator_u"),
  statorV: doublePrecision("stator_v"),
  statorW: doublePrecision("stator_w"),
  rotorU: doublePrecision("rotor_u"),
  rotorV: doublePrecision("rotor_v"),
  rotorW: doublePrecision("rotor_w"),
  windingTemp: doublePrecision("winding_temp"),
  pi: doublePrecision("pi"),
  testVoltage: integer("test_voltage").notNull().default(1000),
  testVoltageRotor: integer("test_voltage_rotor"),
  piStatorU: doublePrecision("pi_stator_u"),
  piStatorV: doublePrecision("pi_stator_v"),
  piStatorW: doublePrecision("pi_stator_w"),
  piRotor: doublePrecision("pi_rotor"),
  unit: text("unit").notNull().default("MΩ"),
  workers: text("workers").default("").notNull(),
  note: text("note").default("").notNull(),
  at: text("at").notNull(),
  shiftKey: text("shift_key").notNull(),
});

export const oilChanges = pgTable("oil_changes", {
  id: serial("id").primaryKey(),
  tag: text("tag").notNull(),
  day: text("day").notNull(),
  hours: doublePrecision("hours").notNull().default(0),
  note: text("note").default("").notNull(),
  at: text("at").notNull(),
  shiftKey: text("shift_key").notNull(),
});

/** ثبت گزارش سرویس / تعمیرات دستی برای هر قطعه */
export const equipmentReports = pgTable("equipment_reports", {
  id: serial("id").primaryKey(),
  tag: text("tag").notNull(),
  kind: text("kind").notNull().default("service"),
  reason: text("reason").notNull(),
  operator: text("operator").default("").notNull(),
  shiftKey: text("shift_key").notNull(),
  at: text("at").notNull(),
});

/** قالب چک‌لیست PM به ازای هر دسته (قابل ویرایش توسط ادمین) */
export const pmTemplates = pgTable("pm_templates", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  name: text("name").notNull(),
  items: jsonb("items").$type<string[]>().notNull().default([]),
  updatedAt: text("updated_at").notNull(),
});

export const pmRecords = pgTable("pm_records", {
  id: serial("id").primaryKey(),
  tag: text("tag").notNull(),
  templateName: text("template_name").notNull().default(""),
  results: jsonb("results").$type<Record<string, string>>().notNull().default({}),
  workers: text("workers").default("").notNull(),
  note: text("note").default("").notNull(),
  day: text("day").notNull(),
  at: text("at").notNull(),
  shiftKey: text("shift_key").notNull(),
});

/** کاتالوگ/دیتاشیت PDF هر تجهیز (ذخیره به‌صورت base64) */
export const catalogs = pgTable("catalogs", {
  id: serial("id").primaryKey(),
  tag: text("tag").notNull(),
  name: text("name").notNull(),
  mime: text("mime").notNull().default("application/pdf"),
  size: integer("size").notNull().default(0),
  data: text("data").notNull(),
  /** مسیر فایل روی دیسک (نسخه‌های جدید روی فایل‌سیستم ذخیره می‌شوند، نه داخل دیتابیس) */
  path: text("path").notNull().default(""),
  /** هش SHA-256 محتوا برای صحت‌سنجی */
  sha256: text("sha256").notNull().default(""),
  uploadedAt: text("uploaded_at").notNull(),
  uploadedBy: text("uploaded_by").notNull().default(""),
});

export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  at: text("at").notNull(),
  day: text("day").notNull(),
  tag: text("tag").notNull(),
  param: text("param").notNull(),
  label: text("label").notNull(),
  value: doublePrecision("value").notNull(),
  severity: text("severity").notNull(),
  message: text("message").notNull(),
  shiftKey: text("shift_key").notNull(),
  seenAt: text("seen_at").default("").notNull(),
  actedAt: text("acted_at").default("").notNull(),
  seenShift: text("seen_shift").default("").notNull(),
  actedShift: text("acted_shift").default("").notNull(),
  /** زمان برطرف‌شدن خودکار (وقتی مقدار به محدودهٔ مجاز برگشت) — هشدار از داشبورد کنار می‌رود */
  resolvedAt: text("resolved_at").default("").notNull(),
});

export const activity = pgTable("activity", {
  id: serial("id").primaryKey(),
  at: text("at").notNull(),
  shiftKey: text("shift_key").notNull(),
  action: text("action").notNull(),
  detail: text("detail").default("").notNull(),
  /** زنجیرهٔ هش برای تشخیص دست‌کاری دفتر فعالیت (نسخه ۱.۳) */
  prevHash: text("prev_hash").default("").notNull(),
  hash: text("hash").default("").notNull(),
});

export const problems = pgTable("problems", {
  id: serial("id").primaryKey(),
  at: text("at").notNull(),
  shiftKey: text("shift_key").notNull(),
  text: text("text").notNull(),
  internal: boolean("internal").notNull().default(false),
});

export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  day: text("day").notNull(),
  shiftKey: text("shift_key").notNull(),
  operators: text("operators").default("").notNull(),
  createdAt: text("created_at").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
});

/** کانال‌های ارسال (بله/ایتا) */
export const channels = pgTable("channels", {
  key: text("key").primaryKey(),
  provider: text("provider").notNull().default("bale"),
  chatId: text("chat_id").notNull().default(""),
  token: text("token").notNull().default(""),
  enabled: boolean("enabled").notNull().default(false),
});

/** صف ارسال آفلاین: هیچ گزارشی گم نمی‌شود */
export const sendQueue = pgTable("send_queue", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").notNull(),
  channelKey: text("channel_key").notNull().default("daily"),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error").notNull().default(""),
  createdAt: text("created_at").notNull(),
  sentAt: text("sent_at").notNull().default(""),
  shiftKey: text("shift_key").notNull().default(""),
});

/** بک‌آپ کامل JSON از همه جدول‌ها */
export const backups = pgTable("backups", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  createdAt: text("created_at").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
});

/** سابقهٔ تغییر مقادیر: مقدار قبلی هرگز بی‌سابقه نمی‌ماند */
export const valueAudits = pgTable("value_audits", {
  id: serial("id").primaryKey(),
  at: text("at").notNull(),
  shiftKey: text("shift_key").notNull(),
  scope: text("scope").notNull(),
  tag: text("tag").notNull(),
  param: text("param").notNull().default(""),
  oldValue: text("old_value").notNull().default(""),
  newValue: text("new_value").notNull().default(""),
});

export const operatorNotes = pgTable("operator_notes", {
  id: serial("id").primaryKey(),
  day: text("day").notNull(),
  shiftKey: text("shift_key").notNull(),
  text: text("text").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

/** رویدادهای امنیتی: هر ورود موفق/ناموفق، قفل شدن، خروج از همهٔ دستگاه‌ها */
export const securityEvents = pgTable("security_events", {
  id: serial("id").primaryKey(),
  ts: bigint("ts", { mode: "number" }).notNull(),
  at: text("at").notNull(),
  kind: text("kind").notNull(),
  shiftKey: text("shift_key").notNull().default(""),
  ip: text("ip").notNull().default(""),
  detail: text("detail").notNull().default(""),
}, (t) => [index("security_events_ts_idx").on(t.ts)]);

/* ============================================================================
 * نسخه ۱.۳ — جداول تاب‌آوری، نشست سروری، ردیابی خطا و بایگانی
 * ========================================================================== */

/** نشست‌های سروری: هر ورود یک ردیف؛ امکان فهرست‌کردن و ابطال تک‌تک دستگاه‌ها */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    shiftKey: text("shift_key").notNull(),
    role: text("role").notNull().default("operator"),
    ip: text("ip").notNull().default(""),
    agent: text("agent").notNull().default(""),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    lastSeenAt: bigint("last_seen_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    revokedAt: bigint("revoked_at", { mode: "number" }).notNull().default(0),
    revokedReason: text("revoked_reason").notNull().default(""),
  },
  (t) => [index("sessions_shift_idx").on(t.shiftKey, t.expiresAt), index("sessions_expires_idx").on(t.expiresAt)],
);

/** قفل ورود ماندگار (با ری‌استارت سرور پاک نمی‌شود) */
export const authLocks = pgTable("auth_locks", {
  scope: text("scope").primaryKey(),
  fails: integer("fails").notNull().default(0),
  firstFailAt: bigint("first_fail_at", { mode: "number" }).notNull().default(0),
  lockedUntil: bigint("locked_until", { mode: "number" }).notNull().default(0),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(0),
});

/** ردیابی خطاها و رخدادهای فنی (قابل مشاهده در تب ادمین) */
export const appEvents = pgTable(
  "app_events",
  {
    id: serial("id").primaryKey(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    level: text("level").notNull().default("error"),
    source: text("source").notNull().default(""),
    message: text("message").notNull().default(""),
    detail: jsonb("detail").$type<unknown>(),
    requestId: text("request_id").notNull().default(""),
    shiftKey: text("shift_key").notNull().default(""),
    path: text("path").notNull().default(""),
    durationMs: integer("duration_ms").notNull().default(0),
  },
  (t) => [index("app_events_ts_idx").on(t.ts), index("app_events_level_idx").on(t.level, t.ts)],
);

/** جلوگیری از ثبت تکراری هنگام دوبار کلیک/تلاش مجدد شبکه */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    shiftKey: text("shift_key").notNull().default(""),
    action: text("action").notNull().default(""),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    response: jsonb("response").$type<unknown>(),
  },
  (t) => [index("idempotency_created_idx").on(t.createdAt)],
);

export const archiveRuns = pgTable("archive_runs", {
  id: serial("id").primaryKey(),
  at: text("at").notNull(),
  shiftKey: text("shift_key").notNull().default(""),
  cutoffDay: text("cutoff_day").notNull().default(""),
  motorRows: integer("motor_rows").notNull().default(0),
  processRows: integer("process_rows").notNull().default(0),
  file: text("file").notNull().default(""),
  sha256: text("sha256").notNull().default(""),
  bytes: integer("bytes").notNull().default(0),
});

export const motorReadingsArchive = pgTable("motor_readings_archive", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  tag: text("tag").notNull(),
  day: text("day").notNull(),
  intervalIndex: integer("interval_index").notNull(),
  param: text("param").notNull(),
  value: doublePrecision("value").notNull(),
  shiftKey: text("shift_key").notNull().default(""),
  recordedAt: text("recorded_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
});

export const processReadingsArchive = pgTable("process_readings_archive", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  day: text("day").notNull(),
  intervalIndex: integer("interval_index").notNull(),
  tag: text("tag").notNull(),
  value: doublePrecision("value").notNull(),
  shiftKey: text("shift_key").notNull().default(""),
  recordedAt: text("recorded_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
});

/** نمای ترکیبی جدول جاری + بایگانی تا گزارش‌های چندساله کامل بمانند */
export const motorReadingsAll = pgView("motor_readings_all", {
  id: bigint("id", { mode: "number" }).notNull(),
  tag: text("tag").notNull(),
  day: text("day").notNull(),
  intervalIndex: integer("interval_index").notNull(),
  param: text("param").notNull(),
  value: doublePrecision("value").notNull(),
  shiftKey: text("shift_key").notNull(),
  recordedAt: text("recorded_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}).existing();

export const processReadingsAll = pgView("process_readings_all", {
  id: bigint("id", { mode: "number" }).notNull(),
  day: text("day").notNull(),
  intervalIndex: integer("interval_index").notNull(),
  tag: text("tag").notNull(),
  value: doublePrecision("value").notNull(),
  shiftKey: text("shift_key").notNull(),
  recordedAt: text("recorded_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}).existing();

/** سابقهٔ کپی بک‌آپ به مسیر بیرونی (آینه) */
export const backupMirrorRuns = pgTable(
  "backup_mirror_runs",
  {
    id: serial("id").primaryKey(),
    at: text("at").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull().default(0),
    file: text("file").notNull().default(""),
    target: text("target").notNull().default(""),
    bytes: integer("bytes").notNull().default(0),
    ok: boolean("ok").notNull().default(false),
    error: text("error").notNull().default(""),
  },
  (t) => [index("backup_mirror_at_idx").on(t.ts)],
);
