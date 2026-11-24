import {
  boolean,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { and, eq } from 'drizzle-orm';
import { type ListingFields, outcomeKind } from '../types';
import { listingVersions } from './listing-version.table';

export const legacyListingSnapshots = pgTable(
  'listing_snapshots',
  {
    pollId: uuid('poll_id').primaryKey(),
    competitorId: text('competitor_id').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    outcomeKind: outcomeKind('outcome_kind').notNull(),
    httpStatus: smallint('http_status'),
    versionId: uuid('version_id').references(() => listingVersions.id),
    partialFields: jsonb('partial_fields').$type<ListingFields>(),
    changeImported: boolean('change_imported').notNull().default(false),
    changed: boolean().notNull().default(false),
  },
  ({ competitorId, fetchedAt, changed, changeImported, pollId, outcomeKind }) => [
    index('snapshots_import_idx')
      .on(fetchedAt, pollId)
      .where(and(changed.getSQL(), eq(changeImported, false)).inlineParams()),
    index('snapshots_competitor_time_idx').on(competitorId, fetchedAt),
    index('snapshots_outcome_time_idx').on(competitorId, outcomeKind, fetchedAt),
    index('snapshots_recent_change_idx').on(fetchedAt, competitorId).where(changed.getSQL()),
  ],
);
