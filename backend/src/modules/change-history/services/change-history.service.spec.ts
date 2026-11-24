import { ListingChangeRepository } from '@src/modules/change-history/repositories/listing-change.repository';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database } from '@src/tools/db';
import { TestEnv } from '@test/nest';
import { listingChanges } from '../entities';
import { ChangeKind, ObservationKind, SummaryStatus, type Observation } from '../types';
import { ChangeHistoryService } from './change-history.service';

describe('ChangeHistoryService', () => {
  let env: TestEnv, db: Database, service: ChangeHistoryService;
  const fields = { title: 'CRM', tagline: 'CRM for teams', price: '$39/mo', description: 'A & B' };
  function observation(overrides: Partial<Observation> = {}): Observation {
    return {
      pollId: randomUUID(),
      competitorId: 'demo',
      observedAt: new Date(),
      current: { kind: ObservationKind.Complete, fields },
      previousFields: fields,
      previouslyVisible: true,
      ...overrides,
    };
  }
  beforeAll(async () => {
    env = await TestEnv.create({ providers: [ListingChangeRepository, ChangeHistoryService] });
    db = env.nest.get(DATABASE);
    service = env.nest.get(ChangeHistoryService);
  }, 180000);
  beforeEach(async () => {
    await db.delete(listingChanges);
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it('stores a replayed multi-field diff once using only its event table', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`create schema history_only`);
      await tx.execute(
        sql`create table history_only.listing_changes (like public.listing_changes including all)`,
      );
      await tx.execute(sql`set local search_path to history_only`);
      const isolated = new ChangeHistoryService(new ListingChangeRepository(tx));
      const input = observation({
        current: {
          kind: ObservationKind.Complete,
          fields: { ...fields, tagline: 'Team CRM', price: '$29/mo', description: 'A &amp; B' },
        },
      });
      await isolated.record(input);
      await isolated.record(input);
      const rows = await isolated.byPollIds([input.pollId]);
      expect(rows).toEqual([
        {
          pollId: input.pollId,
          observedAt: input.observedAt,
          competitorId: 'demo',
          kind: ChangeKind.ContentChanged,
          changedFields: {
            tagline: { from: 'CRM for teams', to: 'Team CRM' },
            price: { from: '$39/mo', to: '$29/mo' },
          },
          summary: null,
          summaryStatus: SummaryStatus.Pending,
        },
      ]);
      expect(await isolated.changedSince(['demo'], input.observedAt)).toEqual(new Set(['demo']));
      expect(await isolated.changedSince(['demo'], new Date(+input.observedAt + 1))).toEqual(
        new Set(),
      );
    });
  });
  it('ignores baselines, equivalent prices and text, inconclusive outcomes and repeated absence', async () => {
    const observations: Observation[] = [
      observation({ previousFields: null, previouslyVisible: null }),
      observation({ previousFields: null, previouslyVisible: false }),
      observation({
        current: {
          kind: ObservationKind.Complete,
          fields: { ...fields, price: 'USD 39.00 per month', description: 'A &amp;  B' },
        },
      }),
      observation({ current: { kind: ObservationKind.Inconclusive } }),
      observation({ current: { kind: ObservationKind.Missing }, previouslyVisible: false }),
    ];
    for (const input of observations) expect(await service.record(input)).toBeNull();
    expect(await db.select().from(listingChanges)).toEqual([]);
  });
  it('records disappearance and return, including content changes on return', async () => {
    expect(
      await service.record(observation({ current: { kind: ObservationKind.Missing } })),
    ).toEqual({
      kind: ChangeKind.Disappeared,
      changedFields: {},
    });
    expect(await service.record(observation({ previouslyVisible: false }))).toEqual({
      kind: ChangeKind.Returned,
      changedFields: {},
    });
    expect(
      await service.record(
        observation({
          previouslyVisible: false,
          current: { kind: ObservationKind.Complete, fields: { ...fields, title: 'New' } },
        }),
      ),
    ).toEqual({ kind: ChangeKind.Returned, changedFields: { title: { from: 'CRM', to: 'New' } } });
  });
});
