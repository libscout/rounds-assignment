import type { SummaryDiff } from '../types';

export const summaryKinds: readonly SummaryDiff['kind'][] = [
  'content_changed',
  'returned',
  'disappeared',
];
export const summaryFields: ReadonlySet<string> = new Set<
  keyof SummaryDiff['changedFields']
>(['title', 'tagline', 'description', 'price']);
