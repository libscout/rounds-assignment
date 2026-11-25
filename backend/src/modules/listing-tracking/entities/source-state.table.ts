import { eq } from 'drizzle-orm';
import { check, pgTable, smallint, timestamp } from 'drizzle-orm/pg-core';

export const sourceState = pgTable(
  'source_state',
  {
    id: smallint().primaryKey(),
    cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),
  },
  ({ id }) => [check('source_state_singleton', eq(id, 1).inlineParams())],
);
