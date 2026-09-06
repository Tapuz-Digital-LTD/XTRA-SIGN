CREATE TABLE IF NOT EXISTS "distributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"channels" jsonb NOT NULL,
	"content_kind" text DEFAULT 'campaign_link' NOT NULL,
	"content_url" text,
	"message" jsonb,
	"audience" jsonb,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stats" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "distribution_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"distribution_id" uuid NOT NULL,
	"company_id" uuid,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"results" jsonb,
	"error" text,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "distributions" ADD CONSTRAINT "distributions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "distributions" ADD CONSTRAINT "distributions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "distributions" ADD CONSTRAINT "distributions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "distribution_recipients" ADD CONSTRAINT "distribution_recipients_distribution_id_distributions_id_fk" FOREIGN KEY ("distribution_id") REFERENCES "public"."distributions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "distribution_recipients" ADD CONSTRAINT "distribution_recipients_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "distributions_group_idx" ON "distributions" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "distribution_recipients_distribution_idx" ON "distribution_recipients" USING btree ("distribution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "distribution_recipients_phone_idx" ON "distribution_recipients" USING btree ("phone","sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "distribution_recipients_email_idx" ON "distribution_recipients" USING btree ("email","sent_at");
