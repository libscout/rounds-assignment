import { Expose } from 'class-transformer';
import type { ListingFields } from '@src/modules/listing-tracking/types';

export class PartialListingDto implements ListingFields {
  @Expose()
  title?: string;

  @Expose()
  tagline?: string;

  @Expose()
  price?: string;

  @Expose()
  description?: string;
}
