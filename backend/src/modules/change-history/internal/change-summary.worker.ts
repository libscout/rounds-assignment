import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LoggerService } from '@src/tools/logger';
import { SummariesService } from '@src/modules/summaries/services';
import { ChangeSummaryRepository } from '../repositories/change-summary.repository';
import { SummaryStatus } from '../types';

/** Claims pending listing changes, requests a summary for each, and records the outcome. */
@Injectable()
export class ChangeSummaryWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private cycle?: Promise<void>;
  private stopping = false;
  constructor(
    private readonly queue: ChangeSummaryRepository,
    private readonly summaries: SummariesService,
    private readonly logger: LoggerService,
  ) {}

  onApplicationBootstrap() {
    this.schedule(0);
  }

  private schedule(wait: number) {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.cycle = this.processNext()
        .then((worked) => this.schedule(worked ? 0 : 500))
        .catch((error: unknown) => {
          this.logger.error('Could not process change summary', error);
          this.schedule(1000);
        });
    }, wait);
  }

  async processNext(): Promise<boolean> {
    const token = randomUUID();
    const claim = await this.queue.claimNext(token, 30);
    if (!claim) return false;
    let summary: string | null = null;
    let status: SummaryStatus;
    try {
      const result = await this.summaries.summarize({
        kind: claim.kind,
        changedFields: claim.changedFields,
      });
      summary = typeof result === 'string' ? result.trim() || null : null;
      status =
        result === null
          ? SummaryStatus.BudgetExhausted
          : summary
            ? SummaryStatus.Ready
            : SummaryStatus.InvalidOutput;
    } catch (error) {
      status =
        error && typeof error === 'object' && 'name' in error && error.name === 'TimeoutError'
          ? SummaryStatus.Timeout
          : SummaryStatus.Failed;
    }
    await this.queue.finish(claim.pollId, token, status, summary);
    return true;
  }

  async onModuleDestroy() {
    this.stopping = true;
    clearTimeout(this.timer);
    await this.cycle;
  }
}
