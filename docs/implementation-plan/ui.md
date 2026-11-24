# React UI implementation plan

Build the watchlist first so a user can start tracking a competitor. Then build its timeline so the user can see the first poll, subsequent changes, and failed checks. Use the existing React, TypeScript, and Vite scaffold. [UI requirements](./ui-requirements.md) · [Frontend conventions](../../frontend/AGENTS.md)

## 1. Connect the watchlist to Nest

- Put the watchlist view and its typed API functions in `frontend/src/features/watchlist/`. Keep the timeline in a sibling `timeline/` folder. Let `App.tsx` select the view from the URL. Use native links to `/` and `/?competitor=<id>` so reload, sharing, and browser Back work with the existing static entry point. Build query strings with `URLSearchParams` and encode IDs used in API path segments.
- Fetch `GET /api/competitors` once per list load. It returns an array of `{ id, changedInLast24h }`. Render each ID as a timeline link. Use the flag to display “Changed in the last 24 hours”. This keeps the list to one request even with 6,000 tracked IDs.
- Add a labelled ID input and an **Add competitor** button. Trim whitespace, preserve case, and send `POST /api/competitors` with `{ id }`. Accept unfamiliar IDs. Give each row a **Remove** button that sends `DELETE /api/competitors/:id` and handles the empty 204 response.
- After a successful mutation, reload the list so membership and change indicators reflect the server. Prevent repeat submission while the action is pending. Keep the input or existing row on mutation failure. If the mutation succeeds but the reload fails, offer to retry the list read. Show separate loading, empty-watchlist, and request-error states. [Watchlist controller](../../backend/src/modules/tracking/controllers/competitors.controller.ts)

## 2. Build the timeline and load older polls

- Open a competitor’s timeline directly by ID. Default to **Changes**, backed by `GET /api/competitors/:id/changes`. Show event titles and the before and after values for changed fields. Display a disappearance with HTTP 404, a return as an availability transition, and full observed fields in an expandable section. Show summary text only when ready and nonblank. With an empty change feed, use poll history to explain whether tracking is waiting for a first check, has a baseline, found a match, received a 404, or could not complete the check. Show the last check time and a link to **All polls**.
- Open **All polls** via `/?competitor=<id>&view=polls`. Show the ID, a link back to the watchlist, and an ordered list of polls. Fetch `GET /api/competitors/:id/snapshots`. The body is a newest-first array with a default page size of 50. An empty array on the first page means “No polls recorded yet”.
- Key entries by `pollId` and preserve server order. When the response includes `X-Next-Cursor`, show **Load older changes** or **Load older polls** for the active view. Pass that value as `?cursor=…` and append the returned page. Disable the action during the request. On failure, keep the entries and cursor so the user can retry. An absent header marks the end.
- Start at the newest page whenever a timeline opens. When switching competitors, reset pagination and cancel or ignore the previous request. [Timeline API](../architecture/competitor-timeline.md#page-boundary)

## 3. Make each poll understandable

Group polls by UTC date and show each check’s time, outcome, and summary state. Show the latest observed fields together and let users expand earlier complete listings. For a partial result, list the omitted fields once. For a missing listing, show “Listing unavailable” and an HTTP 404 badge. Failed checks show their reason without an empty listing form. Render source text and AI output as plain text through JSX. [Snapshot contract](../architecture/competitor-timeline.md#http-contract)

| Response field | Rendering decision |
| --- | --- |
| `outcomeKind` | Identify a complete or partial observation, a missing listing, or the specific failed check. Give rate limiting, source error, timeout, connection failure, invalid response, and interruption readable labels. |
| `changed` and `changeKind` | For a recorded change, identify a listing edit, disappearance, or return. Show supplied before/after values for changed fields. For a complete poll with no event, use “No change recorded”, which also covers the first observation. For an unsuccessful check, show why the listing could not be assessed. |
| `summaryStatus` and `summary` | Show an AI status badge for each poll. Render summary text only for `ready` with a nonblank summary. All other states display the badge alone. |

## 4. Integrate and verify

- Use the existing Vite `/api` proxy during development. Run Vite and Nest locally and start PostgreSQL and the supplied mocks with the backend Compose file. [Frontend setup](../../frontend/README.md) · [Full-system startup](../../README.md#start-everything)
- Run `npm run lint` and `npm run build` from `frontend/`. From a clean local startup, add an ID and open its empty timeline. Reopen it after the first poll and verify the entry. Remove the ID and check that its history is still accessible via its URL. Exercise the flow using the keyboard.
- Verify a changed poll followed by an unchanged poll. Both should appear, and the watchlist should still flag the competitor within the 24-hour window. Verify a partial listing, a disappearance and return, a failed fetch, and a changed poll with an unusable summary. The current empty-string AI mock exercises the last case.
- Use controlled API responses for pending, ready, failed, timed-out, and budget-exhausted summaries. Check that a timeline request failure offers a retry, while a recorded poll failure appears as an entry. Exercise two pages, an older-page retry, and a switch between competitors during a slow request. Verify that paging can reach a retained poll at least 90 days old.
