import { setImmediate } from 'node:timers/promises';
import { ContextService } from './context.service';

describe('ContextService', () => {
  it('isolates overlapping requests and releases their context afterward', async () => {
    const service = new ContextService();
    const contexts = [{ requestID: 'first', userID: 'user' }, { requestID: 'second' }];
    await Promise.all(
      contexts.map((context) =>
        service.run(context, async () => {
          await setImmediate();
          expect(service.requestID()).toBe(context.requestID);
          expect(service.userID()).toBe(context.userID);
        }),
      ),
    );
    expect(() => service.requestID()).toThrow('No request context');
  });
});
