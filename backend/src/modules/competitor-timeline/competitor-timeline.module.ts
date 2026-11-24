import { Module } from '@nestjs/common';
import { ChangeHistoryModule } from '@src/modules/change-history/change-history.module';
import { TrackingModule } from '@src/modules/tracking/tracking.module';
import { CompetitorTimelineController } from './controllers/competitor-timeline.controller';
import { ChangeFeedRepository } from './repositories/change-feed.repository';
import { CompetitorTimelineService } from './services/competitor-timeline.service';

/** Connects the competitor timeline endpoint to tracking and change history. */
@Module({
  imports: [TrackingModule, ChangeHistoryModule],
  controllers: [CompetitorTimelineController],
  providers: [CompetitorTimelineService, ChangeFeedRepository],
})
export class CompetitorTimelineModule {}
