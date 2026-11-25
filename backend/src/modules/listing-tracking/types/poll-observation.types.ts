import type { ListingFields } from './listing-fields.types';
import type { OutcomeKind } from './outcome-kind.enum';

import type { FailedAttempt } from './failed-attempt.types';

export interface PollObservation {
  failedAttempts: FailedAttempt[];
  pollId: string;
  finishedAt: Date;
  outcomeKind: OutcomeKind;
  fields: ListingFields | null;
}
