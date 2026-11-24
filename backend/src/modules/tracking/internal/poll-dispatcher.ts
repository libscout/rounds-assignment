import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { ListingSourceClient } from '@src/external/listing-source';
import { ConfigService } from '@src/tools/config';
import { LoggerService } from '@src/tools/logger';
import { PollOutcomeMapper } from './poll-outcome-mapper';
import { PollAttemptService } from './poll-attempt.service';
import { type ClaimedPoll, OutcomeKind } from '../types';

const START_SPACING_MS = 200;

/** Starts due polls within the source rate and concurrency limits and pauses dispatch during cooldowns. */
@Injectable()
export class PollDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private cycle?: Promise<void>;
  private stopping = false;
  private nextStart = 0;
  private reportAt = Date.now() + 60_000;
  private starts = 0;
  private outcomes: Partial<Record<OutcomeKind, number>> = {};
  private cooldownUntil = 0;
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly attempts: PollAttemptService,
    private readonly source: ListingSourceClient,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  async onApplicationBootstrap() {
    this.cooldownUntil = await this.attempts.recover();
    this.nextStart = performance.now() + START_SPACING_MS;
    this.schedule(START_SPACING_MS);
  }

  private schedule(ms: number) {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.cycle = this.dispatchOnce()
        .then((wait) => this.schedule(wait))
        .catch((error: unknown) => {
          this.logger.error('Could not dispatch poll', error);
          this.schedule(1000);
        });
    }, ms);
  }

  async dispatchOnce(): Promise<number> {
    if (Date.now() >= this.reportAt) {
      this.reportAt = Date.now() + 60_000;
      this.logger.info('Polling activity over the last minute', {
        starts: this.starts,
        outcomes: this.outcomes,
        inFlight: this.running.size,
        oldestOverdueMs: await this.attempts.oldestOverdueMs(),
        cooldownUntil: this.cooldownUntil || null,
      });
      this.starts = 0;
      this.outcomes = {};
    }
    const wait = Math.max(this.cooldownUntil - Date.now(), this.nextStart - performance.now());
    if (wait > 0) return Math.min(60_000, Math.ceil(wait));
    if (this.running.size >= this.config.getEnv('POLL_CONCURRENCY')) return 50;
    const poll = await this.attempts.claim();
    if (!poll) return 200;
    if (this.stopping || Date.now() < this.cooldownUntil) {
      await this.attempts.releaseUnstarted(poll);
      return 200;
    }
    const job = this.run(poll);
    this.nextStart = performance.now() + START_SPACING_MS;
    this.starts++;
    this.running.add(job);
    void job.then(
      () => this.running.delete(job),
      (error: unknown) => {
        this.running.delete(job);
        this.logger.error('Poll execution failed', { pollId: poll.id, err: error });
      },
    );
    return START_SPACING_MS;
  }

  private async run(poll: ClaimedPoll) {
    const context = { pollId: poll.id, competitorId: poll.competitorId };
    const lagMs = Math.max(0, Date.now() - poll.dueAt.getTime());
    this.logger.debug('Starting listing request', {
      ...context,
      lagMs,
      inFlight: this.running.size + 1,
    });
    const response = await this.source.fetchListing(poll.competitorId, poll.id);
    const finishedAt = new Date();
    const result = PollOutcomeMapper.classify(poll.competitorId, response, finishedAt);
    this.outcomes[result.kind] = (this.outcomes[result.kind] ?? 0) + 1;
    if (result.kind === OutcomeKind.RateLimited) {
      this.cooldownUntil = Math.max(this.cooldownUntil, result.retryAfter.getTime());
      this.logger.warn('Listing source cooldown', {
        ...context,
        until: new Date(this.cooldownUntil).toISOString(),
      });
    }
    for (;;) {
      try {
        await this.attempts.finish(poll, result, finishedAt);
        break;
      } catch (error) {
        this.logger.error('Could not persist poll outcome', { ...context, err: error });
        if (this.stopping) return;
        await delay(1000);
      }
    }
    this.logger.debug('Poll finished', { ...context, outcome: result.kind });
  }

  async onModuleDestroy() {
    this.stopping = true;
    clearTimeout(this.timer);
    await this.cycle;
    await Promise.allSettled(this.running);
  }
}
