CREATE TABLE "assistant_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "assistant_usage_at_idx" ON "assistant_usage" USING btree ("at");--> statement-breakpoint
CREATE INDEX "assistant_usage_ip_hash_idx" ON "assistant_usage" USING btree ("ip_hash","at");