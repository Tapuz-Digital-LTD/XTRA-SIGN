ALTER TABLE "project_leads" ADD COLUMN "form_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "project_leads" ADD COLUMN "referrer" text;--> statement-breakpoint
ALTER TABLE "project_leads" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "project_leads_idempotency_unique" ON "project_leads" USING btree ("group_id","idempotency_key") WHERE "project_leads"."idempotency_key" is not null;