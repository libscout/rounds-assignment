import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { DATABASE, type Database } from '@src/tools/db';
import { PollStatus } from '../types';
import { pollLogs, watchlist } from '../entities';

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

  /** Clears the competitor’s schedule and closes any poll waiting for a retry. */
  async deactivate(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(watchlist)
        .set({ nextDueAt: null, lastDispatchedPollId: null })
        .where(eq(watchlist.id, id));
      await tx
        .update(pollLogs)
        .set({ status: PollStatus.Failed, finishedAt: new Date() })
        .where(
          and(
            eq(pollLogs.competitorId, id),
            eq(pollLogs.status, PollStatus.WaitingRetry),
          ),
        );
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
