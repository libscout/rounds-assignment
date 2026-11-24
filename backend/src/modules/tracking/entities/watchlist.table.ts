import { between, eq, isNotNull } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const watchlist = pgTable(
  'watchlist',
  {
    id: text().primaryKey(),
    active: boolean().notNull().default(true),
    nextDueAt: timestamp('next_due_at', { withTimezone: true }),
    nextAttemptNo: smallint('next_attempt_no').notNull().default(1),
    lastDispatchedPollId: uuid('last_dispatched_poll_id'),
  },
  ({ active, nextDueAt, nextAttemptNo, id }) => [
    check('watchlist_active_due', eq(isNotNull(nextDueAt), active)),
    check('watchlist_attempt_range', between(nextAttemptNo, 1, 3).inlineParams()),

    index('watchlist_due_idx').on(nextDueAt, id).where(active.getSQL()),
  ],
);
