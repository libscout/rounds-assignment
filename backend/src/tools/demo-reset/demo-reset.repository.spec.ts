import { randomUUIDv7 } from 'node:crypto';
import { TestEnv } from '@test/nest';
import { DATABASE, type Database } from '@src/tools/db';
import { AiSummaryRepository } from '@src/modules/ai-summary/repositories/ai-summary.repository';
import { dailyAiUsage } from '@src/modules/ai-summary/entities';
import { SummaryStatus } from '@src/modules/ai-summary/types';
import { DemoResetRepository } from './demo-reset.repository';

describe('demo budget reset', () => {
  let env: TestEnv;
  let db: Database;
  let queue: AiSummaryRepository;
  let reset: DemoResetRepository;
  beforeAll(async () => {
    env = await TestEnv.create({
      providers: [AiSummaryRepository, DemoResetRepository],
    });
    db = env.nest.get(DATABASE);
    queue = env.nest.get(AiSummaryRepository);
    reset = env.nest.get(DemoResetRepository);
  }, 180000);
  beforeEach(async () => {
    await db.delete(dailyAiUsage);
  });
  afterAll(() => env?.cleanup());
  /** Reserves one real or simulated call through the summary queue. */
  async function reserve(usesLiveProvider: boolean) {
    const pollId = randomUUIDv7();
    await queue.submit({ pollId, diff: { kind: 'returned', changedFields: {} } });
    const claim = await queue.claim({ canSend: true, usesLiveProvider });
    expect(claim).toMatchObject({ kind: 'claimed', pollId });
    await queue.finish(pollId, 1, {
      status: SummaryStatus.Ready,
      text: 'Listing returned.',
    });
  }
  it('clears all simulated reservations even when resetting twice', async () => {
    await reserve(false);
    await reset.clear();
    await reset.clear();
    expect(await db.select().from(dailyAiUsage)).toEqual([]);
  });
  it('retains live reservations after the operator switches back to the mock', async () => {
    await reserve(true);
    await reserve(false);
    expect(await db.select().from(dailyAiUsage)).toMatchObject([
      { calls: 2, liveCalls: 1 },
    ]);
    await reset.clear();
    expect(await db.select().from(dailyAiUsage)).toMatchObject([
      { calls: 1, liveCalls: 1 },
    ]);
  });
});
