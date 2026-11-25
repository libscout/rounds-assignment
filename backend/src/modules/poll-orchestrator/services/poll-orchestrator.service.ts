import { Injectable } from '@nestjs/common';
import { PollDeliveryService } from '@src/modules/listing-tracking/services';
import { OutcomeKind } from '@src/modules/listing-tracking/types';
import { ChangeHistoryService } from '@src/modules/change-history/services';
import {
  ObservationKind,
  type Observation,
  type ObservationState,
} from '@src/modules/change-history/types';
import {
  SummaryStatus,
  SummarySubmissionOutcome,
  type SummaryResult,
} from '@src/modules/ai-summary/types';
import { AiSummaryService } from '@src/modules/ai-summary/services';
import { LoggerService } from '@src/tools/logger';
import { PollExecutionRepository } from '../repositories/poll-execution.repository';
import { ExecutionStatus, type PollExecutionStatus } from '../types';

/** Coordinates independent leaf commits and reconciles their progress by poll ID. */
@Injectable()
export class PollOrchestratorService {
  /** Uses the leaf services, execution repository and logger to coordinate poll processing. */
  constructor(
    private readonly tracking: PollDeliveryService,
    private readonly history: ChangeHistoryService,
    private readonly ai: AiSummaryService,
    private readonly repo: PollExecutionRepository,
    private readonly logger: LoggerService,
  ) {}

  /** Returns the recorded comparison and AI progress for the requested polls. */
  statuses(ids: string[]): Promise<PollExecutionStatus[]> {
    return this.repo.statuses(ids);
  }

  /** Returns any comparison error blocking the competitor’s oldest outstanding poll. */
  async latestComparisonError(competitorId: string) {
    const id = await this.tracking.oldestOutstandingId(competitorId);
    if (!id) {
      return null;
    }
    const error = await this.repo.comparisonErrorForPoll(id);

    return error ? { ...error, status: ExecutionStatus.Error } : null;
  }

  /** Records the poll’s comparison if needed and acknowledges delivery after completion. */
  async deliverPoll(id: string) {
    const observation = await this.readObservation(id);
    const execution = await this.repo.discover(id, observation.observedAt);
    if (execution.changeHistoryStatus !== ExecutionStatus.Completed) {
      await this.compare(observation);
    }
    await this.tracking.acknowledge(id);
  }

  /** Converts a deliverable tracking result into the observation accepted by Change History. */
  private async readObservation(id: string): Promise<Observation> {
    const poll = await this.tracking.getDeliverableObservation(id);
    const current: ObservationState =
      poll.outcomeKind === OutcomeKind.Complete
        ? { kind: ObservationKind.Complete, fields: poll.fields }
        : { kind: ObservationKind.Missing };

    return {
      pollId: id,
      competitorId: poll.competitorId,
      observedAt: poll.finishedAt,
      current,
    };
  }

  /** Records the history decision and whether it requires a summary, marking comparison failures for retry. */
  private async compare(observation: Observation) {
    const { pollId } = observation;
    await this.repo.begin(pollId);
    let changed: boolean;
    try {
      const result = await this.history.record(observation);
      changed = Boolean(result.change);
    } catch (error) {
      await this.repo.comparisonError(pollId);
      throw error;
    }
    await this.repo.finishComparison(pollId, changed);
  }

  /** Submits a committed diff to AI Summary and records acceptance or an input rejection. */
  async submit(id: string) {
    const change = await this.history.getChange(id);
    if (!change) {
      throw new Error('Expected committed change');
    }
    const outcome = await this.ai.submit({
      pollId: id,
      diff: { kind: change.kind, changedFields: change.changedFields },
    });
    const nextStatus =
      outcome === SummarySubmissionOutcome.Accepted
        ? ExecutionStatus.Submitted
        : ExecutionStatus.Error;
    await this.repo.aiTransition(id, ExecutionStatus.NotSubmitted, nextStatus);
  }

  /** Reads summary outcomes and marks submitted executions as completed or in error. */
  async checkResults(ids: string[]) {
    const results = await this.ai.getResults(ids);
    for (const id of ids) {
      await this.recordSummaryResult(id, results.get(id));
    }
  }

  /** Updates one terminal execution and logs any missing job or failed status write. */
  private async recordSummaryResult(id: string, result: SummaryResult | undefined) {
    if (!result) {
      this.logger.warn('Missing submitted summary', { pollId: id });

      return;
    }
    if (result.status === 'pending') {
      return;
    }
    try {
      const nextStatus =
        result.status === SummaryStatus.Ready
          ? ExecutionStatus.Completed
          : ExecutionStatus.Error;
      await this.repo.aiTransition(id, ExecutionStatus.Submitted, nextStatus);
    } catch (error) {
      this.logger.warn('Could not record AI result', { pollId: id, err: error });
    }
  }
}
