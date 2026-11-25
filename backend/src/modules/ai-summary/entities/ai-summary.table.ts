import {
  and,
  between,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  not,
  or,
  sql,
} from 'drizzle-orm';
import {
  pgTable,
  uuid,
  jsonb,
  timestamp,
  integer,
  text,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { SummaryStatus, type SummaryDiff } from '../types';
import { MAX_AI_ATTEMPTS } from '../consts/ai-limits.const';

export const aiSummaries = pgTable(
  'ai_summaries',
  {
    pollId: uuid('poll_id').primaryKey(),
    diff: jsonb().$type<SummaryDiff>().notNull(),
    status: text().$type<SummaryStatus>().notNull().default(SummaryStatus.Queued),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow(),
    attemptCount: integer('attempt_count').notNull().default(0),
    summaryText: text('summary_text'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  ({ availableAt, pollId, status, completedAt, attemptCount, summaryText }) => {
    const active = inArray(status, [SummaryStatus.Queued, SummaryStatus.Running]);
    const scheduled = and(active, isNotNull(availableAt), isNull(completedAt));
    const finished = and(not(active), isNull(availableAt), isNotNull(completedAt));
    const hasSummary = and(
      eq(status, SummaryStatus.Ready),
      isNotNull(summaryText),
      gt(sql<number>`length(trim(${summaryText}))`, 0),
    );
    const noSummary = and(ne(status, SummaryStatus.Ready), isNull(summaryText));

    return [
      index('ai_summaries_due_idx')
        .on(availableAt, pollId)
        .where(active.inlineParams()),
      check(
        'ai_summary_status',
        inArray(status, Object.values(SummaryStatus)).inlineParams(),
      ),
      check(
        'ai_attempt_range',
        between(attemptCount, 0, MAX_AI_ATTEMPTS).inlineParams(),
      ),
      check('ai_summary_lifecycle', or(scheduled, finished).inlineParams()),
      check('ai_summary_ready', or(hasSummary, noSummary).inlineParams()),
    ];
  },
);
