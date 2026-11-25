import type { ListingDiff } from './listing-diff.types';

export interface ListingChange extends ListingDiff {
  pollId: string;
  competitorId: string;
  observedAt: Date;
}
