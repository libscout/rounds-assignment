import type { SummaryStatus } from './summary-status.enum';

export interface SummaryDiff {
  kind: 'content_changed' | 'returned' | 'disappeared';
  changedFields: Partial<
    Record<'title' | 'tagline' | 'price' | 'description', { from: string; to: string }>
  >;
}

export interface SubmitSummary {
  pollId: string;
  diff: SummaryDiff;
}

export interface PendingSummaryResult {
  status: 'pending';
}

export interface ReadySummaryResult {
  status: SummaryStatus.Ready;
  text: string;
}

export interface TimeoutSummaryResult {
  status: SummaryStatus.Timeout;
}

export interface FailedSummaryResult {
  status: SummaryStatus.Failed;
}

export interface InvalidOutputSummaryResult {
  status: SummaryStatus.InvalidOutput;
}

export interface BudgetExhaustedSummaryResult {
  status: SummaryStatus.BudgetExhausted;
}

export type SummaryResult =
  | PendingSummaryResult
  | ReadySummaryResult
  | TimeoutSummaryResult
  | FailedSummaryResult
  | InvalidOutputSummaryResult
  | BudgetExhaustedSummaryResult;
