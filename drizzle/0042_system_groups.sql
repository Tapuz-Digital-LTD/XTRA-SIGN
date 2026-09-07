-- Internal contexts that behave like a campaign but are never shown as one (direct signings). Additive only.
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "system_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "groups_org_system_key_unique" ON "groups" ("organization_id","system_key") WHERE "system_key" IS NOT NULL;
