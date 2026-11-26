# CompetitorPulse backend

## [Architecture and design decisions](../docs/architecture.md)

See how the API coordinates source polling, change detection, and AI summaries.

## Run the full system

With Docker running, run this from the repository root.

```sh
docker compose up
```

Open the [watchlist](http://localhost:5173) or the [competitors API](http://localhost:3000/api/competitors). Docker starts all five services without an `.env` file or API key.

## Local development

To edit NestJS with automatic reload, use this workflow with Docker and nvm installed. Start in the repository root.

```sh
cd backend
nvm install
npm ci
cp -n .env.example .env
npm run docker:up
npm run start:dev
```

Here, Docker runs PostgreSQL and the two mock services. Nest runs on your machine, reads `backend/.env`, and applies migrations at startup. Stop Nest with Ctrl+C and its dependencies with `npm run docker:down`.

### Set the listing source and AI provider

The local defaults use the listing source on port `4002` and the mock LLM on port `4001`. For a different source, set `LISTING_SOURCE_URL` in `backend/.env`. Restart Nest after changing settings. [Environment example](./.env.example)

| Provider | Settings |
| --- | --- |
| Bundled mock | Leave the AI settings unset. |
| DeepSeek | Set only `AI_API_KEY` to your DeepSeek key. |
| OpenRouter | Set `AI_BASE_URL=https://openrouter.ai/api/v1`, `AI_MODEL=deepseek/deepseek-v4.1-flash-1017`, and your OpenRouter `AI_API_KEY`. |
| Other Chat Completions providers | Set `AI_BASE_URL`, `AI_MODEL`, and an `AI_API_KEY` if required. |

## Checks

From `backend/`, run `npm run lint` and `npm run build`. With Docker running, use `npm test` for backend tests and `npm run test:e2e` for the public API scenarios. [End-to-end guide](./test/e2e/README.md)

[Configuration defaults](./src/tools/config/config.schema.ts) · [AI assistance](../README.md#ai-assistance)
