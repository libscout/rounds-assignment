import { randomUUIDv7 } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { TestEnv } from '@test/nest';
import { DATABASE, type Database } from '@src/tools/db';
import { pollLogs, watchlist } from '../entities';
import { ListingHistoryRepository } from '../repositories';
import { OutcomeKind, PollStatus } from '../types';
import { PollObservationsService } from './poll-observations.service';

describe('PollObservationsService', () => {
  let env: TestEnv;
  let db: Database;
  let service: PollObservationsService;
  const fields = { title: 'Acme', tagline: 'CRM', price: '$29', description: 'Teams' };
  const competitorId = 'archive';
  const otherId = randomUUIDv7();
  const unfinishedId = randomUUIDv7();
  const ids = [
    'ffffffff-ffff-7fff-8fff-ffffffffffff',
    ...Array.from(
      { length: 4 },
      (_, i) => '00000000-0000-7000-8000-00000000000' + (i + 1),
    ),
  ];
  beforeAll(async () => {
    env = await TestEnv.create({
      providers: [ListingHistoryRepository, PollObservationsService],
    });
    db = env.nest.get(DATABASE);
    service = env.nest.get(PollObservationsService);
  }, 180000);
  beforeEach(async () => {
    await db.delete(pollLogs);
    await db.delete(watchlist);
    await seedHistory();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  /** Seeds mixed outcomes and tied timestamps to exercise ordering, filtering and pagination. */
  async function seedHistory() {
    await db.insert(watchlist).values([{ id: competitorId }, { id: 'other' }]);
    const base = {
      competitorId,
      status: PollStatus.Missing,
      deliveredAt: null,
    };
    const earlier = sql`'2020-01-01T00:00:00.000001Z'::timestamptz`;
    const later = sql`'2020-01-01T00:00:00.000002Z'::timestamptz`;
    await db.insert(pollLogs).values([
      {
        ...base,
        pollId: ids[0],
        finishedAt: earlier,
        status: PollStatus.Complete,
        listingFields: fields,
      },
      {
        ...base,
        pollId: ids[1],
        finishedAt: later,
        status: PollStatus.Failed,
        failedAttempts: [
          {
            at: new Date(0).toISOString(),
            kind: OutcomeKind.Partial,
            fields: { title: 'Draft' },
          },
        ],
      },
      { ...base, pollId: ids[2], finishedAt: later },
      {
        ...base,
        pollId: ids[3],
        finishedAt: later,
        status: PollStatus.Failed,
        failedAttempts: [
          { at: new Date(0).toISOString(), kind: OutcomeKind.Interrupted },
        ],
      },
      {
        ...base,
        pollId: ids[4],
        finishedAt: later,
        status: PollStatus.Failed,
        failedAttempts: [{ at: new Date(0).toISOString(), kind: OutcomeKind.Timeout }],
      },
      {
        ...base,
        pollId: otherId,
        competitorId: 'other',
        finishedAt: later,
      },
      {
        competitorId,
        pollId: unfinishedId,
        status: PollStatus.Fetching,
      },
    ]);
  }

  it('uses the last returned poll ID and keeps timestamp precision across pages and new inserts', async () => {
    const first = await service.page(competitorId, 2);
    expect(first.items.map((row) => row.pollId)).toEqual([ids[4], ids[3]]);
    expect(first.nextCursor).toBe(ids[3]);
    await db.insert(pollLogs).values({
      competitorId,
      status: PollStatus.Missing,
      deliveredAt: null,
      finishedAt: new Date(),
    });
    const second = await service.page(competitorId, 2, first.nextCursor);
    expect(second.items).toMatchObject([
      { pollId: ids[2], fields: null },
      { pollId: ids[1], fields: { title: 'Draft' } },
    ]);
    const third = await service.page(competitorId, 2, second.nextCursor);
    expect(third).toMatchObject({
      items: [{ pollId: ids[0], fields }],
      nextCursor: null,
    });
  });

  it('accepts the oldest poll as a cursor and returns an empty page', async () => {
    expect(await service.page(competitorId, 2, ids[0])).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(await service.page('unknown', 50)).toEqual({ items: [], nextCursor: null });
  });

  it.each([
    ['unknown', randomUUIDv7()],
    ['another competitor', otherId],
    ['unfinished', unfinishedId],
  ])('rejects a cursor for a poll that is %s', async (_label, cursor) => {
    await expect(service.page(competitorId, 2, cursor)).rejects.toMatchObject({
      status: 400,
    });
  });
});
