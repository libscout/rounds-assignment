import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '@src/tools/db';
import { pollExecutions as work } from '../entities/poll-execution.table';
import { ExecutionStatus, type PollExecutionStatus } from '../types';

/** Stores execution statuses and selects eligible work without copying leaf payloads. */
@Injectable()
export class PollExecutionRepository {
  /** Uses the database to track module progress for each poll. */
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Matches the poll while its comparison can still change status. */
  private static incompleteComparison(id: string) {
    return and(
      eq(work.pollId, id),
      ne(work.changeHistoryStatus, ExecutionStatus.Completed),
    );
  }

  /** Registers the poll once and returns its current module statuses. */
  async discover(pollId: string, trackingFinishedAt: Date) {
    await this.db
      .insert(work)
      .values({ pollId, trackingFinishedAt })
      .onConflictDoNothing();
    const [row] = await this.statuses([pollId]);

    return row;
  }

  /** Reads the comparison and AI execution statuses for the requested polls. */
  async statuses(ids: string[]): Promise<PollExecutionStatus[]> {
    const { pollId, changeHistoryStatus, aiSummaryStatus } = work;

    return this.db
      .select({ pollId, changeHistoryStatus, aiSummaryStatus })
      .from(work)
      .where(inArray(pollId, ids));
  }

  /** Returns the poll ID and tracking finish time if the comparison is in error. */
  async comparisonErrorForPoll(id: string) {
    const { pollId, trackingFinishedAt, changeHistoryStatus } = work;
    const [row] = await this.db
      .select({ pollId, trackingFinishedAt })
      .from(work)
      .where(and(eq(pollId, id), eq(changeHistoryStatus, ExecutionStatus.Error)));

    return row ?? null;
  }

  /** Marks a previously unsubmitted comparison as submitted. */
  begin(id: string) {
    return this.db
      .update(work)
      .set({ changeHistoryStatus: ExecutionStatus.Submitted })
      .where(
        and(
          eq(work.pollId, id),
          eq(work.changeHistoryStatus, ExecutionStatus.NotSubmitted),
        ),
      );
  }

  /** Records a comparison error while the comparison is still incomplete. */
  comparisonError(id: string) {
    return this.db
      .update(work)
      .set({ changeHistoryStatus: ExecutionStatus.Error })
      .where(PollExecutionRepository.incompleteComparison(id));
  }

  /** Completes the comparison and marks whether the poll needs an AI summary. */
  finishComparison(id: string, changed: boolean) {
    const aiSummaryStatus = changed
      ? ExecutionStatus.NotSubmitted
      : ExecutionStatus.NotRequired;

    return this.db
      .update(work)
      .set({
        changeHistoryStatus: ExecutionStatus.Completed,
        aiSummaryStatus,
      })
      .where(PollExecutionRepository.incompleteComparison(id));
  }

  /** Updates AI progress only when the comparison is complete and the prior AI status matches. */
  aiTransition(id: string, from: ExecutionStatus, to: ExecutionStatus) {
    return this.db
      .update(work)
      .set({ aiSummaryStatus: to })
      .where(and(eq(work.pollId, id), PollExecutionRepository.eligibleForAi(from)));
  }

  /** Matches completed comparisons with the expected AI status for scanning or updating. */
  private static eligibleForAi(status: ExecutionStatus) {
    return and(
      eq(work.changeHistoryStatus, ExecutionStatus.Completed),
      eq(work.aiSummaryStatus, status),
    );
  }

  /** Pages through completed comparisons with the requested AI status in tracking finish order. */
  async page(status: ExecutionStatus, limit: number, after?: string) {
    const position = this.db
      .select({ at: work.trackingFinishedAt, id: work.pollId })
      .from(work)
      .where(eq(work.pollId, after));
    const cursorFilter = after
      ? sql`(${work.trackingFinishedAt},${work.pollId}) > ${position}`
      : undefined;
    const rows = await this.db
      .select({ pollId: work.pollId })
      .from(work)
      .where(and(PollExecutionRepository.eligibleForAi(status), cursorFilter))
      .orderBy(asc(work.trackingFinishedAt), asc(work.pollId))
      .limit(limit);

    const next = rows.length === limit ? rows[rows.length - 1].pollId : undefined;

    return {
      items: rows,
      next,
    };
  }
}
