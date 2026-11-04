import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";

/** کاربران/شیفت‌ها: هر شیفت یک PIN چهاررقمی مشترک (هش‌شده) */
export const shifts = pgTable("shifts", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  role: text("role").notNull().default("operator"),
  pin: text("pin").notNull(),
  members: jsonb("members").$type<string[]>().notNull().default([]),
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
});

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
});

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
});

export const activity = pgTable("activity", {
  id: serial("id").primaryKey(),
  at: text("at").notNull(),
  shiftKey: text("shift_key").notNull(),
  action: text("action").notNull(),
  detail: text("detail").default("").notNull(),
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
