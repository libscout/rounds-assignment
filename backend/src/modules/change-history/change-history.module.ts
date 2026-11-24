import { ListingChangeRepository } from './repositories/listing-change.repository';
import { ChangeSummaryRepository } from './repositories/change-summary.repository';
import { Module } from '@nestjs/common';
import { SummariesModule } from '@src/modules/summaries/summaries.module';
import { ChangeSummaryWorker } from './internal/change-summary.worker';
import { ChangeHistoryService } from './services';

/** Provides the listing change history API and runs the worker that summarizes recorded changes. */
@Module({
  imports: [SummariesModule],
  providers: [
    ListingChangeRepository,
    ChangeSummaryRepository,
    ChangeHistoryService,
    ChangeSummaryWorker,
  ],
  exports: [ChangeHistoryService],
})
export class ChangeHistoryModule {}
