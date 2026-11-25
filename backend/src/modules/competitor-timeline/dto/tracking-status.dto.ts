import { Expose } from 'class-transformer';
import type { OutcomeKind } from '@src/modules/listing-tracking/types';

export class TrackingStatusDto {
  @Expose()
  pollId: string;

  @Expose()
  finishedAt: string;

  @Expose()
  outcomeKind: OutcomeKind;
}
