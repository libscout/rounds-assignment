import { eq } from 'drizzle-orm';
import { TestEnv } from '@test/nest';
import { DATABASE, type Database } from '@src/tools/db';
import { ChangeHistoryModule } from '@src/modules/change-history/change-history.module';
import { WatchlistService } from '../services';
import { pollAttempts, sourceState, watchlist } from '../entities';
import { OutcomeKind, PollStatus } from '../types';
import { PollAttemptRepository, WatchlistRepository } from '../repositories';
import { PollAttemptService } from './poll-attempt.service';

describe('PollAttemptService', () => {
  let env: TestEnv;
  let db: Database;
  let attempts: PollAttemptService;
  let tracked: WatchlistService;
  beforeAll(async () => {
    env = await TestEnv.create({
      imports: [ChangeHistoryModule],
      providers: [PollAttemptRepository, PollAttemptService, WatchlistRepository, WatchlistService],
    });
    db = env.nest.get(DATABASE);
    attempts = env.nest.get(PollAttemptService);
    tracked = env.nest.get(WatchlistService);
  }, 180000);
  beforeEach(async () => {
    await db.delete(pollAttempts);
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
    for (const competitorId of ['older', 'old', 'new'])
      expect(await attempts.claim()).toMatchObject({ competitorId });
    expect(await attempts.claim()).toBeUndefined();
  });
  it('schedules two jittered retries with distinct IDs then returns to the normal interval', async () => {
    await tracked.add('acme');
    const ids = new Set<string>();
    for (let attemptNo = 1; attemptNo <= 3; attemptNo++) {
      const poll = await attempts.claim();
      expect(poll.attemptNo).toBe(attemptNo);
      ids.add(poll.id);
      const finished = new Date();
      await attempts.finish(poll, { kind: OutcomeKind.UpstreamError, httpStatus: 500 }, finished);
      const [schedule] = await db.select().from(watchlist);
      expect(schedule.nextAttemptNo).toBe(attemptNo < 3 ? attemptNo + 1 : 1);
      const delay = schedule.nextDueAt.getTime() - finished.getTime();
      if (attemptNo < 3) {
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(2000 * attemptNo);
        await db.update(watchlist).set({ nextDueAt: new Date(0) });
      } else expect(delay).toBeGreaterThan(890000);
      await db.delete(pollAttempts).where(eq(pollAttempts.id, poll.id));
    }
    expect(ids.size).toBe(3);
  });
  it('restores the longest shared cooldown, preserves terminal work and marks abandoned work interrupted', async () => {
    for (const id of ['a', 'b', 'c']) await tracked.add(id);
    const first = await attempts.claim(),
      second = await attempts.claim(),
      abandoned = await attempts.claim();
    const end = Date.now() + 5000;
    for (const [poll, deadline] of [
      [first, end],
      [second, end - 2000],
    ] as const) {
      await attempts.finish(
        poll,
        { kind: OutcomeKind.RateLimited, httpStatus: 429, retryAfter: new Date(deadline) },
        new Date(),
      );
    }
    expect(await attempts.recover()).toBe(end);
    const rows = await db.select().from(pollAttempts);
    expect(rows.filter((row) => row.outcomeKind === OutcomeKind.RateLimited)).toHaveLength(2);
    expect(rows.find((row) => row.id === abandoned.id)).toMatchObject({
      status: PollStatus.Error,
      outcomeKind: OutcomeKind.Interrupted,
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
    expect(await db.select().from(pollAttempts)).toMatchObject([
      { id: poll.id, outcomeKind: OutcomeKind.Timeout },
    ]);
  });
});
