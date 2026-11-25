import type { SummaryDiff } from './summary.types';

export interface IdleSummaryClaim {
  readonly kind: 'idle';
}

export interface FinishedSummaryClaim {
  readonly kind: 'finished';
}

export interface ClaimedSummaryJob {
  readonly kind: 'claimed';
  readonly pollId: string;
  readonly attempt: number;
  readonly diff: SummaryDiff;
}

export type SummaryClaim = IdleSummaryClaim | FinishedSummaryClaim | ClaimedSummaryJob;
