import { eq } from 'drizzle-orm';
import { TestEnv } from '@test/nest';
import { DATABASE, type Database } from '@src/tools/db';
import { WatchlistService } from '../services';
import { pollLogs, sourceState, watchlist } from '../entities';
import { OutcomeKind, PollStatus, type PollResult } from '../types';
import { PollAttemptRepository, WatchlistRepository } from '../repositories';
import { PollAttemptService } from './poll-attempt.service';

describe('PollAttemptService', () => {
  let env: TestEnv;
  let db: Database;
  let attempts: PollAttemptService;
  let tracked: WatchlistService;
  beforeAll(async () => {
    env = await TestEnv.create({
      providers: [
        PollAttemptRepository,
        PollAttemptService,
        WatchlistRepository,
        WatchlistService,
      ],
    });
    db = env.nest.get(DATABASE);
    attempts = env.nest.get(PollAttemptService);
    tracked = env.nest.get(WatchlistService);
  }, 180000);
  beforeEach(async () => {
    await db.delete(pollLogs);
    await db.delete(watchlist);
    await db.update(sourceState).set({ cooldownUntil: null });
  });
  afterAll(async () => {
    await env?.cleanup();
  });
  it('selects the oldest due listing first and excludes outstanding work', async () => {
    const rows = ['new', 'old', 'older'].map((id, index) => ({
      id,
      nextDueAt: new Date(Date.now() - (index + 1) * 1000),
    }));
    await db.insert(watchlist).values(rows);
    for (const competitorId of ['older', 'old', 'new']) {
      expect(await attempts.claim()).toMatchObject({ competitorId });
    }
    expect(await attempts.claim()).toBeUndefined();
  });
  it('creates one manual poll across concurrent requests and dispatches that ID', async () => {
    await db
      .insert(watchlist)
      .values({ id: 'acme', nextDueAt: new Date(Date.now() + 900_000) });
    const requests = await Promise.all(
      Array.from({ length: 8 }, () => attempts.requestPoll('acme')),
    );
    const pollId = requests[0].pollId;
    expect(requests.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(requests.map((r) => r.pollId))).toEqual(new Set([pollId]));
    expect(await db.select().from(pollLogs)).toMatchObject([
      { pollId, status: PollStatus.Queued },
    ]);
    await expect(
      db.insert(pollLogs).values({ competitorId: 'acme' }),
    ).rejects.toMatchObject({
      cause: { code: '23505' },
    });
    const poll = await attempts.claim();
    expect(poll.id).toBe(pollId);
    expect(await attempts.requestPoll('acme')).toEqual({ pollId, created: false });
    await attempts.releaseUnstarted(poll);
    const resumed = await attempts.claim();
    expect(resumed.id).toBe(pollId);
    await attempts.finish(
      resumed,
      { kind: OutcomeKind.Missing, httpStatus: 404 },
      new Date(),
    );
    const next = await attempts.requestPoll('acme');
    expect(next.created).toBe(true);
    expect(next.pollId > pollId).toBe(true);
  });
  it('shares a scheduled poll and preserves its retry deadline on a manual request', async () => {
    await tracked.add('acme');
    const [poll, requested] = await Promise.all([
      attempts.claim(),
      attempts.requestPoll('acme'),
    ]);
    const running = poll ?? (await attempts.claim());
    expect(running.id).toBe(requested.pollId);
    const deadline = new Date(Date.now() + 60_000);
    await attempts.finish(
      running,
      { kind: OutcomeKind.RateLimited, httpStatus: 429, retryAfter: deadline },
      new Date(),
    );
    expect(await attempts.requestPoll('acme')).toEqual({
      pollId: running.id,
      created: false,
    });
    const [schedule] = await db.select().from(watchlist);
    expect(schedule.nextDueAt).toEqual(deadline);
    expect(await attempts.claim()).toBeUndefined();
  });
  it('cancels an unsent poll on removal and only accepts active competitors', async () => {
    expect(await attempts.requestPoll('acme')).toBeUndefined();
    await tracked.add('acme');
    await attempts.requestPoll('acme');
    await tracked.remove('acme');
    expect(await attempts.requestPoll('acme')).toBeUndefined();
    expect(await attempts.claim()).toBeUndefined();
    expect(await db.select().from(pollLogs)).toEqual([]);
  });
  it('schedules two jittered retries on one poll ID then returns to the normal interval', async () => {
    await tracked.add('acme');
    const ids = new Set<string>();
    for (let attemptNo = 1; attemptNo <= 3; attemptNo++) {
      const poll = await attempts.claim();
      expect(poll.attemptNo).toBe(attemptNo);
      ids.add(poll.id);
      const finished = new Date();
      await attempts.finish(
        poll,
        { kind: OutcomeKind.UpstreamError, httpStatus: 500 },
        finished,
      );
      const [schedule] = await db.select().from(watchlist);

      const delay = schedule.nextDueAt.getTime() - finished.getTime();
      if (attemptNo < 3) {
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(2000 * attemptNo);
        await db.update(watchlist).set({ nextDueAt: new Date(0) });
      } else {
        expect(delay).toBeGreaterThan(890000);
      }
    }
    expect(ids.size).toBe(1);
    const [id] = ids;
    const [log] = await db.select().from(pollLogs);
    expect(log).toMatchObject({
      pollId: id,
      status: PollStatus.Failed,
      listingFields: null,
      deliveredAt: null,
    });
    expect(log.failedAttempts.map((f) => f.httpStatus)).toEqual([500, 500, 500]);
    expect(log.finishedAt).toBeInstanceOf(Date);
    await db.update(watchlist).set({ nextDueAt: new Date(0) });
    const next = await attempts.claim();
    expect(next.id > id).toBe(true);
    expect(next.attemptNo).toBe(1);
  });
  it('stores a bounded failure preview even when truncation splits a surrogate pair', async () => {
    await tracked.add('acme');
    const poll = await attempts.claim();
    const prefix = 'é'.repeat(4095);
    const result = {
      kind: OutcomeKind.UpstreamError,
      httpStatus: 503,
      output: prefix + '😀z',
    } as const;
    await attempts.finish(poll, result, new Date());
    const [log] = await db.select().from(pollLogs);
    expect(log.failedAttempts[0].output).toBe(prefix + '\uFFFD');
  });
  it('preserves the source cooldown when a 429 exhausts the poll’s last attempt', async () => {
    await tracked.add('acme');
    for (let i = 0; i < 2; i++) {
      const poll = await attempts.claim();
      await attempts.finish(poll, { kind: OutcomeKind.Timeout }, new Date());
      await db.update(watchlist).set({ nextDueAt: new Date(0) });
    }
    const last = await attempts.claim();
    const [schedule] = await db.select().from(watchlist);
    const finishedAt = new Date();
    const deadline = new Date(finishedAt.getTime() + 60_000);
    await attempts.finish(
      last,
      {
        kind: OutcomeKind.RateLimited,
        httpStatus: 429,
        retryAfter: deadline,
      },
      finishedAt,
    );

    expect(await db.select().from(pollLogs)).toMatchObject([
      {
        pollId: last.id,
        status: PollStatus.Failed,
        finishedAt,
        failedAttempts: [
          { kind: OutcomeKind.Timeout },
          { kind: OutcomeKind.Timeout },
          { kind: OutcomeKind.RateLimited },
        ],
      },
    ]);
    expect(await db.select().from(watchlist)).toEqual([schedule]);
    expect(await attempts.recover()).toBe(deadline.getTime());
  });

  it('recovers the longest header deadline when the process exits before the poll finishes', async () => {
    await tracked.add('acme');
    const poll = await attempts.claim();
    const deadline = new Date(Date.now() + 60_000);
    await attempts.saveCooldown(deadline);
    await attempts.saveCooldown(new Date(deadline.getTime() - 1000));
    expect(await db.select().from(pollLogs)).toMatchObject([
      { pollId: poll.id, status: PollStatus.Fetching, finishedAt: null },
    ]);
    expect(await attempts.recover()).toBe(deadline.getTime());
    expect(await db.select().from(pollLogs)).toMatchObject([
      { pollId: poll.id, failedAttempts: [{ kind: OutcomeKind.Interrupted }] },
    ]);
  });
  it('restores the longest shared cooldown, preserves terminal work and marks abandoned work interrupted', async () => {
    for (const id of ['a', 'b', 'c']) {
      await tracked.add(id);
    }
    const first = await attempts.claim();
    const second = await attempts.claim();
    const abandoned = await attempts.claim();
    const end = Date.now() + 5000;
    for (const [poll, deadline] of [
      [first, end],
      [second, end - 2000],
    ] as const) {
      await attempts.finish(
        poll,
        {
          kind: OutcomeKind.RateLimited,
          httpStatus: 429,
          retryAfter: new Date(deadline),
        },
        new Date(),
      );
    }
    expect(await attempts.recover()).toBe(end);
    const rows = await db.select().from(pollLogs);
    expect(
      rows.filter((row) => row.failedAttempts[0]?.kind === OutcomeKind.RateLimited),
    ).toHaveLength(2);
    expect(rows.find((row) => row.pollId === abandoned.id)).toMatchObject({
      status: PollStatus.WaitingRetry,
      failedAttempts: [{ kind: OutcomeKind.Interrupted }],
    });
  });
  it.each([OutcomeKind.Complete, OutcomeKind.Missing] as const)(
    'finishes the original retried poll as %s and ignores stale writes',
    async (terminal) => {
      await tracked.add('acme');
      const first = await attempts.claim();
      await attempts.finish(
        first,
        { kind: OutcomeKind.UpstreamError, httpStatus: 503, output: 'source busy' },
        new Date(),
      );
      await db.update(watchlist).set({ nextDueAt: new Date(0) });
      const retry = await attempts.claim();
      expect(retry).toMatchObject({ id: first.id, attemptNo: 2 });
      await attempts.finish(first, { kind: OutcomeKind.Timeout }, new Date());
      await attempts.releaseUnstarted(retry);
      const final = await attempts.claim();
      const fields = {
        price: 'USD 39 per month',
        title: 'A',
        description: 'B',
        tagline: 'C',
      };
      const result: PollResult =
        terminal === OutcomeKind.Missing
          ? { kind: terminal, httpStatus: 404 }
          : { kind: terminal, httpStatus: 200, fields };
      await attempts.finish(final, result, new Date());
      const logs = await db.select().from(pollLogs);
      expect(logs).toHaveLength(1);
      const listingFields = terminal === OutcomeKind.Missing ? null : fields;
      expect(logs[0]).toMatchObject({
        pollId: first.id,
        status: terminal,
        listingFields,
        failedAttempts: [
          { kind: OutcomeKind.UpstreamError, httpStatus: 503, output: 'source busy' },
        ],
        deliveredAt: null,
      });
    },
  );
  it('closes a waiting poll on removal and creates a newer UUIDv7 after reactivation even with a future prior ID', async () => {
    await tracked.add('acme');
    const first = await attempts.claim();
    const failedAt = new Date(Date.now() - 600_000);
    await attempts.finish(first, { kind: OutcomeKind.Timeout }, failedAt);
    await tracked.remove('acme');
    const [closed] = await db.select().from(pollLogs);
    expect(closed).toMatchObject({ status: PollStatus.Failed, finishedAt: failedAt });
    const future = 'f0000000-0000-7001-8000-000000000001';
    await db
      .update(pollLogs)
      .set({ pollId: future })
      .where(eq(pollLogs.pollId, first.id));
    await tracked.add('acme');
    const next = await attempts.claim();
    expect(next.id > future).toBe(true);
    expect(next.id[14]).toBe('7');
    expect(next.attemptNo).toBe(1);
  });
  it('keeps the last fetch time when an unsent retry is released after removal', async () => {
    await tracked.add('acme');
    const first = await attempts.claim();
    await attempts.finish(
      first,
      { kind: OutcomeKind.Timeout },
      new Date(Date.now() - 600_000),
    );
    const second = await attempts.claim();
    const failedAt = new Date(Date.now() - 300_000);
    await attempts.finish(
      second,
      { kind: OutcomeKind.UpstreamError, httpStatus: 503 },
      failedAt,
    );
    const retry = await attempts.claim();
    await tracked.remove('acme');
    await attempts.releaseUnstarted(retry);
    const [closed] = await db.select().from(pollLogs);
    expect(closed).toMatchObject({
      pollId: first.id,
      status: PollStatus.Failed,
      finishedAt: failedAt,
      failedAttempts: [
        { kind: OutcomeKind.Timeout },
        { kind: OutcomeKind.UpstreamError },
      ],
    });
  });
  it('records an old response without changing a reactivated schedule', async () => {
    await tracked.add('acme');
    const poll = await attempts.claim();
    await tracked.remove('acme');
    await tracked.add('acme');
    const before = await db.select().from(watchlist);
    await attempts.finish(poll, { kind: OutcomeKind.Timeout }, new Date());
    expect(await db.select().from(watchlist)).toEqual(before);
    expect(await db.select().from(pollLogs)).toMatchObject([
      {
        pollId: poll.id,
        status: PollStatus.Failed,
        failedAttempts: [{ kind: OutcomeKind.Timeout }],
      },
    ]);
  });
});
