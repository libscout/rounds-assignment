export enum SummaryStatus {
  Queued = 'queued',
  Running = 'running',
  Ready = 'ready',
  Timeout = 'timeout',
  Failed = 'failed',
  InvalidOutput = 'invalid_output',
  BudgetExhausted = 'budget_exhausted',
}
