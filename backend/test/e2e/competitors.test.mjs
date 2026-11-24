import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { eventually, request, startStack } from './stack.mjs';

const id = 'ferry-pay';

test('public API tracks a listing through changes, source failures and removal', async () => {
  await using resources = new AsyncDisposableStack();
  const { api, sourceUrl } = await startStack(resources);
  const snapshots = `${api}/${id}/snapshots`;
  const list = async () => (await request(api)).json();
  const history = async () => (await request(snapshots)).json();
  const configure = (body) => request(sourceUrl + '/control/configure', { method: 'POST', body });
  const advance = (steps = 1) =>
    request(sourceUrl + '/control/advance', { method: 'POST', body: { id, steps } });
  const requestCount = async () => {
    const stats = await (await request(sourceUrl + '/control/stats')).json();
    return stats.byCompetitor[id]?.requests ?? 0;
  };
  const waitForPoll = (reason, predicate) =>
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
    return rows.length === 2 && rows;
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

  await advance(2);
  const missing = await waitForPoll('disappearance', (p) => p.changeKind === 'disappeared');
  assert.equal(missing.outcomeKind, 'missing');
  assert.equal(missing.title, null);
  await advance(2);
  const returned = await waitForPoll('return', (p) => p.changeKind === 'returned');
  assert.equal(returned.outcomeKind, 'complete');
  assert.match(returned.price, /49/);

  await advance();
  const change = await waitForPoll(
    'price change and summary worker',
    (p) => p.changedFields.price && p.summaryStatus === 'invalid_output',
  );
  assert.equal(change.changed, true);
  assert.equal(change.changeKind, 'content_changed');
  assert.deepEqual(Object.keys(change.changedFields), ['price']);
  assert.match(change.changedFields.price.from, /49/);
  assert.match(change.changedFields.price.to, /59/);
  assert.equal(change.summary, null);
  assert.deepEqual(await list(), [{ id, changedInLast24h: true }]);

  await advance();
  const copy = await waitForPoll(
    'tagline and description change',
    (p) => p.changedFields.tagline && p.changedFields.description,
  );
  assert.equal(copy.changeKind, 'content_changed');
  assert.deepEqual(Object.keys(copy.changedFields).sort(), ['description', 'tagline']);

  for (const [setting, kind] of [
    ['partialNext', 'partial'],
    ['failNext', 'upstream_error'],
    ['timeoutNext', 'timeout'],
  ]) {
    await configure({ [setting]: 1 });
    const failed = await waitForPoll(kind, (p) => p.outcomeKind === kind);
    assert.equal(failed.changed, false);
    assert.equal(failed.summaryStatus, 'not_applicable');
    await waitForPoll(
      'successful poll after ' + kind,
      (p) => p.fetchedAt > failed.fetchedAt && p.outcomeKind === 'complete',
    );
  }

  await configure({ rateLimitPerSecond: 1 });
  const limited = await waitForPoll('HTTP 429', (p) => p.outcomeKind === 'rate_limited');
  const otherId = 'unknown-during-cooldown';
  await request(api, { method: 'POST', body: { id: otherId }, status: 201 });
  await configure({ rateLimitPerSecond: 5 });
  const resumed = await waitForPoll(
    'polling resumes after rate limit',
    (p) => p.fetchedAt > limited.fetchedAt && p.outcomeKind === 'complete',
  );
  const firstOtherPoll = await eventually('first poll of unknown competitor', async () => {
    const rows = await (await request(api + '/' + otherId + '/snapshots')).json();
    return rows.at(-1);
  });
  assert.equal(firstOtherPoll.outcomeKind, 'missing');
  assert.equal(firstOtherPoll.changed, false);
  // The simulator's 429 uses a Retry-After of at least one second.
  for (const poll of [resumed, firstOtherPoll]) {
    assert.ok(
      Date.parse(poll.fetchedAt) - Date.parse(limited.fetchedAt) >= 1000,
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
  assert.equal(retained.filter((p) => p.changedFields.price).length, 1);
  assert.ok(retained.some((p) => p.pollId === change.pollId));
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

  const paged = [];
  let cursor;
  do {
    const query = new URLSearchParams({ limit: '2' });
    if (cursor) query.set('cursor', cursor);
    const response = await request(snapshots + '?' + query);
    const rows = await response.json();
    paged.push(...rows.map((p) => p.pollId));
    cursor = response.headers.get('X-Next-Cursor');
    if (cursor) assert.equal(cursor, rows.at(-1).pollId);
    assert.ok(paged.length <= retained.length, 'pagination repeated a page');
  } while (cursor);
  assert.deepEqual(paged, ids);
});
