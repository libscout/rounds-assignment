import { isNotNull } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const watchlist = pgTable(
  'watchlist',
  {
    id: text().primaryKey(),
    nextDueAt: timestamp('next_due_at', { withTimezone: true }),
    lastDispatchedPollId: uuid('last_dispatched_poll_id'),
  },
  ({ nextDueAt, id }) => [
    index('watchlist_due_idx').on(nextDueAt, id).where(isNotNull(nextDueAt)),
  ],
);
