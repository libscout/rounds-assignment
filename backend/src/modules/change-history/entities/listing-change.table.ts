import { and, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { type ChangedFields, ChangeKind, changeKind, SummaryStatus, summaryStatus } from '../types';

export const listingChanges = pgTable(
  'listing_changes',
  {
    pollId: uuid('poll_id').primaryKey(),
    competitorId: text('competitor_id').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    kind: changeKind().notNull(),
    changedFields: jsonb('changed_fields').$type<ChangedFields>().notNull(),
    summary: text(),
    summaryStatus: summaryStatus('summary_status').notNull().default(SummaryStatus.Pending),
    claimToken: uuid('claim_token'),
    claimExpiresAt: timestamp('claim_expires_at', { withTimezone: true }),
  },
  ({
    competitorId,
    observedAt,
    pollId,
    kind,
    changedFields,
    summary,
    summaryStatus,
    claimToken,
    claimExpiresAt,
  }) => [
    check(
      'change_field_shape',
      sql`jsonb_typeof(${changedFields}) = 'object' AND (${changedFields} - ARRAY['title','tagline','description','price']) = '{}'::jsonb`,
    ),
    check(
      'change_event_fields',
      and(
        or(ne(kind, ChangeKind.ContentChanged), sql`${changedFields} <> '{}'::jsonb`),
        or(ne(kind, ChangeKind.Disappeared), sql`${changedFields} = '{}'::jsonb`),
      ).inlineParams(),
    ),
    check('change_summary_ready', sql`(${summary} is not null) = (${summaryStatus} = 'ready')`),
    check(
      'change_claim_state',
      or(
        and(isNull(claimToken), isNull(claimExpiresAt)),
        and(
          eq(summaryStatus, SummaryStatus.Pending),
          isNotNull(claimToken),
          isNotNull(claimExpiresAt),
        ),
      ).inlineParams(),
    ),
    index('changes_feed_idx').on(competitorId, observedAt.desc(), pollId.desc()),
    index('changes_pending_idx')
      .on(observedAt, pollId)
      .where(eq(summaryStatus, SummaryStatus.Pending).inlineParams()),
  ],
);
