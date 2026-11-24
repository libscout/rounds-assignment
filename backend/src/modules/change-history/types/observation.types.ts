import { ObservationKind } from './observation-kind.enum';
import type { ListingContent } from './listing-content.types';

export interface Observation {
  pollId: string;
  competitorId: string;
  observedAt: Date;
  current:
    | { kind: ObservationKind.Complete; fields: ListingContent }
    | { kind: ObservationKind.Missing | ObservationKind.Inconclusive };
  previousFields: ListingContent | null;
  previouslyVisible: boolean | null;
}
