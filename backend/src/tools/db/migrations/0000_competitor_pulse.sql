CREATE TABLE "ai_summaries" (
	"poll_id" uuid PRIMARY KEY NOT NULL,
	"diff" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now(),
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"summary_text" text,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ai_summary_status" CHECK ("ai_summaries"."status" in ('queued', 'running', 'ready', 'timeout', 'failed', 'invalid_output', 'budget_exhausted')),
	CONSTRAINT "ai_attempt_range" CHECK ("ai_summaries"."attempt_count" between 0 and 2),
	CONSTRAINT "ai_summary_lifecycle" CHECK ((("ai_summaries"."status" in ('queued', 'running') and "ai_summaries"."available_at" is not null and "ai_summaries"."completed_at" is null) or (not "ai_summaries"."status" in ('queued', 'running') and "ai_summaries"."available_at" is null and "ai_summaries"."completed_at" is not null))),
	CONSTRAINT "ai_summary_ready" CHECK ((("ai_summaries"."status" = 'ready' and "ai_summaries"."summary_text" is not null and length(trim("ai_summaries"."summary_text")) > 0) or ("ai_summaries"."status" <> 'ready' and "ai_summaries"."summary_text" is null)))
);
--> statement-breakpoint
CREATE TABLE "daily_ai_usage" (
	"day" date PRIMARY KEY NOT NULL,
	"calls" integer NOT NULL,
	CONSTRAINT "daily_ai_calls_range" CHECK ("daily_ai_usage"."calls" between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "listing_comparisons" (
	"poll_id" uuid PRIMARY KEY NOT NULL,
	"competitor_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"listing_state" jsonb,
	"diff" jsonb,
	CONSTRAINT "comparison_complete_state" CHECK (("listing_comparisons"."listing_state" is null or (jsonb_typeof("listing_comparisons"."listing_state") = 'object' and "listing_comparisons"."listing_state" ?& array['title', 'tagline', 'price', 'description'] and jsonb_typeof("listing_comparisons"."listing_state"->'title') = 'string' and jsonb_typeof("listing_comparisons"."listing_state"->'tagline') = 'string' and jsonb_typeof("listing_comparisons"."listing_state"->'price') = 'string' and jsonb_typeof("listing_comparisons"."listing_state"->'description') = 'string'))),
	CONSTRAINT "comparison_diff_shape" CHECK (("listing_comparisons"."diff" is null or (jsonb_typeof("listing_comparisons"."diff") = 'object' and "listing_comparisons"."diff" ?& array['kind','changedFields'] and jsonb_typeof("listing_comparisons"."diff"->'kind') = 'string' and jsonb_typeof(("listing_comparisons"."diff"->'changedFields')) = 'object' and (("listing_comparisons"."diff"->'changedFields') - array['title', 'tagline', 'price', 'description']) = '{}'::jsonb and case "listing_comparisons"."diff"->>'kind'
      when 'disappeared' then ("listing_comparisons"."listing_state" is null and ("listing_comparisons"."diff"->'changedFields') = '{}'::jsonb)
      when 'content_changed' then ("listing_comparisons"."listing_state" is not null and ("listing_comparisons"."diff"->'changedFields') <> '{}'::jsonb)
      when 'returned' then "listing_comparisons"."listing_state" is not null
      else false
    end)))
);
--> statement-breakpoint
CREATE TABLE "poll_executions" (
	"poll_id" uuid PRIMARY KEY NOT NULL,
	"tracking_finished_at" timestamp with time zone NOT NULL,
	"tracking_status" text DEFAULT 'completed' NOT NULL,
	"change_history_status" text DEFAULT 'not_submitted' NOT NULL,
	"ai_summary_status" text DEFAULT 'not_submitted' NOT NULL,
	CONSTRAINT "execution_tracking_done" CHECK ("poll_executions"."tracking_status" = 'completed'),
	CONSTRAINT "execution_history_required" CHECK ("poll_executions"."change_history_status" in ('not_submitted', 'submitted', 'completed', 'error')),
	CONSTRAINT "execution_ai_summary_status" CHECK ("poll_executions"."ai_summary_status" in ('not_submitted', 'submitted', 'completed', 'error', 'not_required'))
);
--> statement-breakpoint
CREATE TABLE "poll_logs" (
	"poll_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"competitor_id" text NOT NULL,
	"status" text DEFAULT 'fetching' NOT NULL,
	"listing_fields" jsonb,
	"failed_attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "poll_logs_status" CHECK ("poll_logs"."status" in ('fetching', 'waiting_retry', 'complete', 'missing', 'failed')),
	CONSTRAINT "poll_logs_uuidv7" CHECK (uuid_extract_version("poll_logs"."poll_id") is not distinct from 7),
	CONSTRAINT "poll_logs_lifecycle" CHECK (((("poll_logs"."status" in ('fetching', 'waiting_retry') and "poll_logs"."finished_at" is null) or (not "poll_logs"."status" in ('fetching', 'waiting_retry') and "poll_logs"."finished_at" is not null)) and (("poll_logs"."status" = 'complete' and "poll_logs"."listing_fields" is not null) or ("poll_logs"."status" <> 'complete' and "poll_logs"."listing_fields" is null)) and ("poll_logs"."delivered_at" is null or "poll_logs"."status" in ('complete', 'missing')))),
	CONSTRAINT "poll_logs_failures" CHECK ((jsonb_typeof("poll_logs"."failed_attempts") = 'array' and jsonb_array_length("poll_logs"."failed_attempts") between 0 and 3 and ("poll_logs"."status" not in ('failed', 'waiting_retry') or jsonb_array_length("poll_logs"."failed_attempts") > 0) and ("poll_logs"."status" = 'failed' or jsonb_array_length("poll_logs"."failed_attempts") < 3)))
);
--> statement-breakpoint
CREATE TABLE "source_state" (
	"id" smallint PRIMARY KEY NOT NULL,
	"cooldown_until" timestamp with time zone,
	CONSTRAINT "source_state_singleton" CHECK ("source_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" text PRIMARY KEY NOT NULL,
	"next_due_at" timestamp with time zone,
	"last_dispatched_poll_id" uuid
);
--> statement-breakpoint
ALTER TABLE "poll_logs" ADD CONSTRAINT "poll_logs_competitor_id_watchlist_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."watchlist"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_summaries_due_idx" ON "ai_summaries" USING btree ("available_at","poll_id") WHERE "ai_summaries"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "listing_comparisons_poll_order" ON "listing_comparisons" USING btree ("competitor_id","poll_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "listing_comparisons_changes_feed" ON "listing_comparisons" USING btree ("competitor_id","observed_at" DESC NULLS LAST,"poll_id" DESC NULLS LAST) WHERE "listing_comparisons"."diff" is not null;--> statement-breakpoint
CREATE INDEX "execution_ai_work_idx" ON "poll_executions" USING btree ("ai_summary_status","tracking_finished_at","poll_id") WHERE ("poll_executions"."change_history_status" = 'completed' and "poll_executions"."ai_summary_status" in ('not_submitted', 'submitted'));--> statement-breakpoint
CREATE UNIQUE INDEX "poll_logs_open_idx" ON "poll_logs" USING btree ("competitor_id") WHERE "poll_logs"."status" in ('fetching', 'waiting_retry');--> statement-breakpoint
CREATE INDEX "poll_logs_competitor_order_idx" ON "poll_logs" USING btree ("competitor_id","poll_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "poll_logs_timeline_idx" ON "poll_logs" USING btree ("competitor_id","finished_at" DESC NULLS LAST,"poll_id" DESC NULLS LAST) WHERE "poll_logs"."finished_at" is not null;--> statement-breakpoint
CREATE INDEX "poll_logs_unack_order_idx" ON "poll_logs" USING btree ("competitor_id","poll_id") WHERE ("poll_logs"."delivered_at" is null and "poll_logs"."status" in ('complete', 'missing'));--> statement-breakpoint
CREATE INDEX "watchlist_due_idx" ON "watchlist" USING btree ("next_due_at","id") WHERE "watchlist"."next_due_at" is not null;
--> statement-breakpoint
INSERT INTO source_state (id) VALUES (1);
