import type { ListingContent } from './listing-content.types';
export type ChangedFields = Partial<Record<keyof ListingContent, { from: string; to: string }>>;
