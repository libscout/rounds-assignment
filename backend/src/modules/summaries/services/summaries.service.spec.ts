import { DailyAiUsageRepository } from '@src/modules/summaries/repositories/daily-ai-usage.repository';
import { TestEnv } from '@test/nest';
import { DATABASE, type Database } from '@src/tools/db';
import { MockAiClient } from '@src/external/ai/mock-ai.client';
import { dailyAiUsage, DAILY_AI_LIMIT } from '../entities';
import { SummariesService } from './summaries.service';

describe('SummariesService daily quota', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await TestEnv.create({
      providers: [DailyAiUsageRepository, SummariesService, MockAiClient],
    });
  }, 180000);
  afterAll(async () => {
    await env?.cleanup();
  });
  it('reserves the last UTC slot once across concurrent competitors', async () => {
    const db = env.nest.get<Database>(DATABASE),
      service = env.nest.get(SummariesService);
    await db
      .insert(dailyAiUsage)
      .values({ day: new Date().toISOString().slice(0, 10), calls: DAILY_AI_LIMIT - 1 });
    const spy = jest.spyOn(env.nest.get(MockAiClient), 'summarize');
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        service.summarize({ kind: 'disappeared', changedFields: {} }),
      ),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r === null)).toHaveLength(5);
    expect(await db.select().from(dailyAiUsage)).toMatchObject([{ calls: DAILY_AI_LIMIT }]);
  });
});
