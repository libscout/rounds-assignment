# CompetitorPulse implementation plan

- [Clarified business requirements](./business-requirements.md)
- [Technical requirements and limits](./technical-requirements.md)
- [Proposed backend design](./backend-design.md)
- [Backend transition to Drizzle](./drizzle.md)
- [Change history and durable poll log](../architecture/change-history.md)
- [Tracking database schema](../architecture/tracking-schema.md)
- [Tracking module implementation plan](../architecture/tracking.md)

Build one end-to-end flow first. A user adds a competitor, the scheduler fetches its listing, and the timeline shows the first observation. Then add change detection and summaries. [Assignment brief](../../assignment/instructions.md)

## Build order

1. **Tracking and storage.** Create the `watchlist`, `poll_attempts`, and `source_state` tables with a versioned Drizzle SQL migration. Implement the three watchlist endpoints in tracking. Accept an unknown ID for polling, record a missing listing when the source returns 404, and stop scheduling when the user removes the ID. Retain every poll in tracking for at least 90 days.
2. **Polling.** Fetch listings over HTTP from a configurable base URL. Schedule the oldest due competitor first, apply a request timeout, and pace all starts and retries through one shared limiter. Honor a 429 response’s `Retry-After` across all IDs. At five requests per second, 6,000 competitors take at least 20 minutes per pass. Document the expected delay when the configured interval is shorter.
3. **History and change detection.** Compose the timeline endpoint in `CompetitorHistoryModule` using public reads from tracking and change history. Write one `listing_changes` event per meaningful change with field-level before and after values. Compare complete listings with the last complete observation, normalizing whitespace, HTML entities, and price presentation while preserving currency and billing period. Record the first observation as a baseline. Keep failed and partial polls visible, and record disappearance and return as availability events. Reference an existing listing version when its contents are unchanged.
4. **Summaries.** Use the durable change event as the input for a pending summary. Have the change history worker call an injected, in-process AI mock with the change kind and the previous and current values. The mock always returns `''`. Wire the supplied HTTP mock server during full-system integration. Reserve one call against the shared 2,000-call UTC daily budget before every attempt. Record success, timeout, invalid output, failure, or exhausted quota so the timeline can explain each outcome.
5. **React and startup.** Build the competitor list with add, remove, and a last-24-hours change indicator. Build a paginated newest-first timeline with the observed fields, poll outcome, and summary state. From the repository root, `docker compose up` should apply migrations and start PostgreSQL, the backend, React, the listing source, and the mock LLM.

## Acceptance checks

- Poll a stable listing twice with formatting noise enabled. Both attempts appear in history and the mock receives zero summary calls.
- Advance to a meaningful price change. The list flags a recent change and the timeline shows the old and new observations. With the empty-string mock it explains why the summary is unavailable.
- Force a partial response, a timeout, and a 429. Verify each outcome is recorded, the last complete listing survives, and other IDs respect the shared cooldown.
- Force a summary failure, then exhaust a small test budget. Verify the poll survives both cases, the UI explains each missing summary, and the worker stays within the budget.
- Start from a clean database with Compose and follow the root README. Include service URL configuration, the capacity trade-off, retention, intentional omissions, and one actual decision where the author revised an AI suggestion.
