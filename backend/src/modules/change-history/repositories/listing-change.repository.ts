import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { DATABASE, type Database, type DatabaseTransaction } from '@src/tools/db';
import { listingComparisons as comparisons } from '../entities';
import { ListingComparison } from '../internal/listing-comparison';
import { ObservationKind, type ListingChange, type Observation } from '../types';
import { decisionColumns } from '../consts/decision-columns.const';

const { pollId, competitorId, observedAt, diff } = decisionColumns;
type SavedComparison = Pick<
  typeof comparisons.$inferSelect,
  keyof typeof decisionColumns
>;

/** Records source-ordered observations and serves their original comparison decisions. */
@Injectable()
export class ListingChangeRepository {
  /** Uses the database to store and query listing comparisons. */
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Matches a competitor’s comparison rows that contain a diff. */
  private static changedFor(id: string) {
    return and(eq(competitorId, id), isNotNull(diff));
  }

  /** Compares the next observation in source order and returns the saved decision on replay. */
  record(input: Observation) {
    return this.db.transaction(async (tx) => {
      await ListingChangeRepository.lockCompetitor(tx, input.competitorId);
      const [saved] = await tx
        .select(decisionColumns)
        .from(comparisons)
        .where(eq(pollId, input.pollId));
      if (saved) {
        return ListingChangeRepository.decision(saved);
      }

      const baseline = await ListingChangeRepository.priorListing(tx, input);
      const listingState =
        input.current.kind === ObservationKind.Complete ? input.current.fields : null;
      const [row] = await tx
        .insert(comparisons)
        .values({
          pollId: input.pollId,
          competitorId: input.competitorId,
          observedAt: input.observedAt,
          listingState,
          diff: ListingComparison.compare({ ...input, ...baseline }),
        })
        .returning(decisionColumns);

      return ListingChangeRepository.decision(row);
    });
  }

  /** Serializes comparisons for a competitor, including its first observation. */
  private static lockCompetitor(tx: DatabaseTransaction, id: string) {
    return tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${id}, 0))`);
  }

  /** Finds the previous comparison and the last visible listing when a competitor reappears. */
  private static async priorListing(tx: DatabaseTransaction, input: Observation) {
    const forCompetitor = eq(competitorId, input.competitorId);
    const [latest] = await tx
      .select({ pollId, listingState: comparisons.listingState })
      .from(comparisons)
      .where(forCompetitor)
      .orderBy(desc(pollId))
      .limit(1);
    if (latest && latest.pollId >= input.pollId) {
      throw new Error('Expected a new observation in increasing source order');
    }
    const previouslyVisible = latest?.listingState != null;
    let previousFields = latest?.listingState ?? null;
    if (
      latest &&
      !previouslyVisible &&
      input.current.kind === ObservationKind.Complete
    ) {
      const [lastVisible] = await tx
        .select({ fields: comparisons.listingState })
        .from(comparisons)
        .where(and(forCompetitor, isNotNull(comparisons.listingState)))
        .orderBy(desc(pollId))
        .limit(1);
      previousFields = lastVisible?.fields ?? null;
    }

    return { previouslyVisible, previousFields };
  }

  /** Returns recorded decisions for the requested polls, including comparisons with no change. */
  async getDecisions(ids: string[]) {
    const rows = await this.db
      .select(decisionColumns)
      .from(comparisons)
      .where(inArray(pollId, ids));

    return rows.map(ListingChangeRepository.decision);
  }

  /** Reads changes newest first and returns null if the cursor falls outside the competitor’s feed. */
  async page(id: string, limit: number, cursor?: string) {
    const changed = ListingChangeRepository.changedFor(id);
    const cursorFilter = this.atOrBeforeCursor(changed, cursor);
    const fetchLimit = cursor ? limit + 1 : limit;
    const rows = await this.db
      .select(decisionColumns)
      .from(comparisons)
      .where(and(changed, cursorFilter))
      .orderBy(desc(observedAt), desc(pollId))
      .limit(fetchLimit);
    if (cursor && rows[0]?.pollId !== cursor) {
      return null;
    }

    const pageRows = cursor ? rows.slice(1) : rows;

    return pageRows.map(ListingChangeRepository.listingChange);
  }

  /** Builds the inclusive page boundary for this competitor’s changes. */
  private atOrBeforeCursor(changed: SQL, cursor?: string) {
    if (!cursor) {
      return undefined;
    }
    const position = this.db
      .select({ observedAt, pollId })
      .from(comparisons)
      .where(and(changed, eq(pollId, cursor)));

    return sql`(${observedAt},${pollId}) <= ${position}`;
  }

  /** Returns the requested competitors with a recorded change at or after the cutoff. */
  async changedSince(ids: string[], since: Date) {
    const rows = await this.db
      .selectDistinct({ id: competitorId })
      .from(comparisons)
      .where(and(inArray(competitorId, ids), isNotNull(diff), gte(observedAt, since)));

    return new Set(rows.map((row) => row.id));
  }

  /** Reconstructs the comparison decision returned for both new observations and replays. */
  private static decision(this: void, row: SavedComparison) {
    return { pollId: row.pollId, change: ListingChangeRepository.listingChange(row) };
  }

  /** Combines a saved diff with its poll metadata, returning null for an unchanged listing. */
  private static listingChange(this: void, row: SavedComparison): ListingChange | null {
    if (!row.diff) {
      return null;
    }

    return {
      pollId: row.pollId,
      competitorId: row.competitorId,
      observedAt: row.observedAt,
      ...row.diff,
    };
  }
}
