import type { ObservationKind } from './observation-kind.enum';
import type { ListingContent } from './listing-content.types';

export interface CompleteObservation {
  kind: ObservationKind.Complete;
  fields: ListingContent;
}

export interface MissingObservation {
  kind: ObservationKind.Missing;
}

export type ObservationState = CompleteObservation | MissingObservation;

export interface Observation {
  pollId: string;
  competitorId: string;
  observedAt: Date;
  current: ObservationState;
}
