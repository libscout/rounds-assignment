import type { ListingFields } from './listing-fields.types';
import type { OutcomeKind } from './outcome-kind.enum';
import type { PollObservation } from './poll-observation.types';

interface CompetitorObservation extends PollObservation {
  competitorId: string;
}

export interface CompleteDelivery extends CompetitorObservation {
  outcomeKind: OutcomeKind.Complete;
  fields: Required<ListingFields>;
}

export interface MissingDelivery extends CompetitorObservation {
  outcomeKind: OutcomeKind.Missing;
  fields: null;
}

export type DeliverableObservation = CompleteDelivery | MissingDelivery;
