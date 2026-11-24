import { ObservationKind } from '@src/modules/change-history/types';
import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { LoggerService } from '@src/tools/logger';
import { ChangeHistoryService } from '@src/modules/change-history/services';
import { PollBaselineReader } from './poll-baseline.reader';

import { PollDeliveryRepository } from '../repositories';
import type { ListingVersionWrite } from '../types';

const DELIVERY_BATCH_SIZE = 32;

/** Delivers completed polls to change history and retries until each poll is acknowledged. */
@Injectable()
export class SnapshotDeliveryWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private cycle?: Promise<void>;
  private stopping = false;

  constructor(
    private readonly deliveries: PollDeliveryRepository,
    private readonly changeHistory: ChangeHistoryService,
    private readonly logger: LoggerService,
    private readonly baselines: PollBaselineReader,
  ) {}

  onApplicationBootstrap() {
    this.schedule(0);
  }

  private schedule(ms: number) {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.cycle = this.deliverBatch()
        .then((count) => this.schedule(count === DELIVERY_BATCH_SIZE ? 0 : 200))
        .catch((error: unknown) => {
          this.logger.error('Could not deliver poll outcomes', error);
          this.schedule(1000);
        });
    }, ms);
  }

  async deliverBatch(): Promise<number> {
    const due = await this.deliveries.findDue(DELIVERY_BATCH_SIZE);
    for (const poll of due) {
      if (this.stopping) break;
      try {
        const {
          versionId: previousVersionId,
          previousFields,
          previouslyVisible,
        } = await this.baselines.read(poll.competitorId);
        const current = PollBaselineReader.current(poll.outcomeKind, poll.response);
        const diff = await this.changeHistory.record({
          pollId: poll.id,
          competitorId: poll.competitorId,
          observedAt: poll.finishedAt,
          current,
          previousFields,
          previouslyVisible,
        });
        let version: ListingVersionWrite | null = null;
        if (current.kind === ObservationKind.Complete) {
          const needsVersion =
            !previousVersionId || (diff && Object.keys(diff.changedFields).length > 0);
          version = needsVersion
            ? { id: poll.id, newFields: current.fields }
            : { id: previousVersionId };
        }
        await this.deliveries.acknowledge(poll.id, version);
      } catch (error) {
        const maxDelay = Math.min(60_000, 1000 * 2 ** Math.min(6, poll.deliveryAttempts));
        await this.deliveries.retryAt(poll.id, new Date(Date.now() + Math.random() * maxDelay));
        this.logger.warn('Snapshot delivery will retry', {
          pollId: poll.id,
          competitorId: poll.competitorId,
          ageMs: Date.now() - poll.finishedAt.getTime(),
          err: error,
        });
      }
    }
    return due.length;
  }

  async onModuleDestroy() {
    this.stopping = true;
    clearTimeout(this.timer);
    await this.cycle;
  }
}
