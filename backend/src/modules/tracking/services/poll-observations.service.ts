import { BadRequestException, Injectable } from '@nestjs/common';
import { ListingHistoryRepository } from '../repositories';

/** Pages through the processed polls and listing fields observed for one competitor. */
@Injectable()
export class PollObservationsService {
  constructor(private readonly listings: ListingHistoryRepository) {}

  async page(competitorId: string, limit: number, cursor?: string) {
    const rows = await this.listings.findProcessed(competitorId, limit + 1, cursor);
    if (rows === null) throw new BadRequestException('Invalid timeline cursor');
    const items = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? items[limit - 1].pollId : null;
    return { items, nextCursor };
  }
}
