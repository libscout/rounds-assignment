import { setTimeout, clearTimeout } from 'node:timers';
import { Injectable } from '@nestjs/common';
import { ChangeHistoryService } from '@src/modules/change-history/services';
import { ChangeKind, type ListingChange } from '@src/modules/change-history/types';
import { AiSummaryService } from '@src/modules/ai-summary/services';
import { SummaryStatus, type SummaryResult } from '@src/modules/ai-summary/types';
import {
  ExecutionStatus,
  type PollExecutionStatus,
} from '@src/modules/poll-orchestrator/types';
import { PollOrchestratorService } from '@src/modules/poll-orchestrator/services';
import {
  PollObservationsService,
  WatchlistService,
} from '@src/modules/listing-tracking/services';
import { OutcomeKind, type PollObservation } from '@src/modules/listing-tracking/types';
import {
  RECENT_CHANGES_WINDOW_MS,
  SUPPLEMENTARY_READ_TIMEOUT_MS,
} from '../consts/timeline-timing.const';
import { ProcessingStatusDto } from '../dto/processing-status.dto';
import { SnapshotDto, type ComparisonStatus } from '../dto/snapshot.dto';

interface TimelineProgress {
  executions: Map<string, PollExecutionStatus> | undefined;
  summaries: Map<string, SummaryResult> | undefined;
}

