# Tracking implementation plan

The storage and delivery sections below describe the initial implementation. The agreed revision gives tracking a durable poll log and change history a changes feed. [Change history implementation plan](./change-history.md)

Build **one NestJS business module, `TrackingModule`**, for the watchlist, dispatcher, and delivery of poll outcomes. Claiming a poll inserts a `pending_polls` row and advances the watchlist schedule together. A rate-limited response updates the attempt and the shared cooldown together. Separating those tables into Nest modules would spread ownership of these writes across modules. [Tracking schema](./tracking-schema.md)

## Nest wiring

`AppModule` loads `TrackingModule` in one NestJS process. Its providers use the global Drizzle client. The listing-source module handles HTTP and the change history module stores observations and answers recent-change queries.

| Component | Who calls it | What it does |
| --- | --- | --- |
| `CompetitorsController` in `controllers/` | The frontend, over HTTP | Validate the add, remove, and list requests, call `WatchlistService`, and return response DTOs. |
| `WatchlistService` in `services/` | The controller | Maintain the user’s watchlist. Adding an ID makes it due immediately. Removing an ID stops future checks. Listing IDs makes one batch call to change history for the 24-hour change indicator. |
| `PollDispatcher` in `internal/` | A single background loop | Decide **when a request may start**. Check available slots, pacing, and the shared cooldown. Ask the attempt service to claim one due ID, call the source client once, and hand the result back to the attempt service. On a 429, pause new starts immediately. |
| `PollAttemptService` in `internal/` | The dispatcher, including during startup recovery | Decide **which ID to claim and what to persist**. Claiming creates a poll ID and advances the schedule in one transaction. Finishing saves the outcome and, when appropriate, schedules a retry or extends the persisted cooldown in one transaction. |
| `SnapshotDeliveryWorker` in `internal/` | A second background loop | Deliver completed `pending_polls` rows to change history. Delete a row after acknowledgement. If delivery fails, schedule another delivery of the saved payload with the same poll ID. |

Tracking owns three tables: `watchlist`, `pending_polls`, and `source_state`. The listing-source client performs one HTTP GET. Tracking’s `PollOutcomeMapper` classifies the response or transport failure. Tracking hands the saved outcome to change history with a stable poll ID and consumes its recent-changes lookup for the list view. The revised design assigns change events to change history and the timeline API to `CompetitorHistoryModule`. [Module design](./tracking-module.md)

## Watchlist HTTP contract

