import { Module } from '@nestjs/common';
import { ListingSourceModule } from '@src/external/listing-source';
import { CompetitorsController } from './controllers/competitors.controller';
import { PollAttemptService } from './internal/poll-attempt.service';
import { PollDispatcher } from './internal/poll-dispatcher';
import {
  ListingHistoryRepository,
  PollAttemptRepository,
  PollDeliveryRepository,
  WatchlistRepository,
} from './repositories';
import {
  PollDeliveryService,
  PollObservationsService,
  WatchlistService,
} from './services';

/** Connects the watchlist API to source polling and the ordered feed of completed observations. */
@Module({
  imports: [ListingSourceModule],
  exports: [PollDeliveryService, PollObservationsService, WatchlistService],
  controllers: [CompetitorsController],
  providers: [
    ListingHistoryRepository,
    PollAttemptRepository,
    PollDeliveryService,
    PollDeliveryRepository,
    WatchlistRepository,
    WatchlistService,
    PollObservationsService,
    PollAttemptService,
    PollDispatcher,
  ],
})
export class ListingTrackingModule {}
