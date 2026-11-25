import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server;
before(async () => {
  server = await createServer({
    mode: 'test',
    server: { middlewareMode: true, watch: null, ws: false },
  });
});
after(() => server?.close());

const complete = {
  pollId: 'latest',
  fetchedAt: '2026-03-15T12:00:00Z',
  outcomeKind: 'complete',
  comparisonStatus: 'completed',
  failedAttempts: [],
  observationAvailable: true,
  changed: false,
  changedFields: {},
  changeKind: null,
  summaryStatus: 'not_applicable',
  summary: null,
  title: 'CRM',
  tagline: 'For teams',
  price: '$29',
  description: 'Manage customers',
};

test('Poll now requests the encoded competitor and accepts an existing poll ID', async (t) => {
  const { requestPoll } = await server.ssrLoadModule('/src/features/timeline/api.ts');
  const result = { pollId: 'existing', created: false };
  const signal = new AbortController().signal;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/competitors/a%2Fb/polls');
    assert.equal(options.method, 'POST');
    assert.equal(options.signal, signal);

    return Response.json(result, { status: 202 });
  });
  assert.deepEqual(await requestPoll('a/b', signal), result);
});

test('Reset all reports partial failures and accepts a confirmed reset', async (t) => {
  const { resetDemo } = await server.ssrLoadModule(
    '/src/features/mock-controls/api.ts',
  );
  let response = Response.json(
    { message: 'Reset incomplete for the mock LLM.' },
    { status: 503 },
  );
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/dev/progress');
    assert.equal(options.method, 'DELETE');

    return response;
  });
  await assert.rejects(resetDemo(), /mock LLM/);
  response = new Response(null, { status: 204 });
  await resetDemo();
});

/** Renders one poll through the component used by the All polls view. */
async function renderPoll(overrides = {}) {
  const { default: PollEntry } = await server.ssrLoadModule(
    '/src/features/timeline/PollEntry.tsx',
  );

  return renderToStaticMarkup(
    createElement(PollEntry, { poll: { ...complete, ...overrides }, latest: true }),
  );
}

/** Serves one snapshot response and checks that the empty view makes a single request. */
async function readEmptyView(t, rows, headers = {}) {
  const { readEmptyChangeContext } = await server.ssrLoadModule(
    '/src/features/timeline/emptyChangeContext.ts',
  );
  const signal = new AbortController().signal;
  const fetcher = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/competitors/crm/snapshots?limit=1');
    assert.equal(options.signal, signal);

    return Response.json(rows, { headers });
  });
  const context = await readEmptyChangeContext('crm', signal);
  assert.equal(fetcher.mock.callCount(), 1);

  return context;
}

test('renders a recorded price change with an unavailable summary', async () => {
  const { default: ChangeEntry } = await server.ssrLoadModule(
    '/src/features/timeline/ChangeEntry.tsx',
  );
  const poll = {
    ...complete,
    changed: true,
    changeKind: 'content_changed',
    changedFields: { price: { from: '$39', to: '$29' } },
    summaryStatus: 'unavailable',
  };
  const html = renderToStaticMarkup(createElement(ChangeEntry, { poll }));
  assert.match(html, /Price decreased/);
  assert.match(html, /Summary unavailable/);
});

for (const [comparisonStatus, title] of [
  ['pending', 'Comparison pending.'],
  ['error', 'Comparison failed.'],
  ['unavailable', 'Comparison status unavailable.'],
]) {
  test(`shows the latest poll's ${comparisonStatus} comparison`, async (t) => {
    const latest = { ...complete, comparisonStatus };
    const context = await readEmptyView(t, [latest]);
    assert.equal(context.title, title);
    assert.deepEqual(context.latest, latest);
  });
}

test('shows an unchanged latest poll without following an older-page cursor', async (t) => {
  const context = await readEmptyView(t, [complete], { 'X-Next-Cursor': 'older' });
  assert.equal(context.title, 'No changes recorded yet.');
  assert.deepEqual(context.latest, complete);
});

