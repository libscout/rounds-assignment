import { ClassSerializerInterceptor, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { agent } from 'supertest';
import { OutcomeKind } from '@src/modules/listing-tracking/types';
import { ChangeKind } from '@src/modules/change-history/types';
import { ProcessingStatusDto } from '../dto/processing-status.dto';
import { SnapshotDto } from '../dto/snapshot.dto';
import { CompetitorTimelineService } from '../services/competitor-timeline.service';
import { CompetitorTimelineController } from './competitor-timeline.controller';

describe('competitor timeline HTTP contract', () => {
  let app: INestApplication<Server>;
  const timeline = {
    page: jest.fn(),
    listCompetitors: jest.fn(),
    processingStatus: jest.fn(),
  };
  beforeAll(async () => {
    const nest = await Test.createTestingModule({
      controllers: [CompetitorTimelineController],
      providers: [{ provide: CompetitorTimelineService, useValue: timeline }],
    }).compile();
    app = nest.createNestApplication();
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector), {
        strategy: 'excludeAll',
        exposeUnsetFields: false,
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.resetAllMocks());
  it('serializes the bare array, nested diffs and cursor header', async () => {
    const cursor = 'a439191c-7816-74fd-ae91-dda03eb0b058';
    const row = {
      pollId: 'a439191c-7816-74fd-ae91-dda03eb0b059',
      fetchedAt: '2026-08-03T09:00:00.000Z',
      title: null,
      tagline: null,
      description: null,
      price: null,
      outcomeKind: OutcomeKind.Missing,
      changed: true,
      changeKind: ChangeKind.Disappeared,
      changedFields: {},
      summary: null,
      summaryStatus: 'pending',
    };
    const change = {
      ...row,
      title: 'CRM',
      tagline: 'Team',
      description: 'Fast',
      price: '$29',
      outcomeKind: OutcomeKind.Complete,
      changeKind: ChangeKind.ContentChanged,
      changedFields: { price: { from: '$39', to: '$29' } },
    };
    const unchanged = {
      ...change,
      changed: false,
      changeKind: null,
      changedFields: {},
      summaryStatus: 'not_applicable',
    };
    timeline.page.mockResolvedValue({
      snapshots: [change, row, unchanged].map((item) =>
        Object.assign(new SnapshotDto(), item, { privateData: true }),
      ),
      nextCursor: row.pollId,
    });
    await agent(app.getHttpServer())
      .get('/api/competitors/%20Acme%20/snapshots')
      .query({ limit: 3, cursor })
      .expect('X-Next-Cursor', row.pollId)
      .expect(200, [change, row, unchanged]);
    expect(timeline.page).toHaveBeenCalledWith('Acme', 3, cursor);
  });
  it('defaults to 50 and omits the cursor on an empty final page', async () => {
    timeline.page.mockResolvedValue({ snapshots: [], nextCursor: null });
    const res = await agent(app.getHttpServer())
      .get('/api/competitors/Acme/snapshots')
      .expect(200, []);
    expect(res.headers['x-next-cursor']).toBeUndefined();
    expect(timeline.page).toHaveBeenCalledWith('Acme', 50, undefined);
  });
  it.each([
    '?limit=0',
    '?limit=101',
    '?limit=no',
    '?limit=2.5',
    '?cursor=',
    '?cursor=%23',
    '?cursor=WyJhY21lIl0',
  ])('rejects invalid query %s', async (query) => {
    await agent(app.getHttpServer())
      .get('/api/competitors/Acme/snapshots' + query)
      .expect(400);
    expect(timeline.page).not.toHaveBeenCalled();
  });
  it('lists active competitors with an optional recent-change flag', async () => {
    timeline.listCompetitors.mockResolvedValue([
      { id: 'Foo', changedInLast24h: false },
      { id: 'Bar', changedInLast24h: null },
      { id: 'Baz', changedInLast24h: true },
    ]);
    await agent(app.getHttpServer())
      .get('/api/competitors')
      .expect(200, [
        { id: 'Foo', changedInLast24h: false },
        { id: 'Bar', changedInLast24h: null },
        { id: 'Baz', changedInLast24h: true },
      ]);
  });
  it('serializes the latest active comparison error even without a change', async () => {
    const pollId = 'a439191c-7816-74fd-ae91-dda03eb0b058';
    timeline.processingStatus.mockResolvedValue(
      new ProcessingStatusDto(
        { pollId, trackingFinishedAt: new Date(0) },
        {
          pollId,
          finishedAt: new Date(0),
          outcomeKind: OutcomeKind.Complete,
          fields: null,
          failedAttempts: [],
        },
      ),
    );
    await agent(app.getHttpServer())
      .get('/api/competitors/Foo/status')
      .expect(200, {
        latestTrackingPoll: {
          pollId,
          finishedAt: new Date(0).toISOString(),
          outcomeKind: 'complete',
        },
        latestComparisonError: {
          pollId,
          trackingFinishedAt: new Date(0).toISOString(),
          status: 'error',
        },
      });
  });
  it('validates the competitor ID', async () => {
    await agent(app.getHttpServer()).get('/api/competitors/%20/snapshots').expect(400);
  });
});
