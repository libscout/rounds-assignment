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
    canSend: true,
    usesLiveProvider: true,
    complete: jest.fn<
      ReturnType<AiChatClient['complete']>,
      Parameters<AiChatClient['complete']>
    >(),
  };
  const diff = {
    kind: 'content_changed',
    changedFields: {
      price: { from: 'EUR 49 per month', to: '€35.50/mo' },
      description: {
        from: 'Dashboards, CSV export, Slack alerts.',
        to: 'Webhooks, dashboards, PDF reports.',
      },
    },
  };
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
  it('requests both prices and each feature change, then stores the complete reply', async () => {
    const text =
      'Price €49 → €35.50 (monthly). Added webhooks and PDF reports. Removed CSV export and Slack alerts.';
    client.complete.mockResolvedValue({ kind: 'ready', text });
    await worker.tick();
    const [messages, id] = client.complete.mock.calls[0];
    expect(id).toBe('id');
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Price $39 → $29 (monthly).');
    expect(messages[0].content).toContain('every added feature after "Added"');
    expect(messages[0].content).toContain('every removed feature after "Removed"');
    expect(messages[1]).toEqual({ role: 'user', content: JSON.stringify(diff) });
    expect(repo.finish).toHaveBeenCalledWith('id', 1, {
      status: 'ready',
      text,
    });
  });
  it('asks for the offer and its audience when only the description changed', async () => {
    const planDiff = {
      kind: 'content_changed',
      changedFields: {
        description: {
          from: 'Track leads & deals in one place. Now with AI follow-up reminders.',
          to: 'Track leads & deals in one place. Now with AI follow-up reminders and a free plan for solo founders.',
        },
      },
    };
    repo.claim.mockResolvedValue({
      kind: 'claimed',
      pollId: 'id',
      diff: planDiff,
      attempt: 1,
    });
    client.complete.mockResolvedValue({
      kind: 'ready',
      text: 'Added a free plan for solo founders.',
    });
    await worker.tick();
    const [system, input] = client.complete.mock.calls[0][0];
    expect(system.content).toContain('changes to plans');
    expect(system.content).toContain('who qualifies');
    expect(system.content).not.toContain('Price OLD → NEW');
    expect(input).toEqual({ role: 'user', content: JSON.stringify(planDiff) });
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
