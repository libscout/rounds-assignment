import type { OutcomeKind } from './outcome-kind.enum';
import type { ListingFields } from './listing-fields.types';

export type PollResult =
  | { kind: OutcomeKind.Complete | OutcomeKind.Partial; httpStatus: number; fields: ListingFields }
  | { kind: OutcomeKind.RateLimited; httpStatus: number; retryAfter: Date }
  | {
      kind: OutcomeKind.Missing | OutcomeKind.UpstreamError | OutcomeKind.InvalidResponse;
      httpStatus: number;
    }
  | { kind: OutcomeKind.Timeout | OutcomeKind.TransportError; httpStatus?: number };
