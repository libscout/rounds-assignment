import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { DATABASE, type Database } from '@src/tools/db';
import { pollLogs } from '../entities';
import { OutcomeKind, PollStatus, type PollObservation } from '../types';
import { observationColumns } from '../consts/observation-columns.const';

const { pollId, competitorId, finishedAt } = observationColumns;
type FinishedLog = Pick<typeof pollLogs.$inferSelect, keyof typeof observationColumns>;

/** Reads finished logical polls, including their preceding failed attempts, directly from the log. */
@Injectable()
export class ListingHistoryRepository {
  /** Uses the tracking log to read finished poll observations. */
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Matches finished poll rows for one competitor. */
  private static finishedFor(id: string) {
    return and(eq(competitorId, id), isNotNull(finishedAt));
  }

  /** Reads finished polls newest first and returns null if the cursor is invalid for this competitor. */
  async findFinished(
    id: string,
    limit: number,
    cursor?: string,
  ): Promise<PollObservation[] | null> {
    const finished = ListingHistoryRepository.finishedFor(id);
    const cursorFilter = this.atOrBeforeCursor(finished, cursor);
    const fetchLimit = cursor ? limit + 1 : limit;
    const rows = await this.db
      .select(observationColumns)
      .from(pollLogs)
      .where(and(finished, cursorFilter))
      .orderBy(desc(finishedAt), desc(pollId))
      .limit(fetchLimit);
    if (cursor && rows[0]?.pollId !== cursor) {
      return null;
    }

    const pageRows = cursor ? rows.slice(1) : rows;

    return pageRows.map(ListingHistoryRepository.observation);
  }

  /** Builds the inclusive page boundary for this competitor’s finished polls. */
  private atOrBeforeCursor(finished: SQL, cursor?: string) {
    if (!cursor) {
      return undefined;
    }
    const position = this.db
      .select({ finishedAt, pollId })
      .from(pollLogs)
      .where(and(finished, eq(pollId, cursor)));

    return sql`(${finishedAt},${pollId}) <= ${position}`;
  }

  /** Returns observations for the requested poll IDs that have finished. */
  async byIds(ids: string[]) {
    const rows = await this.db
      .select(observationColumns)
      .from(pollLogs)
      .where(and(inArray(pollId, ids), isNotNull(finishedAt)));

    return rows.map(ListingHistoryRepository.observation);
  }

  /** Maps a finished log row to an observation, using the last failure for a failed poll. */
  private static observation(this: void, row: FinishedLog) {
    const lastFailure = row.failedAttempts[row.failedAttempts.length - 1];
    let outcomeKind = OutcomeKind.Missing;
    let fields = row.listingFields;
    if (row.status === PollStatus.Failed) {
      outcomeKind = lastFailure.kind;
      fields = lastFailure.fields ?? null;
    } else if (row.status === PollStatus.Complete) {
      outcomeKind = OutcomeKind.Complete;
    }

    return {
      pollId: row.pollId,
      competitorId: row.competitorId,
      finishedAt: row.finishedAt,
      outcomeKind,
      fields,
      failedAttempts: row.failedAttempts,
    };
  }
}
