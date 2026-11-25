import { Injectable } from '@nestjs/common';
import { WatchlistRepository } from '../repositories';

/** Maintains the active competitor watchlist. */
@Injectable()
export class WatchlistService {
  /** Uses the watchlist repository to manage tracking membership. */
  constructor(private readonly watchlist: WatchlistRepository) {}

  /** Starts tracking a new or inactive competitor with an immediate first due time. */
  add(id: string): Promise<void> {
    return this.watchlist.activate(id, new Date());
  }

  /** Stops scheduling polls for the competitor. */
  remove(id: string): Promise<void> {
    return this.watchlist.deactivate(id);
  }

  /** Lists the IDs of competitors currently scheduled for tracking. */
  list() {
    return this.watchlist.listActiveIds();
  }
}
