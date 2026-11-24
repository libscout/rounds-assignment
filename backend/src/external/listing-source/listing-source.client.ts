import { Injectable } from '@nestjs/common';
import { ConfigService } from '@src/tools/config';
import type { ListingSourceResponse } from './listing-source-response.types';

/** Fetches one listing and returns the HTTP status, response data, or transport failure. */
@Injectable()
export class ListingSourceClient {
  constructor(private readonly config: ConfigService) {}

  async fetchListing(id: string, requestId: string): Promise<ListingSourceResponse> {
    const signal = AbortSignal.timeout(this.config.getEnv('POLL_TIMEOUT_MS'));
    let httpStatus: number | undefined;
    try {
      const base = this.config.getEnv('LISTING_SOURCE_URL').replace(/\/+$/, '');
      const res = await fetch(base + '/listings/' + encodeURIComponent(id), {
        headers: { 'x-request-id': requestId },
        signal,
        redirect: 'manual',
      });
      httpStatus = res.status;
      if (res.status !== 200) {
        void res.body?.cancel().catch(() => undefined);
        return { httpStatus, retryAfter: res.headers.get('retry-after') ?? undefined };
      }
      const raw = await res.text();
      try {
        return { httpStatus, body: JSON.parse(raw) as unknown };
      } catch {
        return { httpStatus };
      }
    } catch {
      return { failure: signal.aborted ? 'timeout' : 'network', httpStatus };
    }
  }
}
