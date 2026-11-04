CREATE TABLE "activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" text NOT NULL,
	"shift_key" text NOT NULL,
	"action" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" text NOT NULL,
	"day" text NOT NULL,
	"tag" text NOT NULL,
	"param" text NOT NULL,
	"label" text NOT NULL,
	"value" double precision NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"shift_key" text NOT NULL,
	"seen_at" text DEFAULT '' NOT NULL,
	"acted_at" text DEFAULT '' NOT NULL,
	"seen_shift" text DEFAULT '' NOT NULL,
	"acted_shift" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backups" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"created_at" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag" text NOT NULL,
	"name" text NOT NULL,
	"mime" text DEFAULT 'application/pdf' NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"data" text NOT NULL,
	"uploaded_at" text NOT NULL,
	"uploaded_by" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"key" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'bale' NOT NULL,
	"chat_id" text DEFAULT '' NOT NULL,
	"token" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_totals" (
	"id" serial PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"value" double precision NOT NULL,
	"shift_key" text NOT NULL,
	"recorded_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "daily_totals_day_unique" UNIQUE("day")
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"spec" text DEFAULT '' NOT NULL,
	"plate" text DEFAULT '' NOT NULL,
	"part_numbers" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"is_aux" boolean DEFAULT false NOT NULL,
	"is_motor" boolean DEFAULT false NOT NULL,
	"safety_critical" boolean DEFAULT false NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"description_at" text DEFAULT '' NOT NULL,
	"description_by" text DEFAULT '' NOT NULL,
	"deleted_at" text DEFAULT '' NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "equipment_tag_unique" UNIQUE("tag")
);
--> statement-breakpoint
CREATE TABLE "equipment_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag" text NOT NULL,
	"kind" text DEFAULT 'service' NOT NULL,
	"reason" text NOT NULL,
	"operator" text DEFAULT '' NOT NULL,
	"shift_key" text NOT NULL,
	"at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "megger_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag" text NOT NULL,
	"day" text NOT NULL,
	"stator_u" double precision,
	"stator_v" double precision,
	"stator_w" double precision,
	"rotor_u" double precision,
	"rotor_v" double precision,
	"rotor_w" double precision,
	"winding_temp" double precision,
	"pi" double precision,
	"test_voltage" integer DEFAULT 1000 NOT NULL,
	"workers" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"at" text NOT NULL,
	"shift_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "motor_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag" text NOT NULL,
	"day" text NOT NULL,
	"interval_index" integer NOT NULL,
	"param" text NOT NULL,
	"value" double precision NOT NULL,
	"shift_key" text NOT NULL,
	"recorded_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "motor_services" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag" text NOT NULL,
	"day" text NOT NULL,
	"hours" double precision NOT NULL,
	"workers" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"brush" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" text NOT NULL,
	"shift_key" text NOT NULL,
	"shift_label" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "motor_state_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag" text NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"at" text NOT NULL,
	"shift_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "motors" (
	"tag" text PRIMARY KEY NOT NULL,
	"pump_tag" text NOT NULL,
	"state" text DEFAULT 'off' NOT NULL,
	"total_hours" double precision DEFAULT 0 NOT NULL,
	"last_service_hours" double precision DEFAULT 0 NOT NULL,
	"state_changed_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oil_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag" text NOT NULL,
	"day" text NOT NULL,
	"hours" double precision DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"at" text NOT NULL,
	"shift_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"shift_key" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pm_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag" text NOT NULL,
	"template_name" text DEFAULT '' NOT NULL,
	"results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"workers" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"day" text NOT NULL,
	"at" text NOT NULL,
	"shift_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pm_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "problems" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" text NOT NULL,
	"shift_key" text NOT NULL,
	"text" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_readings" (
	"id" serial PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"interval_index" integer NOT NULL,
	"tag" text NOT NULL,
	"value" double precision NOT NULL,
	"shift_key" text NOT NULL,
	"recorded_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"day" text NOT NULL,
	"shift_key" text NOT NULL,
	"operators" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "send_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" integer NOT NULL,
	"channel_key" text DEFAULT 'daily' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	"sent_at" text DEFAULT '' NOT NULL,
	"shift_key" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"role" text DEFAULT 'operator' NOT NULL,
	"pin" text NOT NULL,
	"members" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "value_audits" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" text NOT NULL,
	"shift_key" text NOT NULL,
	"scope" text NOT NULL,
	"tag" text NOT NULL,
	"param" text DEFAULT '' NOT NULL,
	"old_value" text DEFAULT '' NOT NULL,
	"new_value" text DEFAULT '' NOT NULL
);
