# CompetitorPulse frontend

[UI](../docs/UI.md)

React and TypeScript client for the competitor watchlist and poll timeline. Open `/` to manage tracked IDs or `/?competitor=acme-crm` to see its recorded changes. Select **All polls** to see every processed observation, including unchanged listings and source failures. Follow the [root startup guide](../README.md#start-everything) to run Vite alongside the API and its local dependencies.

## Local development

From `frontend/`, run:

```sh
nvm use
npm ci
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). Run the [Nest backend](../backend/README.md#local-development) when developing API-backed screens. In development, requests to `/api` go to `http://127.0.0.1:3000`. To use another backend, set `API_PROXY_TARGET` in `frontend/.env.local` and restart Vite. This setting belongs to the dev server.

### Development mock controls

Click **Advance mock listing** on a competitor timeline to send its ID to `POST /control/advance`. The button reports the resulting mock version. Reopen the timeline after the next scheduled poll to see the observation. [Mock server endpoints](../assignment/files/listing-source/README.md#endpoints)

The development proxy targets `http://127.0.0.1:4002` by default. Set `MOCK_SOURCE_TARGET` in `frontend/.env.local` if your local mock uses another port, and make sure Nest's `LISTING_SOURCE_URL` points to the same instance. The button is available with `npm run dev`.

## Verification

Run `npm run lint` for React and accessibility checks, `npm run typecheck` for strict TypeScript checks, and `npm run build` for a production build in `dist/`. Use `npm run preview` to serve the build locally. A production host must serve the static files and route `/api` to Nest.

Project conventions and upstream references are in [AGENTS.md](./AGENTS.md).
