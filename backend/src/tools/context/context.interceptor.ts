import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUIDv7 } from 'node:crypto';
import { Observable } from 'rxjs';
import { ContextService } from './context.service';
import type { RequestContext } from './request-context.types';
import type { Request, Response } from 'express';

/** Carries incoming request and user IDs into the handler and returns the correlation ID in the response. */
@Injectable()
export class ContextInterceptor implements NestInterceptor {
  constructor(private readonly contextService: ContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const ctx: RequestContext = {
      requestID: (req.headers['x-request-id'] as string) ?? randomUUIDv7(),
      userID: req.headers['x-user-id'] as string | undefined,
    };

    res.setHeader('x-request-id', ctx.requestID);

    return new Observable<unknown>((subscriber) =>
      this.contextService.run(ctx, () => next.handle().subscribe(subscriber)),
    );
  }
}
