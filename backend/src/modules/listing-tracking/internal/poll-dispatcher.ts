import {
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { ListingSourceClient } from '@src/external/listing-source';
import { ConfigService } from '@src/tools/config';
import { LoggerService } from '@src/tools/logger';
import { BackgroundWorker } from '@src/tools/worker/background-worker.decorator';
import { PollOutcomeMapper } from './poll-outcome-mapper';
import { PollAttemptService } from './poll-attempt.service';
import { OutcomeKind, type ClaimedPoll, type PollResult } from '../types';
import { START_SPACING_MS } from '../consts/polling.const';

/** Starts due polls within the source rate and concurrency limits and pauses dispatch during cooldowns. */
@Injectable()
@BackgroundWorker()
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

  /** Uses the source client, poll storage, configured concurrency and activity logger. */
  constructor(
    private readonly attempts: PollAttemptService,
    private readonly source: ListingSourceClient,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  /** Restores the persisted cooldown and schedules the first paced dispatch. */
  async onApplicationBootstrap() {
    this.stopping = false;
    this.cooldownUntil = await this.attempts.recover();
    this.nextStart = performance.now() + START_SPACING_MS;
    this.schedule(START_SPACING_MS);
  }

  /** Schedules the next dispatch and retries a failed dispatch after one second. */
  private schedule(ms: number) {
    if (this.stopping) {
      return;
    }
    this.timer = setTimeout(() => {
      this.cycle = this.dispatchOnce()
        .then((wait) => this.schedule(wait))
        .catch((error: unknown) => {
          this.logger.error('Could not dispatch poll', error);
          this.schedule(1000);
        });
    }, ms);
  }

  /** Claims one eligible poll and returns the delay until dispatch should run again. */
  async dispatchOnce(): Promise<number> {
    if (Date.now() >= this.reportAt) {
      await this.reportActivity();
    }
    const wait = this.dispatchDelay();
    if (wait > 0) {
      return wait;
    }
    const poll = await this.attempts.claim();
    if (!poll) {
      return START_SPACING_MS;
    }
    if (this.stopping || Date.now() < this.cooldownUntil) {
      await this.attempts.releaseUnstarted(poll);

      return START_SPACING_MS;
    }
    this.start(poll);

    return START_SPACING_MS;
  }

  /** Logs the past minute's outcomes and resets the counters for the next report. */
  private async reportActivity() {
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

  /** Returns the wait imposed by the source cooldown, start spacing, or concurrency limit. */
  private dispatchDelay(): number {
    const wait = Math.max(
      this.cooldownUntil - Date.now(),
      this.nextStart - performance.now(),
    );
    if (wait > 0) {
      return Math.min(60_000, Math.ceil(wait));
    }

    return this.running.size >= this.config.getEnv('POLL_CONCURRENCY') ? 50 : 0;
  }

  /** Starts a paced source request and frees its concurrency slot when it settles. */
  private start(poll: ClaimedPoll) {
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
  }

  /** Fetches the listing once, classifies it and saves that observation at its original finish time. */
  private async run(poll: ClaimedPoll) {
    const context = { pollId: poll.id, competitorId: poll.competitorId };
    const lagMs = Math.max(0, Date.now() - poll.dueAt.getTime());
    this.logger.debug('Starting listing request', {
      ...context,
      lagMs,
      inFlight: this.running.size + 1,
    });
    const response = await this.source.fetchListing(
      poll.competitorId,
      poll.id,
      (header) => this.onRateLimitHeader(header),
    );
    const finishedAt = new Date();
    const result = PollOutcomeMapper.classify(poll.competitorId, response, finishedAt);
    this.recordOutcome(poll, result);
    if (await this.persistOutcome(poll, result, finishedAt)) {
      this.logger.debug('Poll finished', { ...context, outcome: result.kind });
    }
  }

  /** Pauses dispatch as soon as the source sends 429 headers, before its body has finished. */
  private onRateLimitHeader(header: string | undefined) {
    const deadline = PollOutcomeMapper.cooldownDeadline(header, Date.now());
    this.cooldownUntil = Math.max(this.cooldownUntil, deadline.getTime());
  }

  /** Counts one source result and extends the shared cooldown for a rate-limited reply. */
  private recordOutcome(poll: ClaimedPoll, result: PollResult) {
    this.outcomes[result.kind] = (this.outcomes[result.kind] ?? 0) + 1;
    if (result.kind === OutcomeKind.RateLimited) {
      this.cooldownUntil = Math.max(this.cooldownUntil, result.retryAfter.getTime());
      this.logger.warn('Listing source cooldown', {
        pollId: poll.id,
        competitorId: poll.competitorId,
        until: new Date(this.cooldownUntil).toISOString(),
      });
    }
  }

  /** Retries the same write after storage errors and returns false if shutdown interrupts a retry. */
  private async persistOutcome(
    poll: ClaimedPoll,
    result: PollResult,
    finishedAt: Date,
  ) {
    for (;;) {
      try {
        await this.attempts.finish(poll, result, finishedAt);

        return true;
      } catch (error) {
        this.logger.error('Could not persist poll outcome', {
          pollId: poll.id,
          competitorId: poll.competitorId,
          err: error,
        });
        if (this.stopping) {
          return false;
        }
        await delay(1000);
      }
    }
  }

  /** Stops scheduling and waits for the current dispatch and in-flight polls to finish. */
  async onModuleDestroy() {
    this.stopping = true;
    clearTimeout(this.timer);
    await this.cycle;
    await Promise.allSettled(this.running);
  }
}
