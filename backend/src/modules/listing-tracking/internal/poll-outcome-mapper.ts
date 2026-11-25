import type {
  ListingSourceHttpResponse,
  ListingSourceNetworkError,
  ListingSourceResponse,
  ListingSourceTimeout,
} from '@src/external/listing-source';
import { OutcomeKind, type ListingFields, type PollResult } from '../types';
import { listingFields } from '../consts/listing-fields.const';
import { MAX_POLL_OUTPUT_CODE_UNITS } from '../consts/polling.const';

/** Classifies listing source responses for tracking and resolves rate-limit deadlines. */
export class PollOutcomeMapper {
  /** Classifies a source reply at the time the request finished. */
  static classify(
    id: string,
    response: ListingSourceResponse,
    finishedAt: Date,
  ): PollResult {
    if ('failure' in response) {
      return PollOutcomeMapper.transportFailure(response);
    }
    if (response.httpStatus === 200) {
      return PollOutcomeMapper.classifyListing(id, response);
    }

    return PollOutcomeMapper.classifyStatus(response, finishedAt);
  }

  /** Preserves the status and preview available when the source connection failed. */
  private static transportFailure(
    response: ListingSourceNetworkError | ListingSourceTimeout,
  ): PollResult {
    const kind =
      response.failure === 'timeout' ? OutcomeKind.Timeout : OutcomeKind.TransportError;

    return { kind, httpStatus: response.httpStatus, output: response.output };
  }

  /** Maps an HTTP error to its tracking outcome, including the source cooldown on a 429. */
  private static classifyStatus(
    response: ListingSourceHttpResponse,
    finishedAt: Date,
  ): PollResult {
    const { httpStatus, output } = response;
    if (httpStatus === 429) {
      return {
        kind: OutcomeKind.RateLimited,
        output,
        httpStatus,
        retryAfter: PollOutcomeMapper.cooldownDeadline(
          response.retryAfter,
          finishedAt.getTime(),
        ),
      };
    }
    if (httpStatus === 404) {
      return { kind: OutcomeKind.Missing, httpStatus };
    }
    if (httpStatus >= 500) {
      return { kind: OutcomeKind.UpstreamError, httpStatus, output };
    }

    return PollOutcomeMapper.invalidResponse(response);
  }

  /** Distinguishes complete and partial listings after validating the requested ID and fields. */
  private static classifyListing(
    id: string,
    response: ListingSourceHttpResponse,
  ): PollResult {
    const { body, httpStatus } = response;
    if (typeof body !== 'object' || body === null) {
      return PollOutcomeMapper.invalidResponse(response);
    }
    if (!('id' in body) || body.id !== id) {
      return PollOutcomeMapper.invalidResponse(response);
    }
    const fields = PollOutcomeMapper.readFields(body);
    if (!fields) {
      return PollOutcomeMapper.invalidResponse(response);
    }
    const complete = listingFields.every((key) => fields[key] !== undefined);
    const kind = complete ? OutcomeKind.Complete : OutcomeKind.Partial;

    return { kind, httpStatus, fields };
  }

  /** Extracts populated listing fields, returning undefined for malformed field values. */
  private static readFields(body: object): ListingFields | undefined {
    const fields: ListingFields = {};
    for (const key of listingFields) {
      const value: unknown = Reflect.get(body, key);
      if (value == null) {
        continue;
      }
      if (typeof value !== 'string') {
        return undefined;
      }
      if (value.includes('\0') || /[\uD800-\uDFFF]/u.test(value)) {
        return undefined;
      }
      if (value.trim()) {
        fields[key] = value;
      }
    }

    return fields;
  }

  /** Uses the source preview when available, otherwise takes a bounded preview of the response body. */
  private static invalidResponse(response: ListingSourceHttpResponse): PollResult {
    return {
      kind: OutcomeKind.InvalidResponse,
      httpStatus: response.httpStatus,
      output:
        response.output ??
        JSON.stringify(response.body)?.slice(0, MAX_POLL_OUTPUT_CODE_UNITS),
    };
  }

  /** Resolves a Retry-After value to a deadline, using a one-second fallback. */
  static cooldownDeadline(header: string | undefined, now: number): Date {
    if (header && /^\d+$/.test(header)) {
      const deadline = now + Number(header) * 1000;
      if (Number.isFinite(new Date(deadline).getTime())) {
        return new Date(deadline);
      }
    } else if (header && /[a-z]{3}/i.test(header)) {
      const deadline = Date.parse(header);
      if (Number.isFinite(deadline)) {
        return new Date(Math.max(now, deadline));
      }
    }

    return new Date(now + 1000);
  }
}
