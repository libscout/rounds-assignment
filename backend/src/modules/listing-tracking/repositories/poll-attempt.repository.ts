import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  lte,
  notExists,
  sql,
} from 'drizzle-orm';
import { DATABASE, type Database, type DatabaseTransaction } from '@src/tools/db';
import { watchlist, pollLogs, sourceState } from '../entities';
import { MAX_POLL_OUTPUT_CODE_UNITS } from '../consts/polling.const';
import {
  OutcomeKind,
  PollStatus,
  type PollResult,
  type PollAttempt,
  type ClaimedPoll,
  type FailedAttempt,
  type CompletePollResult,
  type MissingPollResult,
} from '../types';

type FailedPollResult = Exclude<PollResult, CompletePollResult | MissingPollResult>;
interface AttemptTiming {
  finishedAt: Date;
  retryAt: Date | null;
}

/** Claims logical polls and commits their retry history, terminal results and source cooldown. */
@Injectable()
export class PollAttemptRepository {
  /** Uses the database to update poll attempts and scheduling state together. */
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Builds the SQL expression that counts a poll’s recorded failures. */
  private static failureCount() {
    return sql<number>`jsonb_array_length(${pollLogs.failedAttempts})`;
  }

  /** Matches in-flight fetches using the partial index on unfinished polls. */
  private static fetching() {
    return and(isNull(pollLogs.finishedAt), eq(pollLogs.status, PollStatus.Fetching));
  }

  /** Matches the fetching poll only if its recorded failures agree with the claimed attempt number. */
  private static activeAttempt(poll: PollAttempt) {
    return and(
      eq(pollLogs.pollId, poll.id),
      PollAttemptRepository.fetching(),
      eq(PollAttemptRepository.failureCount(), poll.attemptNo - 1),
    );
  }

  /** Returns in-flight polls and their current attempt numbers for recovery. */
  async listFetching(): Promise<PollAttempt[]> {
    return this.db
      .select({
        id: pollLogs.pollId,
        competitorId: pollLogs.competitorId,
        attemptNo: sql<number>`${PollAttemptRepository.failureCount()} + 1`,
      })
      .from(pollLogs)
      .where(PollAttemptRepository.fetching());
  }

  /** Reads the shared deadline for resuming requests to the listing source. */
  async cooldownUntil() {
    const [state] = await this.db
      .select()
      .from(sourceState)
      .where(eq(sourceState.id, 1));

    return state.cooldownUntil;
  }

  /** Commits the source deadline independently of the poll that received the 429. */
  saveCooldown(deadline: Date) {
    return PollAttemptRepository.extendCooldown(this.db, deadline);
  }

  /** Returns the earliest scheduled poll time, or null when the watchlist has none. */
  async oldestDueAt(): Promise<Date | null> {
    const [oldest] = await this.db
      .select({ due: watchlist.nextDueAt })
      .from(watchlist)
      .where(isNotNull(watchlist.nextDueAt))
      .orderBy(asc(watchlist.nextDueAt), asc(watchlist.id))
      .limit(1);

    return oldest?.due ?? null;
  }

  /** Queues a poll for an active competitor, or returns the ID already awaiting completion. */
  requestPoll(competitorId: string) {
    return this.db.transaction(async (tx) => {
      const [listing] = await tx
        .select({ id: watchlist.id })
        .from(watchlist)
        .where(and(eq(watchlist.id, competitorId), isNotNull(watchlist.nextDueAt)))
        .for('update');
      if (!listing) {
        return;
      }
      const latest = await PollAttemptRepository.latestPoll(tx, competitorId);
      if (latest?.finishedAt === null) {
        return { pollId: latest.id, created: false };
      }
      const pollId = await PollAttemptRepository.insertPoll(
        tx,
        { competitorId, status: PollStatus.Queued },
        latest?.id,
      );
      await tx
        .update(watchlist)
        .set({ nextDueAt: sql`least(${watchlist.nextDueAt}, now())` })
        .where(eq(watchlist.id, competitorId));

      return { pollId, created: true };
    });
  }

  /** Locks the oldest eligible watchlist entry and starts a new poll or resumes its pending retry. */
  async claim(intervalMs: number): Promise<ClaimedPoll | undefined> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const listing = await PollAttemptRepository.lockNextDue(tx, now);
      if (!listing) {
        return;
      }
      const attempt = await PollAttemptRepository.startAttempt(tx, listing.id);
      await tx
        .update(watchlist)
        .set({
          lastDispatchedPollId: attempt.id,
          nextDueAt: new Date(now.getTime() + intervalMs),
        })
        .where(eq(watchlist.id, listing.id));

