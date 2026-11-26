# CompetitorPulse

## Documentation

- [UI screenshots](./docs/UI.md) — Watchlist, Changes, and All polls.
- [Architecture and design decisions](./docs/architecture.md) — how the poll orchestrator works and why it uses PostgreSQL instead of a message queue.

## Start locally with Docker Compose

With Docker running, start CompetitorPulse from the repository root.

```sh
docker compose up
```

The demo uses the bundled listing source and mock LLM. It runs without an API key or `.env` file.

1. Open the [watchlist](http://localhost:5173) and add `acme-crm`.
2. Select `acme-crm` and wait for the first listing to appear under **All polls**.
3. Click **Advance mock listing**, then **Poll now**. Open **Changes** to see the diff and summary.

### Set the listing source and AI provider

To override the defaults, copy [.env.example](./.env.example) to `.env` in the repository root.

| To use | Set in `.env` |
| --- | --- |
| Another listing source | `LISTING_SOURCE_URL` to a base URL the backend container can reach. |
| DeepSeek directly | `AI_API_KEY` to your DeepSeek key. |
| OpenRouter or another Chat Completions provider | `AI_BASE_URL`, `AI_MODEL`, and the provider’s `AI_API_KEY` if required. |

Apply changes with `docker compose up -d --no-deps backend`. [Provider examples](./backend/README.md#set-the-listing-source-and-ai-provider)

## AI assistance

I designed the architecture and used OpenAI Codex for planning, implementation, and tests. I revised the database schema Codex suggested to use fewer tables and keep the database layer simpler.

## Code formatting

Run `npm run format` in `backend/` or `frontend/`. For local development and tests, see the [backend guide](./backend/README.md) and [frontend guide](./frontend/README.md).
