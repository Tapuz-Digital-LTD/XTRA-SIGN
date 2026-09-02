CREATE TABLE IF NOT EXISTS "bulk_batch_items" (
	"batch_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"agreement_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bulk_batch_items_batch_id_company_id_pk" PRIMARY KEY("batch_id","company_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bulk_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"group_id" uuid,
	"template_id" uuid,
	"group_name" text,
	"template_name" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_requested" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_groups" (
	"group_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_groups_group_id_company_id_pk" PRIMARY KEY("group_id","company_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bulk_batch_items" ADD CONSTRAINT "bulk_batch_items_batch_id_bulk_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."bulk_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_batch_items" ADD CONSTRAINT "bulk_batch_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_batches" ADD CONSTRAINT "bulk_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_batches" ADD CONSTRAINT "bulk_batches_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_batches" ADD CONSTRAINT "bulk_batches_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_batches" ADD CONSTRAINT "bulk_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_groups" ADD CONSTRAINT "company_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_groups" ADD CONSTRAINT "company_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bulk_batch_items_agreement_idx" ON "bulk_batch_items" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bulk_batches_org_idx" ON "bulk_batches" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_groups_company_idx" ON "company_groups" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "groups_org_idx" ON "groups" USING btree ("organization_id");