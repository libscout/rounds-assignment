import type { ListingFields } from '../types';
import { jsonb, pgTable, uuid } from 'drizzle-orm/pg-core';

export const listingVersions = pgTable('listing_versions', {
  id: uuid().primaryKey(),
  fields: jsonb().$type<ListingFields>().notNull(),
});
