-- Saved reports: a name over a report definition, personal or shared with the team. Additive only.
CREATE TABLE IF NOT EXISTS "saved_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"entity" text NOT NULL,
	"definition" jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_reports_org_idx" ON "saved_reports" ("organization_id","updated_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agreements_company_status_idx" ON "agreements" ("company_id","status","completed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_leads_org_created_idx" ON "project_leads" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_sends_org_sent_idx" ON "message_sends" ("organization_id","sent_at");
