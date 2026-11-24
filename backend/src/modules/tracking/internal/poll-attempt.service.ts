import { Injectable } from '@nestjs/common';
import { ConfigService } from '@src/tools/config';
import { PollAttemptRepository } from '../repositories';
import {
  type PollResult,
  type ClaimedPoll,
  type PollReschedule,
  OutcomeKind,
  PollStatus,
} from '../types';

/** Schedules poll attempts and applies retry and cooldown policies to their outcomes. */
@Injectable()
export class PollAttemptService {
  constructor(
    private readonly attempts: PollAttemptRepository,
    private readonly config: ConfigService,
  ) {}

  async recover(): Promise<number> {
    const cooldown = await this.attempts.recover();
    return cooldown?.getTime() ?? 0;
  }

  async oldestOverdueMs(): Promise<number> {
    const due = await this.attempts.oldestDueAt();
    return due ? Math.max(0, Date.now() - due.getTime()) : 0;
  }

  claim(): Promise<ClaimedPoll | undefined> {
    return this.attempts.claim(this.config.getEnv('POLL_INTERVAL_MS'));
  }

  releaseUnstarted(poll: ClaimedPoll): Promise<void> {
    return this.attempts.releaseUnstarted(poll);
  }

  finish(poll: ClaimedPoll, result: PollResult, finishedAt: Date): Promise<void> {
    const success = [OutcomeKind.Complete, OutcomeKind.Partial, OutcomeKind.Missing].includes(
      result.kind,
    );
    const status = success ? PollStatus.Success : PollStatus.Error;
    return this.attempts.finish(
      poll,
      result,
      finishedAt,
      status,
      PollAttemptService.nextSchedule(poll, result, finishedAt),
    );
  }

  private static nextSchedule(
    poll: ClaimedPoll,
    result: PollResult,
    finishedAt: Date,
  ): PollReschedule | null {
    if (result.kind === OutcomeKind.RateLimited)
      return { nextDueAt: result.retryAfter, nextAttemptNo: poll.attemptNo };
    if (poll.attemptNo >= 3 || !PollAttemptService.isTransient(result)) return null;
    const delay = Math.random() * 2000 * 2 ** (poll.attemptNo - 1);
    return { nextDueAt: new Date(finishedAt.getTime() + delay), nextAttemptNo: poll.attemptNo + 1 };
  }

  private static isTransient(result: PollResult): boolean {
    return (
      result.kind === OutcomeKind.Timeout ||
      result.kind === OutcomeKind.TransportError ||
      (result.kind === OutcomeKind.UpstreamError && [500, 502, 503].includes(result.httpStatus))
    );
  }
}
