import { DiscoveryService } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { DemoMocksClient } from '@src/external/demo-mocks/demo-mocks.client';
import { ConfigService } from '@src/tools/config';
import { EnvSchema } from '@src/tools/config/config.schema';
import { DemoResetRepository } from './demo-reset.repository';
import { DemoResetService } from './demo-reset.service';

describe('DemoResetService', () => {
  const settings = new EnvSchema();
  const worker = { onModuleDestroy: jest.fn(), onApplicationBootstrap: jest.fn() };
  const mocks = { reset: jest.fn() };
  const storage = { clear: jest.fn() };
  let service: DemoResetService;
  beforeEach(async () => {
    jest.resetAllMocks();
    settings.DEMO_RESET_ENABLED = 'true';
    settings.AI_API_KEY = undefined;
    settings.AI_BASE_URL = undefined;
    mocks.reset.mockResolvedValue([]);
    const app = await Test.createTestingModule({
      providers: [
        DemoResetService,
        { provide: ConfigService, useValue: new ConfigService(settings) },
        {
          provide: DiscoveryService,
          useValue: { getProviders: () => [{ instance: worker }] },
        },
        { provide: DemoMocksClient, useValue: mocks },
        { provide: DemoResetRepository, useValue: storage },
      ],
    }).compile();
    service = app.get(DemoResetService);
  });
  it('drains active work and shares one reset between callers', async () => {
    let drained: () => void;
    worker.onModuleDestroy.mockReturnValue(
      new Promise<void>((resolve) => {
        drained = resolve;
      }),
    );
    const reset = service.reset();
    expect(service.reset()).toBe(reset);
    expect(mocks.reset).not.toHaveBeenCalled();
    drained();
    await reset;
    expect(mocks.reset).toHaveBeenCalledTimes(1);
    expect(storage.clear).toHaveBeenCalledTimes(1);
    expect(worker.onApplicationBootstrap).toHaveBeenCalledTimes(1);
  });
  it('keeps app history and resumes workers when a mock reset fails', async () => {
    mocks.reset.mockResolvedValueOnce(['mock LLM']);
    await expect(service.reset()).rejects.toThrow('mock LLM');
    expect(storage.clear).not.toHaveBeenCalled();
    expect(worker.onApplicationBootstrap).toHaveBeenCalledTimes(1);
    await service.reset();
    expect(storage.clear).toHaveBeenCalledTimes(1);
  });
  it('rejects reset before touching any data when disabled', () => {
    settings.DEMO_RESET_ENABLED = 'false';
    expect(() => service.reset()).toThrow('Not Found');
    expect(worker.onModuleDestroy).not.toHaveBeenCalled();
    expect(mocks.reset).not.toHaveBeenCalled();
  });
});
