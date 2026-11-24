# Competitor timeline API

`CompetitorTimelineModule` answers “What happened each time we checked this competitor?” Tracking supplies one row per processed poll. Change history supplies a diff and summary state for polls that revealed a meaningful change. Joining them by poll ID gives the UI a timeline that also includes unchanged listings, incomplete observations, and failures. [Assignment contract](../../assignment/instructions.md#frontend-build-it)

## HTTP contract

`GET /api/competitors/:id/snapshots?limit=50&cursor=…` returns `200` with a JSON array, newest first. A valid ID with no processed polls returns `[]`. Removing an ID from the watchlist stops scheduling and preserves access to its retained history. Pages can reach the full retained history, including at least the required 90 days.

`GET /api/competitors/:id/changes` uses the same response shape and returns only recorded changes from processed polls. The Changes view uses this route. All polls uses the snapshots route.

Example response for a price change processed with the current AI mock follows.

```json
[
  {
    "pollId": "a439191c-7816-44fd-ae91-dda03eb0b058",
    "fetchedAt": "2026-09-10T12:00:00.000Z",
    "title": "Acme CRM",
    "tagline": "Simple CRM for small teams",
    "price": "$29/mo",
    "description": "Track leads and deals in one place.",
    "outcomeKind": "complete",
    "changed": true,
    "changeKind": "content_changed",
    "changedFields": { "price": { "from": "$39/mo", "to": "$29/mo" } },
    "summary": null,
    "summaryStatus": "invalid_output"
  }
]
```

- `pollId` identifies a timeline entry even when two polls share a timestamp. `fetchedAt` is the attempt’s finish time in UTC, including the recorded finish time of an interrupted attempt.
- `outcomeKind` uses tracking’s existing enum. For a complete poll, return the four display values from its referenced listing version. Equivalent observations can share a version and its display formatting. For a partial poll, return only the values observed on that attempt and serialize absent fields as `null`. For a missing listing or failed poll, return all four fields as `null`.
- `changed` means that change history recorded an event for this poll. With an event, return its `changeKind` and `changedFields`. An availability change can have an empty diff. Without an event, return `false`, `null`, and `{}` respectively. A failed poll with `changed: false` means no change was recorded. The listing’s actual state is unknown.
- With an event, expose its saved `summaryStatus` from the following values — `pending`, `ready`, `timeout`, `invalid_output`, `failed`, or `budget_exhausted`. Only `ready` carries summary text. Without an event, return `summary: null` and the API-only status `not_applicable`. The UI can use `outcomeKind` to display “No change recorded” for a baseline or equivalent complete poll, “Incomplete listing” for a partial poll, “Listing unavailable” for a missing listing, or the specific poll failure. A disappearance with a pending summary therefore displays differently from a repeated 404. A poll timeout appears in `outcomeKind`. An AI timeout appears in `summaryStatus`.

## Page boundary

Use an optional integer `limit` from 1 through 100, default 50. When an older page exists, send the last returned poll ID in the `X-Next-Cursor` response header. Omit the header on the final page. This preserves the assignment’s bare array body. The React client follows the cursor when the user requests older polls.

Pass that UUID as `?cursor=<pollId>`. Tracking looks up the processed poll for the requested competitor and uses its exact PostgreSQL `(finished_at, id)` position. The page query includes the cursor row to distinguish a valid end of history from an invalid cursor, then discards that row. Order both columns descending and use one lookahead row to detect an older page. Return `400` for a malformed UUID, an unknown or unprocessed poll, a cursor belonging to another competitor, or an invalid limit.

The changes route accepts a cursor from the same competitor’s visible changes and orders events by `(observed_at, poll_id)`. Each page is selected from changes before applying the limit.

## Nest module responsibilities

| Component | Responsibility |
| --- | --- |
| `CompetitorTimelineController` | Own both timeline routes, validate path and query DTOs, set the pagination header, and serialize an array of explicit snapshot DTOs. Keep each DTO in its own file and expose nested field diffs under the global serializer. |
| `CompetitorTimelineService` | Ask tracking for one page, call `ChangeHistoryService.byPollIds(ids)` once for that page, index the events by poll ID, and assemble the DTOs in tracking’s order. An empty page skips the event lookup. Propagate a lookup failure so an unavailable change store cannot turn changes into apparent unchanged polls. |
| `ChangeFeedRepository` in competitor timeline | Read change events with their processed polls and listing versions so the service can return a page of changes. |
| Public `PollObservationsService` in tracking | Return processed polls for one competitor with their observed fields and page boundary. Use tracking’s `ListingHistoryRepository` for the Drizzle query. Export the service from `TrackingModule`. |
| Existing `ChangeHistoryService` | Return saved diffs and current summary states by poll ID using its existing public read method. |

Register `CompetitorTimelineModule` in `AppModule` and import `TrackingModule` and `ChangeHistoryModule` into it. Its controller, service, and read-only repository are private to the module. The three watchlist endpoints stay in tracking. [Backend boundaries](../implementation-plan/backend-design.md)

## Visibility and storage

Tracking reads `poll_attempts` for the requested competitor with `processed_at IS NOT NULL`, ordered by `finished_at DESC, id DESC`. A left join on `listing_versions.id = poll_attempts.version_id` supplies complete listing fields and preserves rows without a version. Use the existing partial index `poll_attempts_timeline_idx`. The query does not depend on watchlist membership or legacy snapshot rows. [Tracking schema](../../backend/src/modules/tracking/entities/poll-attempts.table.ts)

A poll becomes visible after tracking acknowledges delivery. At that point the diff decision is durable and the listing fields have been finalized. A delivery retry cannot expose a premature unchanged row or a duplicate. A changed row can appear with a pending summary as soon as tracking acknowledges delivery. A later read can show the AI result. Each retry that actually contacted the source is its own poll. [Delivery worker](../../backend/src/modules/tracking/internal/snapshot-delivery.worker.ts) · [Change history](./change-history.md)

## Implementation and acceptance

1. Add the tracking read service and repository query. Exercise it on PostgreSQL with complete, partial, missing, interrupted, and failed attempts, a removed competitor, and a retained row at least 90 days old. Include migrated rows whose attempt number or creation time is null.
2. Implement composition using the two public services. Test a baseline, unchanged poll, multi-field change, initial and repeated 404s, disappearance, and return. Verify one output per processed poll, one batched change lookup, and correct ordering even when events arrive in a different order.
3. Add the HTTP controller, DTOs, and module wiring. Test the real validation and serialization pipeline with Supertest. Check null fields, false booleans, nested before/after values, every summary state, and the array body and cursor header.
4. Exercise pagination across tied timestamps and timestamps less than one millisecond apart. Insert a newer poll between page requests and check for gaps or duplicates among the previously visible rows. Simulate a lost delivery acknowledgement and verify visibility only after recovery. Read the same completed change before and after summary resolution and verify its poll ID and position stay stable.
