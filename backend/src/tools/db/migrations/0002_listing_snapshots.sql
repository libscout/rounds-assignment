CREATE TABLE "listing_snapshots" (
	"poll_id" uuid PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"outcome_kind" "poll_outcome_kind" NOT NULL,
	"http_status" smallint,
	"version_id" uuid,
	"partial_fields" jsonb,
	"changed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fields" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_snapshots" ADD CONSTRAINT "listing_snapshots_version_id_listing_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."listing_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "snapshots_competitor_time_idx" ON "listing_snapshots" USING btree ("competitor_id","fetched_at");--> statement-breakpoint
CREATE INDEX "snapshots_outcome_time_idx" ON "listing_snapshots" USING btree ("competitor_id","outcome_kind","fetched_at");--> statement-breakpoint
CREATE INDEX "snapshots_recent_change_idx" ON "listing_snapshots" USING btree ("fetched_at","competitor_id") WHERE "listing_snapshots"."changed";