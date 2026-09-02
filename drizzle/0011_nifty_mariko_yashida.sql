ALTER TABLE "companies" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "source" text DEFAULT 'xtra' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "crm_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_crm_unique" ON "companies" USING btree ("organization_id","crm_object_type","crm_record_id") WHERE "companies"."crm_record_id" is not null;