ALTER TABLE "fields" ADD COLUMN "placeholder" text;--> statement-breakpoint
ALTER TABLE "fields" ADD COLUMN "auto_fill" boolean DEFAULT false NOT NULL;