export type ListingSourceResponse =
  | { httpStatus: number; body?: unknown; retryAfter?: string }
  | { failure: 'timeout' | 'network'; httpStatus?: number };
