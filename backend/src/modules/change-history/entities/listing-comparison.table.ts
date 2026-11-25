import { and, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { ChangeKind, type ListingContent, type ListingDiff } from '../types';
import { listingFields } from '../consts/listing-fields.const';

export const listingComparisons = pgTable(
  'listing_comparisons',
  {
    pollId: uuid('poll_id').primaryKey(),
    competitorId: text('competitor_id').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    listingState: jsonb('listing_state').$type<ListingContent>(),
    diff: jsonb('diff').$type<ListingDiff>(),
  },
  ({ competitorId, observedAt, pollId, listingState, diff }) => {
    const fieldKeys = sql`array[${sql.join(
      listingFields.map((field) => sql.param(field)),
      sql`, `,
    )}]`;
    const validListingState = and(
      eq(sql<string>`jsonb_typeof(${listingState})`, 'object'),
      sql`${listingState} ?& ${fieldKeys}`,
      ...listingFields.map((field) =>
        eq(sql<string>`jsonb_typeof(${listingState}->${field})`, 'string'),
      ),
    );

    const changedFields = sql`(${diff}->'changedFields')`;
    const emptyObject = sql`'{}'::jsonb`;
    const validChangeKind = sql`case ${diff}->>'kind'
      when ${ChangeKind.Disappeared} then ${and(isNull(listingState), eq(changedFields, emptyObject))}
      when ${ChangeKind.ContentChanged} then ${and(isNotNull(listingState), ne(changedFields, emptyObject))}
      when ${ChangeKind.Returned} then ${isNotNull(listingState)}
      else false
    end`;
    const validDiff = and(
      eq(sql<string>`jsonb_typeof(${diff})`, 'object'),
      sql`${diff} ?& array['kind','changedFields']`,
      eq(sql<string>`jsonb_typeof(${diff}->'kind')`, 'string'),
      eq(sql<string>`jsonb_typeof(${changedFields})`, 'object'),
      eq(sql`(${changedFields} - ${fieldKeys})`, emptyObject),
      validChangeKind,
    );

    return [
      index('listing_comparisons_poll_order').on(competitorId, pollId.desc()),
      index('listing_comparisons_changes_feed')
        .on(competitorId, observedAt.desc(), pollId.desc())
        .where(isNotNull(diff)),
      check(
        'comparison_complete_state',
        or(isNull(listingState), validListingState).inlineParams(),
      ),
      check('comparison_diff_shape', or(isNull(diff), validDiff).inlineParams()),
    ];
  },
);
