# CompetitorPulse frontend

## [UI screenshots](../docs/UI.md)

See the watchlist, listing changes, and poll history.

## Run the full system

With Docker running, run this from the repository root.

```sh
docker compose up
```

Open the [watchlist](http://localhost:5173) and add `acme-crm`. Docker starts the UI, API, database, and mocks without an `.env` file or API key.

## Local development

To edit the React app with Vite, start the [backend development server](../backend/README.md#local-development). In a second terminal, run these commands from the repository root.

```sh
cd frontend
nvm install
npm ci
npm run dev
```

Open the URL Vite prints. It forwards `/api` to `http://127.0.0.1:3000` and **Advance mock listing** to the source on port `4002`. To use different addresses, set `API_PROXY_TARGET` or `MOCK_SOURCE_TARGET` in `frontend/.env.local` and restart Vite.

## Checks

From `frontend/`, run `npm run lint` and `npm run build`. The build checks TypeScript and writes the production files to `dist/`.
