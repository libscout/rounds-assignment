-- Cancelled retries were closed at removal time instead of their last source attempt.
UPDATE "poll_logs"
SET "finished_at" = ("failed_attempts" -> -1 ->> 'at')::timestamptz
WHERE "status" = 'failed'
  AND "finished_at" <> ("failed_attempts" -> -1 ->> 'at')::timestamptz;
