ALTER TABLE "backup_mirror_runs" ADD COLUMN IF NOT EXISTS "ts" bigint NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS "backup_mirror_at_idx";
CREATE INDEX IF NOT EXISTS "backup_mirror_at_idx" ON "backup_mirror_runs" ("ts");
