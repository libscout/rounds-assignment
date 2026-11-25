import { and, eq, inArray } from 'drizzle-orm';
import { pgTable, uuid, timestamp, index, check, text } from 'drizzle-orm/pg-core';
import { ExecutionStatus } from '../types';

export const pollExecutions = pgTable(
  'poll_executions',
  {
    pollId: uuid('poll_id').primaryKey(),
    trackingFinishedAt: timestamp('tracking_finished_at', {
      withTimezone: true,
    }).notNull(),
    trackingStatus: text('tracking_status')
      .$type<ExecutionStatus>()
      .notNull()
      .default(ExecutionStatus.Completed),
    changeHistoryStatus: text('change_history_status')
      .$type<ExecutionStatus>()
      .notNull()
      .default(ExecutionStatus.NotSubmitted),
    aiSummaryStatus: text('ai_summary_status')
      .$type<ExecutionStatus>()
      .notNull()
      .default(ExecutionStatus.NotSubmitted),
  },
  ({
    pollId,
    trackingFinishedAt,
    trackingStatus,
    changeHistoryStatus,
    aiSummaryStatus,
  }) => [
    check(
      'execution_tracking_done',
      eq(trackingStatus, ExecutionStatus.Completed).inlineParams(),
    ),
    check(
      'execution_history_required',
      inArray(
        changeHistoryStatus,
        Object.values(ExecutionStatus).filter(
          (status) => status !== ExecutionStatus.NotRequired,
        ),
      ).inlineParams(),
    ),
    check(
      'execution_ai_summary_status',
      inArray(aiSummaryStatus, Object.values(ExecutionStatus)).inlineParams(),
    ),
    index('execution_ai_work_idx')
      .on(aiSummaryStatus, trackingFinishedAt, pollId)
      .where(
        and(
          eq(changeHistoryStatus, ExecutionStatus.Completed),
          inArray(aiSummaryStatus, [
            ExecutionStatus.NotSubmitted,
            ExecutionStatus.Submitted,
          ]),
        ).inlineParams(),
      ),
  ],
);
