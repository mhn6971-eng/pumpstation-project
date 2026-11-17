-- 0002: تاب‌آوری، بایگانی، نشست سروری، ردیابی خطا (نسخه ۱.۳)
-- همهٔ دستورها idempotent هستند تا اجرای دوباره بی‌خطر باشد.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_events" (
  "id" serial PRIMARY KEY,
  "ts" bigint NOT NULL,
  "level" text NOT NULL DEFAULT 'error',
  "source" text NOT NULL DEFAULT '',
  "message" text NOT NULL DEFAULT '',
  "detail" jsonb,
  "request_id" text NOT NULL DEFAULT '',
  "shift_key" text NOT NULL DEFAULT '',
  "path" text NOT NULL DEFAULT '',
  "duration_ms" integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_events_ts_idx" ON "app_events" ("ts");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_events_level_idx" ON "app_events" ("level", "ts");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" text PRIMARY KEY,
  "token_hash" text NOT NULL,
  "shift_key" text NOT NULL,
  "role" text NOT NULL DEFAULT 'operator',
  "ip" text NOT NULL DEFAULT '',
  "agent" text NOT NULL DEFAULT '',
  "created_at" bigint NOT NULL,
  "last_seen_at" bigint NOT NULL,
  "expires_at" bigint NOT NULL,
  "revoked_at" bigint NOT NULL DEFAULT 0,
  "revoked_reason" text NOT NULL DEFAULT ''
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'operator';
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "revoked_reason" text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_shift_idx" ON "sessions" ("shift_key", "expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_expires_idx" ON "sessions" ("expires_at");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_locks" (
  "scope" text PRIMARY KEY,
  "fails" integer NOT NULL DEFAULT 0,
  "first_fail_at" bigint NOT NULL DEFAULT 0,
  "locked_until" bigint NOT NULL DEFAULT 0,
  "updated_at" bigint NOT NULL DEFAULT 0
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "key" text PRIMARY KEY,
  "shift_key" text NOT NULL DEFAULT '',
  "action" text NOT NULL DEFAULT '',
  "created_at" bigint NOT NULL,
  "response" jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_created_idx" ON "idempotency_keys" ("created_at");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "archive_runs" (
  "id" serial PRIMARY KEY,
  "at" text NOT NULL,
  "shift_key" text NOT NULL DEFAULT '',
  "cutoff_day" text NOT NULL DEFAULT '',
  "motor_rows" integer NOT NULL DEFAULT 0,
  "process_rows" integer NOT NULL DEFAULT 0,
  "file" text NOT NULL DEFAULT '',
  "sha256" text NOT NULL DEFAULT '',
  "bytes" integer NOT NULL DEFAULT 0
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "motor_readings_archive" (
  "id" bigint PRIMARY KEY,
  "tag" text NOT NULL,
  "day" text NOT NULL,
  "interval_index" integer NOT NULL,
  "param" text NOT NULL,
  "value" double precision NOT NULL,
  "shift_key" text NOT NULL DEFAULT '',
  "recorded_at" text NOT NULL DEFAULT '',
  "updated_at" text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mra_tag_day_param_idx" ON "motor_readings_archive" ("tag", "day", "param");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mra_day_idx" ON "motor_readings_archive" ("day");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "process_readings_archive" (
  "id" bigint PRIMARY KEY,
  "day" text NOT NULL,
  "interval_index" integer NOT NULL,
  "tag" text NOT NULL,
  "value" double precision NOT NULL,
  "shift_key" text NOT NULL DEFAULT '',
  "recorded_at" text NOT NULL DEFAULT '',
  "updated_at" text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pra_day_idx" ON "process_readings_archive" ("day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pra_tag_idx" ON "process_readings_archive" ("tag");

--> statement-breakpoint
CREATE OR REPLACE VIEW "motor_readings_all" AS
  SELECT id::bigint AS id, tag, day, interval_index, param, value, shift_key, recorded_at, updated_at FROM "motor_readings"
  UNION ALL
  SELECT id, tag, day, interval_index, param, value, shift_key, recorded_at, updated_at FROM "motor_readings_archive";
--> statement-breakpoint
CREATE OR REPLACE VIEW "process_readings_all" AS
  SELECT id::bigint AS id, day, interval_index, tag, value, shift_key, recorded_at, updated_at FROM "process_readings"
  UNION ALL
  SELECT id, day, interval_index, tag, value, shift_key, recorded_at, updated_at FROM "process_readings_archive";

--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "prev_hash" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "hash" text NOT NULL DEFAULT '';

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_at_idx" ON "activity" ("at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_open_idx" ON "alerts" ("resolved_at", "acted_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alerts_day_idx" ON "alerts" ("day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "problems_at_idx" ON "problems" ("at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "value_audits_at_idx" ON "value_audits" ("at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "send_queue_status_idx" ON "send_queue" ("status", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_deleted_idx" ON "equipment" ("deleted_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "equipment_reports_tag_idx" ON "equipment_reports" ("tag", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pm_records_tag_idx" ON "pm_records" ("tag", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "motor_services_tag_idx" ON "motor_services" ("tag", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "megger_tests_tag_idx" ON "megger_tests" ("tag", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oil_changes_tag_idx" ON "oil_changes" ("tag", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogs_tag_idx" ON "catalogs" ("tag");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_created_idx" ON "reports" ("created_at");
