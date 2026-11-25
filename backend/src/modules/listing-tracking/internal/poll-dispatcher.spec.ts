import { Test } from '@nestjs/testing';
import {
  ListingSourceClient,
  type ListingSourceResponse,
} from '@src/external/listing-source';
import { ConfigService } from '@src/tools/config';
import { EnvSchema } from '@src/tools/config/config.schema';
import { LoggerService } from '@src/tools/logger';
import { OutcomeKind, type ClaimedPoll } from '../types';
import { PollAttemptService } from './poll-attempt.service';
import { PollDispatcher } from './poll-dispatcher';

describe('PollDispatcher', () => {
  const attempts = {
    claim: jest.fn<Promise<ClaimedPoll>, []>(),
    recover: jest.fn<Promise<number>, []>(),
    releaseUnstarted: jest.fn(),
    finish: jest.fn(),
    oldestOverdueMs: jest.fn(),
  };
  const fetchListing = jest.fn<
    Promise<ListingSourceResponse>,
    Parameters<ListingSourceClient['fetchListing']>
  >();
  let dispatcher: PollDispatcher;
  let sequence: number;
  const missing: ListingSourceResponse = { httpStatus: 404 };
  /** Creates sequential poll claims with a retry on the third claim. */
  function makeClaim(): ClaimedPoll {
    const id = String(++sequence);

    const attemptNo = sequence === 3 ? 2 : 1;

    return {
      id,
      competitorId: id,
      attemptNo,
      dueAt: new Date(0),
    };
  }
  beforeEach(async () => {
    jest.resetAllMocks();
    jest.useFakeTimers({ now: 1000000 });
    sequence = 0;
    attempts.claim.mockImplementation(() => Promise.resolve(makeClaim()));
    attempts.recover.mockResolvedValue(0);
    fetchListing.mockResolvedValue(missing);
    const nest = await Test.createTestingModule({
      providers: [
        PollDispatcher,
        { provide: PollAttemptService, useValue: attempts },
        { provide: ListingSourceClient, useValue: { fetchListing } },
        {
          provide: ConfigService,
          useValue: new ConfigService(
            Object.assign(new EnvSchema(), { POLL_CONCURRENCY: 2 }),
          ),
        },
        {
          provide: LoggerService,
          useValue: {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();
    dispatcher = nest.get(PollDispatcher);
  });
  afterEach(async () => {
    await dispatcher.onModuleDestroy();
    jest.useRealTimers();
  });
  it('restores the source cooldown and pauses first attempts and retries after another 429', async () => {
    attempts.recover.mockResolvedValue(Date.now() + 2000);
    fetchListing.mockImplementationOnce(() =>
      Promise.resolve({
        httpStatus: 429,
        retryAfter: '3',
      }),
    );
    await dispatcher.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(1999);
    expect(fetchListing).toHaveBeenCalledTimes(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchListing).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2999);
    expect(fetchListing).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchListing).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(200);
    expect(fetchListing).toHaveBeenCalledTimes(3);
    expect(attempts.finish).toHaveBeenCalledWith(
      expect.anything(),
      { kind: OutcomeKind.Missing, httpStatus: 404 },
      expect.any(Date),
    );
  });
  it('pauses new requests as soon as 429 headers arrive while the body is still pending', async () => {
    let sendBody: (response: ListingSourceResponse) => void;
    fetchListing.mockImplementationOnce((_id, _pollId, onRateLimited) => {
      onRateLimited?.('3');

      return new Promise((resolve) => {
        sendBody = resolve;
      });
    });
    await dispatcher.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(200);
    try {
      await jest.advanceTimersByTimeAsync(2999);
      expect(fetchListing).toHaveBeenCalledTimes(1);
      expect(attempts.claim).toHaveBeenCalledTimes(1);
      expect(attempts.finish).not.toHaveBeenCalled();
    } finally {
      sendBody({ httpStatus: 429, retryAfter: '3' });
    }
  });
  it('retries a failed persistence write with the same outcome and no second source request', async () => {
    jest.useRealTimers();
    const saved = new Promise<void>((resolve) => {
      attempts.finish
        .mockRejectedValueOnce(new Error('database unavailable'))
        .mockImplementationOnce(() => resolve());
    });
    await dispatcher.dispatchOnce();
    await saved;
    expect(fetchListing).toHaveBeenCalledTimes(1);
    expect(attempts.finish).toHaveBeenCalledTimes(2);
    expect(attempts.finish.mock.calls[1]).toEqual(attempts.finish.mock.calls[0]);
  });
  it('allows overlap up to the concurrency limit and releases the slot when a request finishes', async () => {
    let finishFirst: (result: ListingSourceResponse) => void;
    let finishSecond: (result: ListingSourceResponse) => void;
    fetchListing
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSecond = resolve;
          }),
      );
    await dispatcher.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(1000);
    expect(fetchListing).toHaveBeenCalledTimes(2);
    finishSecond(missing);
    await jest.advanceTimersByTimeAsync(50);
    expect(fetchListing).toHaveBeenCalledTimes(3);
    finishFirst(missing);
  });
  it('releases an unstarted claim if another in-flight request closes the gate', async () => {
    let finish: (result: ListingSourceResponse) => void;
    let grant: (poll: ClaimedPoll) => void;
    fetchListing.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await dispatcher.dispatchOnce();
    jest.advanceTimersByTime(200);
    attempts.claim.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const claiming = dispatcher.dispatchOnce();
    finish({
      httpStatus: 429,
      retryAfter: '3',
    });
    const next = makeClaim();
    grant(next);
    await claiming;
    expect(attempts.releaseUnstarted).toHaveBeenCalledWith(next);
    expect(fetchListing).toHaveBeenCalledTimes(1);
  });
  it('paces 6000 eligible claims over 20 minutes with at most 4500 starts in the first 15', async () => {
    const starts: number[] = [];
    fetchListing.mockImplementation(() => {
      starts.push(performance.now());

      return Promise.resolve(missing);
    });
    for (let index = 0; index < 6000; index++) {
      await dispatcher.dispatchOnce();
      jest.advanceTimersByTime(199);
      await dispatcher.dispatchOnce();
      jest.advanceTimersByTime(1);
    }
    expect(starts).toHaveLength(6000);
    expect(starts.filter((time) => time < 900000)).toHaveLength(4500);
    expect(
      starts.every((time, index) => !index || time - starts[index - 1] >= 200),
    ).toBe(true);
    expect(new Set(fetchListing.mock.calls.map(([id]) => id)).size).toBe(6000);
  });
});
