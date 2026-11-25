import type { ListingSourceResponse } from '@src/external/listing-source';
import { OutcomeKind } from '../types';
import { PollOutcomeMapper } from './poll-outcome-mapper';

describe('PollOutcomeMapper', () => {
  const finishedAt = new Date('2026-03-15T12:00:00Z');
  const fields = { title: 'CRM', price: '$9/mo', tagline: 'a', description: 'b' };

  /** Classifies a source reply using the test listing ID and fixed finish time. */
  function classify(response: ListingSourceResponse) {
    return PollOutcomeMapper.classify('a', response, finishedAt);
  }

  it('retains only listing fields in complete and partial observations', () => {
    expect(
      classify({ httpStatus: 200, body: { id: 'a', ...fields, noise: 123 } }),
    ).toEqual({
      kind: OutcomeKind.Complete,
      httpStatus: 200,
      fields,
    });
    expect(
      classify({ httpStatus: 200, body: { id: 'a', title: 'CRM', price: null } }),
    ).toEqual({
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
    { id: 'a', tagline: '\uD800' },
    { id: 'a', price: 1 },
  ])('rejects invalid source payload %p', (body) => {
    expect(classify({ httpStatus: 200, body })).toEqual({
      kind: OutcomeKind.InvalidResponse,
      httpStatus: 200,
      output: JSON.stringify(body),
    });
  });

  it('keeps up to 4096 UTF-16 code units when building a preview from an invalid body', () => {
    const body = '😀'.repeat(2046) + 'ab';
    const exact = JSON.stringify(body);
    expect(exact).toHaveLength(4096);
    expect(classify({ httpStatus: 200, body })).toMatchObject({ output: exact });
    expect(classify({ httpStatus: 200, body: body + 'xyz' })).toMatchObject({
      output: '"' + body + 'x',
    });
    expect(classify({ httpStatus: 200, body, output: 'source preview' })).toMatchObject(
      {
        output: 'source preview',
      },
    );
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
    expect(classify({ failure: 'network' })).toMatchObject({
      kind: OutcomeKind.TransportError,
    });
  });
});
