import { pgEnum } from 'drizzle-orm/pg-core';

export enum SummaryStatus {
  Pending = 'pending',
  Ready = 'ready',
  Timeout = 'timeout',
  InvalidOutput = 'invalid_output',
  Failed = 'failed',
  BudgetExhausted = 'budget_exhausted',
}
export const summaryStatus = pgEnum('summary_status', SummaryStatus);
