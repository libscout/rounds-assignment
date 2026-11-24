import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { listingChanges } from '@src/modules/change-history/entities';
import { listingVersions, pollAttempts } from '@src/modules/tracking/entities';
import { OutcomeKind } from '@src/modules/tracking/types';
import { DATABASE, type Database } from '@src/tools/db';

/** Reads published change events with their observed listing, newest first. */
@Injectable()
export class ChangeFeedRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async page(competitorId: string, limit: number, cursor?: string) {
    const { pollId, observedAt } = listingChanges;
    const rows = await this.db
      .select({
        change: listingChanges,
        finishedAt: pollAttempts.finishedAt,
        outcomeKind: pollAttempts.outcomeKind,
        fields: listingVersions.fields,
      })
      .from(listingChanges)
      .innerJoin(pollAttempts, eq(pollAttempts.id, pollId))
      .leftJoin(
        listingVersions,
        and(
          eq(listingVersions.id, pollAttempts.versionId),
          eq(pollAttempts.outcomeKind, OutcomeKind.Complete),
        ),
      )
      .where(
        and(
          eq(listingChanges.competitorId, competitorId),
          isNotNull(pollAttempts.processedAt),
          cursor ? this.atOrBefore(cursor) : undefined,
        ),
      )
      .orderBy(desc(observedAt), desc(pollId))
      .limit(cursor ? limit + 1 : limit);

    if (!cursor) return rows;
    return rows[0]?.change.pollId === cursor ? rows.slice(1) : null;
  }

  private atOrBefore(cursor: string) {
    const { observedAt, pollId } = listingChanges;
    const position = this.db
      .select({ observedAt, pollId })
      .from(listingChanges)
      .where(eq(pollId, cursor));
    return sql`(${observedAt}, ${pollId}) <= ${position}`;
  }
}
