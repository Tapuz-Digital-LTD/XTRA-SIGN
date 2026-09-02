ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "source" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "crm_template_id" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "crm_modified_on" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "crm_content_hash" text;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "crm_merge_fields" jsonb;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "crm_source_html_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "templates_crm_version_unique" ON "templates" USING btree ("organization_id","crm_template_id","crm_content_hash") WHERE "templates"."crm_template_id" is not null;