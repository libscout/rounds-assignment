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
const previous = { ...complete, pollId: 'previous' };

/** Reads the empty feed through the same paginated poll API as the component. */
async function readHistory(t, pages) {
  const { readEmptyChangeContext } = await server.ssrLoadModule(
    '/src/features/timeline/emptyChangeContext.ts',
  );
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const page = pages[urls.length];
    assert.ok(page, 'An unexpected page of poll history was requested');
    urls.push(url);
    const headers = page.next ? { 'X-Next-Cursor': page.next } : {};

    return Response.json(page.rows, { headers });
  });
  const context = await readEmptyChangeContext('crm', new AbortController().signal);

  return { context, urls };
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
  test(`two complete fetches with comparison status ${comparisonStatus}`, async (t) => {
    const latest = { ...complete, comparisonStatus };
    const { context } = await readHistory(t, [{ rows: [latest, previous] }]);
    assert.equal(context.title, title);
    assert.doesNotMatch(context.detail ?? '', /matched/);
  });
}

test('only searches older pages when a completed observation needs a baseline', async (t) => {
  const { context, urls } = await readHistory(t, [
    { rows: [complete], next: 'older' },
    { rows: [previous] },
  ]);
  assert.match(context.detail, /matched the previous complete check/);
  assert.equal(context.count, 2);
  assert.match(urls[1], /cursor=older/);
});

test('a pending first page does not need older polls', async (t) => {
  const pending = { ...complete, comparisonStatus: 'pending' };
  const { context, urls } = await readHistory(t, [{ rows: [pending], next: 'older' }]);
  assert.equal(context.title, 'Comparison pending.');
  assert.equal(urls.length, 1);
});

test('identifies the first completed baseline', async (t) => {
  const { context } = await readHistory(t, [{ rows: [complete] }]);
  assert.equal(context.title, 'First listing recorded.');
});

test('shows the source outcome when a comparison does not apply', async (t) => {
  const failed = {
    ...complete,
    outcomeKind: 'timeout',
    comparisonStatus: 'not_applicable',
  };
  const { context } = await readHistory(t, [{ rows: [failed, previous] }]);
  assert.match(context.detail, /request timed out/i);
});
