CREATE TYPE "public"."poll_outcome_kind" AS ENUM('complete', 'partial', 'missing', 'rate_limited', 'upstream_error', 'timeout', 'transport_error', 'invalid_response', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."poll_status" AS ENUM('pending', 'success', 'error');--> statement-breakpoint
CREATE TABLE "pending_polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" text NOT NULL,
	"attempt_no" smallint NOT NULL,
	"status" "poll_status" DEFAULT 'pending' NOT NULL,
	"outcome_kind" "poll_outcome_kind",
	"http_status" smallint,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"delivery_attempts" integer DEFAULT 0 NOT NULL,
	"next_delivery_at" timestamp with time zone,
	CONSTRAINT "pending_polls_competitor_id_unique" UNIQUE("competitor_id"),
	CONSTRAINT "pending_polls_attempt_range" CHECK ("pending_polls"."attempt_no" between 1 and 3),
	CONSTRAINT "pending_polls_delivery_count" CHECK ("pending_polls"."delivery_attempts" >= 0),
	CONSTRAINT "pending_polls_http_status" CHECK ("pending_polls"."http_status" between 100 and 599),
	CONSTRAINT "pending_polls_lifecycle" CHECK (
    ("pending_polls"."status" = 'pending' and "pending_polls"."outcome_kind" is null and "pending_polls"."finished_at" is null and "pending_polls"."next_delivery_at" is null)
    or ("pending_polls"."finished_at" is not null and "pending_polls"."next_delivery_at" is not null and "pending_polls"."outcome_kind" is not null and (
      ("pending_polls"."status" = 'success' and "pending_polls"."outcome_kind" in ('complete', 'partial', 'missing'))
      or ("pending_polls"."status" = 'error' and "pending_polls"."outcome_kind" in
        ('rate_limited', 'upstream_error', 'timeout', 'transport_error', 'invalid_response', 'interrupted'))
    ))
  )
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
	"active" boolean DEFAULT true NOT NULL,
	"next_due_at" timestamp with time zone,
	"next_attempt_no" smallint DEFAULT 1 NOT NULL,
	"last_dispatched_poll_id" uuid,
	CONSTRAINT "watchlist_active_due" CHECK ("watchlist"."active" = ("watchlist"."next_due_at" is not null)),
	CONSTRAINT "watchlist_attempt_range" CHECK ("watchlist"."next_attempt_no" between 1 and 3)
);
--> statement-breakpoint
ALTER TABLE "pending_polls" ADD CONSTRAINT "pending_polls_competitor_id_watchlist_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."watchlist"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_polls_delivery_idx" ON "pending_polls" USING btree ("next_delivery_at","id") WHERE "pending_polls"."status" in ('success', 'error');--> statement-breakpoint
CREATE INDEX "watchlist_due_idx" ON "watchlist" USING btree ("next_due_at","id") WHERE "watchlist"."active";--> statement-breakpoint
INSERT INTO "source_state" ("id") VALUES (1);
