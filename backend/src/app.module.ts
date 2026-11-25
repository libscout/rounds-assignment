import { CompetitorTimelineModule } from '@src/modules/competitor-timeline/competitor-timeline.module';
import { ListingTrackingModule } from '@src/modules/listing-tracking/listing-tracking.module';
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
    ListingTrackingModule,
    CompetitorTimelineModule,
    ContextModule,
    LoggerModule.register({ service: 'competitor-pulse' }),
  ],
})
export class AppModule {}
