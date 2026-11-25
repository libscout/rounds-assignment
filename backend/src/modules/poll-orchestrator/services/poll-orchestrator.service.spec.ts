import { randomUUIDv7 } from 'node:crypto';
import { TestEnv } from '@test/nest';
import { DATABASE, type Database } from '@src/tools/db';
import { ListingTrackingModule } from '@src/modules/listing-tracking/listing-tracking.module';
import { PollDeliveryService } from '@src/modules/listing-tracking/services';
import { OutcomeKind } from '@src/modules/listing-tracking/types';
import { ChangeHistoryModule } from '@src/modules/change-history/change-history.module';
import { ChangeHistoryService } from '@src/modules/change-history/services';
import { ChangeKind } from '@src/modules/change-history/types';
import { AiSummaryService } from '@src/modules/ai-summary/services';
import {
  SummaryStatus,
  SummarySubmissionOutcome,
  type SummaryResult,
} from '@src/modules/ai-summary/types';
import { pollExecutions } from '../entities/poll-execution.table';
import { ExecutionStatus } from '../types';
import { PollExecutionRepository } from '../repositories/poll-execution.repository';
import { PollOrchestratorService } from './poll-orchestrator.service';

describe('PollOrchestratorService', () => {
  let env: TestEnv;
  let db: Database;
  let service: PollOrchestratorService;
  let repo: PollExecutionRepository;
  let history: ChangeHistoryService;
  let tracking: PollDeliveryService;
  const ai: jest.Mocked<Pick<AiSummaryService, 'submit' | 'getResults'>> = {
    submit: jest.fn(),
    getResults: jest.fn(),
  };
  beforeAll(async () => {
    env = await TestEnv.create({
      imports: [ListingTrackingModule, ChangeHistoryModule],
      providers: [
        { provide: AiSummaryService, useValue: ai },
        PollExecutionRepository,
        PollOrchestratorService,
      ],
    });
    db = env.nest.get(DATABASE);
    service = env.nest.get(PollOrchestratorService);
    repo = env.nest.get(PollExecutionRepository);
    history = env.nest.get(ChangeHistoryService);
    tracking = env.nest.get(PollDeliveryService);
  }, 180000);
  beforeEach(async () => {
    await db.delete(pollExecutions);
    ai.submit.mockReset().mockResolvedValue(SummarySubmissionOutcome.Accepted);
    ai.getResults.mockReset();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => env?.cleanup());

  /** Prepares a committed change ready for summary submission. */
  async function prepareSubmission() {
    const pollId = randomUUIDv7();
    const observedAt = new Date(0);
    await repo.discover(pollId, observedAt);
    await repo.finishComparison(pollId, true);
    jest.spyOn(history, 'getChange').mockResolvedValue({
      pollId,
      observedAt,
      competitorId: 'c',
      kind: ChangeKind.Returned,
      changedFields: {},
    });

    return pollId;
  }

  it('recovers lost acknowledgments, lost submit confirmations and repeated terminal reads', async () => {
    const [base, id] = [randomUUIDv7(), randomUUIDv7()].sort();
    const get = jest.spyOn(tracking, 'getDeliverableObservation');
    get.mockImplementation((pollId) => {
      const price = pollId === base ? '$39' : '$29';

      return Promise.resolve({
        competitorId: 'c',
        failedAttempts: [],
        pollId,
        finishedAt: new Date(0),
        outcomeKind: OutcomeKind.Complete,
        fields: {
          title: 'A',
          tagline: 'B',
          description: 'C',
          price,
        },
      });
    });
    const ack = jest.spyOn(tracking, 'acknowledge').mockResolvedValue(undefined);
    jest
      .spyOn(history, 'record')
      .mockRejectedValueOnce(new Error('comparison unavailable'));
    await expect(service.deliverPoll(base)).rejects.toThrow();
    expect(ack).not.toHaveBeenCalled();
    expect((await service.statuses([base]))[0].changeHistoryStatus).toBe('error');
    jest.spyOn(tracking, 'oldestOutstandingId').mockResolvedValue(base);
    expect(await service.latestComparisonError('c')).toEqual({
      pollId: base,
      trackingFinishedAt: new Date(0),
      status: ExecutionStatus.Error,
    });
    await service.deliverPoll(base);
    expect(await service.latestComparisonError('c')).toBeNull();
    expect((await service.statuses([base]))[0].aiSummaryStatus).toBe('not_required');
    ack.mockRejectedValueOnce(new Error('lost ack'));
    await expect(service.deliverPoll(id)).rejects.toThrow();
    await service.deliverPoll(id);
    const update = jest.spyOn(repo, 'aiTransition');
    update.mockImplementationOnce(() => {
      throw new Error('lost confirmation');
    });
    await expect(service.submit(id)).rejects.toThrow();
    expect((await repo.page(ExecutionStatus.NotSubmitted, 10)).items).toEqual([
      { pollId: id },
    ]);
    await service.submit(id);
    const submission = {
      pollId: id,
      diff: {
        kind: 'content_changed',
        changedFields: { price: { from: '$39', to: '$29' } },
      },
    };
    expect(ai.submit.mock.calls).toEqual([[submission], [submission]]);
    ai.getResults.mockResolvedValue(
      new Map<string, SummaryResult>([
        [id, { status: SummaryStatus.Ready, text: 'Price fell.' }],
      ]),
    );
    await service.checkResults([id]);
    await service.checkResults([id]);
    expect(await service.statuses([id])).toEqual([
      {
        pollId: id,
        changeHistoryStatus: ExecutionStatus.Completed,
        aiSummaryStatus: ExecutionStatus.Completed,
      },
    ]);
  });

  it.each([
    SummarySubmissionOutcome.InvalidInput,
    SummarySubmissionOutcome.ConflictingDiff,
  ])('records a rejected submission (%s) as an execution error', async (outcome) => {
    const id = await prepareSubmission();
    ai.submit.mockResolvedValueOnce(outcome);
    await service.submit(id);
    expect((await service.statuses([id]))[0].aiSummaryStatus).toBe(
      ExecutionStatus.Error,
    );
    expect((await repo.page(ExecutionStatus.NotSubmitted, 10)).items).toEqual([]);
  });

  it('retries after a submission storage failure on the next pass', async () => {
    const id = await prepareSubmission();
    ai.submit.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.submit(id)).rejects.toThrow('database unavailable');
    expect((await repo.page(ExecutionStatus.NotSubmitted, 10)).items).toEqual([
      { pollId: id },
    ]);
    await service.submit(id);
    expect((await service.statuses([id]))[0].aiSummaryStatus).toBe(
      ExecutionStatus.Submitted,
    );
    expect(ai.submit.mock.calls[1]).toEqual(ai.submit.mock.calls[0]);
  });

  it('guards AI scans and updates by completed comparison and expected AI status', async () => {
    const id = randomUUIDv7();
    await repo.discover(id, new Date(0));
    const initial = (await repo.statuses([id]))[0].aiSummaryStatus;
    await repo.aiTransition(id, initial, ExecutionStatus.Submitted);
    expect((await repo.statuses([id]))[0].aiSummaryStatus).toBe(initial);
    expect((await repo.page(initial, 10)).items).toEqual([]);

    await repo.finishComparison(id, true);
    await repo.aiTransition(id, ExecutionStatus.Submitted, ExecutionStatus.Completed);
    expect((await repo.statuses([id]))[0].aiSummaryStatus).toBe(
      ExecutionStatus.NotSubmitted,
    );
    expect((await repo.page(ExecutionStatus.NotSubmitted, 10)).items).toEqual([
      { pollId: id },
    ]);
    expect((await repo.page(ExecutionStatus.Submitted, 10)).items).toEqual([]);
  });
});
