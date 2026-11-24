import { Module } from '@nestjs/common';
import { ListingSourceModule } from '@src/external/listing-source';
import { ChangeHistoryModule } from '@src/modules/change-history/change-history.module';
import { CompetitorsController } from './controllers/competitors.controller';
import { PollAttemptService } from './internal/poll-attempt.service';
import { PollDispatcher } from './internal/poll-dispatcher';
import { LegacyChangeImport } from './internal/legacy-change-import';
import { PollBaselineReader } from './internal/poll-baseline.reader';
import { SnapshotDeliveryWorker } from './internal/snapshot-delivery.worker';
import {
  ListingHistoryRepository,
  PollAttemptRepository,
  PollDeliveryRepository,
  WatchlistRepository,
} from './repositories';
import { PollObservationsService, WatchlistService } from './services';

/** Connects the watchlist API to the workers that poll listings and deliver observations to change history. */
@Module({
  imports: [ListingSourceModule, ChangeHistoryModule],
  exports: [PollObservationsService],
  controllers: [CompetitorsController],
  providers: [
    ListingHistoryRepository,
    PollAttemptRepository,
    PollDeliveryRepository,
    WatchlistRepository,
    WatchlistService,
    PollObservationsService,
    PollAttemptService,
    PollDispatcher,
    SnapshotDeliveryWorker,
    PollBaselineReader,
    LegacyChangeImport,
  ],
})
export class TrackingModule {}
