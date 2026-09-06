CREATE TABLE "campaign_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"type" text NOT NULL,
	"visit_id" text NOT NULL,
	"requested_slug" text,
	"canonical_slug" text,
	"path" text,
	"utm" jsonb,
	"referrer" text,
	"registration_id" uuid,
	"agreement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_events" ADD CONSTRAINT "campaign_events_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_events_group_type_time_idx" ON "campaign_events" USING btree ("group_id","type","created_at");--> statement-breakpoint
CREATE INDEX "campaign_events_group_visit_idx" ON "campaign_events" USING btree ("group_id","visit_id");--> statement-breakpoint
CREATE INDEX "campaign_events_registration_idx" ON "campaign_events" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "campaign_events_agreement_idx" ON "campaign_events" USING btree ("agreement_id");