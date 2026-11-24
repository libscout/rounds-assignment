import { DailyAiUsageRepository } from './repositories/daily-ai-usage.repository';
import { Module } from '@nestjs/common';
import { MockAiClient } from '@src/external/ai/mock-ai.client';
import { SummariesService } from './services';
/** Connects summary requests to the AI client and the shared daily call budget. */
@Module({
  providers: [DailyAiUsageRepository, MockAiClient, SummariesService],
  exports: [SummariesService],
})
export class SummariesModule {}
