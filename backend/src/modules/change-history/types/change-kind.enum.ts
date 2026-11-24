import { pgEnum } from 'drizzle-orm/pg-core';

export enum ChangeKind {
  ContentChanged = 'content_changed',
  Disappeared = 'disappeared',
  Returned = 'returned',
}

export const changeKind = pgEnum('listing_change_kind', ChangeKind);
