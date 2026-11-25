ALTER TABLE "daily_ai_usage" ADD COLUMN "live_calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- The original counter did not distinguish local mock calls from live reservations.
UPDATE "daily_ai_usage" SET "live_calls" = "calls";--> statement-breakpoint
ALTER TABLE "daily_ai_usage" ADD CONSTRAINT "daily_ai_live_calls_range" CHECK ("daily_ai_usage"."live_calls" between 0 and "daily_ai_usage"."calls");
