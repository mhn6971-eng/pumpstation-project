-- مهاجرت ۰۰۰۱: ایندکس‌ها، یکتایی سلول‌های قرائت، ستون‌های امنیتی و کاتالوگ
ALTER TABLE "catalogs" ADD COLUMN IF NOT EXISTS "path" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "catalogs" ADD COLUMN IF NOT EXISTS "sha256" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN IF NOT EXISTS "resolved_at" text NOT NULL DEFAULT '';
--> statement-breakpoint
DELETE FROM process_readings a USING process_readings b WHERE a.id > b.id AND a.day = b.day AND a.interval_index = b.interval_index AND a.tag = b.tag;
--> statement-breakpoint
DELETE FROM motor_readings a USING motor_readings b WHERE a.id > b.id AND a.tag = b.tag AND a.day = b.day AND a.interval_index = b.interval_index AND a.param = b.param;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "process_readings_cell_uq" ON "process_readings" ("day","interval_index","tag");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "motor_readings_cell_uq" ON "motor_readings" ("tag","day","interval_index","param");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "process_readings_day_idx" ON "process_readings" ("day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "motor_readings_day_idx" ON "motor_readings" ("day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "motor_readings_tag_day_param_idx" ON "motor_readings" ("tag","day","param");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_day_idx" ON "alerts" ("day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_open_idx" ON "alerts" ("acted_at","resolved_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_at_idx" ON "activity" ("at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_day_idx" ON "reports" ("day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_reports_tag_idx" ON "equipment_reports" ("tag");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "value_audits_at_idx" ON "value_audits" ("at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_notes_day_idx" ON "operator_notes" ("day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "motor_services_tag_idx" ON "motor_services" ("tag");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "send_queue_status_idx" ON "send_queue" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "security_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "ts" bigint NOT NULL,
  "at" text NOT NULL,
  "kind" text NOT NULL,
  "shift_key" text DEFAULT '' NOT NULL,
  "ip" text DEFAULT '' NOT NULL,
  "detail" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_events_ts_idx" ON "security_events" ("ts");
