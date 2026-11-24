import type { ListingSourceResponse } from '@src/external/listing-source';
import { OutcomeKind, type ListingFields, type PollResult } from '../types';

/** Classifies listing source responses for tracking and resolves rate-limit deadlines. */
export class PollOutcomeMapper {
  static classify(id: string, response: ListingSourceResponse, finishedAt: Date): PollResult {
    if ('failure' in response) {
      return {
        kind: response.failure === 'timeout' ? OutcomeKind.Timeout : OutcomeKind.TransportError,
        httpStatus: response.httpStatus,
      };
    }
    const { httpStatus, body } = response;
    if (httpStatus === 429) {
      return {
        kind: OutcomeKind.RateLimited,
        httpStatus,
        retryAfter: PollOutcomeMapper.cooldownDeadline(response.retryAfter, finishedAt.getTime()),
      };
    }
    if (httpStatus === 404) return { kind: OutcomeKind.Missing, httpStatus };
    if (httpStatus >= 500) return { kind: OutcomeKind.UpstreamError, httpStatus };
    if (httpStatus !== 200) return { kind: OutcomeKind.InvalidResponse, httpStatus };
    if (!body || typeof body !== 'object' || !('id' in body) || body.id !== id) {
      return { kind: OutcomeKind.InvalidResponse, httpStatus };
    }
    const fields: ListingFields = {};
    let complete = true;
    for (const key of ['title', 'tagline', 'price', 'description'] as const) {
      const value: unknown = Reflect.get(body, key);
      if (typeof value === 'string' && (value.includes('\0') || /[\uD800-\uDFFF]/u.test(value))) {
        return { kind: OutcomeKind.InvalidResponse, httpStatus };
      }
      if (typeof value === 'string' && value.trim()) fields[key] = value;
      else if (value == null || typeof value === 'string') complete = false;
      else return { kind: OutcomeKind.InvalidResponse, httpStatus };
    }
    return { kind: complete ? OutcomeKind.Complete : OutcomeKind.Partial, httpStatus, fields };
  }

  private static cooldownDeadline(header: string | undefined, now: number): Date {
    if (header && /^\d+$/.test(header)) {
      const deadline = now + Number(header) * 1000;
      if (Number.isFinite(new Date(deadline).getTime())) return new Date(deadline);
    } else if (header && /[a-z]{3}/i.test(header)) {
      const deadline = Date.parse(header);
      if (Number.isFinite(deadline)) return new Date(Math.max(now, deadline));
    }
    return new Date(now + 1000);
  }
}
