import { Injectable } from '@nestjs/common';
import { ConfigService } from '@src/tools/config';
import { PollAttemptRepository } from '../repositories';
import {
  OutcomeKind,
  type PollResult,
  type PollAttempt,
  type ClaimedPoll,
} from '../types';
import { MAX_POLL_ATTEMPTS } from '../consts/polling.const';

/** Schedules source fetches and records each attempt against its logical poll. */
@Injectable()
export class PollAttemptService {
  /** Uses tracking storage and the configured polling interval to schedule attempts. */
  constructor(
    private readonly attempts: PollAttemptRepository,
    private readonly config: ConfigService,
  ) {}

  /** Records interrupted fetches and returns the persisted source cooldown as an epoch timestamp in milliseconds. */
  async recover() {
    for (const poll of await this.attempts.listFetching()) {
      await this.finish(poll, { kind: OutcomeKind.Interrupted }, new Date());
    }
    const until = await this.attempts.cooldownUntil();

    return until?.getTime() ?? 0;
  }

  /** Persists the longest known source deadline while the rate-limited poll is still in flight. */
  saveCooldown(deadline: Date) {
    return this.attempts.saveCooldown(deadline);
  }

  /** Returns how many milliseconds the oldest scheduled poll is overdue, or zero if none is late. */
  async oldestOverdueMs() {
    const due = await this.attempts.oldestDueAt();

    return due ? Math.max(0, Date.now() - due.getTime()) : 0;
  }

  /** Claims the next due poll using the configured interval for its regular schedule. */
  claim() {
    return this.attempts.claim(this.config.getEnv('POLL_INTERVAL_MS'));
  }

  /** Requests the next available dispatch for an active competitor, reusing any unfinished poll. */
  requestPoll(id: string) {
    return this.attempts.requestPoll(id);
  }

  /** Releases a claim when its source request never started. */
  releaseUnstarted(poll: ClaimedPoll) {
    return this.attempts.releaseUnstarted(poll);
  }

  /** Applies the retry policy and records the attempt’s result. */
  finish(poll: PollAttempt, result: PollResult, finishedAt: Date) {
    const retryAt = PollAttemptService.retryAt(poll.attemptNo, result, finishedAt);

    return this.attempts.finish(poll, result, { finishedAt, retryAt });
  }

  /** Returns the source retry deadline or a jittered backoff time, or null when polling should stop for this ID. */
  private static retryAt(
    attemptNo: number,
    result: PollResult,
    finishedAt: Date,
  ): Date | null {
    if (
      result.kind === OutcomeKind.Complete ||
      result.kind === OutcomeKind.Missing ||
      attemptNo >= MAX_POLL_ATTEMPTS
    ) {
      return null;
    }
    if (result.kind === OutcomeKind.RateLimited) {
      return result.retryAfter;
    }
    const jitterMs = Math.random() * 2000 * 2 ** (attemptNo - 1);

    return new Date(finishedAt.getTime() + jitterMs);
  }
}
