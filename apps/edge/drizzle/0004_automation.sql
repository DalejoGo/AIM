CREATE TABLE "automation_events" (
	"run_id" uuid NOT NULL,
	"step" text NOT NULL,
	"data" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_events_run_id_step_pk" PRIMARY KEY("run_id","step")
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_run_id_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."automation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_runs_created_at_idx" ON "automation_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "automation_usage_at_idx" ON "automation_usage" USING btree ("at");--> statement-breakpoint
CREATE INDEX "automation_usage_ip_hash_at_idx" ON "automation_usage" USING btree ("ip_hash","at");