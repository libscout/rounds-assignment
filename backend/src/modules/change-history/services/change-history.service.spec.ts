import { randomUUIDv7 } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { DATABASE, type Database } from '@src/tools/db';
import { listingComparisons } from '../entities';
import { TestEnv } from '@test/nest';
import { ChangeHistoryModule } from '../change-history.module';
import { ChangeKind, ObservationKind, type Observation } from '../types';
import { ChangeHistoryService } from './change-history.service';

describe('ChangeHistoryService', () => {
  let env: TestEnv;
  let history: ChangeHistoryService;
  let db: Database;
  const fields = {
    title: 'CRM',
    tagline: 'Small teams',
    description: 'A & B',
    price: '$39/mo',
  };
  beforeAll(async () => {
    env = await TestEnv.create({ imports: [ChangeHistoryModule] });
    history = env.nest.get(ChangeHistoryService);
    db = env.nest.get(DATABASE);
  }, 180000);
  let orderedIds: string[];
  beforeEach(async () => {
    await db.delete(listingComparisons);
    orderedIds = Array.from({ length: 100 }, () => randomUUIDv7()).sort();
  });
  afterAll(() => env?.cleanup());
  /** Builds the next source-ordered observation for a competitor. */
  function observation(id: string, current: Observation['current']): Observation {
    return {
      pollId: orderedIds.shift(),
      competitorId: id,
      observedAt: new Date(),
      current,
    };
  }
  it('owns the baseline and replays prior multi-field and unchanged decisions', async () => {
    const id = randomUUIDv7();
    const baseline = observation(id, { kind: ObservationKind.Complete, fields });
    const noise = observation(id, {
      kind: ObservationKind.Complete,
      fields: { ...fields, description: 'A &amp;  B', price: 'USD 39.00 per month' },
    });
    const edit = observation(id, {
      kind: ObservationKind.Complete,
      fields: { ...fields, price: '$29/mo', tagline: 'Agencies' },
    });
    expect((await history.record(baseline)).change).toBeNull();
    expect((await history.record(noise)).change).toBeNull();
    const original = await history.record(edit);
    expect(original.change).toMatchObject({
      kind: ChangeKind.ContentChanged,
      changedFields: {
        tagline: { from: 'Small teams', to: 'Agencies' },
        price: { from: 'USD 39.00 per month', to: '$29/mo' },
      },
    });
    expect(await history.record(edit)).toEqual(original);
    expect((await history.record(noise)).change).toBeNull();
    expect((await history.page(id, 10)).items).toEqual([original.change]);
    expect(await history.changedSince([id], edit.observedAt)).toEqual(new Set([id]));
    expect(await history.changedSince([id], new Date(+edit.observedAt + 1))).toEqual(
      new Set(),
    );
  });
  it('records only disappearance and return when a competitor starts out missing', async () => {
    const id = randomUUIDv7();
    const initiallyMissing = observation(id, { kind: ObservationKind.Missing });
    const baseline = observation(id, { kind: ObservationKind.Complete, fields });
    const missing = observation(id, { kind: ObservationKind.Missing });
    const stillMissing = observation(id, { kind: ObservationKind.Missing });
    const returnedFields = { ...fields, price: '$29/mo' };
    const returned = observation(id, {
      kind: ObservationKind.Complete,
      fields: returnedFields,
    });
    const polls = [initiallyMissing, baseline, missing, stillMissing, returned];
    // Finish times can tie. UUIDv7 retains the poll creation order.
    polls.forEach((p) => {
      p.observedAt = new Date('2025-01-01T00:00:00Z');
    });
    for (const poll of polls) {
      await history.record(poll);
    }
    const rows = await db
      .select()
      .from(listingComparisons)
      .where(eq(listingComparisons.competitorId, id))
      .orderBy(asc(listingComparisons.pollId));
    expect(rows.map((row) => row.pollId)).toEqual(polls.map((p) => p.pollId));
    expect(rows.map((row) => row.listingState)).toEqual([
      null,
      fields,
      null,
      null,
      returnedFields,
    ]);
    expect(rows.map((row) => row.diff?.kind ?? null)).toEqual([
      null,
      null,
      ChangeKind.Disappeared,
      null,
      ChangeKind.Returned,
    ]);
    const first = await history.page(id, 1);
    expect(first.items).toMatchObject([
      {
        pollId: returned.pollId,
        kind: ChangeKind.Returned,
        changedFields: { price: { from: fields.price, to: returnedFields.price } },
      },
    ]);
    expect(
      (await history.page(id, 1, first.nextCursor)).items.map(
        (change) => change.pollId,
      ),
    ).toEqual([missing.pollId]);
    expect(await history.getDecisions([stillMissing.pollId, randomUUIDv7()])).toEqual([
      { pollId: stillMissing.pollId, change: null },
    ]);
    await expect(
      history.record({ ...baseline, pollId: '00000000-0000-7000-8000-000000000001' }),
    ).rejects.toThrow('source order');
  });
  it('handles simultaneous first deliveries for the same poll', async () => {
    const first = observation(randomUUIDv7(), {
      kind: ObservationKind.Complete,
      fields,
    });
    const saved = await Promise.all([history.record(first), history.record(first)]);
    expect(saved).toEqual([
      { pollId: first.pollId, change: null },
      { pollId: first.pollId, change: null },
    ]);
    expect(await history.changedSince([first.competitorId], new Date(0))).toEqual(
      new Set(),
    );
  });
});
