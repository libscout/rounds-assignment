import { and, between, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  uniqueIndex,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { type ListingFields, OutcomeKind, outcomeKind, PollStatus, pollStatus } from '../types';
import { listingVersions } from './listing-version.table';
import { watchlist } from './watchlist.table';

export const pollAttempts = pgTable(
  'poll_attempts',
  {
    id: uuid().defaultRandom().primaryKey(),
    competitorId: text('competitor_id')
      .notNull()
      .references(() => watchlist.id),
    attemptNo: smallint('attempt_no'),
    status: pollStatus().notNull().default(PollStatus.Pending),
    outcomeKind: outcomeKind('outcome_kind'),
    httpStatus: smallint('http_status'),
    response: jsonb().$type<ListingFields>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    versionId: uuid('version_id').references(() => listingVersions.id),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    deliveryAttempts: integer('delivery_attempts').notNull().default(0),
    nextDeliveryAt: timestamp('next_delivery_at', { withTimezone: true }),
  },
  ({
    id,
    competitorId,
    processedAt,
    createdAt,
    versionId,
    status,
    outcomeKind,
    finishedAt,
    nextDeliveryAt,
    attemptNo,
    deliveryAttempts,
    httpStatus,
  }) => {
    const pending = and(
      eq(status, PollStatus.Pending),
      isNull(outcomeKind),
      isNull(processedAt),
      isNull(finishedAt),
      isNull(nextDeliveryAt),
    );
    const success = and(
      eq(status, PollStatus.Success),
      inArray(outcomeKind, [OutcomeKind.Complete, OutcomeKind.Partial, OutcomeKind.Missing]),
    );
    const error = and(
      eq(status, PollStatus.Error),
      inArray(outcomeKind, [
        OutcomeKind.RateLimited,
        OutcomeKind.UpstreamError,
        OutcomeKind.Timeout,
        OutcomeKind.TransportError,
        OutcomeKind.InvalidResponse,
        OutcomeKind.Interrupted,
      ]),
    );
    const finished = and(
      isNotNull(outcomeKind),
      isNotNull(finishedAt),
      sql`(${nextDeliveryAt} is not null) = (${processedAt} is null)`,
      or(success, error),
    );

    return [
      uniqueIndex('poll_attempts_outstanding_idx').on(competitorId).where(isNull(processedAt)),
      index('poll_attempts_timeline_idx')
        .on(competitorId, finishedAt.desc(), id.desc())
        .where(isNotNull(processedAt)),
      check(
        'poll_attempts_claim_metadata',
        or(isNotNull(processedAt), and(isNotNull(attemptNo), isNotNull(createdAt))),
      ),
      check(
        'poll_attempts_version',
        eq(
          isNotNull(versionId),
          and(isNotNull(processedAt), eq(outcomeKind, OutcomeKind.Complete)),
        ).inlineParams(),
      ),
      check('poll_attempts_attempt_range', between(attemptNo, 1, 3).inlineParams()),
      check('poll_attempts_delivery_count', gte(deliveryAttempts, 0).inlineParams()),
      check('poll_attempts_http_status', between(httpStatus, 100, 599).inlineParams()),
      check('poll_attempts_lifecycle', or(pending, finished).inlineParams()),

      index('poll_attempts_delivery_idx')
        .on(nextDeliveryAt, id)
        .where(
          and(
            isNull(processedAt),
            inArray(status, [PollStatus.Success, PollStatus.Error]),
          ).inlineParams(),
        ),
    ];
  },
);
