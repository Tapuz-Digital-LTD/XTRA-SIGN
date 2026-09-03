CREATE TABLE "project_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"data" jsonb NOT NULL,
	"company_id" uuid,
	"source" text DEFAULT 'landing' NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "landing_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "landing_slug" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "landing_config" jsonb;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "notify_emails" jsonb;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "notification_prefs" jsonb;--> statement-breakpoint
ALTER TABLE "project_leads" ADD CONSTRAINT "project_leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_leads" ADD CONSTRAINT "project_leads_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_leads" ADD CONSTRAINT "project_leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_leads" ADD CONSTRAINT "project_leads_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_leads_group_idx" ON "project_leads" USING btree ("group_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_landing_slug_unique" ON "groups" USING btree ("landing_slug") WHERE "groups"."landing_slug" is not null;