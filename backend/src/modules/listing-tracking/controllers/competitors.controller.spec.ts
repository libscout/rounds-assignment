import { ClassSerializerInterceptor, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { agent } from 'supertest';
import type { Server } from 'node:http';
import { ContextModule, ContextService } from '@src/tools/context';
import { WatchlistService } from '../services';
import { CompetitorsController } from './competitors.controller';
import { PollAttemptService } from '../internal/poll-attempt.service';

describe('watchlist HTTP contract', () => {
  let app: INestApplication<Server>;
  const service = { add: jest.fn(), remove: jest.fn() };
  const polls = { requestPoll: jest.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ContextModule],
      controllers: [CompetitorsController],
      providers: [
        { provide: WatchlistService, useValue: service },
        { provide: PollAttemptService, useValue: polls },
      ],
    }).compile();
    app = module.createNestApplication();
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

  it('keeps incoming IDs through the handler and generates an ID for anonymous requests', async () => {
    const context = app.get(ContextService);
    const observed: { requestID: string; userID?: string }[] = [];
    /** Captures the request and user IDs after an asynchronous boundary. */
    const list = async () => {
      await Promise.resolve();
      observed.push({ requestID: context.requestID(), userID: context.userID() });

      return [];
    };
    service.add.mockImplementationOnce(list).mockImplementationOnce(list);
    await agent(app.getHttpServer())
      .post('/api/competitors')
      .send({ id: 'context' })
      .set('x-request-id', 'request-1')
      .set('x-user-id', 'user-1')
      .expect('x-request-id', 'request-1')
      .expect(201);
    const anonymous = await agent(app.getHttpServer())
      .post('/api/competitors')
      .send({ id: 'context' })
      .expect(
        'x-request-id',
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
      .expect(201);
    expect(observed).toEqual([
      { requestID: 'request-1', userID: 'user-1' },
      { requestID: anonymous.headers['x-request-id'], userID: undefined },
    ]);
  });
  it('returns the trimmed mixed-case ID on add', async () => {
    await agent(app.getHttpServer())
      .post('/api/competitors')
      .send({ id: ' Foo ' })
      .expect(201, { id: 'Foo' });
    expect(service.add).toHaveBeenCalledWith('Foo');
  });
  it.each([{}, { id: '   ' }, { id: 12 }])('rejects invalid body %p', async (body) => {
    await agent(app.getHttpServer()).post('/api/competitors').send(body).expect(400);
  });
  it('validates the delete path and returns an empty body', async () => {
    await agent(app.getHttpServer()).delete('/api/competitors/%20').expect(400);
    await agent(app.getHttpServer())
      .delete('/api/competitors/%20Foo%20')
      .expect(204, '');
    expect(service.remove).toHaveBeenCalledWith('Foo');
  });
  it('returns HTTP 202 with the existing poll ID when a poll is already in progress', async () => {
    const result = { pollId: '019a0000-0000-7000-8000-000000000001', created: false };
    polls.requestPoll.mockResolvedValueOnce(result);
    await agent(app.getHttpServer())
      .post('/api/competitors/%20Acme%20/polls')
      .expect(202, result);
    expect(polls.requestPoll).toHaveBeenCalledWith('Acme');
  });
  it('rejects invalid poll paths and reports an untracked competitor', async () => {
    await agent(app.getHttpServer()).post('/api/competitors/%20/polls').expect(400);
    await agent(app.getHttpServer()).post('/api/competitors/missing/polls').expect(404);
  });
});
