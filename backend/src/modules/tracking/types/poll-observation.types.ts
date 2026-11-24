import type { ListingFields } from './listing-fields.types';
import type { OutcomeKind } from './outcome-kind.enum';

export interface PollObservation {
  pollId: string;
  finishedAt: Date;
  outcomeKind: OutcomeKind;
  fields: ListingFields | null;
}
