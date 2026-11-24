# CompetitorPulse

Nest and Vite run locally in watch mode. PostgreSQL and the two supplied mock servers run through [backend/docker-compose.yml](./backend/docker-compose.yml).

## First-time setup

Start Docker and extract the supplied archive into `assignment/` so that `assignment/files/listing-source/` and `assignment/files/mock-llm/` exist. From the repository root, select the pinned Node version with nvm, install both apps, and create the backend configuration.

```sh
nvm install "$(cat backend/.nvmrc)"
npm --prefix backend ci
npm --prefix frontend ci
test -f backend/.env || cp backend/.env.example backend/.env
```

## Start everything

Run this command from the repository root with the pinned Node version active:

```sh
npm --prefix backend run docker:up && npx --yes concurrently@9.2.1 --kill-others --names api,ui "npm --prefix backend run start:dev" "npm --prefix frontend run dev"
```

Compose waits for PostgreSQL. Nest applies migrations on startup, and Vite proxies `/api` requests to Nest. The first invocation of `npx` downloads the process runner. To use separate terminals, run each of the two quoted npm commands after starting the infrastructure.

Open [the watchlist](http://localhost:5173), add `acme-crm`, and follow its link to the poll timeline. Vite prints the browser URL if the default port is occupied.

| Service | Default local address |
| --- | --- |
| React frontend | `http://localhost:5173` |
| Nest API | `http://localhost:3000/api/competitors` |
| PostgreSQL | `localhost:5432`, credentials and database in `backend/.env` |
| Listing source | `http://localhost:4002/health` |
| Mock LLM | `POST http://localhost:4001/v1/chat/completions` |

Set `LISTING_SOURCE_URL` in `backend/.env` to use another listing source. For quicker local testing, set `POLL_INTERVAL_MS=5000` there. The supplied HTTP mock LLM starts with the infrastructure. The summary worker currently uses its in-process empty-string mock, so the timeline displays field changes and explains the unusable summary.

## Stop

Press Ctrl+C to stop Nest and Vite. Stop the infrastructure with the following command. PostgreSQL keeps its data in a named volume.

```sh
npm --prefix backend run docker:down
```

This local development setup departs from the assignment’s full-system Compose startup requirement. [Assignment brief](./assignment/instructions.md#additional-notes)

See the [backend guide](./backend/README.md) and [frontend guide](./frontend/README.md) for individual commands and configuration.
