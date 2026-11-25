export interface ListingSourceHttpResponse {
  httpStatus: number;
  body?: unknown;
  retryAfter?: string;
  output?: string;
}

export interface ListingSourceTimeout {
  failure: 'timeout';
  httpStatus?: number;
  output?: string;
}

export interface ListingSourceNetworkError {
  failure: 'network';
  httpStatus?: number;
  output?: string;
}

export type ListingSourceResponse =
  ListingSourceHttpResponse | ListingSourceTimeout | ListingSourceNetworkError;
