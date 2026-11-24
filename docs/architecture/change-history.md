# Change history implementation plan

Change history takes an observation, compares it with the supplied baseline, and saves one event in `listing_changes` if it finds a meaningful change. It owns the AI call that turns that diff into a short explanation and saves the explanation on the event. For `$39 → $39 → timeout → $29`, it saves one price-change event. [Business requirements](../implementation-plan/business-requirements.md)

## AI service for this milestone

The injected AI mock always returns the empty string (`''`) for every input. Change history treats the empty result as `invalid_output`, keeps `summary` null, and preserves the saved diff.

## Change history table

| Column | PostgreSQL definition | Purpose |
| --- | --- | --- |
| `poll_id` | `uuid PRIMARY KEY` | Identifies the poll that revealed the change. Multiple fields changing in that poll produce one event. |
| `competitor_id` | `text NOT NULL` | Lets the feed select one competitor directly. Use the competitor ID supplied with the observation. |
| `observed_at` | `timestamptz NOT NULL` | Use the observation time supplied by the caller. Delivery retries must preserve the original observation time. |
| `kind` | `listing_change_kind NOT NULL` | Use the enum values `content_changed`, `disappeared`, and `returned`. |
| `changed_fields` | `jsonb NOT NULL` | Store the display values before and after each changed field. Use an empty object for an availability-only event. |
| `summary` | `text NULL` | The accepted explanation from the configured AI service. |
| `summary_status` | `summary_status NOT NULL DEFAULT 'pending'` | Use `pending`, `ready`, `timeout`, `invalid_output`, `failed`, or `budget_exhausted`. Only ready events have summary text. |
| `claim_token`, `claim_expires_at` | `uuid NULL`, `timestamptz NULL` | Allow the worker to recover a pending explanation after a restart and reject late writes from an expired claim. |

For example, a single `content_changed` event can carry both a price change and a new tagline:

```json
{
  "price": { "from": "$39/mo", "to": "$29/mo" },
  "tagline": { "from": "CRM for small teams", "to": "CRM for agencies" }
}
```

Allow only `title`, `tagline`, `price`, and `description` as field keys, each with string `from` and `to` values. Compare normalized values and store readable source values for display. Enforce an object payload in PostgreSQL, a nonempty object for `content_changed`, and an empty object for `disappeared`. A `returned` event may carry field changes observed on return. Index `(competitor_id, observed_at DESC, poll_id DESC)` for stable newest-first reads. The feed can render each event directly from this table.

## Input to change history

The caller supplies one observation with an opaque poll ID, competitor ID, observation time, current listing outcome and comparison baseline. The baseline contains the last complete listing fields, if available, and the last known availability. The caller translates its data into this module’s value types and supplies the same input on replay. The service can calculate the diff entirely from these values.

## Decide which event to record

| Observation | Change history result |
| --- | --- |
| First complete listing, including after an unknown ID initially returned 404 | Return an empty diff. |
| Complete listing while visible | Compare the four fields after whitespace, HTML, and price normalization. Any remaining difference, including a wording-only edit, produces one `content_changed` event listing all changed fields. An exact match after normalization yields an empty diff. |
| 404 after a visible listing | Emit `disappeared` once. Initial and repeated 404s yield an empty diff. |
| Complete listing after a recorded disappearance | Emit one `returned` event. Include any field differences from the last visible version in that same row. |
| Partial response, timeout, 429, upstream failure, invalid response, or interrupted attempt | Return an empty diff. |

## Implementation order

1. Define the observation input, change-kind enum and field diff in the module’s own types. Define the Drizzle table and migration for `listing_changes`. Its identifiers are scalar values supplied by the caller.
2. Extend the comparison to produce field-level before and after values and availability events. Return the calculated event or an empty result.
3. Save each event with its original observation time. Use the poll ID as the unique key so replaying identical input produces one stored row. A database failure must propagate to the caller so it can retry.
4. Generate the explanation as part of the diff workflow. Commit a new change with its summary pending. A worker inside change history claims that row and calls the budgeted AI service with the change kind and field pairs. Pass listing text as quoted data. Use a bounded request deadline and validate that the response contains usable summary text. Save the explanation or failure status by poll ID and claim token. A baseline, equivalent listing, repeated absence or failed poll yields zero AI calls. Replaying an observation preserves its existing summary state.
5. Enforce the shared cap of 2,000 calls per UTC day by reserving one slot atomically before each AI invocation, including the local mock. A worker recovering an expired claim reserves another slot if it calls again. A crash after a call but before saving its response can cause a second invocation. Only the worker holding the current claim token may save the result. At the cap, save `budget_exhausted`. Keep the diff on every AI outcome and release the database transaction before network I/O. [Assignment AI requirements](../../assignment/instructions.md#step-4--ai-change-summary)
6. Expose saved events by poll ID in batches and support the recent-changes lookup. The consuming API module decides when and how to present each result. [Backend module boundaries](../implementation-plan/backend-design.md)

## Acceptance checks

- Run the module’s persistence tests against PostgreSQL with only its own schema and caller-supplied observations.
- Change “CRM for small teams” to “Small-team CRM”. Expect one event containing the two tagline values. Equivalent formatting yields an empty diff.
- Compare a new price and tagline with a supplied baseline. Expect one event containing both field differences. A partial or failed observation yields an empty diff.
- Cover initial and repeated 404s, disappearance after a visible listing, and return with a different price. Assert the exact event kind and fields for each input.
- Deliver an identical observation twice, including after a lost acknowledgement. Verify a single event with the original observation time.
- With the in-process AI mock, verify one call returning an empty string for a poll with two changed fields, zero calls on a baseline or unchanged poll, and no fresh call on redelivery of a completed event. Assert that the empty result produces `invalid_output` and a null summary. Use separate test doubles for a timeout and a rejected call. Verify the field diff survives in every case. With one quota slot remaining, process two changes concurrently and verify only one reaches the mock and the other gets `budget_exhausted`.

The durable poll log and migration of historical attempts have their own tracking plan. [Tracking schema](./tracking-schema.md#planned-durable-poll-log)
