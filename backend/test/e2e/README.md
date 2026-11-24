# Backend API E2E flow

With Docker running, backend dependencies installed, and the assignment extracted under `assignment/`, run `npm --prefix backend run test:e2e` from the repository root. Each run starts Nest, a fresh PostgreSQL database, and an isolated instance of the supplied listing server on temporary ports. [Test stack](./stack.mjs)

Nest polls `GET /listings/:id` over HTTP. The test freezes automatic version changes with `POST /control/configure`, advances the listing with `POST /control/advance`, and reads request counts from `GET /control/stats`. Noise and formatting variations stay enabled. [Supplied server controls](../../../assignment/files/listing-source/README.md#control-endpoints)

The scenario follows `ferry-pay` through its supplied history. [Executable test](./competitors.test.mjs)

1. Check that the watchlist and timeline start empty. Adding a whitespace-only ID returns 400.
2. Add `ferry-pay` twice. Both requests return 201 and the watchlist contains one entry with its 24-hour change flag clear.
3. Wait for two scheduled fetches. The server request counter and distinct timeline poll IDs confirm that observation is running. Both polls show the $49/month listing with no change or summary, even as price formatting varies.
4. Observe the disappearance and return. The fixture supplies two delisted versions, then restores the $49/month listing. The API records a missing listing with a null title and then a complete listing marked as returned.
5. Observe the price increase to $59/month. Verify the price-only diff and the 24-hour change flag. The empty-string AI mock produces an `invalid_output` summary status, and the poll retains its diff.
6. Observe the subsequent tagline and description change and check that the diff names both fields.
7. Set `partialNext`, `failNext`, and `timeoutNext` in turn. For each, verify the recorded outcome, absence of a change and summary, and a subsequent successful observation.
8. Lower the source limit to one request per second and wait for a 429. Add an unknown competitor during cooldown and restore the usual limit. Verify the cooldown across both IDs and the unknown competitor's first missing observation.
9. Remove both IDs. Verify the watchlist is empty and the mock receives no further requests for `ferry-pay` across multiple polling intervals.
10. Read the retained timeline. Verify newest-first order, unique poll IDs, and a single recorded price change. Fetch two entries per page and follow each cursor until the combined pages match the complete history.
