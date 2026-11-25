import { Injectable, Inject } from '@nestjs/common';
import { and, asc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import { DATABASE, type Database, type DatabaseTransaction } from '@src/tools/db';
import { aiSummaries as jobs } from '../entities/ai-summary.table';
import { dailyAiUsage } from '../entities/daily-ai-usage.table';
import {
  SummaryStatus,
  SummarySubmissionOutcome,
  type ClaimedSummaryJob,
  type FinishedSummaryClaim,
  type PendingSummaryResult,
  type SubmitSummary,
  type SummaryClaim,
  type SummaryProvider,
  type SummaryResult,
} from '../types';
import { DAILY_AI_LIMIT, MAX_AI_ATTEMPTS } from '../consts/ai-limits.const';

type Terminal = Exclude<SummaryResult, PendingSummaryResult>;

/** Owns the durable FIFO requests, worker leases, guarded outcomes and UTC quota reservations. */
@Injectable()
export class AiSummaryRepository {
  /** Uses the database shared by summary jobs and the daily call counter. */
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Accepts new or identical submissions and reports a different stored diff for the same poll. */
  submit(input: SubmitSummary): Promise<SummarySubmissionOutcome> {
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(jobs)
        .values(input)
        .onConflictDoNothing()
        .returning({ id: jobs.pollId });
      if (inserted.length) {
        return SummarySubmissionOutcome.Accepted;
      }
      const [existing] = await tx
        .select({ id: jobs.pollId })
        .from(jobs)
        .where(and(eq(jobs.pollId, input.pollId), eq(jobs.diff, input.diff)));

      return existing
        ? SummarySubmissionOutcome.Accepted
        : SummarySubmissionOutcome.ConflictingDiff;
    });
  }

  /** Leases the oldest due job and reserves quota only when the provider can send it. */
  claim({ canSend, usesLiveProvider }: SummaryProvider): Promise<SummaryClaim> {
    return this.db.transaction<SummaryClaim>(async (tx) => {
      const job = await AiSummaryRepository.lockNextJob(tx);
      if (!job) {
        return { kind: 'idle' };
      }
      if (!canSend || job.attemptCount >= MAX_AI_ATTEMPTS) {
        return AiSummaryRepository.closeJob(tx, job.pollId, SummaryStatus.Failed);
      }
      const reserved = await AiSummaryRepository.reserveDailyCall(tx, usesLiveProvider);
      if (!reserved) {
        return AiSummaryRepository.closeJob(
          tx,
          job.pollId,
          SummaryStatus.BudgetExhausted,
        );
      }

      return AiSummaryRepository.startAttempt(tx, job.pollId, job.attemptCount + 1);
    });
  }

  /** Starts the next attempt and returns its diff to the worker. */
  private static async startAttempt(
    tx: DatabaseTransaction,
    id: string,
    attempt: number,
  ): Promise<ClaimedSummaryJob> {
    const [job] = await tx
      .update(jobs)
      .set({
        status: SummaryStatus.Running,
        attemptCount: attempt,
        availableAt: sql`now() + interval '30 seconds'`,
      })
      .where(eq(jobs.pollId, id))
      .returning({ diff: jobs.diff });

    return { kind: 'claimed', pollId: id, diff: job.diff, attempt };
  }

  /** Locks the earliest due queued job or expired lease, skipping rows held by another worker. */
  private static async lockNextJob(tx: DatabaseTransaction) {
    const { pollId, attemptCount, status, availableAt } = jobs;
    const [job] = await tx
      .select({ pollId, attemptCount })
      .from(jobs)
      .where(
        and(
          inArray(status, [SummaryStatus.Queued, SummaryStatus.Running]),
          lte(availableAt, sql`now()`),
        ),
      )
      .orderBy(asc(availableAt), asc(pollId))
      .limit(1)
      .for('update', { skipLocked: true });

    return job;
  }

  /** Increments today's UTC call count atomically and returns false when the budget is full. */
  private static async reserveDailyCall(
    tx: DatabaseTransaction,
    usesLiveProvider: boolean,
  ) {
    const { day, calls, liveCalls } = dailyAiUsage;
    const live = Number(usesLiveProvider);
    const result = await tx
      .insert(dailyAiUsage)
      .values({
        day: sql`(statement_timestamp() at time zone 'UTC')::date`,
        calls: 1,
        liveCalls: live,
      })
      .onConflictDoUpdate({
        target: day,
        set: { calls: sql`${calls} + 1`, liveCalls: sql`${liveCalls} + ${live}` },
        setWhere: lt(calls, DAILY_AI_LIMIT),
      });

    return result.rowCount === 1;
  }

  /** Closes a locked job that cannot start another attempt. */
  private static async closeJob(
    tx: DatabaseTransaction,
    id: string,
    status: SummaryStatus.Failed | SummaryStatus.BudgetExhausted,
  ): Promise<FinishedSummaryClaim> {
    await tx
      .update(jobs)
      .set({ status, completedAt: sql`now()`, availableAt: null })
      .where(eq(jobs.pollId, id));

    return { kind: 'finished' };
  }

  /** Matches the running attempt allowed to update this summary job. */
  private static activeAttempt(id: string, attempt: number) {
    return and(
      eq(jobs.pollId, id),
      eq(jobs.status, SummaryStatus.Running),
      eq(jobs.attemptCount, attempt),
    );
  }

  /** Requeues the matching attempt for the specified time. */
  async retry(id: string, attempt: number, availableAt: Date) {
    await this.db
      .update(jobs)
      .set({ status: SummaryStatus.Queued, availableAt })
      .where(AiSummaryRepository.activeAttempt(id, attempt));
  }

  /** Saves the terminal outcome and any summary text if the attempt still owns the job. */
  async finish(id: string, attempt: number, result: Terminal) {
    const summaryText = result.status === SummaryStatus.Ready ? result.text : null;
    await this.db
      .update(jobs)
      .set({
        status: result.status,
        summaryText,
        completedAt: sql`now()`,
        availableAt: null,
      })
      .where(AiSummaryRepository.activeAttempt(id, attempt));
  }

  /** Returns outcomes by poll ID, reporting queued and running jobs as pending. */
  async results(ids: string[]): Promise<Map<string, SummaryResult>> {
    const rows = await this.db
      .select({ id: jobs.pollId, status: jobs.status, text: jobs.summaryText })
      .from(jobs)
      .where(inArray(jobs.pollId, ids));

    return new Map<string, SummaryResult>(
      rows.map(({ id, status, text }) => {
        if (status === SummaryStatus.Queued || status === SummaryStatus.Running) {
          return [id, { status: 'pending' }];
        }
        if (status === SummaryStatus.Ready) {
          return [id, { status, text }];
        }

        return [id, { status }];
      }),
    );
  }
}
