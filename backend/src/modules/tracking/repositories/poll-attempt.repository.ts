import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, lte, notExists, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DATABASE, type Database } from '@src/tools/db';
import { watchlist, pollAttempts, sourceState } from '../entities';
import {
  type PollResult,
  type ClaimedPoll,
  type PollReschedule,
  OutcomeKind,
  PollStatus,
} from '../types';

/** Claims due polls and persists their outcomes, retry schedules, and source cooldowns. */
@Injectable()
export class PollAttemptRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async recover(): Promise<Date | null> {
    const now = new Date();
    await this.db
      .update(pollAttempts)
      .set({
        status: PollStatus.Error,
        outcomeKind: OutcomeKind.Interrupted,
        finishedAt: now,
        nextDeliveryAt: now,
      })
      .where(eq(pollAttempts.status, PollStatus.Pending));
    const [state] = await this.db.select().from(sourceState).where(eq(sourceState.id, 1));
    return state.cooldownUntil;
  }

  async oldestDueAt(): Promise<Date | null> {
    const [oldest] = await this.db
      .select({ due: watchlist.nextDueAt })
      .from(watchlist)
      .where(eq(watchlist.active, true))
      .orderBy(asc(watchlist.nextDueAt), asc(watchlist.id))
      .limit(1);
    return oldest?.due ?? null;
  }

  async claim(intervalMs: number): Promise<ClaimedPoll | undefined> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [row] = await tx
        .select()
        .from(watchlist)
        .where(
          and(
            eq(watchlist.active, true),
            lte(watchlist.nextDueAt, now),
            notExists(
              tx
                .select({ id: pollAttempts.id })
                .from(pollAttempts)
                .where(
                  and(
                    eq(pollAttempts.competitorId, watchlist.id),
                    isNull(pollAttempts.processedAt),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(watchlist.nextDueAt), asc(watchlist.id))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!row) return;
      const id = randomUUID();
      await tx
        .insert(pollAttempts)
        .values({ id, competitorId: row.id, attemptNo: row.nextAttemptNo, createdAt: now });
      await tx
        .update(watchlist)
        .set({
          lastDispatchedPollId: id,
          nextAttemptNo: 1,
          nextDueAt: new Date(now.getTime() + intervalMs),
        })
        .where(eq(watchlist.id, row.id));
      return { id, competitorId: row.id, attemptNo: row.nextAttemptNo, dueAt: row.nextDueAt };
    });
  }

  // A cooldown or shutdown can arrive while the claim transaction is in progress.
  async releaseUnstarted(poll: ClaimedPoll): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(watchlist)
        .set({ nextDueAt: poll.dueAt, nextAttemptNo: poll.attemptNo, lastDispatchedPollId: null })
        .where(
          and(eq(watchlist.id, poll.competitorId), eq(watchlist.lastDispatchedPollId, poll.id)),
        );
      await tx.delete(pollAttempts).where(eq(pollAttempts.id, poll.id));
    });
  }

  async finish(
    poll: ClaimedPoll,
    result: PollResult,
    finishedAt: Date,
    status: PollStatus,
    schedule: PollReschedule | null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [saved] = await tx
        .update(pollAttempts)
        .set({
          status,
          outcomeKind: result.kind,
          httpStatus: result.httpStatus ?? null,
          response: 'fields' in result ? result.fields : null,
          finishedAt,
          nextDeliveryAt: finishedAt,
        })
        .where(and(eq(pollAttempts.id, poll.id), eq(pollAttempts.status, PollStatus.Pending)))
        .returning({ id: pollAttempts.id });
      if (!saved) return; // Replayed commit after an uncertain acknowledgement.
      if (!schedule) return;
      let due = schedule.nextDueAt;
      if (result.kind === OutcomeKind.RateLimited) {
        const [state] = await tx
          .update(sourceState)
          .set({
            cooldownUntil: sql`greatest(${sourceState.cooldownUntil}, ${due.toISOString()}::timestamptz)`,
          })
          .where(eq(sourceState.id, 1))
          .returning({ cooldownUntil: sourceState.cooldownUntil });
        due = state.cooldownUntil;
      }
      await tx
        .update(watchlist)
        .set({ nextDueAt: due, nextAttemptNo: schedule.nextAttemptNo })
        .where(
          and(
            eq(watchlist.id, poll.competitorId),
            eq(watchlist.active, true),
            eq(watchlist.lastDispatchedPollId, poll.id),
          ),
        );
    });
  }
}
