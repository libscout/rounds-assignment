import { listingComparisons as comparisons } from '../entities/listing-comparison.table';

const { pollId, competitorId, observedAt, diff } = comparisons;
export const decisionColumns = { pollId, competitorId, observedAt, diff };
