import { Inject, Injectable } from '@nestjs/common';
import { eq, isNull, isNotNull } from 'drizzle-orm';
import { DATABASE, type Database } from '@src/tools/db';
import { watchlist } from '../entities';
import { PollAttemptRepository } from './poll-attempt.repository';

/** Stores which competitors are active and schedules them when tracking starts. */
@Injectable()
export class WatchlistRepository {
  /** Uses the database to keep watchlist membership and poll scheduling in sync. */
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Schedules a new or inactive competitor and preserves an active competitor’s existing due time. */
  async activate(id: string, nextDueAt: Date): Promise<void> {
    await this.db
      .insert(watchlist)
      .values({ id, nextDueAt })
      .onConflictDoUpdate({
        target: watchlist.id,
        setWhere: isNull(watchlist.nextDueAt),
        set: { nextDueAt, lastDispatchedPollId: null },
      });
  }

  /** Removes unsent work and closes waiting retries when a competitor is untracked. */
  async deactivate(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(watchlist)
        .set({ nextDueAt: null, lastDispatchedPollId: null })
        .where(eq(watchlist.id, id));
      await PollAttemptRepository.cancelPending(tx, id);
    });
  }

  /** Returns scheduled competitor IDs in ascending order. */
  async listActiveIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: watchlist.id })
      .from(watchlist)
      .where(isNotNull(watchlist.nextDueAt))
      .orderBy(watchlist.id);

    return rows.map(({ id }) => id);
  }
}
