# Tracking database schema

The storage and delivery sections below describe the initial implementation. The agreed revision gives tracking a durable poll log and change history a changes feed. [Change history implementation plan](./change-history.md)

Tracking uses three PostgreSQL tables. A versioned Drizzle SQL migration creates the tables, constraints, indexes, and singleton row described below. `ChangeHistoryModule` owns the 90-day history and enforces uniqueness on the poll ID it receives from tracking.

## `watchlist` — one row per source listing ID

| Column | PostgreSQL type | Meaning |
| --- | --- | --- |
| `id` | `text PRIMARY KEY` | The source ID accepted by the API. |
| `active` | `boolean NOT NULL DEFAULT true` | Removing an ID marks the row inactive and preserves its history. |
| `next_due_at` | `timestamptz` | Earliest time a regular poll or scheduled HTTP retry can start. Present exactly when active. |
| `next_attempt_no` | `smallint NOT NULL DEFAULT 1` | 1 for a regular poll, 2 or 3 for its two possible HTTP retries. Constrain to 1–3. |
| `last_dispatched_poll_id` | `uuid` | ID of the most recently dispatched attempt for this registration. Clear it on removal. A late result may schedule a retry only if this ID still matches. |

Index active rows on `(next_due_at, id) WHERE active`. Add an unknown ID as immediately due. A duplicate add leaves an active schedule intact. Reactivating an ID sets it due now with attempt number 1.

## `pending_polls` — one row per attempt awaiting completion or delivery

| Column | PostgreSQL type | Meaning |
| --- | --- | --- |
| `id` | `uuid PRIMARY KEY` | Fresh ID for each HTTP request. Reuse this ID on every delivery to change history. |
| `competitor_id` | `text NOT NULL UNIQUE REFERENCES watchlist(id)` | Allows at most one outstanding attempt per competitor until delivery completes. |
| `attempt_no` | `smallint NOT NULL` | Copy of the scheduled attempt number at dispatch. Constrain to 1–3. |
| `status` | `poll_status NOT NULL DEFAULT 'pending'` | Constrain to `pending`, `success`, or `error`. Describes the HTTP attempt, independently of delivery. |
| `outcome_kind` | `poll_outcome_kind` | Queryable classification. Allowed combinations appear below. |
| `http_status` | `smallint` | Actual HTTP status when available, otherwise NULL. |
| `response` | `jsonb` | Received listing fields or error details. A timeout can be recorded without a response body. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Time the dispatcher claimed the attempt. |
| `finished_at` | `timestamptz` | Time the outcome became known. |
| `delivery_attempts` | `integer NOT NULL DEFAULT 0` | Count of attempts to deliver this saved observation to change history. Constrain to nonnegative values. |
| `next_delivery_at` | `timestamptz` | Initially set to `finished_at` when the result is saved. Advance it after a delivery failure. |

Enforce the following state combinations with database checks. Index terminal rows on `(next_delivery_at, id) WHERE status IN ('success', 'error')` so the delivery worker can find due work.

| Status | Allowed `outcome_kind` | Required timestamps |
| --- | --- | --- |
| `pending` | NULL | `finished_at` and `next_delivery_at` are NULL. |
| `success` | `complete`, `partial`, `missing` | Both timestamps are present. A source 404 is a successful observation of absence. |
| `error` | `rate_limited`, `upstream_error`, `timeout`, `transport_error`, `invalid_response`, `interrupted` | Both timestamps are present. An interrupted attempt has an unknown source outcome. |

## `source_state` — one shared cooldown

| Column | PostgreSQL type | Meaning |
| --- | --- | --- |
| `id` | `smallint PRIMARY KEY CHECK (id = 1)` | Seed row 1 in the migration. |
| `cooldown_until` | `timestamptz` | Earliest time the source may be polled after a 429. Initially NULL. |

## Writes and recovery

1. **Claim.** Once the shared pacing gate opens, lock the oldest active, due watchlist row without a pending attempt. In one transaction insert a pending poll, copy its attempt number, set `last_dispatched_poll_id`, and set the next regular due time and attempt number 1. Commit before sending the request.
2. **Finish.** In one transaction save the outcome and make it eligible for delivery. On a 429, immediately pause new starts, extend the persisted cooldown to the latest applicable deadline, and make the affected registration due at cooldown expiry. The shared gate and oldest-due ordering apply on resumption. On a 500, 502, 503, timeout, or transport error, schedule at most two retries with full jitter (0–2 seconds, then 0–4 seconds). Update the watchlist only if still active with the matching dispatched ID. Every retry passes through the same pacing gate. After attempt 3 the regular schedule stands.
3. **Deliver.** Send the saved result to change history. On acknowledgement, delete only the pending row for that poll ID. On a delivery failure, keep the result and retry delivery with jittered exponential backoff capped at 60 seconds. A replay after a lost acknowledgement resolves to the same snapshot.
4. **Remove or restart.** Removal clears the dispatch marker and due time and resets the next attempt number. An older poll may still finish and enter history. On startup, replay terminal rows with their saved results. Mark any abandoned `pending` attempt as `error/interrupted` and deliver it under its original ID.

## Planned durable poll log

Rename `pending_polls` to `poll_attempts`. Preserve its poll ID, outcome, response, retry metadata, and scheduling relationships. Add `processed_at` and a nullable `version_id` referencing `listing_versions`. Tracking will own complete listing versions alongside the attempt log. A complete attempt references its version even when its fields are unchanged. A partial attempt retains exactly the fields it received. Failed and missing attempts retain their outcomes and timestamps.

Replace unconditional uniqueness on `competitor_id` with a unique partial index for `processed_at IS NULL`. Update the dispatch claim to exclude only competitors with an outstanding attempt. Update the delivery index and worker to select only terminal, unprocessed attempts due for delivery. Allow `next_delivery_at` to be cleared on acknowledgement. Index finished attempts by competitor, finish time, and poll ID for the full timeline and baseline lookup.

For the next observation, tracking supplies the last processed complete version and the most recent processed complete-or-missing outcome for that competitor. These facts answer different questions: what was last advertised, and was the listing subsequently observed missing? Retain both across removal and reactivation. Initially keep the existing indefinite retention policy. Any future 90-day pruning must preserve these baseline facts and versions referenced by retained attempts.

After the change history call succeeds, tracking acknowledges the attempt in its own transaction and assigns or reuses the complete listing version. Clear a complete response payload only after persisting its version reference. Retry failed delivery with the original poll ID and comparison input. Guard acknowledgement by poll ID and an unset processing timestamp.

For cutover, stop the old backend, migrate and backfill, verify the data, then start the new workers. Import acknowledged snapshots by original poll ID with their observed time, outcome, HTTP status, version and partial fields. Allow unknown claim times and attempt numbers for imported rows. Merge overlapping records by poll ID and preserve richer attempt metadata. Replay historical observations per competitor in fetched-time and poll-ID order through the change history contract. Verify poll IDs against the union of the old tables and compare derived events with the old change flags. Retire the old snapshots table only after verification. Test a historical baseline followed by a terminal poll awaiting delivery.
