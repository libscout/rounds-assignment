import { Expose, Type } from 'class-transformer';
import type { FailedAttempt } from '@src/modules/listing-tracking/types';
import { PartialListingDto } from './partial-listing.dto';

export class FailedAttemptDto {
  @Expose()
  at: string;

  @Expose()
  kind: FailedAttempt['kind'];

  @Expose()
  httpStatus?: number;

  @Expose()
  output?: string;

  @Expose()
  @Type(() => PartialListingDto)
  fields?: PartialListingDto;
}
