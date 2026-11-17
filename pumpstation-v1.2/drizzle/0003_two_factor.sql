-- 0003: ورود دوعاملی (TOTP) و آینهٔ بک‌آپ (نسخه ۱.۴)

--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "totp_secret" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "totp_pending" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "totp_enabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "totp_backup_codes" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "totp_enabled_at" text NOT NULL DEFAULT '';

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backup_mirror_runs" (
  "id" serial PRIMARY KEY,
  "at" text NOT NULL,
  "file" text NOT NULL DEFAULT '',
  "target" text NOT NULL DEFAULT '',
  "bytes" integer NOT NULL DEFAULT 0,
  "ok" boolean NOT NULL DEFAULT false,
  "error" text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backup_mirror_at_idx" ON "backup_mirror_runs" ("at");
