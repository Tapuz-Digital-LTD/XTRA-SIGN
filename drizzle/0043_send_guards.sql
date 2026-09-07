-- Idempotent sends (attempt_key) and a per-organisation do-not-contact list. Additive only.
ALTER TABLE "message_sends" ADD COLUMN IF NOT EXISTS "attempt_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_sends_attempt_key_unique" ON "message_sends" ("organization_id","attempt_key") WHERE "attempt_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_sends_lead_channel_idx" ON "message_sends" ("lead_id","channel","event","sent_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel" text DEFAULT 'any' NOT NULL,
	"address" text NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_suppressions_unique" ON "contact_suppressions" ("organization_id","channel","address");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_suppressions" ADD CONSTRAINT "contact_suppressions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
