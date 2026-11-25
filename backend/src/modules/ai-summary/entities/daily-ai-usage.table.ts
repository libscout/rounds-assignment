import { between } from 'drizzle-orm';
import { check, date, integer, pgTable } from 'drizzle-orm/pg-core';
import { DAILY_AI_LIMIT } from '../consts/ai-limits.const';

export const dailyAiUsage = pgTable(
  'daily_ai_usage',
  {
    day: date().primaryKey(),
    calls: integer().notNull(),
    liveCalls: integer('live_calls').notNull().default(0),
  },
  ({ calls, liveCalls }) => [
    check('daily_ai_calls_range', between(calls, 1, DAILY_AI_LIMIT).inlineParams()),
    check('daily_ai_live_calls_range', between(liveCalls, 0, calls).inlineParams()),
  ],
);
