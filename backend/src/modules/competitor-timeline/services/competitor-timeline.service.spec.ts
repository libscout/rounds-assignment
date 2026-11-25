import { Test } from '@nestjs/testing';
import { ChangeHistoryService } from '@src/modules/change-history/services';
import { AiSummaryService } from '@src/modules/ai-summary/services';
import { PollOrchestratorService } from '@src/modules/poll-orchestrator/services';
import {
  PollObservationsService,
  WatchlistService,
} from '@src/modules/listing-tracking/services';
import { CompetitorTimelineService } from './competitor-timeline.service';

describe('CompetitorTimelineService', () => {
  const polls = { page: jest.fn(), byIds: jest.fn() };
  const history = { getDecisions: jest.fn(), page: jest.fn(), changedSince: jest.fn() };
  const ai = { getResults: jest.fn() };
  const execution = { statuses: jest.fn() };
  const watchlist = { list: jest.fn() };
  const fields = { title: 'CRM', tagline: 'teams', price: '$29', description: 'fast' };
  const event = {
    pollId: 'edit',
    competitorId: 'c',
    observedAt: new Date(0),
    kind: 'content_changed',
    changedFields: { price: { from: '$39', to: '$29' } },
  };
  let service: CompetitorTimelineService;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CompetitorTimelineService,
        { provide: PollObservationsService, useValue: polls },
        { provide: ChangeHistoryService, useValue: history },
        { provide: AiSummaryService, useValue: ai },
        { provide: WatchlistService, useValue: watchlist },
        { provide: PollOrchestratorService, useValue: execution },
      ],
    }).compile();
    service = module.get(CompetitorTimelineService);
  });
  beforeEach(() => {
    jest.resetAllMocks();
    execution.statuses.mockResolvedValue([]);
    ai.getResults.mockResolvedValue(new Map());
  });
  it('batch enriches only eligible polls and distinguishes pending, unchanged and failed fetches', async () => {
    const ids = ['edit', 'new', 'same', 'failed'];
    polls.page.mockResolvedValue({
      items: ids.map((pollId) => {
        const outcomeKind = pollId === 'failed' ? 'timeout' : 'complete';

        return { pollId, finishedAt: new Date(0), outcomeKind, fields };
      }),
      nextCursor: 'same',
    });
    history.getDecisions.mockResolvedValue([
      { pollId: 'edit', change: event },
      { pollId: 'same', change: null },
    ]);
    execution.statuses.mockResolvedValue([
      { pollId: 'edit', changeHistoryStatus: 'error' },
    ]);
    ai.getResults.mockResolvedValue(
      new Map([['edit', { status: 'ready', text: 'Lower price.' }]]),
    );
    const page = await service.page('c', 4);
    expect(history.getDecisions).toHaveBeenCalledWith(ids.slice(0, 3));
    expect(page.nextCursor).toBe('same');
    expect(page.snapshots).toMatchObject([
      { comparisonStatus: 'completed', changed: true, summary: 'Lower price.' },
      { comparisonStatus: 'pending', summaryStatus: 'pending' },
      {
        comparisonStatus: 'completed',
        changed: false,
        summaryStatus: 'not_applicable',
      },
      { comparisonStatus: 'not_applicable' },
    ]);
  });
  it('retains a history-owned change through tracking and AI outages', async () => {
    history.page.mockResolvedValue({ items: [event], nextCursor: null });
    polls.byIds.mockRejectedValue(new Error());
    ai.getResults.mockRejectedValue(new Error());
    expect((await service.changePage('c', 1)).snapshots).toMatchObject([
      {
        pollId: 'edit',
        changed: true,
        changedFields: event.changedFields,
        comparisonStatus: 'completed',
        summaryStatus: 'unavailable',
        observationAvailable: false,
      },
    ]);
  });

  it('shows known comparison errors when history is unavailable', async () => {
    polls.page.mockResolvedValue({
      items: ['retrying', 'waiting'].map((pollId) => ({
        pollId,
        finishedAt: new Date(0),
        outcomeKind: 'complete',
        fields,
      })),
      nextCursor: null,
    });
    history.getDecisions.mockRejectedValue(new Error('History unavailable'));
    execution.statuses.mockResolvedValue([
      { pollId: 'retrying', changeHistoryStatus: 'error' },
    ]);

    const { snapshots } = await service.page('c', 2);
    expect(snapshots).toMatchObject([
      { pollId: 'retrying', comparisonStatus: 'error' },
      { pollId: 'waiting', comparisonStatus: 'unavailable' },
    ]);
  });

  it('keeps membership readable during a history outage', async () => {
    watchlist.list.mockResolvedValue(['c']);
    history.changedSince.mockRejectedValue(new Error());
    expect(await service.listCompetitors()).toEqual([
      { id: 'c', changedInLast24h: null },
    ]);
  });
});
