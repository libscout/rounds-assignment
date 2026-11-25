import { SummaryStatus } from '../types';

export const terminalStatuses = {
  timeout: SummaryStatus.Timeout,
  invalid_output: SummaryStatus.InvalidOutput,
  failed: SummaryStatus.Failed,
} as const;
