import { Injectable } from '@nestjs/common';
import { ChangeHistoryService } from '@src/modules/change-history/services';
import { WatchlistRepository } from '../repositories';

/** Maintains the active competitor watchlist and reports which listings changed in the last 24 hours. */
@Injectable()
export class WatchlistService {
  constructor(
    private readonly watchlist: WatchlistRepository,
    private readonly changeHistory: ChangeHistoryService,
  ) {}

  add(id: string): Promise<void> {
    return this.watchlist.activate(id, new Date());
  }

  remove(id: string): Promise<void> {
    return this.watchlist.deactivate(id);
  }

  async list() {
    const ids = await this.watchlist.listActiveIds();
    const changed = await this.changeHistory.changedSince(ids, new Date(Date.now() - 86_400_000));
    return ids.map((id) => ({ id, changedInLast24h: changed.has(id) }));
  }
}
