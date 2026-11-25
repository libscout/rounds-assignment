import { Module } from '@nestjs/common';
import { ListingTrackingModule } from '@src/modules/listing-tracking/listing-tracking.module';
import { ChangeHistoryModule } from '@src/modules/change-history/change-history.module';
import { AiSummaryModule } from '@src/modules/ai-summary/ai-summary.module';
import { PollOrchestratorWorker } from './internal/poll-orchestrator.worker';
import { PollExecutionRepository } from './repositories/poll-execution.repository';
import { PollOrchestratorService } from './services';

/** Connects the poll orchestration worker to the public services of the three leaf modules. */
@Module({
  imports: [ListingTrackingModule, ChangeHistoryModule, AiSummaryModule],
  providers: [PollExecutionRepository, PollOrchestratorService, PollOrchestratorWorker],
  exports: [PollOrchestratorService],
})
export class PollOrchestratorModule {}
