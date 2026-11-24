import { Injectable } from '@nestjs/common';
import type { SummaryInput } from '@src/external/ai/summary-input.types';
import { MockAiClient } from '@src/external/ai/mock-ai.client';
import { DailyAiUsageRepository } from '../repositories/daily-ai-usage.repository';

/** Requests a change summary within the shared daily AI budget and call deadline. */
@Injectable()
export class SummariesService {
  constructor(
    private readonly usage: DailyAiUsageRepository,
    private readonly ai: MockAiClient,
  ) {}

  // A null result means that today's shared budget has been exhausted.
  async summarize(change: SummaryInput): Promise<string | null> {
    if (!(await this.usage.reserveCall())) return null;
    const controller = new AbortController();
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new DOMException('AI call timed out', 'TimeoutError');
        controller.abort(error);
        reject(error);
      }, 10_000);
    });
    try {
      return await Promise.race([this.ai.summarize(change, controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
