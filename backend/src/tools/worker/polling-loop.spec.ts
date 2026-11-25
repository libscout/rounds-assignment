import { PollingLoop } from './polling-loop';

describe('PollingLoop', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('waits for an in-flight pass on shutdown and prevents another pass', async () => {
    let finish: (delay: number) => void;
    const pass = new Promise<number>((resolve) => {
      finish = resolve;
    });
    const tick = jest.fn(() => pass);
    const loop = new PollingLoop(tick, jest.fn());
    loop.start();
    loop.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);

    const stopped = jest.fn();
    const shutdown = loop.stop().then(stopped);
    await jest.advanceTimersByTimeAsync(5000);
    expect(stopped).not.toHaveBeenCalled();
    finish(0);
    await shutdown;
    await jest.advanceTimersByTimeAsync(5000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('reports a failed pass, retries after a second and resumes the worker’s delay', async () => {
    const error = new Error('poll failed');
    const tick = jest
      .fn<Promise<number>, []>()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(5000);
    const report = jest.fn();
    const loop = new PollingLoop(tick, report);
    loop.start();
    await jest.advanceTimersByTimeAsync(999);
    expect(report).toHaveBeenCalledWith(error);
    expect(tick).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(4999);
    expect(tick).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(3);
    await loop.stop();
  });
});
