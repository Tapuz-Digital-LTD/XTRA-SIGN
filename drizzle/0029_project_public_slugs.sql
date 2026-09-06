CREATE TABLE "project_public_slugs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replaced_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "project_public_slugs" ADD CONSTRAINT "project_public_slugs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_public_slugs" ADD CONSTRAINT "project_public_slugs_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_public_slugs_slug_unique" ON "project_public_slugs" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "project_public_slugs_current_unique" ON "project_public_slugs" USING btree ("group_id") WHERE "project_public_slugs"."is_current" = true;--> statement-breakpoint
CREATE INDEX "project_public_slugs_group_idx" ON "project_public_slugs" USING btree ("group_id");