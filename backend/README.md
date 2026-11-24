# For project rules and conventions see:

[`rules.md`](./rules.md)

---

# CompetitorPulse backend

The NestJS backend uses Drizzle ORM with PostgreSQL. The initial migration creates the tracking tables and seeds the shared source cooldown.

## Request Context & Logging

The application keeps request-specific context using `AsyncLocalStorage`.

For every incoming HTTP request, `ContextInterceptor` creates a request context containing:

```ts
{
  requestID: string;
  userID?: string;
}
```

The `requestID` is read from the `x-request-id` header. If the header is missing, a new UUID is generated. The same `requestID` is also added to the response headers as `x-request-id`.

The `userID` is read from the optional `x-user-id` header when the request is performed on behalf of an authenticated user.

`ContextService` stores this context for the lifetime of the request. Any service executed inside the same async request flow can access the current request context without passing `requestID` or `userID` manually through method arguments.

The logger uses this context automatically. Every log written during a request includes the current `requestID`, and includes `userID` when available.

Example log:

```ts
interface LogEntry {
  timestamp: string; // ISO
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  service: string; // service name

  requestID?: string;
  userID?: string;

  body: unknown[];

  err?: {
    message: string;
    stack?: string;
  };
}
```

```json
{
  "level": "info",
  "time": "2026-05-15T10:31:19.000Z",
  "service": "users-service",
  "requestID": "req_123",
  "userID": "user_456",
  "body": ["User created"]
}
```

Logs written outside an HTTP request, for example during application startup or background jobs, are still valid but will not include `requestID` or `userID`.

In local/development environments, logs are printed in a pretty human-readable format. In production/cloud environments, logs are printed as structured JSON.

---

## Watchlist and poll history

Run one backend instance per source. It schedules the oldest due competitor first, spaces starts at least 200 ms apart and allows slow requests to overlap. At this rate, checking 6,000 IDs takes at least 20 minutes. A 429 pauses every new request until the shared deadline. A 404 records a missing listing and tracking continues.

| Endpoint | Result |
| --- | --- |
| `POST /api/competitors` with `{"id":"acme-crm"}` | Adds or reactivates the ID and returns 201. |
| `GET /api/competitors` | Active IDs with their `changedInLast24h` flags. |
| `DELETE /api/competitors/:id` | Stops polling that ID and returns 204. Its timeline remains available. |
| `GET /api/competitors/:id/changes` | Newest-first array of recorded changes. Each page contains only changes from processed polls. |
| `GET /api/competitors/:id/snapshots` | Newest-first array of processed polls with observed fields, changes, and summary states. |

Use `?limit=50` (1–100, default 50). When the response includes `X-Next-Cursor`, pass that poll ID as `?cursor=<pollId>` to read the next page. A competitor with no processed polls returns `[]`. [Timeline contract](../docs/architecture/competitor-timeline.md)

Tracking keeps every poll in `poll_attempts`, including failures and partial listings. Complete polls reference `listing_versions`. Change history compares the observation with the supplied baseline and stores one `listing_changes` event per meaningful content or availability change. The summary worker calls the in-process AI mock, which always returns an empty string. A change therefore keeps its field diff with a null summary and `invalid_output` status. The shared UTC budget permits 2,000 AI calls per day.

When upgrading an existing database, stop the previous backend before starting the new one. The migration merges outstanding polls with archived snapshots by poll ID. Startup reconstructs legacy changes before polling resumes and retains the original snapshot table for verification.

# Local development

Follow the [root setup guide](../README.md#first-time-setup) to install dependencies and configure `.env`. From `backend/`, run:

```sh
npm run docker:up
npm run start:dev
```

Compose starts PostgreSQL and both supplied mock servers. Nest waits for its database connection and applies committed migrations on startup. Use `DB_*`, `LISTING_SOURCE_URL`, and the polling settings in `.env` to configure local connections and scheduling.

## Schema changes

Define tables in `src/modules/<domain>/entities/*.table.ts`. Generate a migration, review the SQL, and commit the entire `src/tools/db/migrations/` directory including metadata.

```bash
npm run migration:generate -- --name=describe_change
npm run migration:run
```

Use a new corrective migration for a deployed schema change. The initial tracking migration adds its own tables and leaves any pre-existing boilerplate tables in place.

## Verification

```bash
npm run build
npm test -- --runInBand
```

The tests use Docker to provision an isolated PostgreSQL instance. The build copies migrations into `dist/tools/db/migrations/`. Run `npm run start:prod` from the backend directory after building.

### End-to-end API test

With Docker running, the pinned Node version active, and the assignment extracted, run `npm --prefix backend run test:e2e` from the repository root. The [test setup and full flow](./test/e2e/README.md) describe how the suite drives the supplied listing server over HTTP.
