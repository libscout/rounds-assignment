import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { AiChatClient } from '@src/external/ai/ai-chat.client';
import { ConfigService } from '@src/tools/config';
import { EnvSchema } from '@src/tools/config/config.schema';
import { LoggerService } from '@src/tools/logger';
import { AiSummaryWorker } from '../internal/ai-summary.worker';
import { randomUUIDv7 } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { TestEnv } from '@test/nest';
import { DATABASE, type Database } from '@src/tools/db';
import { aiSummaries } from '../entities/ai-summary.table';
import { dailyAiUsage } from '../entities/daily-ai-usage.table';
import { AiSummaryRepository } from '../repositories/ai-summary.repository';
import {
  SummaryStatus as S,
  SummarySubmissionOutcome,
  type SubmitSummary,
} from '../types';
import { AiSummaryService } from './ai-summary.service';

describe('AI summary queue', () => {
  let env: TestEnv;
  let db: Database;
  let repo: AiSummaryRepository;
  let service: AiSummaryService;
  /** Creates a price-change submission with a fresh poll ID. */
  const request = (): SubmitSummary => ({
    pollId: randomUUIDv7(),
    diff: {
      kind: 'content_changed',
      changedFields: { price: { from: '$39', to: '$29' } },
    },
  });
  beforeAll(async () => {
    env = await TestEnv.create({ providers: [AiSummaryRepository, AiSummaryService] });
    db = env.nest.get(DATABASE);
    repo = env.nest.get(AiSummaryRepository);
    service = env.nest.get(AiSummaryService);
  }, 180000);
  beforeEach(async () => {
    await db.delete(aiSummaries);
    await db.delete(dailyAiUsage);
  });
  afterAll(() => env?.cleanup());
  it.each([
    undefined,
    { kind: 'unknown', changedFields: {} },
    { kind: 'returned', changedFields: [] },
    { kind: 'returned', changedFields: null },
    { kind: 'content_changed', changedFields: {} },
    { kind: 'disappeared', changedFields: { title: { from: 'a', to: 'b' } } },
    { kind: 'returned', changedFields: { url: { from: 'a', to: 'b' } } },
    { kind: 'returned', changedFields: { title: { from: 'a' } } },
  ])('rejects malformed diff %j before creating a job', async (diff: unknown) => {
    const input = { pollId: randomUUIDv7(), diff } as SubmitSummary;
    expect(await service.submit(input)).toBe(SummarySubmissionOutcome.InvalidInput);
    expect(await db.select().from(aiSummaries)).toEqual([]);
  });

  it('requires a UUIDv7 and accepts an empty diff for a returned listing', async () => {
    const input: SubmitSummary = {
      pollId: randomUUIDv7(),
      diff: { kind: 'returned', changedFields: {} },
    };
    expect(await service.submit({ ...input, pollId: 'invalid' })).toBe(
      SummarySubmissionOutcome.InvalidInput,
    );
    expect(await service.submit(input)).toBe(SummarySubmissionOutcome.Accepted);
    expect(await repo.claim()).toMatchObject({ kind: 'claimed', pollId: input.pollId });
  });

  it('closes an expired final attempt without reserving another daily call', async () => {
    const input = request();
    await service.submit(input);
    await repo.claim();
    await repo.retry(input.pollId, 1, new Date(0));
    await repo.claim();
    await db
      .update(aiSummaries)
      .set({ availableAt: new Date(0) })
      .where(eq(aiSummaries.pollId, input.pollId));
    expect(await repo.claim()).toEqual({ kind: 'finished' });
    expect((await service.getResults([input.pollId])).get(input.pollId)).toEqual({
      status: 'failed',
    });
    expect(await db.select().from(dailyAiUsage)).toMatchObject([{ calls: 2 }]);
  });
  it('deduplicates concurrent submissions and serves the saved result after terminal replay', async () => {
    const input = request();
    const submissions = await Promise.all([
      service.submit(input),
      service.submit(input),
    ]);
    expect(submissions).toEqual([
      SummarySubmissionOutcome.Accepted,
      SummarySubmissionOutcome.Accepted,
    ]);
    expect((await service.getResults([input.pollId])).get(input.pollId)).toEqual({
      status: 'pending',
    });
    const job = await repo.claim();
    expect(job.kind).toBe('claimed');
    expect(await service.submit(input)).toBe(SummarySubmissionOutcome.Accepted);
    await repo.finish(input.pollId, 1, { status: S.Ready, text: 'Price fell.' });
    expect(await service.submit(input)).toBe(SummarySubmissionOutcome.Accepted);
    expect(await repo.claim()).toEqual({ kind: 'idle' });
    expect((await service.getResults([input.pollId])).get(input.pollId)).toEqual({
      status: 'ready',
      text: 'Price fell.',
    });
    const conflict = await service.submit({
      ...input,
      diff: { kind: 'returned', changedFields: {} },
    });
    expect(conflict).toBe(SummarySubmissionOutcome.ConflictingDiff);
    expect(await db.select({ diff: aiSummaries.diff }).from(aiSummaries)).toEqual([
      { diff: input.diff },
    ]);
    expect(await db.select().from(dailyAiUsage)).toMatchObject([{ calls: 1 }]);
  });
  it('allows only one worker to reserve the last slot, including a subsequent retry', async () => {
    await db
      .insert(dailyAiUsage)
      .values({ day: sql`(now() at time zone 'UTC')::date`, calls: 1999 });
    const a = request();
    const b = request();
    await service.submit(a);
    await service.submit(b);
    const claims = await Promise.all([repo.claim(), repo.claim()]);
    expect(claims.filter((c) => c.kind === 'finished')).toHaveLength(1);
    const won = claims.find((c) => c.kind === 'claimed');
    expect(won).toBeDefined();
    await repo.retry(won.pollId, 1, new Date(0));
    expect(await repo.claim()).toEqual({ kind: 'finished' });
    expect(
      [...(await service.getResults([a.pollId, b.pollId]))].map(([, r]) => r.status),
    ).toEqual(['budget_exhausted', 'budget_exhausted']);
    expect(await db.select().from(dailyAiUsage)).toMatchObject([{ calls: 2000 }]);
  });
  it('counts actual HTTP attempts, runs the next FIFO job during backoff and stops at the cap', async () => {
    const calls: string[] = [];
    const provider = createServer((req, res) => {
      calls.push(req.headers['x-request-id'] as string);
      req.resume();
      if (calls.length === 1) {
        res.writeHead(429, { 'retry-after': '60' });
        res.end();

        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Price fell.' } }] }));
    }).listen(0, '127.0.0.1');
    await once(provider, 'listening');
    try {
      const { port } = provider.address() as AddressInfo;
      const config = new ConfigService(
        Object.assign(new EnvSchema(), {
          AI_BASE_URL: 'http://127.0.0.1:' + port + '/v1',
        }),
      );
      const worker = new AiSummaryWorker(
        repo,
        new AiChatClient(config),
        env.nest.get(LoggerService),
      );
      await db
        .insert(dailyAiUsage)
        .values({ day: sql`(now() at time zone 'UTC')::date`, calls: 1997 });
      const first = request();
      const second = request();
      const third = request();
      await service.submit(first);
      await service.submit(second);
      await db
        .update(aiSummaries)
        .set({ availableAt: new Date(0) })
        .where(eq(aiSummaries.pollId, first.pollId));
      const startedAt = Date.now();
      await worker.tick();
      await service.submit(first);
      await worker.tick();
      const [retry] = await db
        .select()
        .from(aiSummaries)
        .where(eq(aiSummaries.pollId, first.pollId));
      expect(retry.availableAt.getTime()).toBeGreaterThanOrEqual(startedAt + 60_000);
      expect(retry.availableAt.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
      await db
        .update(aiSummaries)
        .set({ availableAt: new Date(0) })
        .where(eq(aiSummaries.pollId, first.pollId));
      await worker.tick();
      await service.submit(third);
      await worker.tick();
      expect(calls).toEqual([first.pollId, second.pollId, first.pollId]);
      expect(await db.select().from(dailyAiUsage)).toMatchObject([{ calls: 2000 }]);
      const results = await service.getResults([
        first.pollId,
        second.pollId,
        third.pollId,
      ]);
      expect(results.get(first.pollId)).toMatchObject({ status: 'ready' });
      expect(results.get(third.pollId)).toEqual({ status: 'budget_exhausted' });
    } finally {
      await new Promise<void>((resolve, reject) =>
        provider.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }),
      );
    }
  });
  it('starts a new UTC budget after a fully reserved previous day', async () => {
    await db
      .insert(dailyAiUsage)
      .values({ day: sql`(now() at time zone 'UTC')::date - 1`, calls: 2000 });
    const input = request();
    await service.submit(input);
    expect(await repo.claim()).toMatchObject({ pollId: input.pollId, attempt: 1 });
    expect(
      await db.select().from(dailyAiUsage).orderBy(dailyAiUsage.day),
    ).toMatchObject([{ calls: 2000 }, { calls: 1 }]);
  });
  it('orders eligible work by due time and fences writes from the expired attempt', async () => {
    const a = request();
    const b = request();
    await service.submit(a);
    await service.submit(b);
    await db
      .update(aiSummaries)
      .set({ availableAt: new Date(0) })
      .where(eq(aiSummaries.pollId, a.pollId));
    expect(await repo.claim()).toMatchObject({ pollId: a.pollId, attempt: 1 });
    expect(await repo.claim()).toMatchObject({ pollId: b.pollId, attempt: 1 });
    await db
      .update(aiSummaries)
      .set({ availableAt: new Date(0) })
      .where(eq(aiSummaries.pollId, a.pollId));
    expect(await repo.claim()).toMatchObject({ pollId: a.pollId, attempt: 2 });
    await repo.finish(a.pollId, 1, { status: S.Ready, text: 'stale' });
    expect((await service.getResults([a.pollId])).get(a.pollId)).toEqual({
      status: 'pending',
    });
    await repo.finish(a.pollId, 2, { status: S.Timeout });
    expect((await service.getResults([a.pollId])).get(a.pollId)).toEqual({
      status: 'timeout',
    });
  });
});