/** Composes independently published observations, comparisons and summaries by poll ID. */
@Injectable()
export class CompetitorTimelineService {
  /** Returns undefined if a supplementary timeline read fails or exceeds its deadline. */
  private static async optional<T>(read: Promise<T>): Promise<T | undefined> {
    let timer: NodeJS.Timeout;
    try {
      const deadline = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), SUPPLEMENTARY_READ_TIMEOUT_MS);
      });

      return await Promise.race([read, deadline]);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Uses the watchlist, polls, comparisons, summaries and execution statuses to assemble timeline views. */
  constructor(
    private readonly polls: PollObservationsService,
    private readonly history: ChangeHistoryService,
    private readonly ai: AiSummaryService,
    private readonly orchestration: PollOrchestratorService,
    private readonly watchlist: WatchlistService,
  ) {}

  /** Lists watched competitors with their change indicators for the past 24 hours. */
  async listCompetitors() {
    const ids = await this.watchlist.list();
    const changed = await CompetitorTimelineService.optional(
      this.history.changedSince(ids, new Date(Date.now() - RECENT_CHANGES_WINDOW_MS)),
    );

    return ids.map((id) => ({ id, changedInLast24h: changed?.has(id) ?? null }));
  }

  /** Combines the latest finished poll with any outstanding comparison error for the competitor. */
  async processingStatus(id: string) {
    const [polls, error] = await Promise.all([
      this.polls.page(id, 1),
      this.orchestration.latestComparisonError(id),
    ]);

    return new ProcessingStatusDto(error, polls.items[0]);
  }

  /** Pages through finished polls and joins each one to its available comparison and summary. */
  async page(id: string, limit: number, cursor?: string) {
    const { items, nextCursor } = await this.polls.page(id, limit, cursor);
    const ids = items
      .filter(CompetitorTimelineService.canCompare)
      .map((poll) => poll.pollId);
    const [decisions, progress] = await Promise.all([
      this.readDecisions(ids),
      this.readProgress(ids),
    ]);
    const snapshots = items.map((poll) =>
      CompetitorTimelineService.pollSnapshot(poll, decisions, progress),
    );

    return { snapshots, nextCursor };
  }

  /** Pages through detected changes and fills in poll details and summaries when available. */
  async changePage(id: string, limit: number, cursor?: string) {
    const { items, nextCursor } = await this.history.page(id, limit, cursor);
    const ids = items.map((change) => change.pollId);
    const [polls, progress] = await Promise.all([
      this.readObservations(ids),
      this.readProgress(ids),
    ]);
    const snapshots = items.map((change) =>
      CompetitorTimelineService.changeSnapshot(
        change,
        polls.get(change.pollId),
        progress,
      ),
    );

    return { snapshots, nextCursor };
  }

  /** Identifies the complete or missing observations eligible for comparison. */
  private static canCompare(this: void, poll: PollObservation) {
    return (
      poll.outcomeKind === OutcomeKind.Complete ||
      poll.outcomeKind === OutcomeKind.Missing
    );
  }

  /** Indexes comparison decisions by poll ID, including a null change for unchanged listings. */
  private async readDecisions(ids: string[]) {
    const decisions = await CompetitorTimelineService.optional(
      this.history.getDecisions(ids),
    );

    return (
      decisions &&
      new Map(decisions.map((decision) => [decision.pollId, decision.change]))
    );
  }

  /** Indexes available tracking observations for the changes page. */
  private async readObservations(ids: string[]) {
    const polls = await CompetitorTimelineService.optional(this.polls.byIds(ids));

    return new Map(polls?.map((poll) => [poll.pollId, poll]));
  }

  /** Reads execution statuses and summaries concurrently, allowing either source to be unavailable. */
  private async readProgress(ids: string[]): Promise<TimelineProgress> {
    const [statuses, summaries] = await Promise.all([
      CompetitorTimelineService.optional(this.orchestration.statuses(ids)),
      CompetitorTimelineService.optional(this.ai.getResults(ids)),
    ]);
    const executions = statuses && new Map(statuses.map((row) => [row.pollId, row]));

    return { executions, summaries };
  }

  /** Builds a poll snapshot using the saved decision and any known comparison error. */
  private static pollSnapshot(
    poll: PollObservation,
    decisions: Map<string, ListingChange | null> | undefined,
    progress: TimelineProgress,
  ) {
    const execution = progress.executions?.get(poll.pollId);
    let state: ComparisonStatus = 'pending';
    if (!CompetitorTimelineService.canCompare(poll)) {
      state = 'not_applicable';
    } else if (decisions?.has(poll.pollId)) {
      state = 'completed';
    } else if (execution?.changeHistoryStatus === ExecutionStatus.Error) {
      state = 'error';
    } else if (!decisions || !progress.executions) {
      state = 'unavailable';
    }

    return CompetitorTimelineService.snapshot(
      poll,
      decisions?.get(poll.pollId) ?? null,
      state,
      progress,
    );
  }

  /** Uses the change's poll ID and observation time when Tracking cannot supply its fields. */
  private static changeSnapshot(
    change: ListingChange,
    poll: PollObservation | undefined,
    progress: TimelineProgress,
  ) {
    const fallbackOutcome =
      change.kind === ChangeKind.Disappeared
        ? OutcomeKind.Missing
        : OutcomeKind.Complete;
    const observation = poll ?? {
      pollId: change.pollId,
      finishedAt: change.observedAt,
      failedAttempts: [],
      fields: null,
      outcomeKind: fallbackOutcome,
    };

    return CompetitorTimelineService.snapshot(
      observation,
      change,
      'completed',
      progress,
      Boolean(poll),
    );
  }

  /** Builds the snapshot DTO with the summary available for this poll. */
  private static snapshot(
    poll: PollObservation,
    change: ListingChange | null,
    state: ComparisonStatus,
    progress: TimelineProgress,
    available = true,
  ) {
    const { summaryStatus, summary } = CompetitorTimelineService.summaryFor(
      poll.pollId,
      change,
      state,
      progress,
    );

    return SnapshotDto.fromPoll(poll, change, state, summaryStatus, summary, available);
  }

  /** Resolves the visible summary status and text from the comparison and AI progress. */
  private static summaryFor(
    pollId: string,
    change: ListingChange | null,
    state: ComparisonStatus,
    progress: TimelineProgress,
  ): Pick<SnapshotDto, 'summaryStatus' | 'summary'> {
    if (!change) {
      const summaryStatus =
        state === 'pending' || state === 'unavailable' ? state : 'not_applicable';

      return { summaryStatus, summary: null };
    }
    if (!progress.summaries) {
      return { summaryStatus: 'unavailable', summary: null };
    }
    const result = progress.summaries.get(pollId);
    if (result) {
      const summary = result.status === SummaryStatus.Ready ? result.text : null;

      return { summaryStatus: result.status, summary };
    }
    const failed =
      progress.executions?.get(pollId)?.aiSummaryStatus === ExecutionStatus.Error;
    const summaryStatus = failed ? SummaryStatus.Failed : 'pending';

    return { summaryStatus, summary: null };
  }
}
