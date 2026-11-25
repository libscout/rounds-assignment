# CompetitorPulse

CompetitorPulse polls product listings, records changes to their content and availability, and asks an LLM to explain each change. The watchlist and timeline use a NestJS API backed by PostgreSQL.

## Start locally

With Docker running, start the stack from the repository root. The repository includes the listing source, its sample listings, and the mock LLM.

```sh
docker compose up --build
```

Open [the watchlist](http://localhost:5173) and add `acme-crm`. The API listens on port 3000. Compose also starts the listing source on port 4002, the mock LLM on port 4001 and PostgreSQL on port 5432. The API applies the Drizzle migration at startup. Use an empty database for this assessment schema. `docker compose down` stops the stack and preserves its volume.

## Configure the external services

Compose reads configuration from the shell or a repository-root `.env`. When running Nest on the host, use `backend/.env`. If your DeepSeek key is already in `backend/.env`, the following command also uses it for Compose and routes listing requests to the supplied container.

```sh
LISTING_SOURCE_URL=http://listing-source:4002 docker compose --env-file backend/.env up --build
```

| Setting | Behavior |
| --- | --- |
| `LISTING_SOURCE_URL` | Base URL for the source. Compose defaults to `http://listing-source:4002`. Choose a URL reachable from the backend container when substituting another server. |
| `POLL_INTERVAL_MS` | Defaults to 900000. Set to 5000 for a faster local demonstration. |
| `DEEPSEEK_API_KEY` | Selects hosted DeepSeek summaries with model `deepseek-flash` when present. With no key, the backend uses the supplied HTTP mock. |
| `AI_BASE_URL` | Overrides the provider destination. Use `http://mock-llm:4001/v1` in Compose or `http://localhost:4001/v1` on the host to force the mock. The mock echoes the change data. |
| `AI_MODEL` | Overrides the provider's default model. |

See the [backend guide](./backend/README.md) and [frontend guide](./frontend/README.md) for individual commands and configuration.
