-- "דורשים טיפול": a failed message can be retried (retry_of) or marked handled (resolved_*). Additive only.
ALTER TABLE "message_sends" ADD COLUMN IF NOT EXISTS "retry_of" uuid;--> statement-breakpoint
ALTER TABLE "message_sends" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_sends" ADD COLUMN IF NOT EXISTS "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "message_sends" ADD COLUMN IF NOT EXISTS "resolved_note" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_sends_agreement_idx" ON "message_sends" ("agreement_id","sent_at");
