import type { ListingSourceResponse } from '@src/external/listing-source';
import { OutcomeKind } from '../types';
import { PollOutcomeMapper } from './poll-outcome-mapper';

describe('PollOutcomeMapper', () => {
  const finishedAt = new Date('2026-03-15T12:00:00Z');
  const fields = { title: 'CRM', price: '$9/mo', tagline: 'a', description: 'b' };

  function classify(response: ListingSourceResponse) {
    return PollOutcomeMapper.classify('a', response, finishedAt);
  }

  it('retains only listing fields in complete and partial observations', () => {
    expect(classify({ httpStatus: 200, body: { id: 'a', ...fields, noise: 123 } })).toEqual({
      kind: OutcomeKind.Complete,
      httpStatus: 200,
      fields,
    });
    expect(classify({ httpStatus: 200, body: { id: 'a', title: 'CRM', price: null } })).toEqual({
      kind: OutcomeKind.Partial,
      httpStatus: 200,
      fields: { title: 'CRM' },
    });
  });

  it.each([
    undefined,
    null,
    { id: 'other', ...fields },
    { id: 'a', title: 'a\0b' },
    { id: 'a', price: 1 },
  ])('rejects invalid source payload %p', (body) => {
    expect(classify({ httpStatus: 200, body })).toEqual({
      kind: OutcomeKind.InvalidResponse,
      httpStatus: 200,
    });
  });

  it.each([
    [404, OutcomeKind.Missing],
    [502, OutcomeKind.UpstreamError],
    [403, OutcomeKind.InvalidResponse],
  ])('classifies HTTP %i', (httpStatus: number, kind: OutcomeKind) => {
    expect(classify({ httpStatus })).toEqual({ kind, httpStatus });
  });

  it.each([
    ['2', 2000],
    ['Sun, 15 Mar 2026 12:01:00 GMT', 60000],
    [undefined, 1000],
    ['-1', 1000],
  ] as const)(
    'resolves Retry-After %p relative to the response time',
    (retryAfter: string | undefined, delay: number) => {
      expect(classify({ httpStatus: 429, retryAfter })).toEqual({
        kind: OutcomeKind.RateLimited,
        httpStatus: 429,
        retryAfter: new Date(+finishedAt + delay),
      });
    },
  );

  it('distinguishes a stalled body from a connection failure', () => {
    expect(classify({ failure: 'timeout', httpStatus: 200 })).toEqual({
      kind: OutcomeKind.Timeout,
      httpStatus: 200,
    });
    expect(classify({ failure: 'network' })).toMatchObject({ kind: OutcomeKind.TransportError });
  });
});
