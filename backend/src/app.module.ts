import { TrackingModule } from '@src/modules/tracking/tracking.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@src/tools/config';
import { ContextModule } from '@src/tools/context';
import { DbModule } from '@src/tools/db';
import { LoggerModule } from '@src/tools/logger';

/** Connects competitor tracking to configuration, PostgreSQL, request context, and logging. */
@Module({
  imports: [
    ConfigModule.register(),
    DbModule,
    TrackingModule,
    ContextModule,
    LoggerModule.register({ service: 'competitor-pulse' }),
  ],
})
export class AppModule {}
