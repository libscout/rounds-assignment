import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  SnapshotDto,
  TrackedCompetitorListItemDto,
} from '@src/modules/competitor-timeline/dto';
import { ChangeKind } from '@src/modules/change-history/types';
import { SummaryStatus } from '@src/modules/ai-summary/types';
import { OutcomeKind } from '@src/modules/listing-tracking/types';
import { eventually, request, startStack } from './stack';
import type { RequestedPollDto } from '@src/modules/listing-tracking/dto';

const id = 'ferry-pay';

interface MockSourceStats {
  requests: number;
  byCompetitor: Record<string, { requests: number }>;
  byStatus: Record<string, number>;
  versions: Record<string, { index: number }>;
  settings: { versionIntervalSeconds: number };
}

/** Reads the supplied listing server's counters and fixture versions. */
async function readSourceStats(sourceUrl: string): Promise<MockSourceStats> {
  return (
    await request(sourceUrl + '/control/stats')
  ).json() as Promise<MockSourceStats>;
}

void test('manual polls and a complete reset of a running demo', async () => {
  await using resources = new AsyncDisposableStack();
  const { api, sourceUrl, llmUrl } = await startStack(resources, 900_000);
  const competitor = 'acme-crm';
  const listing = `${api}/${competitor}`;
  const settings = {
    versionIntervalSeconds: 0,
    latencyMinMs: 350,
    latencyMaxMs: 350,
    slowRate: 0,
    errorRate: 0,
    timeoutRate: 0,
    partialRate: 0,
  };
  /** Applies deterministic source settings and starts tracking the test competitor. */
  async function track() {
    await request(sourceUrl + '/control/configure', { method: 'POST', body: settings });
    await request(api, { method: 'POST', body: { id: competitor }, status: 201 });
  }
  /** Reads the finished observations for the test competitor. */
  async function history(): Promise<SnapshotDto[]> {
    return (await request(listing + '/snapshots')).json() as Promise<SnapshotDto[]>;
  }
  /** Requests a manual poll over the same endpoint as the timeline button. */
  async function poll(): Promise<RequestedPollDto> {
    return (
      await request(listing + '/polls', { method: 'POST', status: 202 })
    ).json() as Promise<RequestedPollDto>;
  }
  await track();
  const baseline = await eventually('first baseline', async () =>
    (await history()).find((row) => row.comparisonStatus === 'completed'),
  );
  await request(sourceUrl + '/control/advance', {
    method: 'POST',
    body: { id: competitor, steps: 2 },
  });
  const requests = await Promise.all([poll(), poll()]);
  assert.equal(requests.filter((r) => r.created).length, 1);
  assert.equal(new Set(requests.map((r) => r.pollId)).size, 1);
  assert.notEqual(requests[0].pollId, baseline.pollId);
  const change = await eventually('manual price change and summary', async () =>
    (await history()).find(
      (r) => r.pollId === requests[0].pollId && r.summaryStatus === SummaryStatus.Ready,
    ),
  );
  assert.match(change.changedFields.price.to, /29/);
  await poll();
  await eventually('manual fetch is in flight', async () => {
    const stats = await readSourceStats(sourceUrl);

    return stats.byCompetitor[competitor].requests === 2 && stats.requests === 3;
  });
  await request(new URL('/api/dev/progress', api).href, {
    method: 'DELETE',
    status: 204,
  });
  assert.deepEqual(await (await request(api)).json(), []);
  assert.deepEqual(await history(), []);
  assert.deepEqual(await (await request(listing + '/changes')).json(), []);
  const source = await readSourceStats(sourceUrl);
  assert.equal(source.requests, 0);
  assert.equal(source.versions[competitor].index, 0);
  assert.equal(source.settings.versionIntervalSeconds, 120);
  const llm = (await (await request(llmUrl + '/control/stats')).json()) as {
    callCount: number;
  };
  assert.equal(llm.callCount, 0);
  await request(listing + '/polls', { method: 'POST', status: 404 });
  await track();
  const fresh = await eventually('worker resumes with a fresh baseline', async () =>
    (await history()).find((r) => r.comparisonStatus === 'completed'),
  );
  assert.match(fresh.price, /39/);
  assert.equal(fresh.changed, false);
  assert.notEqual(fresh.pollId, baseline.pollId);
});

