CREATE TABLE "document_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_version_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"image_width" integer NOT NULL,
	"image_height" integer NOT NULL,
	"width_pt" double precision NOT NULL,
	"height_pt" double precision NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fields" ALTER COLUMN "x" SET DATA TYPE double precision USING "x"::double precision;--> statement-breakpoint
ALTER TABLE "fields" ALTER COLUMN "y" SET DATA TYPE double precision USING "y"::double precision;--> statement-breakpoint
ALTER TABLE "fields" ALTER COLUMN "width" SET DATA TYPE double precision USING "width"::double precision;--> statement-breakpoint
ALTER TABLE "fields" ALTER COLUMN "height" SET DATA TYPE double precision USING "height"::double precision;--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_agreement_version_id_agreement_versions_id_fk" FOREIGN KEY ("agreement_version_id") REFERENCES "public"."agreement_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_pages_version_number_unique" ON "document_pages" USING btree ("agreement_version_id","page_number");