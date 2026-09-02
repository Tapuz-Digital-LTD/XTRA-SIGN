ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "crm_object_type" integer;--> statement-breakpoint
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "crm_record_id" text;--> statement-breakpoint
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "merge_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "crm_writeback_state" text;--> statement-breakpoint
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "crm_writeback_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "crm_writeback_error" text;