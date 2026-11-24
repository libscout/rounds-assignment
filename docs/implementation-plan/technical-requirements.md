# CompetitorPulse technical requirements and limits

## Production limits

| Constraint | What it means for the system |
| --- | --- |
| 6,000 competitors, each due every 15 minutes | The target requires about 6.67 listing requests per second. The polling interval must be configurable. |
| 5 listing requests per second across all competitors | Only 4,500 requests fit in 15 minutes. A full pass takes at least 20 minutes before retries. The scheduler must respect the shared limit, and the submission must explain how it handles overdue polls. |
| 2,000 LLM calls per day across all competitors | Call the LLM only for meaningful changes. When the budget runs out, preserve the snapshot and show why its summary is missing. |
| At least 90 days of visible history | Include successful, unchanged, and failed polls. At the requested 15-minute cadence, that would be 51.84 million poll records over 90 days. |

## Stack and startup

- **Frontend:** React with two API-backed views. The list supports adding and removing IDs and shows changes in the past 24 hours. The timeline shows one competitor’s polls newest first, including the fetch time, listing fields, and summary or reason it is missing.
- **Backend:** Node.js, Python, or Go, with disciplined typing. The brief prefers TypeScript and assumes one internal user without authentication.
- **Database:** Use a real database and an established migration tool. Database setup must take one command.
- **Local startup:** `docker compose up` must start the entire system, including the provided listing source and mock LLM. Reviewers must be able to substitute their own instances.

## Minimum API contract

| Method and path | Required behavior |
| --- | --- |
| `GET /api/competitors` | Return an array of tracked competitors, each with a string `id`. |
| `POST /api/competitors` | Accept a JSON object with a string `id`. Return `201 Created`. |
| `DELETE /api/competitors/:id` | Remove the competitor from tracking. Return `204 No Content`. |
| `GET /api/competitors/:id/snapshots` | Return a snapshot array, newest first. |

Each snapshot includes `fetchedAt` (ISO 8601), `title`, `tagline`, `price`, `description`, `changed`, and a nullable `summary`. Additional fields can explain a failed poll or a missing summary. [API contract](../../assignment/instructions.md#frontend-build-it)

## External services

- **Listing source.** Fetch every listing over HTTP from `GET /listings/:id` using a configurable base URL. The application must never import the source code or read its fixtures. A successful response can contain noise, formatting differences, or missing fields. Handle timeouts, non-JSON errors, and `429` responses with a shared `Retry-After` delay (in seconds). A `404` can mean an unknown ID or a temporary disappearance. The brief leaves the policy for new, unknown IDs to the implementer. [Source behavior](../../assignment/files/listing-source/README.md#endpoints)
- **LLM.** Use a hosted provider, a local model, or the supplied mock. Store each generated summary with its snapshot. A slow call, failed call, or unusable response must leave the poll result available. The mock echoes input and supports injected delays and failures for testing. [LLM requirements](../../assignment/instructions.md#step-4--ai-change-summary)

## Delivery

The brief estimates three hours and prioritizes persistence, scheduling, and LLM integration. Submit a GitHub repository with a README covering local startup, service configuration, design trade-offs, intentional omissions, and AI tool use, including one suggestion the author changed. Cloud deployment is optional. [Assignment deliverables](../../assignment/instructions.md#deliverables)
