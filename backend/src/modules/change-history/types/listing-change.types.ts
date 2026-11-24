import type { ListingDiff } from './listing-diff.types';
import type { SummaryStatus } from './summary-status.enum';

export interface ListingChange extends ListingDiff {
  pollId: string;
  competitorId: string;
  observedAt: Date;
  summary: string | null;
  summaryStatus: SummaryStatus;
}
