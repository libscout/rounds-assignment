import {
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PollDeliveryService } from '@src/modules/listing-tracking/services';
import { PollingLoop } from '@src/tools/worker/polling-loop';
import { BackgroundWorker } from '@src/tools/worker/background-worker.decorator';
import { ConfigService } from '@src/tools/config';
import { LoggerService } from '@src/tools/logger';
import { POLL_BATCH_SIZE } from '../consts/poll-batch.const';
import { PollExecutionRepository } from '../repositories/poll-execution.repository';
import { PollOrchestratorService } from '../services';
import { ExecutionStatus } from '../types';

/** Rotates bounded tracking, submission and result pages every five seconds. */
@Injectable()
@BackgroundWorker()
export class PollOrchestratorWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly loop = new PollingLoop(
    () => this.tick(),
    (error) => this.logError(error),
  );

  constructor(
    private readonly tracking: PollDeliveryService,
    private readonly repo: PollExecutionRepository,
    private readonly coordinator: PollOrchestratorService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  onApplicationBootstrap() {
    this.loop.start();
  }

  onModuleDestroy() {
    return this.loop.stop();
  }

  private logError(error: unknown) {
    this.logger.error('Poll orchestration failed', { err: error });
  }

  /** Processes each poll separately so a failed handoff leaves the rest of the page available. */
  private async processPolls(
    polls: { pollId: string }[],
    process: (id: string) => Promise<void>,
  ) {
    for (const { pollId } of polls) {
      try {
        await process(pollId);
      } catch (error) {
        this.logger.warn('Poll handoff deferred', { pollId, err: error });
      }
    }
  }

  /** Processes available pages and returns the delay until the next scheduled check. */
  async tick() {
    const started = Date.now();
    await this.processPages();

    return Math.max(
      0,
      this.config.getEnv('ORCHESTRATOR_INTERVAL_MS') - (Date.now() - started),
    );
  }

  /** Alternates one page of deliveries, submissions and results until all three have been read. */
  private async processPages() {
    const readers = [
      (after?: string) => this.deliverPage(after),
      (after?: string) => this.submitPage(after),
      (after?: string) => this.checkResultsPage(after),
    ];
    const cursors = new Map(
      readers.map((read) => [read, undefined as string | undefined]),
    );
    while (cursors.size) {
      for (const [read, after] of cursors) {
        try {
          const next = await read(after);
          if (next) {
            cursors.set(read, next);
            continue;
          }
        } catch (error) {
          this.logError(error);
        }
        cursors.delete(read);
      }
    }
  }

  /** Delivers the oldest eligible poll from each competitor on this tracking page. */
  private async deliverPage(after?: string) {
    const page = await this.tracking.listDeliverablePolls(POLL_BATCH_SIZE, after);
    await this.processPolls(page.items, (id) => this.coordinator.deliverPoll(id));

    return page.next;
  }

  /** Submits the changes on this page to AI Summary. */
  private async submitPage(after?: string) {
    const page = await this.repo.page(
      ExecutionStatus.NotSubmitted,
      POLL_BATCH_SIZE,
      after,
    );
    await this.processPolls(page.items, (id) => this.coordinator.submit(id));

    return page.next;
  }

  /** Collects available AI outcomes for the submitted polls on this page. */
  private async checkResultsPage(after?: string) {
    const page = await this.repo.page(
      ExecutionStatus.Submitted,
      POLL_BATCH_SIZE,
      after,
    );
    await this.coordinator.checkResults(page.items.map((poll) => poll.pollId));

    return page.next;
  }
}
