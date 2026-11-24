import { ListingChangeRepository } from '@src/modules/change-history/repositories/listing-change.repository';
import { eq } from 'drizzle-orm';
import { TestEnv } from '@test/nest';
import { DATABASE, type Database } from '@src/tools/db';
import { LoggerService } from '@src/tools/logger';
import { ChangeHistoryService } from '@src/modules/change-history/services';
import { listingChanges } from '@src/modules/change-history/entities';
import { pollAttempts, listingVersions, watchlist } from '../entities';
import { OutcomeKind, PollStatus } from '../types';
import { ListingHistoryRepository, PollDeliveryRepository } from '../repositories';
import { PollBaselineReader } from './poll-baseline.reader';
import { SnapshotDeliveryWorker } from './snapshot-delivery.worker';

describe('SnapshotDeliveryWorker', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await TestEnv.create({ providers: [ListingChangeRepository, ChangeHistoryService] });
  }, 180000);
  afterAll(async () => {
    await env?.cleanup();
  });
  it('preserves every attempt and replays a committed change after losing its acknowledgement', async () => {
    const db = env.nest.get<Database>(DATABASE),
      history = env.nest.get(ChangeHistoryService);
    const worker = new SnapshotDeliveryWorker(
      new PollDeliveryRepository(db),
      history,
      env.nest.get(LoggerService),
      new PollBaselineReader(new ListingHistoryRepository(db)),
    );
    await db.insert(watchlist).values({ id: 'acme', nextDueAt: new Date() });
    const fields = { title: 'CRM', tagline: 'Teams', description: 'Easy', price: '$39/mo' };
    let tick = Date.now() - 1000;
    async function poll(kind: OutcomeKind, response: Partial<typeof fields> | null) {
      const [row] = await db
        .insert(pollAttempts)
        .values({
          competitorId: 'acme',
          attemptNo: 1,
          status: kind === OutcomeKind.Timeout ? PollStatus.Error : PollStatus.Success,
          outcomeKind: kind,
          response,
          finishedAt: new Date(++tick),
          nextDeliveryAt: new Date(0),
        })
        .returning();
      await worker.deliverBatch();
      return row;
    }
    await poll(OutcomeKind.Complete, fields);
    await poll(OutcomeKind.Complete, { ...fields, price: 'USD 39.00 per month' });
    await poll(OutcomeKind.Timeout, null);
    const partial = await poll(OutcomeKind.Partial, { title: 'Draft' });
    const receiver = new ChangeHistoryService(new ListingChangeRepository(db));
    const delivery = jest.spyOn(history, 'record').mockImplementationOnce(async (observation) => {
      await receiver.record(observation);
      throw new Error('ack lost');
    });
    const changed = await poll(OutcomeKind.Complete, { ...fields, price: '$29/mo' });
    expect(
      await db.select().from(pollAttempts).where(eq(pollAttempts.id, changed.id)),
    ).toMatchObject([{ deliveryAttempts: 1, processedAt: null }]);
    await db
      .update(pollAttempts)
      .set({ nextDeliveryAt: new Date(0) })
      .where(eq(pollAttempts.id, changed.id));
    expect(await worker.deliverBatch()).toBe(1);
    expect(delivery.mock.calls[1]).toEqual(delivery.mock.calls[0]);
    const rows = await db.select().from(pollAttempts).orderBy(pollAttempts.finishedAt);
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.processedAt && row.nextDeliveryAt === null)).toBe(true);
    expect(rows[0].versionId).toEqual(rows[1].versionId);
    expect(rows.find((row) => row.id === partial.id)?.response).toEqual({ title: 'Draft' });
    expect(await db.select().from(listingVersions)).toHaveLength(2);
    expect(await db.select().from(listingChanges)).toMatchObject([
      { pollId: changed.id, changedFields: { price: { from: '$39/mo', to: '$29/mo' } } },
    ]);
  });
});
