import type { ListingContent } from '@src/modules/change-history/types';

export interface ListingVersionWrite {
  id: string;
  newFields?: ListingContent;
}
