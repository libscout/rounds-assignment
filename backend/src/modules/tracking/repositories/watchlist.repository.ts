import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DATABASE, type Database } from '@src/tools/db';
import { watchlist } from '../entities';

/** Stores which competitors are active and schedules them when tracking starts. */
@Injectable()
export class WatchlistRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async activate(id: string, nextDueAt: Date): Promise<void> {
    await this.db
      .insert(watchlist)
      .values({ id, nextDueAt })
      .onConflictDoUpdate({
        target: watchlist.id,
        setWhere: eq(watchlist.active, false),
        set: { active: true, nextDueAt, nextAttemptNo: 1, lastDispatchedPollId: null },
      });
  }

  async deactivate(id: string): Promise<void> {
    await this.db
      .update(watchlist)
      .set({ active: false, nextDueAt: null, nextAttemptNo: 1, lastDispatchedPollId: null })
      .where(eq(watchlist.id, id));
  }

  async listActiveIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: watchlist.id })
      .from(watchlist)
      .where(eq(watchlist.active, true))
      .orderBy(watchlist.id);
    return rows.map(({ id }) => id);
  }
}
