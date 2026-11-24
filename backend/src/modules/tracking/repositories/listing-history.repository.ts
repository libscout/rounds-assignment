import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '@src/tools/db';
import { listingVersions, pollAttempts } from '../entities';
import { legacyListingSnapshots as archive } from '../entities/legacy-listing-snapshot.table';
import { OutcomeKind, type ListingFields, type PollObservation } from '../types';

/** Reads processed listing observations and comparison baselines and tracks legacy change imports. */
@Injectable()
export class ListingHistoryRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findProcessed(
    competitorId: string,
    limit: number,
    cursor?: string,
  ): Promise<PollObservation[] | null> {
    // Include the cursor row so a valid final page can be distinguished from an unknown cursor.
    const rows = await this.selectObservations()
      .where(
        and(
          eq(pollAttempts.competitorId, competitorId),
          isNotNull(pollAttempts.processedAt),
          cursor ? this.atOrBeforeCursor(competitorId, cursor) : undefined,
        ),
      )
      .orderBy(
        sql`${pollAttempts.finishedAt} desc nulls last`,
        sql`${pollAttempts.id} desc nulls last`,
      )
      .limit(cursor ? limit + 1 : limit);

    if (!cursor) return rows;
    return rows.length ? rows.slice(1) : null;
  }

  private atOrBeforeCursor(competitorId: string, cursor: string) {
    const { finishedAt, id, processedAt } = pollAttempts;
    const position = this.db
      .select({ finishedAt, id })
      .from(pollAttempts)
      .where(
        and(eq(id, cursor), eq(pollAttempts.competitorId, competitorId), isNotNull(processedAt)),
      );
    return sql`(${finishedAt}, ${id}) <= ${position}`;
  }

  private selectObservations() {
    const { id, finishedAt, outcomeKind, response, versionId } = pollAttempts;
    return this.db
      .select({
        pollId: id,
        finishedAt,
        outcomeKind,
        fields: sql<ListingFields | null>`case
        when ${outcomeKind} = ${OutcomeKind.Complete} then ${listingVersions.fields}
        when ${outcomeKind} = ${OutcomeKind.Partial} then ${response}
      end`,
      })
      .from(pollAttempts)
      .leftJoin(listingVersions, eq(listingVersions.id, versionId));
  }

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
