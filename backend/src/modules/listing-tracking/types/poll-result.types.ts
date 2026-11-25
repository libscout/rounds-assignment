import type { OutcomeKind } from './outcome-kind.enum';
import type { ListingFields } from './listing-fields.types';

export interface CompletePollResult {
  kind: OutcomeKind.Complete;
  httpStatus: number;
  fields: ListingFields;
}

export interface MissingPollResult {
  kind: OutcomeKind.Missing;
  httpStatus: number;
}

export interface PartialPollResult {
  kind: OutcomeKind.Partial;
  httpStatus: number;
  fields: ListingFields;
}

export interface RateLimitedPollResult {
  kind: OutcomeKind.RateLimited;
  httpStatus: number;
  retryAfter: Date;
  output?: string;
}

export interface UpstreamErrorPollResult {
  kind: OutcomeKind.UpstreamError;
  httpStatus: number;
  output?: string;
}

export interface InvalidResponsePollResult {
  kind: OutcomeKind.InvalidResponse;
  httpStatus: number;
  output?: string;
}

export interface TimeoutPollResult {
  kind: OutcomeKind.Timeout;
  httpStatus?: number;
  output?: string;
}

export interface TransportErrorPollResult {
  kind: OutcomeKind.TransportError;
  httpStatus?: number;
  output?: string;
}

export interface InterruptedPollResult {
  kind: OutcomeKind.Interrupted;
  httpStatus?: number;
  output?: string;
}

export type PollResult =
  | CompletePollResult
  | MissingPollResult
  | PartialPollResult
  | RateLimitedPollResult
  | UpstreamErrorPollResult
  | InvalidResponsePollResult
  | TimeoutPollResult
  | TransportErrorPollResult
  | InterruptedPollResult;
