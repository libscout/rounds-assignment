# CompetitorPulse

[Architecture and design decisions](./docs/architecture.md) · [UI](./docs/UI.md)

CompetitorPulse polls product listings, records changes to their content and availability, and asks an LLM to explain each change.

## Start locally with Docker Compose

Run the commands from the repository root, next to `compose.yaml`. Compose reads the root `.env`, and exported shell variables take precedence. On a fresh checkout, create the file from the [example](./.env.example).

```sh
test -f .env || cp .env.example .env
```

### Set the listing source and AI provider

The root example is ready to use with the bundled listing source at `http://listing-source:4002` and the mock LLM. For an existing Docker volume, keep the `DB_DATABASE` value used when it was initialized. For a host-run backend, use the [backend environment example](./backend/.env.example).

Choose one AI configuration in the same file.

- **Bundled mock LLM.** Leave `AI_API_KEY`, `AI_BASE_URL` and `AI_MODEL` commented out, as in the example file. Compose runs the mock locally and its summaries begin with “Mock AI summary”.
- **DeepSeek directly.** Set `AI_API_KEY` to a DeepSeek key and leave `AI_BASE_URL` and `AI_MODEL` commented out. The backend uses `deepseek-flash` at `https://api.deepseek.com`. If you set that URL explicitly and leave the key blank, the summary is marked `failed` and uses zero calls.
- **OpenRouter.** Set the three entries below to use DeepSeek Flash through OpenRouter. If the root `.env` already defines `OPENROUTER_API_KEY`, replace the existing `AI_API_KEY` assignment with `AI_API_KEY=${OPENROUTER_API_KEY}` and place it below the OpenRouter key.

```dotenv
AI_API_KEY=your-openrouter-api-key
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=deepseek/deepseek-v4.1-flash-1017
```

### Launch the stack

```sh
docker compose up -d --build
```

Add `acme-crm` to the watchlist to start its first poll. The frontend listens on port 5173, the API on 3000, the listing source on 4002, the mock LLM on 4001 and PostgreSQL on 5432. Compose creates the database volume on first use and the API applies its migrations at startup. [Open the watchlist](http://localhost:5173)

After saving the AI settings and the container-reachable listing URL in the root `.env`, recreate the backend to apply them. New summaries use the selected provider. Historical summaries keep their saved text.

```sh
docker compose up -d --no-deps backend
```

Use `docker compose down` to stop the stack and preserve its database volume.

On a competitor’s timeline, **Poll now** requests a fetch and refreshes the timeline when it finishes. A queued poll, an active fetch and a scheduled retry each count as unfinished work, so repeated requests follow the same poll. To observe a new mock version, click **Advance mock listing** and then **Poll now**.

On the watchlist, **Reset all** clears all tracked IDs, poll history, changes and AI summaries after confirmation. It returns the listing simulator to its first versions and restores both mock servers’ settings and counters. Calls already reserved for a live AI provider still count toward the current UTC day’s cap.

## Other configuration

| Setting | Behavior |
| --- | --- |
| `LISTING_SOURCE_URL` | To switch sources, set this to the new server’s base URL in the root `.env` and recreate the backend. For a source running on the Docker Desktop host, use `http://host.docker.internal:4002` with the port that source listens on. |
| `POLL_INTERVAL_MS` | Defaults to 900000. Set to 5000 for a faster local demonstration. |
| `POLL_TIMEOUT_MS` | Maximum duration of a listing request in milliseconds. Defaults to `10000`. |
| `POLL_CONCURRENCY` | Maximum number of simultaneous listing requests. Defaults to `8`. |
| `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` | For another Chat Completions-compatible provider, use its base URL, model ID and optional bearer token. The client appends `/chat/completions` to the base URL. |
| `DEMO_RESET_ENABLED` | Enables the destructive local reset control. Defaults to true in the local Compose stack and in development. |

For API details and test commands, see the [backend guide](./backend/README.md).

## AI assistance

I designed the architecture and used OpenAI Codex for planning, implementation, and tests. I revised the database schema Codex suggested to use fewer tables and keep the database layer simpler.

## Code formatting

Run `npm run format` from either `backend/` or `frontend/` to apply ESLint fixes and Prettier. To check the code without editing it, run `npm run lint` and `npm run format:check` in each directory.

Both apps use an 88-column wrapping target, braces around control flow, one variable per declaration, and blank lines between class members. Nest member decorators go on separate lines, and JSX attributes are formatted one per line when an element has multiple attributes.
