import { BadRequestException, Injectable } from '@nestjs/common';
import { ListingChangeRepository } from '../repositories/listing-change.repository';
import type { Observation } from '../types';

/** Records source-ordered observations and exposes durable comparison decisions and diffs. */
@Injectable()
export class ChangeHistoryService {
  /** Uses the comparison repository to record observations and read change history. */
  constructor(private readonly changes: ListingChangeRepository) {}

  /** Records an observation and returns the comparison decision for its poll ID. */
  record(input: Observation) {
    return this.changes.record(input);
  }

  /** Looks up the recorded comparison decisions for a batch of polls. */
  getDecisions(ids: string[]) {
    return this.changes.getDecisions(ids);
  }

  /** Returns the poll’s detected change, or null if no change has been recorded. */
  async getChange(id: string) {
    return (await this.changes.getDecisions([id]))[0]?.change ?? null;
  }

  /** Finds which requested competitors changed at or after the supplied time. */
  changedSince(ids: string[], since: Date) {
    return this.changes.changedSince(ids, since);
  }

  /** Returns a page of changes for one competitor and rejects an invalid cursor. */
  async page(competitorId: string, limit: number, cursor?: string) {
    const rows = await this.changes.page(competitorId, limit + 1, cursor);
    if (rows === null) {
      throw new BadRequestException('Invalid change cursor');
    }
    const items = rows.slice(0, limit);

    const nextCursor = rows.length > limit ? items[items.length - 1].pollId : null;

    return {
      items,
      nextCursor,
    };
  }
}
