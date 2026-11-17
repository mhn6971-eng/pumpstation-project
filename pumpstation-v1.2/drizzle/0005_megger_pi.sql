ALTER TABLE "megger_tests" ADD COLUMN IF NOT EXISTS "test_voltage_rotor" integer;
--> statement-breakpoint
ALTER TABLE "megger_tests" ADD COLUMN IF NOT EXISTS "pi_stator_u" double precision;
--> statement-breakpoint
ALTER TABLE "megger_tests" ADD COLUMN IF NOT EXISTS "pi_stator_v" double precision;
--> statement-breakpoint
ALTER TABLE "megger_tests" ADD COLUMN IF NOT EXISTS "pi_stator_w" double precision;
--> statement-breakpoint
ALTER TABLE "megger_tests" ADD COLUMN IF NOT EXISTS "pi_rotor" double precision;
--> statement-breakpoint
ALTER TABLE "megger_tests" ADD COLUMN IF NOT EXISTS "unit" text NOT NULL DEFAULT 'MΩ';
