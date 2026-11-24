import { Inject, Injectable } from '@nestjs/common';
import { lt, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '@src/tools/db';
import { DAILY_AI_LIMIT, dailyAiUsage } from '../entities';

/** Reserves AI calls atomically against the shared daily UTC limit. */
@Injectable()
export class DailyAiUsageRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async reserveCall(): Promise<boolean> {
    const reserved = await this.db
      .insert(dailyAiUsage)
      .values({ day: sql`(now() at time zone 'UTC')::date`, calls: 1 })
      .onConflictDoUpdate({
        target: dailyAiUsage.day,
        set: { calls: sql`${dailyAiUsage.calls} + 1` },
        setWhere: lt(dailyAiUsage.calls, DAILY_AI_LIMIT),
      })
      .returning({ calls: dailyAiUsage.calls });
    return reserved.length > 0;
  }
}
