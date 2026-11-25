import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import { agent } from 'supertest';
import { DemoResetService } from './demo-reset.service';
import { DemoResetController } from './demo-reset.controller';

describe('demo reset HTTP contract', () => {
  let app: INestApplication<Server>;
  const service = { reset: jest.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DemoResetController],
      providers: [{ provide: DemoResetService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());
  it('accepts DELETE and does not reset on a read', async () => {
    await agent(app.getHttpServer()).get('/api/dev/progress').expect(404);
    expect(service.reset).not.toHaveBeenCalled();
    await agent(app.getHttpServer()).delete('/api/dev/progress').expect(204, '');
    expect(service.reset).toHaveBeenCalledTimes(1);
  });
});
