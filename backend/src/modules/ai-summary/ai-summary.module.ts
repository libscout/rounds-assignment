import { Module } from '@nestjs/common';
import { AiChatClient } from '@src/external/ai/ai-chat.client';
import { AiSummaryRepository } from './repositories/ai-summary.repository';
import { AiSummaryWorker } from './internal/ai-summary.worker';
import { AiSummaryService } from './services';

/** Runs asynchronous AI summaries and exports submission and result lookup. */
@Module({
  providers: [AiChatClient, AiSummaryRepository, AiSummaryWorker, AiSummaryService],
  exports: [AiSummaryService],
})
export class AiSummaryModule {}
