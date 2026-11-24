import { pgEnum } from 'drizzle-orm/pg-core';

export enum OutcomeKind {
  Complete = 'complete',
  Partial = 'partial',
  Missing = 'missing',
  RateLimited = 'rate_limited',
  UpstreamError = 'upstream_error',
  Timeout = 'timeout',
  TransportError = 'transport_error',
  InvalidResponse = 'invalid_response',
  Interrupted = 'interrupted',
}

export const outcomeKind = pgEnum('poll_outcome_kind', OutcomeKind);
