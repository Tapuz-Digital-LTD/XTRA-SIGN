CREATE TABLE "message_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"group_id" uuid,
	"distribution_id" uuid,
	"agreement_id" uuid,
	"channel" text NOT NULL,
	"event" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"variables" jsonb,
	"provider_message_id" text,
	"is_test" boolean DEFAULT false NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "campaign_kind" text DEFAULT 'signature' NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "registrations_after_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "link_ttl_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "default_template_id" uuid;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "message_overrides" jsonb;--> statement-breakpoint
ALTER TABLE "message_sends" ADD CONSTRAINT "message_sends_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_sends_group_idx" ON "message_sends" USING btree ("group_id","sent_at");--> statement-breakpoint
CREATE INDEX "message_sends_distribution_idx" ON "message_sends" USING btree ("distribution_id");--> statement-breakpoint
CREATE INDEX "message_sends_agreement_idx" ON "message_sends" USING btree ("agreement_id");--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "groups" SET "campaign_kind" = 'public' WHERE "landing_enabled" = true OR ("landing_config"->'selfService'->>'enabled') = 'true';--> statement-breakpoint
UPDATE "groups" SET "link_ttl_days" = ("landing_config"->'selfService'->>'linkTtlDays')::int WHERE ("landing_config"->'selfService'->>'linkTtlDays') ~ '^[0-9]+$';--> statement-breakpoint
UPDATE "groups" SET "owner_user_id" = ("landing_config"->'selfService'->>'ownerUserId')::uuid WHERE "owner_user_id" IS NULL AND ("landing_config"->'selfService'->>'ownerUserId') ~ '^[0-9a-f-]{36}$';--> statement-breakpoint
UPDATE "groups" SET "default_template_id" = ("landing_config"->'selfService'->>'templateId')::uuid WHERE "default_template_id" IS NULL AND ("landing_config"->'selfService'->>'templateId') ~ '^[0-9a-f-]{36}$';
