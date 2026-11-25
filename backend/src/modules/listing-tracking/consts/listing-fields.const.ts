import type { ListingFields } from '../types';

export const listingFields = [
  'title',
  'tagline',
  'price',
  'description',
] as const satisfies readonly (keyof ListingFields)[];
