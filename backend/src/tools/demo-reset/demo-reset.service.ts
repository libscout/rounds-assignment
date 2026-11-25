import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { ConfigService } from '@src/tools/config';
import { DemoMocksClient } from '@src/external/demo-mocks/demo-mocks.client';
import { BackgroundWorker } from '@src/tools/worker/background-worker.decorator';
import { DemoResetRepository } from './demo-reset.repository';

interface Worker {
  onApplicationBootstrap(): void | Promise<void>;
  onModuleDestroy(): void | Promise<void>;
}

/** Drains local background work before discarding demo progress and restarting the workers. */
@Injectable()
export class DemoResetService implements OnModuleDestroy {
  private resetting?: Promise<void>;

  private shuttingDown = false;

  /** Uses the configured demo mode, registered workers and application database. */
  constructor(
    private readonly config: ConfigService,
    private readonly discovery: DiscoveryService,
    private readonly storage: DemoResetRepository,
    private readonly mocks: DemoMocksClient,
  ) {}

  /** Shares a single reset between concurrent requests when the local control is enabled. */
  reset() {
    const enabled =
      this.config.getEnv('DEMO_RESET_ENABLED') ??
      String(this.config.getEnv('NODE_ENV') === 'development');
    if (enabled !== 'true') {
      throw new NotFoundException();
    }
    this.resetting ??= this.clearProgress().finally(() => {
      this.resetting = undefined;
    });

    return this.resetting;
  }

  /** Lets an active reset finish without restarting workers during application shutdown. */
  onModuleDestroy() {
    this.shuttingDown = true;

    return this.resetting;
  }

  /** Waits for existing polls, comparisons and summaries before clearing their rows. */
  private async clearProgress() {
    const workers = this.discovery
      .getProviders({ metadataKey: BackgroundWorker.KEY })
      .map(({ instance }) => instance as Worker);
    try {
      await DemoResetService.drain(workers);
      const failed = await this.mocks.reset();
      if (failed.length) {
        throw new ServiceUnavailableException(
          'Reset incomplete for the ' + failed.join(' and ') + '. Try again.',
        );
      }
      await this.storage.clear();
    } finally {
      if (!this.shuttingDown) {
        await Promise.all(
          workers.map(async (worker) => worker.onApplicationBootstrap()),
        );
      }
    }
  }

  /** Waits for every worker to stop before reporting a failure. */
  private static async drain(workers: Worker[]) {
    const results = await Promise.allSettled(
      workers.map(async (worker) => worker.onModuleDestroy()),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        throw result.reason;
      }
    }
  }
}
