import {
  and,
  between,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  not,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { PollStatus, type FailedAttempt, type ListingFields } from '../types';
import { watchlist } from './watchlist.table';
import { MAX_POLL_ATTEMPTS } from '../consts/polling.const';

export const pollLogs = pgTable(
  'poll_logs',
  {
    pollId: uuid('poll_id')
      .primaryKey()
      .default(sql`uuidv7()`),
    competitorId: text('competitor_id')
      .notNull()
      .references(() => watchlist.id),
    status: text().$type<PollStatus>().notNull().default(PollStatus.Fetching),
    listingFields: jsonb('listing_fields').$type<ListingFields>(),
    failedAttempts: jsonb('failed_attempts')
      .$type<FailedAttempt[]>()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  ({
    competitorId,
    pollId,
    status,
    listingFields,
    failedAttempts,
    finishedAt,
    deliveredAt,
  }) => {
    const open = inArray(status, [
      PollStatus.Queued,
      PollStatus.Fetching,
      PollStatus.WaitingRetry,
    ]);
    const deliverable = inArray(status, [PollStatus.Complete, PollStatus.Missing]);
    const validFinishedAt = or(
      and(open, isNull(finishedAt)),
      and(not(open), isNotNull(finishedAt)),
    );
    const validListingFields = or(
      and(eq(status, PollStatus.Complete), isNotNull(listingFields)),
      and(ne(status, PollStatus.Complete), isNull(listingFields)),
    );
    const validDeliveredAt = or(isNull(deliveredAt), deliverable);

    const failureCount = sql<number>`jsonb_array_length(${failedAttempts})`;
    const validFailures = and(
      eq(sql<string>`jsonb_typeof(${failedAttempts})`, 'array'),
      between(failureCount, 0, MAX_POLL_ATTEMPTS),
      or(ne(status, PollStatus.Queued), eq(failureCount, 0)),
      or(
        notInArray(status, [PollStatus.Failed, PollStatus.WaitingRetry]),
        gt(failureCount, 0),
      ),
      or(eq(status, PollStatus.Failed), lt(failureCount, MAX_POLL_ATTEMPTS)),
    );

    return [
      uniqueIndex('poll_logs_open_idx').on(competitorId).where(isNull(finishedAt)),
      index('poll_logs_competitor_order_idx').on(competitorId, pollId.desc()),
      index('poll_logs_timeline_idx')
        .on(competitorId, finishedAt.desc(), pollId.desc())
        .where(isNotNull(finishedAt)),
      index('poll_logs_unack_order_idx')
        .on(competitorId, pollId)
        .where(and(isNull(deliveredAt), deliverable).inlineParams()),
      check(
        'poll_logs_status',
        inArray(status, Object.values(PollStatus)).inlineParams(),
      ),
      check(
        'poll_logs_uuidv7',
        sql`uuid_extract_version(${pollId}) is not distinct from 7`,
      ),
      check(
        'poll_logs_lifecycle',
        and(validFinishedAt, validListingFields, validDeliveredAt).inlineParams(),
      ),
      check('poll_logs_failures', validFailures.inlineParams()),
    ];
  },
);
