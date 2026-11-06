CREATE TABLE "lab_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "lab_hits_ip_hash_at_idx" ON "lab_hits" USING btree ("ip_hash","at");