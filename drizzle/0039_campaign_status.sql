ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "ended_message" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "allow_completion_after_end" boolean DEFAULT true NOT NULL;
