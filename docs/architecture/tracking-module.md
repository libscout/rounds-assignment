# Tracking module design

The storage and delivery sections below describe the initial implementation. The agreed revision gives tracking a durable poll log and change history a changes feed. [Change history implementation plan](./change-history.md)

Tracking owns the watchlist and its polling schedule. The agreed design uses one PostgreSQL watchlist and one active dispatcher in Docker Compose. All listing requests share the same rate limit and cooldown.

The [tracking database schema](./tracking-schema.md) defines the three tables, constraints, and transaction boundaries.

## User actions

| Action | Behavior |
| --- | --- |
| Add an ID | Trim surrounding whitespace, reject empty IDs, and preserve case. Treat the remaining string as an opaque source ID. Return `201`, and make its first poll due immediately. An unknown ID can be tracked. Repeated adds of the same active ID keep one entry and one schedule. |
| List tracked IDs | Return the active IDs. To include the 24-hour change indicator, ask change history for recent changes in one batch. |
| Remove an ID | Return `204` and stop future polls. An already-started poll can finish and enter history. Adding the ID again resumes tracking. |

## Capacity and scheduling policy

At 6,000 IDs every 900 seconds, demand is 6.67 requests per second. At the allowed five starts per second, only 4,500 IDs fit in 15 minutes. A full pass takes **at least 20 minutes**, before retries, cooldowns, and slow responses. Keep the configured interval as a target, serve the oldest due ID first, and report the delay. A firm 15-minute commitment requires more source capacity or fewer tracked IDs. [Assignment constraints](../../assignment/instructions.md#additional-notes)

## Agreed features

| Feature | Implementation |
| --- | --- |
| Durable watchlist and schedule | Store one PostgreSQL row per source ID with active status and `next_due_at`. Index active rows by `(next_due_at, id)` for deterministic selection. Add and reactivate atomically. A duplicate add leaves the existing schedule intact. |
| Fair dispatch under overload | Run one dispatcher in the Compose deployment. Select the oldest eligible row when a request slot opens. After dispatch, schedule the next check from the actual start time plus the interval. Keep one due check per ID so restarts and missed intervals cannot create a backlog of historical requests. |
| Global request pacing | Route every listing request through one gate, including first polls and retries. At five per second, leave at least 200 ms between actual starts. After a delayed timer or cooldown, resume at the normal pace. The add endpoint enqueues the first check through this same path. |
| Bounded concurrency and request deadlines | Configure a positive limit on outstanding HTTP requests and allow at most one per ID. Slow requests can overlap while all starts still go through the rate gate. Apply one deadline through body consumption, abort expired requests, and release the slot on every exit. Node’s `fetch` accepts an abort signal. [Node.js timeout signal](https://nodejs.org/api/globals.html#static-method-abortsignaltimeoutdelay) |
| Shared cooldown and retry policy | When any ID returns `429`, record that attempt and suspend new starts for the entire source. Make the affected ID due at cooldown expiry. Resume with the oldest eligible ID across the watchlist. Keep the latest cooldown deadline if several responses arrive. The fixture sends seconds; HTTP also permits a date. Use a short positive fallback if the header is missing or invalid. For a 500, 502, 503, timeout, or transport error, allow up to two retries of that ID with exponential backoff and full jitter. Every attempt uses the shared limiter. [Source behavior](../../assignment/files/listing-source/README.md#endpoints) · [HTTP Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3) |
| Typed outcome for each HTTP attempt | Call `GET /listings/{encodedId}` against the configured base URL. Inspect status before decoding the body. Validate a successful response as one listing object matching the requested ID. Emit a complete or partial listing, missing listing, rate limit, timeout, transport error, upstream error, or invalid response. Preserve available listing fields on partial success. A `404` keeps the ID eligible for future polls. |
| Reliable handoff and removal | Give each attempt a poll ID and timestamp, then call the change history module’s public service with the outcome. Retry a failed database handoff using the same poll ID and payload. A fresh HTTP attempt gets a fresh ID. Keep completed observations when an ID is removed during a fetch. Apply a retry schedule only while the active watchlist row still points to that poll ID. Removal clears the pointer. |
| Visibility into missed targets | Record request starts, outcome counts, current in-flight count, cooldown expiry, and age of the oldest overdue item. The last measure shows whether the requested freshness is achievable. Include the competitor ID and poll ID in structured logs for an individual attempt. |

## Restart and deployment boundary

Persist the source cooldown so restarting the process cannot bypass `Retry-After`. On startup wait one pacing interval before the first request and resume from the stored due times. On graceful shutdown stop dispatching and drain outstanding attempts up to their deadlines. For abrupt termination, persist the attempt ID when claiming an ID. Reconcile unfinished attempts with change history on restart. Replay each saved terminal outcome. Record an abandoned pending attempt as interrupted with an unknown result. Only an actual source response can establish that a listing was missing.

If the backend is later replicated, elect a single dispatcher for the source before enabling polling on multiple instances. A PostgreSQL session advisory lock on a dedicated connection is one option. Stop dispatching if that session is lost. [PostgreSQL advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)

## Acceptance checks

Start with the shared cooldown test. When one competitor receives a `429` while another is due, the second request must wait until the cooldown expires.

| Scenario | Passing behavior |
| --- | --- |
| Add the same ID concurrently, remove it during a poll, then add it again | One active schedule exists. The old request can enter history once. Its completion cannot disable or reschedule the new registration. |
| Make 6,000 IDs due at once using a simulated clock | Starts are at least 200 ms apart. At most 4,500 start in the first 15-minute window. Every ID gets its turn before repeat polls crowd it out. |
| Return a slow response for one ID and a normal response for another | The second ID can start while the first is pending, subject to pacing and the concurrency limit. A stalled body times out and releases its slot. |
| Return `429` for one ID while others are due | No new ID starts during the advertised delay, including after restart. Already-started requests may finish. Starts resume without a burst. |
| Return a partial `200`, a `404`, an HTML `502`, and a timeout | `ChangeHistoryModule` receives a distinct, correctly classified attempt for each. Tracking stays active and the scheduler continues. |
| Return three consecutive 500s for one ID | The initial request and two retries produce three distinct poll IDs. The next check follows the regular schedule. |
| Replay a handoff after losing its acknowledgement; stop the process mid-attempt | A committed poll appears once. An unfinished attempt is recoverable as interrupted. Subsequent requests use new poll IDs. |

Use a controllable clock and a recording HTTP adapter for timing assertions. Use PostgreSQL integration tests for uniqueness and restart recovery. Exercise the real HTTP path with the supplied simulator’s control endpoints. [Simulator controls](../../assignment/files/listing-source/README.md#control-endpoints)

## Ownership

The tracking controller handles the three watchlist routes. Public watchlist use cases live in `tracking/services/`, and polling coordination stays in `tracking/internal/`. The HTTP adapter in `external/listing-source/` handles the wire response. Tracking retains poll attempts. `ChangeHistoryModule` records meaningful changes. `CompetitorHistoryModule` combines both for the timeline endpoint. Change history owns the AI explanation on each diff and calls the summaries service for budgeted provider access.

For example, if a tracked ID returns `404` twice, tracking passes on both attempts and schedules another check. `ChangeHistoryModule` has the history needed to decide whether the first absence was a disappearance or the ID has always been missing.
