import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { TestEnv } from '@test/nest';
import { DATABASE, type Database } from '@src/tools/db';
import { listingVersions, pollAttempts, watchlist } from '../entities';
import { ListingHistoryRepository } from '../repositories';
import { OutcomeKind, PollStatus } from '../types';
import { PollObservationsService } from './poll-observations.service';

describe('PollObservationsService', () => {
  let env: TestEnv, db: Database, service: PollObservationsService;
  const fields = { title: 'Acme', tagline: 'CRM', price: '$29', description: 'Teams' };
  const competitorId = 'archive';
  const otherId = randomUUID();
  const unprocessedId = randomUUID();
  const ids = [
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    ...Array.from({ length: 4 }, (_, i) => '00000000-0000-4000-8000-00000000000' + (i + 1)),
  ];
  beforeAll(async () => {
    env = await TestEnv.create({ providers: [ListingHistoryRepository, PollObservationsService] });
    db = env.nest.get(DATABASE);
    service = env.nest.get(PollObservationsService);
    await seedHistory();
  }, 180000);
  afterAll(async () => {
    await env?.cleanup();
  });

  async function seedHistory() {
    await db.insert(watchlist).values([
      { id: competitorId, active: false },
      { id: 'other', active: false },
    ]);
    const versionId = randomUUID();
    await db.insert(listingVersions).values({ id: versionId, fields });
    const base = {
      competitorId,
      status: PollStatus.Success,
      processedAt: new Date(),
      attemptNo: null,
      createdAt: null,
    };
    const earlier = sql`'2020-01-01T00:00:00.000001Z'::timestamptz`;
    const later = sql`'2020-01-01T00:00:00.000002Z'::timestamptz`;
    await db.insert(pollAttempts).values([
      { ...base, id: ids[0], finishedAt: earlier, outcomeKind: OutcomeKind.Complete, versionId },
      {
        ...base,
        id: ids[1],
        finishedAt: later,
        outcomeKind: OutcomeKind.Partial,
        response: { title: 'Draft' },
      },
      { ...base, id: ids[2], finishedAt: later, outcomeKind: OutcomeKind.Missing },
      {
        ...base,
        id: ids[3],
        finishedAt: later,
        outcomeKind: OutcomeKind.Interrupted,
        status: PollStatus.Error,
      },
      {
        ...base,
        id: ids[4],
        finishedAt: later,
        outcomeKind: OutcomeKind.Timeout,
        status: PollStatus.Error,
      },
      {
        ...base,
        id: otherId,
        competitorId: 'other',
        finishedAt: later,
        outcomeKind: OutcomeKind.Missing,
      },
      {
        competitorId,
        id: unprocessedId,
        attemptNo: 1,
        status: PollStatus.Success,
        outcomeKind: OutcomeKind.Missing,
        finishedAt: new Date(),
        nextDeliveryAt: new Date(),
      },
    ]);
  }

  it('uses the last returned poll ID and keeps timestamp precision across pages and new inserts', async () => {
    const first = await service.page(competitorId, 2);
    expect(first.items.map((row) => row.pollId)).toEqual([ids[4], ids[3]]);
    expect(first.nextCursor).toBe(ids[3]);
    await db.insert(pollAttempts).values({
      competitorId,
      status: PollStatus.Success,
      processedAt: new Date(),
      finishedAt: new Date(),
      outcomeKind: OutcomeKind.Missing,
    });
    const second = await service.page(competitorId, 2, first.nextCursor);
    expect(second.items).toMatchObject([
      { pollId: ids[2], fields: null },
      { pollId: ids[1], fields: { title: 'Draft' } },
    ]);
    const third = await service.page(competitorId, 2, second.nextCursor);
    expect(third).toMatchObject({ items: [{ pollId: ids[0], fields }], nextCursor: null });
  });

  it('accepts the oldest poll as a cursor and returns an empty page', async () => {
    expect(await service.page(competitorId, 2, ids[0])).toEqual({ items: [], nextCursor: null });
    expect(await service.page('unknown', 50)).toEqual({ items: [], nextCursor: null });
  });

  it.each([
    ['unknown', randomUUID()],
    ['another competitor', otherId],
    ['unprocessed', unprocessedId],
  ])('rejects a cursor for a poll that is %s', async (_label, cursor) => {
    await expect(service.page(competitorId, 2, cursor)).rejects.toMatchObject({ status: 400 });
  });
});
