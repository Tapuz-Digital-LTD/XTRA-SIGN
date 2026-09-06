ALTER TABLE "project_leads" ADD COLUMN IF NOT EXISTS "meta" jsonb;--> statement-breakpoint
ALTER TABLE "project_leads" ADD COLUMN IF NOT EXISTS "agreement_id" uuid;
