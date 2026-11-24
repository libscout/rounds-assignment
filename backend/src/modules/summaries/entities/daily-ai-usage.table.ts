import { between } from 'drizzle-orm';
import { check, date, integer, pgTable } from 'drizzle-orm/pg-core';

export const DAILY_AI_LIMIT = 2000;
export const dailyAiUsage = pgTable(
  'daily_ai_usage',
  {
    day: date().primaryKey(),
    calls: integer().notNull(),
  },
  ({ calls }) => [check('daily_ai_calls_range', between(calls, 1, DAILY_AI_LIMIT).inlineParams())],
);
