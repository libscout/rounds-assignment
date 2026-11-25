import type { OutcomeKind } from './outcome-kind.enum';
import type { ListingFields } from './listing-fields.types';

export interface FailedAttempt {
  at: string;
  kind: Exclude<OutcomeKind, OutcomeKind.Complete | OutcomeKind.Missing>;
  httpStatus?: number;
  output?: string;
  fields?: ListingFields;
}
