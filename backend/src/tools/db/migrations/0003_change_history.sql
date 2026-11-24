CREATE TYPE "public"."listing_change_kind" AS ENUM('content_changed', 'disappeared', 'returned');--> statement-breakpoint
CREATE TYPE "public"."summary_status" AS ENUM('pending', 'ready', 'timeout', 'invalid_output', 'failed', 'budget_exhausted');--> statement-breakpoint
CREATE TABLE "listing_changes" (
	"poll_id" uuid PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"kind" "listing_change_kind" NOT NULL,
	"changed_fields" jsonb NOT NULL,
	"summary" text,
	"summary_status" "summary_status" DEFAULT 'pending' NOT NULL,
	"claim_token" uuid,
	"claim_expires_at" timestamp with time zone,
	CONSTRAINT "change_field_shape" CHECK (jsonb_typeof("listing_changes"."changed_fields") = 'object' AND ("listing_changes"."changed_fields" - ARRAY['title','tagline','description','price']) = '{}'::jsonb),
	CONSTRAINT "change_event_fields" CHECK ((("listing_changes"."kind" <> 'content_changed' or "listing_changes"."changed_fields" <> '{}'::jsonb) and ("listing_changes"."kind" <> 'disappeared' or "listing_changes"."changed_fields" = '{}'::jsonb))),
	CONSTRAINT "change_summary_ready" CHECK (("listing_changes"."summary" is not null) = ("listing_changes"."summary_status" = 'ready')),
	CONSTRAINT "change_claim_state" CHECK ((("listing_changes"."claim_token" is null and "listing_changes"."claim_expires_at" is null) or ("listing_changes"."summary_status" = 'pending' and "listing_changes"."claim_token" is not null and "listing_changes"."claim_expires_at" is not null)))
);
--> statement-breakpoint
CREATE TABLE "daily_ai_usage" (
	"day" date PRIMARY KEY NOT NULL,
	"calls" integer NOT NULL,
	CONSTRAINT "daily_ai_calls_range" CHECK ("daily_ai_usage"."calls" between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE pending_polls RENAME TO poll_attempts;--> statement-breakpoint
ALTER TABLE poll_attempts RENAME CONSTRAINT pending_polls_pkey TO poll_attempts_pkey;--> statement-breakpoint
ALTER TABLE poll_attempts RENAME CONSTRAINT pending_polls_competitor_id_watchlist_id_fk TO poll_attempts_competitor_id_watchlist_id_fk;--> statement-breakpoint
DROP INDEX pending_polls_delivery_idx;--> statement-breakpoint
ALTER TABLE poll_attempts DROP CONSTRAINT pending_polls_competitor_id_unique;--> statement-breakpoint
ALTER TABLE poll_attempts DROP CONSTRAINT pending_polls_attempt_range;--> statement-breakpoint
ALTER TABLE poll_attempts DROP CONSTRAINT pending_polls_delivery_count;--> statement-breakpoint
ALTER TABLE poll_attempts DROP CONSTRAINT pending_polls_http_status;--> statement-breakpoint
ALTER TABLE poll_attempts DROP CONSTRAINT pending_polls_lifecycle;--> statement-breakpoint
ALTER TABLE poll_attempts ALTER COLUMN attempt_no DROP NOT NULL, ALTER COLUMN created_at DROP NOT NULL, ADD COLUMN version_id uuid, ADD COLUMN processed_at timestamptz;--> statement-breakpoint
ALTER TABLE poll_attempts ADD CONSTRAINT "poll_attempts_claim_metadata" CHECK (("poll_attempts"."processed_at" is not null or ("poll_attempts"."attempt_no" is not null and "poll_attempts"."created_at" is not null)));--> statement-breakpoint
ALTER TABLE poll_attempts ADD CONSTRAINT "poll_attempts_version" CHECK ("poll_attempts"."version_id" is not null = ("poll_attempts"."processed_at" is not null and "poll_attempts"."outcome_kind" = 'complete'));--> statement-breakpoint
ALTER TABLE poll_attempts ADD CONSTRAINT "poll_attempts_attempt_range" CHECK ("poll_attempts"."attempt_no" between 1 and 3);--> statement-breakpoint
ALTER TABLE poll_attempts ADD CONSTRAINT "poll_attempts_delivery_count" CHECK ("poll_attempts"."delivery_attempts" >= 0);--> statement-breakpoint
ALTER TABLE poll_attempts ADD CONSTRAINT "poll_attempts_http_status" CHECK ("poll_attempts"."http_status" between 100 and 599);--> statement-breakpoint
ALTER TABLE poll_attempts ADD CONSTRAINT "poll_attempts_lifecycle" CHECK ((("poll_attempts"."status" = 'pending' and "poll_attempts"."outcome_kind" is null and "poll_attempts"."processed_at" is null and "poll_attempts"."finished_at" is null and "poll_attempts"."next_delivery_at" is null) or ("poll_attempts"."outcome_kind" is not null and "poll_attempts"."finished_at" is not null and ("poll_attempts"."next_delivery_at" is not null) = ("poll_attempts"."processed_at" is null) and (("poll_attempts"."status" = 'success' and "poll_attempts"."outcome_kind" in ('complete', 'partial', 'missing')) or ("poll_attempts"."status" = 'error' and "poll_attempts"."outcome_kind" in ('rate_limited', 'upstream_error', 'timeout', 'transport_error', 'invalid_response', 'interrupted'))))));--> statement-breakpoint
ALTER TABLE "listing_snapshots" ADD COLUMN "change_imported" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "poll_attempts" ADD CONSTRAINT "poll_attempts_version_id_listing_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."listing_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "changes_feed_idx" ON "listing_changes" USING btree ("competitor_id","observed_at" DESC NULLS LAST,"poll_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "changes_pending_idx" ON "listing_changes" USING btree ("observed_at","poll_id") WHERE "listing_changes"."summary_status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "poll_attempts_outstanding_idx" ON "poll_attempts" USING btree ("competitor_id") WHERE "poll_attempts"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "poll_attempts_timeline_idx" ON "poll_attempts" USING btree ("competitor_id","finished_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "poll_attempts"."processed_at" is not null;--> statement-breakpoint
CREATE INDEX "poll_attempts_delivery_idx" ON "poll_attempts" USING btree ("next_delivery_at","id") WHERE ("poll_attempts"."processed_at" is null and "poll_attempts"."status" in ('success', 'error'));--> statement-breakpoint
CREATE INDEX "snapshots_import_idx" ON "listing_snapshots" USING btree ("fetched_at","poll_id") WHERE ("listing_snapshots"."changed" and "listing_snapshots"."change_imported" = false);
--> statement-breakpoint
-- Imported history may predate the watchlist or a removal. Never activate an archived ID.
INSERT INTO watchlist (id, active)
SELECT DISTINCT competitor_id, false FROM listing_snapshots
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- An overlapping pending row means a snapshot was committed but its acknowledgement was lost.
INSERT INTO poll_attempts (id, competitor_id, attempt_no, created_at, finished_at,
                           outcome_kind, http_status, response, version_id, status, processed_at)
SELECT poll_id, competitor_id, NULL, NULL, fetched_at, outcome_kind, http_status,
       partial_fields, version_id,
       CASE WHEN outcome_kind IN ('complete','partial','missing') THEN 'success' ELSE 'error' END::poll_status,
       fetched_at FROM listing_snapshots
ON CONFLICT (id) DO UPDATE SET
  finished_at = excluded.finished_at, outcome_kind = excluded.outcome_kind,
  http_status = excluded.http_status, response = excluded.response, version_id = excluded.version_id,
  status = excluded.status, processed_at = excluded.processed_at, next_delivery_at = NULL;