void test('public API tracks a listing through changes, source failures and removal', async () => {
  await using resources = new AsyncDisposableStack();
  const { api, sourceUrl, llmUrl } = await startStack(resources);
  const snapshots = `${api}/${id}/snapshots`;
  /** Reads the current watchlist through the public API. */
  const list = async () =>
    (await request(api)).json() as Promise<TrackedCompetitorListItemDto[]>;
  /** Reads a page of timeline entries from the supplied URL or the test competitor's snapshots. */
  const history = async (url = snapshots): Promise<SnapshotDto[]> =>
    (await request(url)).json() as Promise<SnapshotDto[]>;
  /** Applies new behavior settings to the mock listing source. */
  const configure = (body: Record<string, number>) =>
    request(sourceUrl + '/control/configure', { method: 'POST', body });
  /** Advances the test competitor by the requested number of mock listing versions. */
  const advance = (steps = 1) =>
    request(sourceUrl + '/control/advance', { method: 'POST', body: { id, steps } });
  /** Reads request counts and response status totals from the mock source. */
  const sourceStats = () => readSourceStats(sourceUrl);
  /** Returns the number of source requests observed for the test competitor. */
  const requestCount = async () =>
    (await sourceStats()).byCompetitor[id]?.requests ?? 0;
  /** Waits for a timeline entry matching the scenario's expected outcome. */
  const waitForPoll = (reason: string, predicate: (poll: SnapshotDto) => boolean) =>
    eventually(reason, async () => (await history()).find(predicate));

  await configure({
    versionIntervalSeconds: 0,
    latencyMinMs: 0,
    latencyMaxMs: 0,
    slowRate: 0,
    errorRate: 0,
    timeoutRate: 0,
    partialRate: 0,
  });
  assert.deepEqual(await list(), []);
  assert.deepEqual(await history(), []);
  await request(api, { method: 'POST', body: { id: ' ' }, status: 400 });
  assert.deepEqual(
    await (await request(api, { method: 'POST', body: { id }, status: 201 })).json(),
    { id },
  );
  await request(api, { method: 'POST', body: { id }, status: 201 });

  assert.deepEqual(await list(), [{ id, changedInLast24h: false }]);
  const stable = await eventually('baseline and repeat observation', async () => {
    const rows = (await history()).slice(-2);

    return (
      rows.length === 2 && rows.every((p) => p.comparisonStatus === 'completed') && rows
    );
  });
  assert.ok((await requestCount()) >= 2, 'scheduler fetched the listing twice');
  assert.notEqual(stable[0].pollId, stable[1].pollId);
  for (const poll of stable) {
    assert.equal(poll.outcomeKind, 'complete');
    assert.equal(poll.changed, false);
    assert.equal(poll.summaryStatus, 'not_applicable');
    assert.equal(poll.summary, null);
    assert.match(poll.price, /49/);
  }

  const llmStats = (await (await request(llmUrl + '/control/stats')).json()) as {
    callCount: number;
  };
  assert.equal(llmStats.callCount, 0);
  await advance(2);
  const missing = await waitForPoll(
    'disappearance',
    (p) => p.changeKind === ChangeKind.Disappeared,
  );
  assert.equal(missing.outcomeKind, 'missing');
  assert.equal(missing.title, null);
  await advance(2);
  const returned = await waitForPoll(
    'return',
    (p) => p.changeKind === ChangeKind.Returned,
  );
  assert.equal(returned.outcomeKind, 'complete');
  assert.match(returned.price, /49/);

  await advance();
  const change = await waitForPoll(
    'price change and summary worker',
    (p) => p.changedFields.price && p.summaryStatus === SummaryStatus.Ready,
  );
  assert.equal(change.changed, true);
  assert.equal(change.changeKind, 'content_changed');
  assert.deepEqual(Object.keys(change.changedFields), ['price']);
  assert.match(change.changedFields.price.from, /49/);
  assert.match(change.changedFields.price.to, /59/);
  assert.match(change.summary, /Mock AI summary/);
  assert.deepEqual(await list(), [{ id, changedInLast24h: true }]);

  await advance();
  const copy = await waitForPoll(
    'tagline and description change',
    (p) =>
      p.changedFields.tagline &&
      p.changedFields.description &&
      p.summaryStatus === SummaryStatus.Ready,
  );
  assert.equal(copy.changeKind, 'content_changed');
  assert.deepEqual(Object.keys(copy.changedFields).sort(), ['description', 'tagline']);

  for (const [setting, kind] of [
    ['partialNext', OutcomeKind.Partial],
    ['failNext', OutcomeKind.UpstreamError],
    ['timeoutNext', OutcomeKind.Timeout],
  ] as const) {
    await configure({ [setting]: 1 });
    const recovered = await waitForPoll(
      'same poll recovered after ' + kind,
      (p) =>
        p.outcomeKind === OutcomeKind.Complete &&
        p.failedAttempts.some((attempt) => attempt.kind === kind),
    );
    const failure = recovered.failedAttempts.find((a) => a.kind === kind);
    if (kind === OutcomeKind.Partial) {
      assert.ok(Object.keys(failure.fields).length > 0);
    }
    if (kind === OutcomeKind.UpstreamError) {
      assert.ok(failure.httpStatus >= 500);
      assert.ok(failure.output.length > 0);
    }

    assert.ok(
      recovered.failedAttempts.every(
        (attempt) => Date.parse(attempt.at) <= Date.parse(recovered.fetchedAt),
      ),
    );
  }

  // Wait for an observed HTTP 429 so the second competitor is added during the shared cooldown.
  /** Returns the number of HTTP 429 responses emitted by the mock source. */
  const rateLimits = async () => (await sourceStats()).byStatus['429'] ?? 0;
  const before = await rateLimits();
  await configure({ rateLimitPerSecond: 1 });
  await eventually('source responds 429', async () => (await rateLimits()) > before);
  const otherId = 'unknown-during-cooldown';
  await request(api, { method: 'POST', body: { id: otherId }, status: 201 });
  await configure({ rateLimitPerSecond: 5 });
  const resumed = await waitForPoll(
    'same poll recovers after rate limit',
    (p) =>
      p.outcomeKind === OutcomeKind.Complete &&
      p.failedAttempts.some((attempt) => attempt.kind === OutcomeKind.RateLimited),
  );
  const limited = resumed.failedAttempts.find(
    (attempt) => attempt.kind === OutcomeKind.RateLimited,
  );
  const firstOtherPoll = await eventually(
    'first poll of unknown competitor',
    async () => {
      const rows = await history(api + '/' + otherId + '/snapshots');

      return rows[rows.length - 1];
    },
  );
  assert.equal(firstOtherPoll.outcomeKind, 'missing');
  assert.equal(firstOtherPoll.changed, false);
  // The simulator's 429 uses a Retry-After of at least one second.
  for (const poll of [resumed, firstOtherPoll]) {
    assert.ok(
      Date.parse(poll.fetchedAt) - Date.parse(limited.at) >= 1000,
      'source-wide cooldown',
    );
  }
  await request(api + '/' + otherId, { method: 'DELETE', status: 204 });

  await request(api + '/' + id, { method: 'DELETE', status: 204 });
  assert.deepEqual(await list(), []);
  // Allow any already-started request to finish, then observe multiple scheduler cycles.
  await delay(900);
  const count = await requestCount();
  await delay(1200);
  assert.equal(await requestCount(), count);

  const retained = await history();
  assert.ok(retained.every((row) => row.pollId[14] === '7'));
  const priceChanges = retained.filter((poll) => poll.changedFields.price);
  assert.deepEqual(
    priceChanges.map((poll) => poll.pollId),
    [change.pollId],
  );
  const ids = retained.map((p) => p.pollId);
  assert.equal(new Set(ids).size, ids.length);
  const times = retained.map((p) => Date.parse(p.fetchedAt));
  assert.deepEqual(
    times,
    [...times].sort((a, b) => b - a),
  );

  const changesUrl = api + '/' + id + '/changes';
  assert.ok(!retained[0].changed, 'a recent unchanged poll precedes older changes');
  const expected = retained.filter((poll) => poll.changed);
  const firstChange = await request(changesUrl + '?limit=1');
  assert.deepEqual(await firstChange.json(), expected.slice(0, 1));
  assert.equal(firstChange.headers.get('X-Next-Cursor'), expected[0].pollId);
  const olderChanges = await request(changesUrl + '?cursor=' + expected[0].pollId);
  assert.deepEqual(await olderChanges.json(), expected.slice(1));
  assert.equal(olderChanges.headers.get('X-Next-Cursor'), null);
  await request(changesUrl + '?cursor=' + stable[0].pollId, { status: 400 });
  assert.deepEqual(await (await request(api + '/' + otherId + '/changes')).json(), []);

  const paged: string[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: '2' });
    if (cursor) {
      query.set('cursor', cursor);
    }
    const response = await request(snapshots + '?' + query.toString());
    const rows = (await response.json()) as SnapshotDto[];
    paged.push(...rows.map((p) => p.pollId));
    cursor = response.headers.get('X-Next-Cursor');
    if (cursor) {
      assert.equal(cursor, rows[rows.length - 1].pollId);
    }
    assert.ok(paged.length <= retained.length, 'pagination repeated a page');
  } while (cursor);
  assert.deepEqual(paged, ids);
});
