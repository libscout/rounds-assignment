import type { ExecutionStatus } from './execution-status.enum';

export interface PollExecutionStatus {
  pollId: string;
  changeHistoryStatus: ExecutionStatus;
  aiSummaryStatus: ExecutionStatus;
}
