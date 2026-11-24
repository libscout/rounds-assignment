import { Inject, Injectable } from '@nestjs/common';
import { and, gte, inArray, desc } from 'drizzle-orm';
import { DATABASE, type Database } from '@src/tools/db';
import { listingChanges } from '../entities';
import type { ListingDiff, Observation } from '../types';

/** Stores each changed poll once and finds listing changes by poll ID or competitor and time. */
@Injectable()
export class ListingChangeRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async insertOnce(observation: Observation, diff: ListingDiff): Promise<void> {
    const { pollId, competitorId, observedAt } = observation;
    await this.db
      .insert(listingChanges)
      .values({ pollId, competitorId, observedAt, ...diff })
      .onConflictDoNothing({ target: listingChanges.pollId });
  }

  async byPollIds(ids: string[]) {
    if (!ids.length) return [];
    return this.db
      .select({
        pollId: listingChanges.pollId,
        competitorId: listingChanges.competitorId,
        observedAt: listingChanges.observedAt,
        kind: listingChanges.kind,
        changedFields: listingChanges.changedFields,
        summary: listingChanges.summary,
        summaryStatus: listingChanges.summaryStatus,
      })
      .from(listingChanges)
      .where(inArray(listingChanges.pollId, ids))
      .orderBy(desc(listingChanges.observedAt), desc(listingChanges.pollId));
  }

  async changedSince(ids: string[], since: Date): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.db
      .selectDistinct({ id: listingChanges.competitorId })
      .from(listingChanges)
      .where(and(inArray(listingChanges.competitorId, ids), gte(listingChanges.observedAt, since)));
    return new Set(rows.map((row) => row.id));
  }
}
