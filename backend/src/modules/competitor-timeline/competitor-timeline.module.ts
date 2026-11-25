import { Module } from '@nestjs/common';
import { AiSummaryModule } from '@src/modules/ai-summary/ai-summary.module';
import { ChangeHistoryModule } from '@src/modules/change-history/change-history.module';
import { PollOrchestratorModule } from '@src/modules/poll-orchestrator/poll-orchestrator.module';
import { ListingTrackingModule } from '@src/modules/listing-tracking/listing-tracking.module';
import { CompetitorTimelineController } from './controllers/competitor-timeline.controller';
import { CompetitorTimelineService } from './services/competitor-timeline.service';

/** Serves read-only HTTP views over the public leaf and execution APIs. */
@Module({
  imports: [
    ListingTrackingModule,
    ChangeHistoryModule,
    AiSummaryModule,
    PollOrchestratorModule,
  ],
  controllers: [CompetitorTimelineController],
  providers: [CompetitorTimelineService],
})
export class CompetitorTimelineModule {}
