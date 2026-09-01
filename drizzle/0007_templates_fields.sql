ALTER TABLE "templates" ADD COLUMN "fields" jsonb;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "page_count" integer;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "deleted_at" timestamp with time zone;