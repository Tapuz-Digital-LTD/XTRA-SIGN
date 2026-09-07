ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "goal" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "entry_method" text;--> statement-breakpoint
UPDATE "groups" SET "goal" = CASE
  WHEN landing_config->'selfService'->>'enabled' = 'true' THEN 'signing'
  WHEN campaign_kind = 'signature' THEN 'signing'
  ELSE 'inquiries' END
WHERE "goal" IS NULL;--> statement-breakpoint
UPDATE "groups" SET "entry_method" = CASE
  WHEN landing_config->'selfService'->>'skin' IS NOT NULL AND landing_config->'selfService'->>'enabled' = 'true' THEN 'custom'
  WHEN landing_enabled OR campaign_kind = 'public' THEN 'form'
  ELSE 'audience' END
WHERE "entry_method" IS NULL;
