import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { DATABASE, type Database } from '@src/tools/db';
import { type ListingVersionWrite, PollStatus } from '../types';
import { listingVersions, pollAttempts } from '../entities';

/** Finds polls awaiting delivery and records acknowledgments or retry times. */
@Injectable()
export class PollDeliveryRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findDue(limit: number) {
    return this.db
      .select()
      .from(pollAttempts)
      .where(
        and(
          isNull(pollAttempts.processedAt),
          inArray(pollAttempts.status, [PollStatus.Success, PollStatus.Error]),
          lte(pollAttempts.nextDeliveryAt, new Date()),
        ),
      )
      .orderBy(asc(pollAttempts.nextDeliveryAt), asc(pollAttempts.id))
      .limit(limit);
  }

  async acknowledge(pollId: string, version: ListingVersionWrite | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [outstanding] = await tx
        .select({ id: pollAttempts.id })
        .from(pollAttempts)
        .where(and(eq(pollAttempts.id, pollId), isNull(pollAttempts.processedAt)))
        .for('update');
      if (!outstanding) return;
      if (version?.newFields)
        await tx.insert(listingVersions).values({ id: version.id, fields: version.newFields });
      await tx
        .update(pollAttempts)
        .set({
          versionId: version?.id ?? null,
          processedAt: new Date(),
          nextDeliveryAt: null,
          response: version ? null : undefined,
        })
        .where(eq(pollAttempts.id, pollId));
    });
  }

  async retryAt(pollId: string, nextDeliveryAt: Date): Promise<void> {
    await this.db
      .update(pollAttempts)
      .set({
        deliveryAttempts: sql`${pollAttempts.deliveryAttempts} + 1`,
        nextDeliveryAt,
      })
      .where(and(eq(pollAttempts.id, pollId), isNull(pollAttempts.processedAt)));
  }
}
