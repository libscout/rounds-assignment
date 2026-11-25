import { Test } from '@nestjs/testing';
import { PollDeliveryService } from '@src/modules/listing-tracking/services';
import { ConfigService } from '@src/tools/config';
import { LoggerService } from '@src/tools/logger';
import { PollExecutionRepository } from '../repositories/poll-execution.repository';
import { PollOrchestratorService } from '../services';
import { ExecutionStatus } from '../types/execution-status.enum';
import { PollOrchestratorWorker } from './poll-orchestrator.worker';

it('visits later competitor heads and reconciles AI despite a full page of comparison failures', async () => {
  const failed = Array.from({ length: 32 }, (_, i) => ({ pollId: String(i) }));
  const list = jest
    .fn()
    .mockResolvedValueOnce({ items: failed, next: 'cursor' })
    .mockResolvedValueOnce({ items: [{ pollId: 'healthy' }] });
  const seen: string[] = [];
  const coordinator = {
    deliverPoll: (id: string) => {
      seen.push(id);

      if (id !== 'healthy') {
        return Promise.reject(new Error('deferred'));
      }

      return Promise.resolve();
    },
    submit: jest.fn(),
    checkResults: jest.fn(),
  };
  const module = await Test.createTestingModule({
    providers: [
      PollOrchestratorWorker,
      { provide: PollDeliveryService, useValue: { listDeliverablePolls: list } },
      {
        provide: PollExecutionRepository,
        useValue: {
          page: (status: ExecutionStatus) =>
            Promise.resolve({ items: [{ pollId: status }] }),
        },
      },
      { provide: PollOrchestratorService, useValue: coordinator },
      { provide: LoggerService, useValue: { warn: jest.fn(), error: jest.fn() } },
      { provide: ConfigService, useValue: { getEnv: () => 5000 } },
    ],
  }).compile();
  await module.get(PollOrchestratorWorker).tick();
  expect(seen).toEqual([...failed.map((row) => row.pollId), 'healthy']);
  expect(list).toHaveBeenLastCalledWith(32, 'cursor');
  expect(coordinator.submit).toHaveBeenCalledWith(ExecutionStatus.NotSubmitted);
  expect(coordinator.checkResults).toHaveBeenCalledWith([ExecutionStatus.Submitted]);
  const secondTrackingPage = list.mock.invocationCallOrder[1];
  expect(coordinator.submit.mock.invocationCallOrder[0]).toBeLessThan(
    secondTrackingPage,
  );
  expect(coordinator.checkResults.mock.invocationCallOrder[0]).toBeLessThan(
    secondTrackingPage,
  );
  await module.close();
});