      return { ...attempt, competitorId: listing.id, dueAt: listing.dueAt };
    });
  }

  /** Locks the oldest due listing that has no fetch in progress. */
  private static async lockNextDue(tx: DatabaseTransaction, now: Date) {
    const fetching = tx
      .select({ id: pollLogs.pollId })
      .from(pollLogs)
      .where(
        and(eq(pollLogs.competitorId, watchlist.id), PollAttemptRepository.fetching()),
      );
    const [listing] = await tx
      .select({ id: watchlist.id, dueAt: watchlist.nextDueAt })
      .from(watchlist)
      .where(and(lte(watchlist.nextDueAt, now), notExists(fetching)))
      .orderBy(asc(watchlist.nextDueAt), asc(watchlist.id))
      .limit(1)
      .for('update', { skipLocked: true });

    return listing;
  }

  /** Reads the newest poll while the caller holds the competitor's watchlist lock. */
  private static async latestPoll(tx: DatabaseTransaction, competitorId: string) {
    const [latest] = await tx
      .select({
        id: pollLogs.pollId,
        status: pollLogs.status,
        finishedAt: pollLogs.finishedAt,
        failures: PollAttemptRepository.failureCount(),
      })
      .from(pollLogs)
      .where(eq(pollLogs.competitorId, competitorId))
      .orderBy(desc(pollLogs.pollId))
      .limit(1);

    return latest;
  }

  /** Starts a queued poll, resumes a retry, or creates a regularly scheduled poll. */
  private static async startAttempt(tx: DatabaseTransaction, competitorId: string) {
    const latest = await PollAttemptRepository.latestPoll(tx, competitorId);
    if (
      latest?.status === PollStatus.Queued ||
      latest?.status === PollStatus.WaitingRetry
    ) {
      await tx
        .update(pollLogs)
        .set({ status: PollStatus.Fetching })
        .where(eq(pollLogs.pollId, latest.id));

      return { id: latest.id, attemptNo: latest.failures + 1 };
    }
    const id = await PollAttemptRepository.insertPoll(
      tx,
      { competitorId, status: PollStatus.Fetching },
      latest?.id,
    );

    return { id, attemptNo: 1 };
  }

  /** Creates a poll with a UUID greater than the competitor’s previous poll ID. */
  private static async insertPoll(
    tx: DatabaseTransaction,
    input: { competitorId: string; status: PollStatus.Queued | PollStatus.Fetching },
    previousId?: string,
  ) {
    const pollId = previousId
      ? sql`uuidv7(greatest(
          interval '0',
          uuid_extract_timestamp(${previousId}::uuid) + interval '1 millisecond' - clock_timestamp()
        ))`
      : undefined;
    const [row] = await tx
      .insert(pollLogs)
      .values({ ...input, pollId })
      .returning({ id: pollLogs.pollId });

    return row.id;
  }

  /** Locks the watchlist entry and checks whether this poll still owns its schedule. */
  private static async ownsSchedule(tx: DatabaseTransaction, poll: PollAttempt) {
    const [owner] = await tx
      .select()
      .from(watchlist)
      .where(eq(watchlist.id, poll.competitorId))
      .for('update');

    return owner?.lastDispatchedPollId === poll.id && owner.nextDueAt !== null;
  }

  /** Drops queued work and closes a waiting retry when its competitor is removed. */
  static async cancelPending(tx: DatabaseTransaction, competitorId: string) {
    const openPoll = and(
      eq(pollLogs.competitorId, competitorId),
      isNull(pollLogs.finishedAt),
    );
    await tx
      .delete(pollLogs)
      .where(and(openPoll, eq(pollLogs.status, PollStatus.Queued)));
    await tx
      .update(pollLogs)
      .set(PollAttemptRepository.cancelledRetryUpdate())
      .where(and(openPoll, eq(pollLogs.status, PollStatus.WaitingRetry)));
  }

  /** Closes a retry at the time its last source request finished. */
  private static cancelledRetryUpdate() {
    return {
      status: PollStatus.Failed,
      finishedAt: sql<Date>`(${pollLogs.failedAttempts} -> -1 ->> 'at')::timestamptz`,
    };
  }

  /** Releases an unsent attempt, preserving prior failures and restoring its due time if still scheduled. */
  async releaseUnstarted(poll: ClaimedPoll) {
    await this.db.transaction(async (tx) => {
      const scheduled = await PollAttemptRepository.ownsSchedule(tx, poll);
      const released = await PollAttemptRepository.releaseClaim(tx, poll, scheduled);
      if (released && scheduled) {
        await tx
          .update(watchlist)
          .set({ nextDueAt: poll.dueAt })
          .where(eq(watchlist.id, poll.competitorId));
      }
    });
  }

  /** Requeues an unsent claim under its original ID or closes it when tracking stopped. */
  private static async releaseClaim(
    tx: DatabaseTransaction,
    poll: PollAttempt,
    scheduled: boolean,
  ) {
    const active = PollAttemptRepository.activeAttempt(poll);
    if (!scheduled && poll.attemptNo === 1) {
      const deleted = await tx.delete(pollLogs).where(active);

      return deleted.rowCount === 1;
    }
    const pending = poll.attemptNo === 1 ? PollStatus.Queued : PollStatus.WaitingRetry;
    const update = scheduled
      ? { status: pending }
      : PollAttemptRepository.cancelledRetryUpdate();
    const updated = await tx.update(pollLogs).set(update).where(active);

    return updated.rowCount === 1;
  }

  /** Records the active attempt’s outcome and applies any retry or cooldown in the same transaction. */
  finish(poll: PollAttempt, result: PollResult, timing: AttemptTiming) {
    return this.db.transaction(async (tx) => {
      const scheduled = await PollAttemptRepository.ownsSchedule(tx, poll);
      const retryAt = scheduled ? timing.retryAt : null;
      const changes = PollAttemptRepository.outcomeUpdate(
        result,
        timing.finishedAt,
        retryAt,
      );
      const saved = await tx
        .update(pollLogs)
        .set(changes)
        .where(PollAttemptRepository.activeAttempt(poll));
      if (saved.rowCount !== 1) {
        return;
      }
      let dueAt = retryAt;
      if (result.kind === OutcomeKind.RateLimited) {
        dueAt = await PollAttemptRepository.extendCooldown(tx, result.retryAfter);
      }
      if (changes.status === PollStatus.WaitingRetry) {
        await tx
          .update(watchlist)
          .set({ nextDueAt: dueAt })
          .where(eq(watchlist.id, poll.competitorId));
      }
    });
  }

  /** Builds the poll log update for a complete listing, confirmed absence or failed attempt. */
  private static outcomeUpdate(
    result: PollResult,
    finishedAt: Date,
    retryAt: Date | null,
  ) {
    if (result.kind === OutcomeKind.Complete) {
      return { status: PollStatus.Complete, listingFields: result.fields, finishedAt };
    }
    if (result.kind === OutcomeKind.Missing) {
      return { status: PollStatus.Missing, listingFields: null, finishedAt };
    }
    const failure = PollAttemptRepository.failedAttempt(result, finishedAt);
    const status = retryAt ? PollStatus.WaitingRetry : PollStatus.Failed;
    const completedAt = retryAt ? null : finishedAt;

    return {
      status,
      failedAttempts: sql`${pollLogs.failedAttempts} || ${JSON.stringify([failure])}::jsonb`,
      finishedAt: completedAt,
    };
  }

  /** Records failure details and bounds the source output before saving it as JSON. */
  private static failedAttempt(
    result: FailedPollResult,
    finishedAt: Date,
  ): FailedAttempt {
    const fields = result.kind === OutcomeKind.Partial ? result.fields : undefined;
    const rawOutput = 'output' in result ? result.output : undefined;
    const output = rawOutput
      ?.slice(0, MAX_POLL_OUTPUT_CODE_UNITS)
      .replaceAll('\0', '\uFFFD')
      .replace(/[\uD800-\uDFFF]/gu, '\uFFFD');

    return {
      at: finishedAt.toISOString(),
      kind: result.kind,
      httpStatus: result.httpStatus,
      fields,
      output,
    };
  }

  /** Extends the shared source cooldown and returns the effective retry deadline. */
  private static async extendCooldown(db: Pick<Database, 'update'>, retryAfter: Date) {
    const [state] = await db
      .update(sourceState)
      .set({
        cooldownUntil: sql`greatest(${sourceState.cooldownUntil},${retryAfter.toISOString()}::timestamptz)`,
      })
      .where(eq(sourceState.id, 1))
      .returning({ until: sourceState.cooldownUntil });

    return state.until;
  }
}