test('waits for the first check when there are no finished polls', async (t) => {
  const context = await readEmptyView(t, []);
  assert.equal(context.title, 'Waiting for the first check.');
  assert.equal(context.latest, undefined);
});

test('explains a 404 using the latest poll', async (t) => {
  const latest = { ...complete, outcomeKind: 'missing' };
  const context = await readEmptyView(t, [latest]);
  assert.equal(context.title, 'Listing unavailable.');
  assert.match(context.detail, /HTTP 404/);
});

test('shows the source outcome when a comparison does not apply', async (t) => {
  const failed = {
    ...complete,
    outcomeKind: 'timeout',
    comparisonStatus: 'not_applicable',
  };
  const context = await readEmptyView(t, [failed]);
  assert.match(context.title, /request timed out/i);
});

test('shows a comparison error alongside a successful listing fetch', async () => {
  const html = await renderPoll({ comparisonStatus: 'error' });
  assert.match(html, /Comparison failed/);
  assert.match(html, /Listing observed/);
});

test('shows the failed attempts behind a recovered poll in source order', async () => {
  const at = '2026-03-15T11:59:50Z';
  const later = '2026-03-15T11:59:57Z';
  const html = await renderPoll({
    failedAttempts: [
      { at, kind: 'timeout' },
      { at: later, kind: 'upstream_error', httpStatus: 503 },
    ],
  });
  assert.match(html, /<summary>2 failed attempts<\/summary>/);
  assert.ok(html.includes(at) && html.indexOf(at) < html.indexOf(later));
  assert.match(html, /Listing request timed out/);
  assert.match(html, /HTTP 503/);
  assert.match(html, /Listing observed/);
  assert.match(html, /No change recorded/);
  assert.doesNotMatch(await renderPoll(), /failed attempt/i);
});

test('distinguishes waiting for comparison from a queued AI summary', async () => {
  const waiting = await renderPoll({
    comparisonStatus: 'pending',
    summaryStatus: 'pending',
  });
  assert.match(
    waiting,
    /<p class="poll-note" data-tone="blue">Comparison pending\.<\/p>/,
  );
  assert.match(waiting, /Awaiting comparison/);
  const queued = await renderPoll({
    changed: true,
    changeKind: 'returned',
    summaryStatus: 'pending',
  });
  assert.match(queued, />Pending</);
  assert.doesNotMatch(queued, /Awaiting comparison/);
});

test('reads and clears an active error using the competitor status endpoint', async (t) => {
  const { loadLatestComparisonError } = await server.ssrLoadModule(
    '/src/features/timeline/api.ts',
  );
  const error = {
    pollId: 'older-poll',
    trackingFinishedAt: complete.fetchedAt,
    status: 'error',
  };
  const signal = new AbortController().signal;
  let latestComparisonError = error;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    assert.equal(url, '/api/competitors/a%2Fb/status');
    assert.equal(options.signal, signal);

    return Promise.resolve(Response.json({ latestComparisonError }));
  });
  assert.deepEqual(await loadLatestComparisonError('a/b', signal), error);
  latestComparisonError = null;
  assert.equal(await loadLatestComparisonError('a/b', signal), null);
});

test('keeps the saved diff and summary visible when tracking details are unavailable', async () => {
  const { default: ChangeEntry } = await server.ssrLoadModule(
    '/src/features/timeline/ChangeEntry.tsx',
  );
  const poll = {
    ...complete,
    title: null,
    tagline: null,
    description: null,
    price: null,
    observationAvailable: false,
    changed: true,
    changeKind: 'content_changed',
    changedFields: { price: { from: '$39', to: '$29' } },
    summaryStatus: 'ready',
    summary: 'The monthly price fell.',
  };
  const html = renderToStaticMarkup(createElement(ChangeEntry, { poll }));
  assert.match(html, /Listing details unavailable/);
  assert.match(html, /Price decreased/);
  assert.match(html, /The monthly price fell/);
  assert.doesNotMatch(html, /Fields unavailable|View listing details/);
});
