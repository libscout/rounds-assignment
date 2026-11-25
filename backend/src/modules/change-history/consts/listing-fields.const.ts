import type { ListingContent } from '../types';

export const listingFields = [
  'title',
  'tagline',
  'price',
  'description',
] as const satisfies readonly (keyof ListingContent)[];
