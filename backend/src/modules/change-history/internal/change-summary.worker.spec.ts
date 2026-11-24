import { ChangeSummaryRepository } from '@src/modules/change-history/repositories/change-summary.repository';
import { DailyAiUsageRepository } from '@src/modules/summaries/repositories/daily-ai-usage.repository';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { TestEnv } from '@test/nest';
import { DATABASE, type Database } from '@src/tools/db';
import { LoggerService } from '@src/tools/logger';
import { MockAiClient } from '@src/external/ai/mock-ai.client';
import { SummariesService } from '@src/modules/summaries/services';
import { DAILY_AI_LIMIT, dailyAiUsage } from '@src/modules/summaries/entities';
import { ChangeKind, SummaryStatus } from '../types';
import { listingChanges } from '../entities';
import { ChangeSummaryWorker } from './change-summary.worker';

describe('ChangeSummaryWorker', () => {
  let env: TestEnv, db: Database, worker: ChangeSummaryWorker, ai: MockAiClient;
  beforeAll(async () => {
    env = await TestEnv.create({
      providers: [DailyAiUsageRepository, SummariesService, MockAiClient],
    });
    db = env.nest.get(DATABASE);
    ai = env.nest.get(MockAiClient);
    worker = new ChangeSummaryWorker(
      new ChangeSummaryRepository(db),
      env.nest.get(SummariesService),
      env.nest.get(LoggerService),
    );
  }, 180000);
  beforeEach(async () => {
    await db.delete(listingChanges);
    await db.delete(dailyAiUsage);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await env?.cleanup();
  });
  async function event() {
    const [row] = await db
      .insert(listingChanges)
      .values({
        pollId: randomUUID(),
        competitorId: 'demo',
        observedAt: new Date(),
        kind: ChangeKind.ContentChanged,
        changedFields: { price: { from: '$39', to: '$29' }, title: { from: 'A', to: 'B' } },
      })
      .returning();
    return row;
  }
  it('calls the empty-string mock once and retains the original diff', async () => {
    const row = await event(),
      call = jest.spyOn(ai, 'summarize');
    await Promise.all([worker.processNext(), worker.processNext()]);
    expect(await worker.processNext()).toBe(false);
    expect(call).toHaveBeenCalledTimes(1);
    expect(await call.mock.results[0].value).toBe('');
    expect(await db.select().from(listingChanges)).toMatchObject([
      {
        pollId: row.pollId,
        changedFields: row.changedFields,
        summary: null,
        summaryStatus: SummaryStatus.InvalidOutput,
      },
    ]);
  });
  it.each([
    [new Error('rejected'), SummaryStatus.Failed],
    [new DOMException('timed out', 'TimeoutError'), SummaryStatus.Timeout],
  ] as const)('preserves evidence when the AI rejects with %p', async (error, status) => {
    await event();
    jest.spyOn(ai, 'summarize').mockRejectedValueOnce(error);
    await worker.processNext();
    expect(await db.select().from(listingChanges)).toMatchObject([
      {
        summary: null,
        summaryStatus: status,
        changedFields: { price: { from: '$39', to: '$29' } },
      },
    ]);
  });
  it('recovers expired work and ignores a late result from an older claim', async () => {
    const row = await event();
    let entered: () => void, release: (s: string) => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    jest
      .spyOn(ai, 'summarize')
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            release = resolve;
            entered();
          }),
      )
      .mockResolvedValueOnce('Recovered summary');
    const first = worker.processNext();
    await started;
    await db
      .update(listingChanges)
      .set({ claimExpiresAt: new Date(0) })
      .where(eq(listingChanges.pollId, row.pollId));
    expect(await worker.processNext()).toBe(true);
    release('Old result');
    await first;
    expect(await db.select().from(listingChanges)).toMatchObject([
      { summary: 'Recovered summary', summaryStatus: SummaryStatus.Ready, claimToken: null },
    ]);
  });
  it('records exhausted budget without invoking the AI', async () => {
    await event();
    await db
      .insert(dailyAiUsage)
      .values({ day: new Date().toISOString().slice(0, 10), calls: DAILY_AI_LIMIT });
    const spy = jest.spyOn(ai, 'summarize');
    await worker.processNext();
    expect(spy).toHaveBeenCalledTimes(0);
    expect(await db.select().from(listingChanges)).toMatchObject([
      { summaryStatus: SummaryStatus.BudgetExhausted },
    ]);
  });
});
