import { ConfigService } from './config.service';
import { EnvSchema } from './config.schema';

describe('ConfigService', () => {
  const service = new ConfigService(new EnvSchema());

  it('returns typed defaults and permits missing optional settings', () => {
    expect(service.expectEnv('POLL_TIMEOUT_MS')).toBe(10_000);
    expect(service.getEnv('IS_LOCAL_ENV')).toBeUndefined();
  });

  it('identifies the missing setting when a caller requires it', () => {
    expect(() => service.expectEnv('IS_LOCAL_ENV')).toThrow('IS_LOCAL_ENV');
  });
});
