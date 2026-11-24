import { Test } from '@nestjs/testing';
import { ChangeHistoryService } from '@src/modules/change-history/services';
import { ChangeKind, SummaryStatus } from '@src/modules/change-history/types';
import { PollObservationsService } from '@src/modules/tracking/services';
import { OutcomeKind, type PollObservation } from '@src/modules/tracking/types';
import { ChangeFeedRepository } from '../repositories/change-feed.repository';
import { CompetitorTimelineService } from './competitor-timeline.service';

describe('CompetitorTimelineService', () => {
  const polls = {
    page: jest.fn<
      ReturnType<PollObservationsService['page']>,
      Parameters<PollObservationsService['page']>
    >(),
  };
  const changes = {
    byPollIds: jest.fn<ReturnType<ChangeHistoryService['byPollIds']>, [string[]]>(),
  };
  const finishedAt = new Date('2026-08-03T09:00:00.990Z');
  const id = '8aa43b38-bff1-469e-8cf4-cfb6738e6530';
  const observation: PollObservation = {
    pollId: id,
    finishedAt,
    outcomeKind: OutcomeKind.Complete,
    fields: { title: 'Acme', tagline: 'CRM', description: 'Teams', price: '$29' },
  };
  const event = {
    pollId: id,
    competitorId: 'acme',
    observedAt: new Date(finishedAt),
    kind: ChangeKind.ContentChanged,
    changedFields: { price: { from: '$39', to: '$29' }, tagline: { from: 'Team', to: 'CRM' } },
    summary: null,
    summaryStatus: SummaryStatus.Pending,
  };
  let service: CompetitorTimelineService;
  beforeAll(async () => {
    const nest = await Test.createTestingModule({
      providers: [
        CompetitorTimelineService,
        { provide: ChangeFeedRepository, useValue: {} },
        { provide: PollObservationsService, useValue: polls },
        { provide: ChangeHistoryService, useValue: changes },
      ],
    }).compile();
    service = nest.get(CompetitorTimelineService);
  });
  beforeEach(() => jest.resetAllMocks());

  it('uses one batch, preserves poll order, and attaches changes by ID', async () => {
    const items = [
      observation,
      { ...observation, pollId: 'repeated', outcomeKind: OutcomeKind.Missing, fields: null },
      { ...observation, pollId: 'disappeared', outcomeKind: OutcomeKind.Missing, fields: null },
      { ...observation, pollId: 'first', outcomeKind: OutcomeKind.Complete },
    ];
    polls.page.mockResolvedValue({ items, nextCursor: null });
    changes.byPollIds.mockResolvedValue([
      { ...event, pollId: 'disappeared', kind: ChangeKind.Disappeared, changedFields: {} },
      event,
    ]);
    const page = await service.page('acme', 50);
    expect(changes.byPollIds).toHaveBeenCalledTimes(1);
    expect(changes.byPollIds).toHaveBeenCalledWith(items.map((row) => row.pollId));
    expect(page.snapshots).toMatchObject([
      { pollId: id, changed: true, changedFields: event.changedFields, summaryStatus: 'pending' },
      { pollId: 'repeated', changed: false, price: null, summaryStatus: 'not_applicable' },
      {
        pollId: 'disappeared',
        changed: true,
        changeKind: 'disappeared',
        changedFields: {},
        price: null,
      },
      { pollId: 'first', changed: false, changedFields: {}, summaryStatus: 'not_applicable' },
    ]);
  });

  it.each(Object.values(SummaryStatus))(
    'returns the current %s summary for the same poll',
    async (status) => {
      polls.page.mockResolvedValue({ items: [observation], nextCursor: null });
      const summary = status === SummaryStatus.Ready ? 'Price fell.' : null;
      changes.byPollIds.mockResolvedValue([
        { ...event, kind: ChangeKind.Returned, summaryStatus: status, summary },
      ]);
      expect((await service.page('acme', 1)).snapshots[0]).toMatchObject({
        pollId: id,
        changed: true,
        changeKind: 'returned',
        summary,
        summaryStatus: status,
      });
    },
  );

  it('forwards the poll ID cursor and skips the change lookup on the final empty page', async () => {
    polls.page
      .mockResolvedValueOnce({ items: [observation], nextCursor: id })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    changes.byPollIds.mockResolvedValue([]);
    const { nextCursor } = await service.page('acme', 1);
    expect(nextCursor).toBe(id);
    expect(await service.page('acme', 1, nextCursor)).toEqual({ snapshots: [], nextCursor: null });
    expect(polls.page).toHaveBeenLastCalledWith('acme', 1, id);
    expect(changes.byPollIds).toHaveBeenCalledTimes(1);
  });

  it('propagates a failed history lookup', async () => {
    polls.page.mockResolvedValue({ items: [observation], nextCursor: null });
    changes.byPollIds.mockRejectedValue(new Error('history unavailable'));
    await expect(service.page('acme', 50)).rejects.toThrow('history unavailable');
  });
});
