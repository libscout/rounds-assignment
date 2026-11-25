import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNotNull, isNull, asc, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '@src/tools/db';
import { pollLogs as polls } from '../entities';
import { PollStatus } from '../types';

/** Pages one outstanding source observation per competitor in claim order. */
@Injectable()
export class PollDeliveryRepository {
  /** Uses the tracking log to find and acknowledge deliverable polls. */
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Matches finished complete or missing polls that still await acknowledgement. */
  private static outstanding() {
    return and(
      isNull(polls.deliveredAt),
      isNotNull(polls.finishedAt),
      inArray(polls.status, [PollStatus.Complete, PollStatus.Missing]),
    );
  }

  /** Pages by competitor ID and returns the oldest outstanding poll for each competitor. */
  async list(limit: number, after?: string) {
    const afterCompetitor = after ? gt(polls.competitorId, after) : undefined;
    const rows = await this.db
      .selectDistinctOn([polls.competitorId], {
        pollId: polls.pollId,
        key: polls.competitorId,
      })
      .from(polls)
      .where(and(PollDeliveryRepository.outstanding(), afterCompetitor))
      .orderBy(asc(polls.competitorId), asc(polls.pollId))
      .limit(limit);

    const next = rows.length === limit ? rows[rows.length - 1].key : undefined;

    return {
      items: rows.map(({ pollId }) => ({ pollId })),
      next,
    };
  }

  /** Returns the competitor’s oldest outstanding poll ID, or undefined when none is waiting. */
  async head(competitorId: string) {
    const [row] = await this.db
      .select({ id: polls.pollId })
      .from(polls)
      .where(
        and(PollDeliveryRepository.outstanding(), eq(polls.competitorId, competitorId)),
      )
      .orderBy(asc(polls.pollId))
      .limit(1);

    return row?.id;
  }

  /** Sets the delivery timestamp only while the poll is outstanding. */
  async acknowledge(id: string) {
    await this.db
      .update(polls)
      .set({ deliveredAt: sql`now()` })
      .where(and(eq(polls.pollId, id), PollDeliveryRepository.outstanding()));
  }
}
