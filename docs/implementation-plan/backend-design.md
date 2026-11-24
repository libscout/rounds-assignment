# Proposed backend design

Use one NestJS application and one PostgreSQL database. Split the backend into four Nest modules. [Backend conventions](../../backend/rules.md)

| Module under `src/modules/` | Business question | Responsibilities |
| --- | --- | --- |
| `tracking/` | Which competitors are we watching, and who is due next? | Add, remove, and list tracked IDs. Own the schedule, durable poll log, and complete listing versions. Coordinate listing requests, enforce the shared source limit, and pass every outcome to change history. |
| `change-history/` | What did we observe, and what changed since the previous observation? | Own meaningful field and availability changes. Compare caller-supplied observations and baselines, persist diffs, initiate the AI explanation for each change, store its result, and expose saved changes for batch reads. |
| `competitor-timeline/` | What should the user see for this competitor? | Own the timeline endpoint and its response DTOs. Combine poll observations and change events through the two modules’ public services. |
| `summaries/` | Which changes can we explain within today's budget? | Accept a supplied diff from change history, reserve daily quota, call the injected AI service, and return the explanation or failure reason. Use an in-process mock that always returns `''` for this milestone. Own the shared daily call counter. |

## Dependencies and data flow

1. **Track.** The tracking controller accepts an ID and makes it due for polling. Removing it stops future polls and preserves history. To build the competitor list, tracking asks change history for the IDs with changes in the past 24 hours in one batch.
2. **Fetch.** A single polling dispatcher inside tracking selects overdue IDs oldest first. Pace request starts across all IDs and retries at up to five per second. Allow bounded concurrent requests so one slow listing does not stall all others. Keep at most one poll in flight per competitor. On a 429, pause new starts for the source's retry interval.
3. **Record.** The listing-source adapter returns the HTTP response data or transport failure. Tracking classifies it and retains each attempt. Change history accepts its own observation and baseline value types and writes each diff to its own table. Tracking acknowledges processing and links complete attempts to their versions. [Storage and handoff plan](../architecture/change-history.md)
4. **Explain.** Computing the diff includes generating its AI explanation. Change history commits the field diff and a pending summary together. Its worker claims the event, requests a budgeted explanation from the summaries service, and writes the text or failure status to the event. Tracking can acknowledge the poll as soon as the diff is durable.
5. **Read the timeline.** `CompetitorTimelineModule` imports `TrackingModule` and `ChangeHistoryModule`. Its controller delegates to a read service, which requests a newest-first page of processed attempts and observed listing fields from tracking, then requests change events for those poll IDs in one batch. This API module owns timeline visibility. It maps over the original attempts so unchanged, partial, and failed checks each retain their place. The response includes the summary when available or a reason such as “Request timed out” or “No change.” This module needs no tables of its own.

Tracking depends on change history. Change history calls the summaries service. `ChangeHistoryModule` can commit a change even when the summary worker is stopped. The change event itself is durable work, so this design needs no separate message broker.

The watchlist actions and polling handoff are detailed in the [tracking module scope](../architecture/tracking-module.md).

## Applying the repository rules

- **HTTP boundaries.** Tracking owns the three watchlist routes. `CompetitorTimelineModule` owns `GET /api/competitors/:id/snapshots`. Change history runs the explanation worker. Controllers validate request DTOs, delegate to services, and return explicit response DTOs with UTC timestamps.
- **Module boundaries.** Put public use cases in `services/`, table mappings in `entities/`, and private policies in `internal/`. Consumers inject exported services and exchange typed data. Each module accesses its own repositories. Use barrel exports in leaf folders only.
- **Integrations.** Put source HTTP handling in `external/listing-source/`. The AI service uses a local mock now. Place the later provider HTTP adapter in `external/llm/`. Decode provider responses in the adapters. Tracking owns the meaning of listing poll outcomes. Keep listing comparison in `change-history/internal/` and budget decisions in summaries. Use `tools/` for existing infrastructure and `lib/` for generic pure helpers.
- **Verification.** Pair each controller and service with a colocated spec. Exercise controllers with Supertest, and test persistence and quota races against PostgreSQL using Testcontainers. Cover the sequence from baseline through timeout to a genuine price change, and verify that an LLM failure leaves the change visible.
