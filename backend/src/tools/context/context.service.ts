import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestContext } from './request-context.types';

/** Carries request and user IDs across asynchronous work for a single request. */
@Injectable()
export class ContextService {
  private readonly storage = new AsyncLocalStorage<RequestContext>();

  /** Run `fn` inside the given context. Used internally by the interceptor. */
  run<T>(ctx: RequestContext, fn: () => T): T {
    return this.storage.run(ctx, fn);
  }

  /** Returns the current request ID. Throws if called outside a request context. */
  requestID(): string {
    return this.#getStore().requestID;
  }

  /** Returns the current authenticated user ID, or `undefined`. */
  userID(): string | undefined {
    return this.#getStore().userID;
  }

  // ── private ──────────────────────────────────────────────────────

  #getStore(): RequestContext {
    const ctx = this.storage.getStore();
    if (!ctx) {
      throw new Error(
        'No request context available. Ensure ContextInterceptor is applied to this route.',
      );
    }
    return ctx;
  }
}
