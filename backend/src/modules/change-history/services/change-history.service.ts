import { Injectable } from '@nestjs/common';
import { compareListing } from '../internal/listing-comparison';
import { ListingChangeRepository } from '../repositories/listing-change.repository';
import type { ListingChange, ListingDiff, Observation } from '../types';

/** Records meaningful listing changes and looks them up by poll, competitor, or time window. */
@Injectable()
export class ChangeHistoryService {
  constructor(private readonly changes: ListingChangeRepository) {}

  async record(observation: Observation): Promise<ListingDiff | null> {
    const diff = compareListing(observation);
    if (diff) await this.changes.insertOnce(observation, diff);
    return diff;
  }

  byPollIds(ids: string[]): Promise<ListingChange[]> {
    return this.changes.byPollIds(ids);
  }

  changedSince(ids: string[], since: Date): Promise<Set<string>> {
    return this.changes.changedSince(ids, since);
  }
}
