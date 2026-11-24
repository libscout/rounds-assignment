# CompetitorPulse UI requirements

One internal user manages a watchlist, checks which competitors changed recently, and opens a competitor’s history to see what happened on each poll. [Assignment overview](../../assignment/instructions.md#how-the-system-works)

## Functional requirements

| View | What the user must be able to do |
| --- | --- |
| Competitor list | Add a competitor by ID, see the tracked IDs, and remove an ID from tracking. Identify which tracked competitors had a meaningful change within the last 24 hours. [Frontend brief](../../assignment/instructions.md#frontend-build-it) |
| Competitor timeline | Open one competitor’s history, newest poll first. Reach at least 90 days of retained polls, including unchanged and failed attempts. [Production context](../../assignment/instructions.md#additional-notes) |
| Timeline entry | See when the poll ran, the available title, tagline, price, and description, and whether a meaningful change was recorded. For a partial listing show the available fields. For a failed poll show the failure so the user can tell that the listing could not be checked. [Snapshot contract](../../assignment/instructions.md#frontend-build-it) |
| Change summary | Read the short plain-English summary when available. Otherwise, explain why it is absent. A slow AI call, failure, unusable answer, or exhausted daily allowance must leave the poll visible. [AI requirements](../../assignment/instructions.md#step-4--ai-change-summary) |

## Non-functional requirements and constraints

- **Technology and integration.** Build the two views in React and connect them to the application backend through the competitors and snapshots endpoints. The backend owns access to the external listing source. [Frontend integration](../../assignment/instructions.md#step-5--frontend) · [Data source](../../assignment/instructions.md#data-source-provided)
- **Deployment and access.** Support one internal user without authentication. Starting the whole system with `docker compose up` must also start the frontend. [Tracking requirements](../../assignment/instructions.md#step-1--tracking-apiui) · [Tech stack](../../assignment/instructions.md#additional-notes)
- **Presentation.** Plain, unstyled views are sufficient. The brief evaluates whether the information is present and understandable. The two reference images are linked in the brief but absent from the supplied archive, so this checklist uses its written requirements and snapshot contract. [Reference views](../../assignment/instructions.md#frontend-build-it)
- **Scale.** Design for a watchlist of 6,000 competitors. At the target cadence of one poll every 15 minutes, 90 days represents about 8,640 entries per competitor before retries. The cadence applies to backend collection. The brief leaves browser refresh frequency and interaction latency open. [Production context](../../assignment/instructions.md#additional-notes)

## Project decisions for the UI

- Accept an unfamiliar ID for tracking. A newly added competitor can have an empty timeline while awaiting its first poll. If the source later returns 404, show that the listing was unavailable on that poll. [Tracking plan](./README.md#build-order)
- Use the backend’s recent-change flag for the 24-hour indicator. A competitor can have an unchanged latest poll and still have changed earlier in the window. [Business requirements](./business-requirements.md)
- Load older polls using the API cursor. Keep already displayed entries when appending older results. [Timeline pagination](../architecture/competitor-timeline.md#page-boundary)
- Use the poll outcome and summary status together. For example, a listing fetch timeout means the listing could not be checked. An AI timeout on a detected price change means the price change is visible and its explanation is unavailable. The current empty-string AI mock exercises the unusable-summary case. [Timeline contract](../architecture/competitor-timeline.md#http-contract)
