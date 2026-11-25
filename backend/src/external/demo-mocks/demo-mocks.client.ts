import { Injectable } from '@nestjs/common';
import { ConfigService } from '@src/tools/config';

/** Restores the two local simulators using their control endpoints. */
@Injectable()
export class DemoMocksClient {
  constructor(private readonly config: ConfigService) {}

  /** Requests both resets and returns the names of any mocks that did not acknowledge. */
  async reset() {
    const targets = [
      { name: 'listing source', url: this.config.getEnv('MOCK_SOURCE_TARGET') },
      { name: 'mock LLM', url: this.config.getEnv('MOCK_LLM_TARGET') },
    ];
    const results = await Promise.allSettled(
      targets.map(({ url }) => this.resetServer(url)),
    );

    return targets
      .filter((_, i) => results[i].status === 'rejected')
      .map(({ name }) => name);
  }

  /** Requires a successful JSON acknowledgment from the configured mock server. */
  private async resetServer(base: string) {
    const response = await fetch(new URL('/control/reset', base), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Mock reset failed (${response.status})`);
    }
    await response.json();
  }
}
