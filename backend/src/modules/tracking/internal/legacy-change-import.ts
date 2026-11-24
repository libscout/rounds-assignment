import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ChangeHistoryService } from '@src/modules/change-history/services';
import { ListingHistoryRepository } from '../repositories';
import { PollBaselineReader } from './poll-baseline.reader';

/** Rebuilds field-level changes from legacy snapshots before polling starts. */
@Injectable()
export class LegacyChangeImport implements OnModuleInit {
  constructor(
    private readonly listings: ListingHistoryRepository,
    private readonly baselines: PollBaselineReader,
    private readonly history: ChangeHistoryService,
  ) {}
  async onModuleInit() {
    for (;;) {
      const batch = await this.listings.findUnimportedChanges(100);
      if (!batch.length) return;
      for (const poll of batch) {
        const { previousFields, previouslyVisible } = await this.baselines.read(
          poll.competitorId,
          poll,
        );
        const diff = await this.history.record({
          pollId: poll.id,
          competitorId: poll.competitorId,
          observedAt: poll.time,
          current: PollBaselineReader.current(poll.kind, poll.fields),
          previousFields,
          previouslyVisible,
        });
        if (!diff)
          throw new Error('Historical change could not be reconstructed for poll ' + poll.id);
        await this.listings.markImported(poll.id);
      }
    }
  }
}