`CompetitorsController` serves one internal user under `/api/competitors`. Each DTO below lives in its own file in `src/modules/tracking/dto/`. [Assignment API](../../assignment/instructions.md#frontend-build-it)

| Route | Input | Success response |
| --- | --- | --- |
| `POST /api/competitors` | `AddCompetitorDto` in `add-competitor.dto.ts`, with `id: string` in the body | `201` with a `TrackedCompetitorResponseDto` from `tracked-competitor-response.dto.ts`, e.g. `{"id":"Acme"}`. A new or reactivated ID is due immediately. A duplicate active ID gets the same response and keeps its schedule. |
| `GET /api/competitors` | No input DTO | `200` with an array of `TrackedCompetitorListItemDto` from `tracked-competitor-list-item.dto.ts`, e.g. `[{"id":"Acme","changedInLast24h":false}]`. An empty watchlist returns `[]`. The flag reflects a meaningful change observation within the past 24 hours, independently of summary availability. |
| `DELETE /api/competitors/:id` | `CompetitorIdParamDto` in `competitor-id-param.dto.ts`, with `id: string` from the path | `204` with an empty body, including for an already inactive or unknown ID. |

Apply a transforming Nest `ValidationPipe` to the controller. Both input DTOs trim string values and preserve case. Reject missing, blank, or non-string IDs with `400`; keep implicit type conversion disabled so a number cannot pass as a string. An unknown but valid ID is accepted without a source lookup. Return instances of the two response DTOs and mark their public fields with `@Expose()` for the existing `excludeAll` serializer. `CompetitorHistoryModule` owns the separate timeline endpoint. [Backend DTO conventions](../../backend/rules.md#controller-dtos--response-serialization)

## Follow one poll

A user adds `acme-crm`. The controller and watchlist service make it due and return `201`. When a request slot opens, the dispatcher asks the attempt service to claim it. After the claim commits, the dispatcher calls the source. If the source returns $29, the attempt service saves that observation. The delivery worker then gives the saved $29 result to change history.

Two failures explain why dispatch and delivery have separate workers. If the **source returns 500**, a scheduled HTTP retry makes a fresh observation with a new poll ID. If **change history commits the $29 result but its acknowledgement is lost**, delivery retries the same $29 result with the same ID. Fetching again could return a different price. During a source-wide cooldown, delivery can still drain observations already saved. The unique pending row per competitor means that competitor’s next fetch waits for delivery acknowledgement. [Database constraints](./tracking-schema.md)

## Implementation order

| Step | Deliverable | Acceptance check |
| --- | --- | --- |
| 1. Storage and config | Define the three Drizzle tables and a versioned SQL migration with constraints, partial indexes, and the singleton cooldown row. Extend the existing config schema with the source URL, polling interval, HTTP deadline, and concurrency limit. | Apply the complete migration chain to an empty PostgreSQL database. Check the cooldown row, invalid status/outcome combinations, and the unique pending attempt per ID. |
| 2. Watchlist API | Implement the controller and four DTOs above. Use a test double for the batch recent-changes lookup until change history is ready. | Run Supertest with the production validation and serialization settings. Assert the exact response bodies, including `false`, `[]`, and an empty 204 body. Cover trimmed mixed-case IDs, invalid inputs, and repeated deletes. A PostgreSQL test verifies concurrent duplicate adds preserve one schedule. |
| 3. Source adapter and tracking classifier | Encode the source ID as one URL path segment and fetch one listing with a deadline covering body consumption. In tracking, classify complete and partial JSON, 404, 429 and its deadline, 5xx including HTML, transport errors, and invalid responses. | Exercise the adapter against a controlled HTTP server. Assert that tracking records a 404 as `success/missing`, a stalled body triggers the configured timeout, and one invocation issues one request. |
| 4. Dispatcher and retries | Start with one explicit dispatch step that tests can drive. Claim the oldest eligible ID in a short transaction and perform HTTP after commit. Space actual starts by at least 200 ms. Persist the latest global cooldown, return the affected ID to the oldest-due queue at expiry, and apply the two-retry policy with full jitter through the same dispatcher. | Verify first that a 429 for A blocks both a first poll for B and a retry for C. Then verify three transient failures produce three distinct poll IDs, and a stale completion cannot reschedule a removed and re-added ID. |
| 5. Delivery and snapshot integration | Wire the two change history service methods. Retain each terminal row until change history commits it. Retry delivery with the original ID and payload. A test double can exercise the tracking contract while the change history implementation is under development. | Simulate a lost acknowledgement. Verify tracking resends the same poll ID and payload, then deletes its pending row only after acknowledgement. Verify the competitor list shows the 24-hour change indicator. |
| 6. Lifecycle and runtime checks | On bootstrap reconcile unfinished attempts, restore the cooldown, then enable dispatch and delivery. Enable Nest shutdown hooks and stop new claims before draining in-flight work. Log poll IDs, outcome counts, and oldest-overdue age. | Restart during a cooldown and with a terminal row awaiting delivery. Verify the cooldown survives and the saved result reaches change history. Run the 6,000-ID fairness check with a simulated clock and a smoke test through the supplied listing server. |

Place a spec beside every service and controller, exercise persistence with PostgreSQL Testcontainers, and drive pacing tests with a controllable clock. The tracking milestone is one added ID, one real HTTP poll, and one saved outcome delivered and acknowledged through the change history interface. [Backend conventions](../../backend/rules.md)
