import { Test } from '@nestjs/testing';
import { AiChatClient } from '@src/external/ai/ai-chat.client';
import { LoggerService } from '@src/tools/logger';
import { AiSummaryRepository } from '../repositories/ai-summary.repository';
import { AiSummaryWorker } from './ai-summary.worker';

describe('AI summary worker', () => {
  const repo = {
    claim: jest.fn(),
    finish: jest.fn(),
    retry: jest.fn<Promise<void>, [string, number, Date]>(),
  };
  const client = {
    complete: jest.fn<
      ReturnType<AiChatClient['complete']>,
      Parameters<AiChatClient['complete']>
    >(),
  };
  const diff = { kind: 'returned', changedFields: {} };
  let worker: AiSummaryWorker;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AiSummaryWorker,
        { provide: AiSummaryRepository, useValue: repo },
        { provide: AiChatClient, useValue: client },
        { provide: LoggerService, useValue: {} },
      ],
    }).compile();
    worker = module.get(AiSummaryWorker);
  });
  beforeEach(() => {
    jest.resetAllMocks();
    repo.claim.mockResolvedValue({ kind: 'claimed', pollId: 'id', diff, attempt: 1 });
  });
  it('builds the prompt from the durable diff and stores the provider text', async () => {
    client.complete.mockResolvedValue({ kind: 'ready', text: 'The listing returned.' });
    await worker.tick();
    const [messages, id] = client.complete.mock.calls[0];
    expect(id).toBe('id');
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('one short, factual English sentence');
    expect(messages[1]).toEqual({ role: 'user', content: JSON.stringify(diff) });
    expect(repo.finish).toHaveBeenCalledWith('id', 1, {
      status: 'ready',
      text: 'The listing returned.',
    });
  });
  it('defers to Retry-After on the first attempt and publishes a final timeout on the second', async () => {
    client.complete.mockResolvedValueOnce({
      kind: 'failed',
      retryable: true,
      retryAfter: 7000,
    });
    const started = Date.now();
    await worker.tick();
    expect(repo.retry.mock.calls[0][2].getTime()).toBeGreaterThanOrEqual(
      started + 7000,
    );
    repo.claim.mockResolvedValue({ kind: 'claimed', pollId: 'id', diff, attempt: 2 });
    client.complete.mockResolvedValue({ kind: 'timeout', retryable: true });
    await worker.tick();
    expect(repo.retry).toHaveBeenCalledTimes(1);
    expect(client.complete).toHaveBeenCalledTimes(2);
    expect(repo.finish).toHaveBeenCalledWith('id', 2, { status: 'timeout' });
  });
  it.each(['failed', 'invalid_output'] as const)(
    'finishes a permanent %s outcome on the first attempt',
    async (kind) => {
      client.complete.mockResolvedValue({ kind, retryable: false });
      await worker.tick();
      expect(repo.finish).toHaveBeenCalledWith('id', 1, { status: kind });
      expect(repo.retry).not.toHaveBeenCalled();
    },
  );
});
