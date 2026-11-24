import pino from 'pino';
import { LoggerService } from './logger.service';

describe('LoggerService', () => {
  let entries: Record<string, unknown>[];
  let logger: LoggerService;

  beforeEach(() => {
    entries = [];
    logger = new LoggerService(
      pino(
        { level: 'trace' },
        {
          write(line) {
            entries.push(JSON.parse(line) as Record<string, unknown>);
          },
        },
      ),
    );
  });

  it('sends Nest and application logs to Pino at the requested levels', () => {
    logger.verbose('verbose');
    logger.log('info');
    logger.error('failed');
    expect(entries.map(({ msg, level }) => [msg, level])).toEqual([
      ['verbose', 10],
      ['info', 30],
      ['failed', 50],
    ]);
  });

  it('writes poll metadata as top-level fields', () => {
    logger.debug('Poll finished', { pollId: 'p1', outcome: 'complete' });
    expect(entries[0]).toMatchObject({ msg: 'Poll finished', pollId: 'p1', outcome: 'complete' });
    expect(entries[0]).not.toHaveProperty('0');
  });

  it('preserves the error message and stack for direct and structured errors', () => {
    const error = new Error('Connection closed');
    logger.error('Could not dispatch poll', error);
    logger.warn('Delivery will retry', { pollId: 'p1', err: error });
    for (const entry of entries) {
      expect(entry.err).toMatchObject({ message: error.message, stack: error.stack });
    }
    expect(entries[1].pollId).toBe('p1');
  });

  it('preserves Nest context and additional arguments', () => {
    logger.error('Startup failed', 'stack trace', 'NestFactory');
    expect(entries[0]).toMatchObject({
      msg: 'Startup failed',
      args: ['stack trace'],
      context: 'NestFactory',
    });
  });
});
