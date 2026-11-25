import { Injectable } from '@nestjs/common';
import { ConfigService } from '@src/tools/config';
import type {
  ListingSourceHttpResponse,
  ListingSourceResponse,
} from './listing-source-response.types';
import { ERROR_PREVIEW_BYTES } from './consts/listing-source.const';

/** Fetches a listing and captures source failures within the same HTTP deadline. */
@Injectable()
export class ListingSourceClient {
  constructor(private readonly config: ConfigService) {}

  /** Fetches one listing before the deadline and reports rate limits when the headers arrive. */
  async fetchListing(
    id: string,
    requestId: string,
    onRateLimited?: (retryAfter: string | undefined) => void,
  ): Promise<ListingSourceResponse> {
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

      return await ListingSourceClient.readResponse(res, onRateLimited);
    } catch (error) {
      const failure = signal.aborted ? 'timeout' : 'network';
      const output = error instanceof Error ? error.message : undefined;

      return { failure, httpStatus, output };
    }
  }

  /** Decodes a listing or returns the source status, retry header and available error preview. */
  private static async readResponse(
    response: Response,
    onRateLimited?: (retryAfter: string | undefined) => void,
  ): Promise<ListingSourceHttpResponse> {
    const httpStatus = response.status;
    if (httpStatus === 200) {
      const raw = await response.text();
      try {
        return { httpStatus, body: JSON.parse(raw) as unknown };
      } catch {
        return { httpStatus, output: raw.slice(0, ERROR_PREVIEW_BYTES) };
      }
    }
    const retryAfter = response.headers.get('retry-after') ?? undefined;
    if (httpStatus === 429) {
      onRateLimited?.(retryAfter);
    }
    if (httpStatus === 404) {
      void response.body?.cancel().catch(() => undefined);

      return { httpStatus, retryAfter };
    }
    const output = await ListingSourceClient.readErrorBody(response);

    return { httpStatus, retryAfter, output };
  }

  /** Reads a bounded preview of a failed response and releases the remaining body. */
  private static async readErrorBody(response: Response): Promise<string | undefined> {
    if (!response.body) {
      return undefined;
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let remaining = ERROR_PREVIEW_BYTES;
    try {
      while (remaining > 0) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const part = value.subarray(0, remaining);
        chunks.push(Buffer.from(part));
        remaining -= part.byteLength;
      }
    } catch {
      // The status and any bytes already received still describe the failed request.
    } finally {
      void reader.cancel().catch(() => undefined);
    }

    return Buffer.concat(chunks).toString('utf8') || undefined;
  }
}
