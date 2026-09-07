-- Personal invitations, staff follow-up fields, tags, follow-up tasks. Additive only.
ALTER TABLE "project_leads" ADD COLUMN IF NOT EXISTS "kind" text;--> statement-breakpoint
ALTER TABLE "project_leads" ADD COLUMN IF NOT EXISTS "phone" text;--> statement-breakpoint
ALTER TABLE "project_leads" ADD COLUMN IF NOT EXISTS "email" text;--> statement-breakpoint
ALTER TABLE "project_leads" ADD COLUMN IF NOT EXISTS "invited_by" uuid;--> statement-breakpoint
ALTER TABLE "project_leads" ADD COLUMN IF NOT EXISTS "invite_channel" text;--> statement-breakpoint
ALTER TABLE "project_leads" ADD COLUMN IF NOT EXISTS "assignee_user_id" uuid;--> statement-breakpoint
ALTER TABLE "project_leads" ADD COLUMN IF NOT EXISTS "follow_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_leads" ADD COLUMN IF NOT EXISTS "call_outcome" text;--> statement-breakpoint
ALTER TABLE "project_leads" ADD COLUMN IF NOT EXISTS "internal_note" text;--> statement-breakpoint
ALTER TABLE "project_leads" ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_leads_phone_idx" ON "project_leads" ("group_id","phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_leads_email_idx" ON "project_leads" ("group_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_leads_assignee_idx" ON "project_leads" ("organization_id","assignee_user_id");--> statement-breakpoint
ALTER TABLE "message_sends" ADD COLUMN IF NOT EXISTS "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "message_sends" ADD COLUMN IF NOT EXISTS "sent_by" uuid;--> statement-breakpoint
ALTER TABLE "message_sends" ADD COLUMN IF NOT EXISTS "manual_state" text;--> statement-breakpoint
ALTER TABLE "message_sends" ADD COLUMN IF NOT EXISTS "manual_by" uuid;--> statement-breakpoint
ALTER TABLE "message_sends" ADD COLUMN IF NOT EXISTS "manual_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_sends_lead_idx" ON "message_sends" ("lead_id");--> statement-breakpoint
ALTER TABLE "campaign_events" ADD COLUMN IF NOT EXISTS "invitation_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_events_invitation_idx" ON "campaign_events" ("invitation_id");--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "follow_up_config" jsonb;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text DEFAULT 'company' NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"color" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tags_org_kind_name_unique" ON "tags" ("organization_id","kind","name_key");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_tags" (
	"company_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_tags_pk" PRIMARY KEY("company_id","tag_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_tags_tag_idx" ON "company_tags" ("tag_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_tags" (
	"lead_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_tags_pk" PRIMARY KEY("lead_id","tag_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_tags_tag_idx" ON "lead_tags" ("tag_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "follow_up_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"group_id" uuid,
	"lead_id" uuid,
	"agreement_id" uuid,
	"company_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"assignee_user_id" uuid,
	"due_at" timestamp with time zone,
	"note" text,
	"link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "follow_up_tasks_lead_kind_unique" ON "follow_up_tasks" ("lead_id","kind") WHERE "lead_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follow_up_tasks_group_status_idx" ON "follow_up_tasks" ("group_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follow_up_tasks_company_idx" ON "follow_up_tasks" ("company_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_tags" ADD CONSTRAINT "company_tags_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_tags" ADD CONSTRAINT "company_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_lead_id_project_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "project_leads"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_lead_id_project_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "project_leads"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;
