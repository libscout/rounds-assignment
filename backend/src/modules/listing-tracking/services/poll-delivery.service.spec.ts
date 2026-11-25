import { eq } from 'drizzle-orm';
import { randomUUIDv7 } from 'node:crypto';
import { TestEnv } from '@test/nest';
import { DATABASE, type Database } from '@src/tools/db';
import { pollLogs, watchlist } from '../entities';
import { PollStatus, OutcomeKind } from '../types';
import { PollDeliveryRepository, ListingHistoryRepository } from '../repositories';
import { PollDeliveryService } from './poll-delivery.service';

describe('PollDeliveryService', () => {
  let env: TestEnv;
  afterAll(() => env?.cleanup());
  it('pages competitor heads and acknowledges only eligible finished attempts', async () => {
    env = await TestEnv.create({
      providers: [
        ListingHistoryRepository,
        PollDeliveryRepository,
        PollDeliveryService,
      ],
    });
    const db = env.nest.get<Database>(DATABASE);
    const service = env.nest.get(PollDeliveryService);
    await db.insert(watchlist).values([{ id: 'a' }, { id: 'b' }]);
    const ids = Array.from({ length: 5 }, () => randomUUIDv7()).sort();
    await db.insert(pollLogs).values(
      ids.map((pollId, i) => {
        const competitorId = i === 4 ? 'b' : 'a';
        const finishedAt = new Date(0);
        if (i < 2) {
          const failure = {
            at: finishedAt.toISOString(),
            kind: OutcomeKind.Timeout as const,
          };

          return {
            pollId,
            competitorId,
            finishedAt,
            status: PollStatus.Failed,
            failedAttempts: [failure],
          };
        }
        if (i === 3) {
          return {
            pollId,
            competitorId,
            finishedAt,
            status: PollStatus.Complete,
            listingFields: {
              title: 'CRM',
              tagline: 'Teams',
              price: '$29',
              description: 'Customers',
            },
          };
        }

        return {
          pollId,
          competitorId,
          finishedAt,
          status: PollStatus.Missing,
          failedAttempts: [],
        };
      }),
    );
    const first = await service.listDeliverablePolls(1);
    expect(first.items).toEqual([{ pollId: ids[2] }]);
    expect((await service.listDeliverablePolls(1, first.next)).items).toEqual([
      { pollId: ids[4] },
    ]);
    await service.acknowledge(ids[2]);
    expect(await service.oldestOutstandingId('a')).toBe(ids[3]);
    expect(await service.getDeliverableObservation(ids[3])).toMatchObject({
      pollId: ids[3],
      competitorId: 'a',
      outcomeKind: OutcomeKind.Complete,
      fields: {
        title: 'CRM',
        tagline: 'Teams',
        price: '$29',
        description: 'Customers',
      },
    });
    await expect(service.getDeliverableObservation(ids[0])).rejects.toThrow();
    // A later UUID for another competitor was already delivered when this older poll finished retrying.
    const [late, newer] = [randomUUIDv7(), randomUUIDv7()].sort();
    await db.insert(watchlist).values([{ id: 'late' }, { id: 'newer' }]);
    await db.insert(pollLogs).values([
      {
        pollId: late,
        competitorId: 'late',
        status: PollStatus.WaitingRetry,
        failedAttempts: [{ at: new Date().toISOString(), kind: OutcomeKind.Timeout }],
      },
      {
        pollId: newer,
        competitorId: 'newer',
        status: PollStatus.Missing,
        finishedAt: new Date(),
      },
    ]);
    await service.acknowledge(newer);
    const [ack] = await db.select().from(pollLogs).where(eq(pollLogs.pollId, newer));
    expect(ack.deliveredAt).toBeInstanceOf(Date);
    await service.acknowledge(newer);
    expect(
      (await db.select().from(pollLogs).where(eq(pollLogs.pollId, newer)))[0]
        .deliveredAt,
    ).toEqual(ack.deliveredAt);
    await db
      .update(pollLogs)
      .set({ status: PollStatus.Missing, finishedAt: new Date() })
      .where(eq(pollLogs.pollId, late));
    expect((await service.listDeliverablePolls(20)).items).toContainEqual({
      pollId: late,
    });
    await service.acknowledge(late);
    expect(await service.oldestOutstandingId('late')).toBeUndefined();
    expect(await service.getDeliverableObservation(ids[2])).toMatchObject({
      outcomeKind: 'missing',
      fields: null,
    });
  }, 180000);
});
