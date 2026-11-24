import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '@src/tools/db';
import { listingVersions, pollAttempts } from '../entities';
import { legacyListingSnapshots as archive } from '../entities/legacy-listing-snapshot.table';
import { OutcomeKind } from '../types';

/** Looks up prior listing content and visibility and tracks which legacy changes have been imported. */
@Injectable()
export class ListingHistoryRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findBaseline(competitorId: string, before?: { time: Date; id: string }) {
    const prior = and(
      eq(pollAttempts.competitorId, competitorId),
      isNotNull(pollAttempts.processedAt),
      before
        ? sql`(${pollAttempts.finishedAt}, ${pollAttempts.id}) < (${before.time.toISOString()}::timestamptz, ${before.id}::uuid)`
        : undefined,
    );
    const order = [desc(pollAttempts.finishedAt), desc(pollAttempts.id)];
    const [previous] = await this.db
      .select({ id: listingVersions.id, fields: listingVersions.fields })
      .from(pollAttempts)
      .innerJoin(listingVersions, eq(pollAttempts.versionId, listingVersions.id))
      .where(and(prior, eq(pollAttempts.outcomeKind, OutcomeKind.Complete)))
      .orderBy(...order)
      .limit(1);
    const [availability] = await this.db
      .select({ kind: pollAttempts.outcomeKind })
      .from(pollAttempts)
      .where(
        and(prior, inArray(pollAttempts.outcomeKind, [OutcomeKind.Complete, OutcomeKind.Missing])),
      )
      .orderBy(...order)
      .limit(1);
    return {
      versionId: previous?.id ?? null,
      previousFields: previous?.fields ?? null,
      previouslyVisible: availability ? availability.kind === OutcomeKind.Complete : null,
    };
  }

  async findUnimportedChanges(limit: number) {
    return this.db
      .select({
        id: archive.pollId,
        competitorId: archive.competitorId,
        time: archive.fetchedAt,
        kind: archive.outcomeKind,
        fields: listingVersions.fields,
      })
      .from(archive)
      .leftJoin(listingVersions, eq(listingVersions.id, archive.versionId))
      .where(and(eq(archive.changed, true), eq(archive.changeImported, false)))
      .orderBy(asc(archive.fetchedAt), asc(archive.pollId))
      .limit(limit);
  }

  async markImported(pollId: string): Promise<void> {
    await this.db.update(archive).set({ changeImported: true }).where(eq(archive.pollId, pollId));
  }
}
