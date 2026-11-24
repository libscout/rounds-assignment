import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ContextInterceptor } from './context.interceptor';
import { ContextService } from './context.service';

/** Installs request context handling globally so providers can read the current request and user IDs. */
@Global()
@Module({
  providers: [
    ContextService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ContextInterceptor,
    },
  ],
  exports: [ContextService],
})
export class ContextModule {}
