import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database } from '@src/tools/db';

/** Clears the local demo's application data in one transaction. */
@Injectable()
export class DemoResetRepository {
  /** Uses the same database as the workers whose progress is being cleared. */
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Clears all demo state while preserving calls already reserved for live providers today. */
  async clear() {
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`truncate table watchlist, poll_logs, listing_comparisons, poll_executions, ai_summaries`,
      );
      await tx.execute(sql`update source_state set cooldown_until = null where id = 1`);
      await tx.execute(
        sql`delete from daily_ai_usage where day <> (now() at time zone 'UTC')::date or live_calls = 0`,
      );
      await tx.execute(sql`update daily_ai_usage set calls = live_calls`);
    });
  }
}
