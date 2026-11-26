# CompetitorPulse backend

[Architecture and design decisions](../docs/architecture.md)

The NestJS API manages the watchlist and serves each competitor’s poll history and AI summaries. This guide runs Nest on your machine with PostgreSQL and the two mock services in Docker. To run the entire application in Docker, follow the [root startup guide](../README.md#start-locally-with-docker-compose).

## Local development

With Docker running and nvm installed, start in the repository root.

```sh
cd backend
nvm install
npm ci
test -f .env || cp .env.example .env
```

### Set the listing source and AI provider

The [backend environment example](./.env.example) points Nest at the bundled listing source on `http://localhost:4002`. To use a different source, set `LISTING_SOURCE_URL` in `backend/.env`. Restart Nest after editing the file. Exported shell variables take precedence.

- **Bundled mock LLM.** Leave `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL` unset. The mock listens on `http://localhost:4001/v1`.
- **DeepSeek.** Set only `AI_API_KEY` to your DeepSeek key. Nest uses `deepseek-flash` at `https://api.deepseek.com`.
- **OpenRouter.** Set `AI_BASE_URL=https://openrouter.ai/api/v1`, `AI_MODEL=deepseek/deepseek-v4.1-flash-1017`, and `AI_API_KEY` to your OpenRouter key.
- **Other Chat Completions providers.** Set the base URL, model ID, and any required bearer token. Nest appends `/chat/completions` to the base URL.

### Launch the backend

Run from `backend/`.

```sh
npm run docker:up
npm run start:dev
```

Nest applies database migrations on startup. A fresh database returns `[]` from the watchlist endpoint. [Open the watchlist API](http://localhost:3000/api/competitors)

Stop Nest with Ctrl+C. Run `npm run docker:down` to stop the supporting services and keep the database volume.

## Other configuration

| Setting | Local behavior |
| --- | --- |
| `POLL_INTERVAL_MS` | Time between scheduled polls for one competitor. Defaults to `900000` (15 minutes). Use `5000` for a faster demo. |
| `POLL_TIMEOUT_MS`, `POLL_CONCURRENCY` | A fetch times out after `10000` ms by default. Up to `8` fetches can run at once. |
| `ORCHESTRATOR_INTERVAL_MS` | Target interval between passes that process finished polls. Defaults to `5000`. |
| `DEMO_RESET_ENABLED` | Enables the local reset endpoint. Defaults to `true` in development. |
| `MOCK_SOURCE_TARGET`, `MOCK_LLM_TARGET` | Mock server addresses for demo resets. Default to `http://localhost:4002` and `http://localhost:4001`, respectively. |
| `LOG_LEVEL` | Overrides the logging level. Defaults to `debug` when `IS_LOCAL_ENV=true` and `info` otherwise. |

## Tests

With Docker running, run `npm test` and `npm run test:e2e` from `backend/`. The end-to-end suite uses an isolated database and the bundled HTTP mocks to exercise the public API. [End-to-end API guide](./test/e2e/README.md)

## AI assistance

I designed the architecture and used OpenAI Codex for planning, implementation, and tests. I revised the database schema Codex suggested to use fewer tables and keep the database layer simpler.

## Code formatting

From `backend/`, run `npm run format` to apply ESLint fixes and Prettier. Run `npm run lint` and `npm run format:check` to check the code. [Project formatting conventions](../README.md#code-formatting)
