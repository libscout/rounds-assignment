import { BadRequestException, Injectable } from '@nestjs/common';
import { ListingHistoryRepository } from '../repositories';

/** Pages through the finished polls and listing fields observed for one competitor. */
@Injectable()
export class PollObservationsService {
  /** Uses tracking history to serve finished poll observations. */
  constructor(private readonly listings: ListingHistoryRepository) {}

  /** Looks up finished observations for the supplied poll IDs. */
  byIds(ids: string[]) {
    return this.listings.byIds(ids);
  }

  /** Returns one competitor’s finished polls and a continuation cursor when more are available. */
  async page(competitorId: string, limit: number, cursor?: string) {
    const rows = await this.listings.findFinished(competitorId, limit + 1, cursor);
    if (rows === null) {
      throw new BadRequestException('Invalid timeline cursor');
    }
    const items = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? items[limit - 1].pollId : null;

    return { items, nextCursor };
  }
}
