import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '@src/tools/db';
import { listingChanges } from '../entities';
import { SummaryStatus } from '../types';

/** Leases pending changes to summary workers and saves results from the current lease holder. */
@Injectable()
export class ChangeSummaryRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  claimNext(token: string, leaseSeconds: number) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          pollId: listingChanges.pollId,
          kind: listingChanges.kind,
          changedFields: listingChanges.changedFields,
        })
        .from(listingChanges)
        .where(
          and(
            eq(listingChanges.summaryStatus, SummaryStatus.Pending),
            or(
              isNull(listingChanges.claimExpiresAt),
              lte(listingChanges.claimExpiresAt, sql`now()`),
            ),
          ),
        )
        .orderBy(asc(listingChanges.observedAt), asc(listingChanges.pollId))
        .limit(1)
        .for('update', { skipLocked: true });
      if (row)
        await tx
          .update(listingChanges)
          .set({
            claimToken: token,
            claimExpiresAt: sql`now() + ${leaseSeconds} * interval '1 second'`,
          })
          .where(eq(listingChanges.pollId, row.pollId));
      return row;
    });
  }

  async finish(
    pollId: string,
    token: string,
    status: SummaryStatus,
    summary: string | null,
  ): Promise<void> {
    await this.db
      .update(listingChanges)
      .set({ summary, summaryStatus: status, claimToken: null, claimExpiresAt: null })
      .where(and(eq(listingChanges.pollId, pollId), eq(listingChanges.claimToken, token)));
  }
}
