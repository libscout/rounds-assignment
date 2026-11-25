import { Module } from '@nestjs/common';
import { ListingChangeRepository } from './repositories/listing-change.repository';
import { ChangeHistoryService } from './services';

/** Stores each compared listing state and its field or availability changes. */
@Module({
  providers: [ListingChangeRepository, ChangeHistoryService],
  exports: [ChangeHistoryService],
})
export class ChangeHistoryModule {}
