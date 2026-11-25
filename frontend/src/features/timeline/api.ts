import { competitorUrl, request } from '../../api';

export type Field = 'title' | 'tagline' | 'price' | 'description';
type Outcome =
  | 'complete'
  | 'partial'
  | 'missing'
  | 'rate_limited'
  | 'upstream_error'
  | 'timeout'
  | 'transport_error'
  | 'invalid_response'
  | 'interrupted';
type SummaryStatus =
  | 'ready'
  | 'not_applicable'
  | 'pending'
  | 'unavailable'
  | 'timeout'
  | 'invalid_output'
  | 'failed'
  | 'budget_exhausted';

export interface Snapshot extends Record<Field, string | null> {
  pollId: string;
  fetchedAt: string;
  outcomeKind: Outcome;
  comparisonStatus:
    'pending' | 'completed' | 'error' | 'unavailable' | 'not_applicable';
  changed: boolean;
  changeKind: 'content_changed' | 'disappeared' | 'returned' | null;
  changedFields: Partial<Record<Field, { from: string; to: string }>>;
  summaryStatus: SummaryStatus;
  summary: string | null;
}

export type HistoryView = 'changes' | 'polls';

/** Fetches a page of changes or polls and reads the continuation cursor from the response. */
export async function loadPage(
  id: string,
  view: HistoryView,
  cursor: string | null,
  signal: AbortSignal,
) {
  const query = cursor ? `?${new URLSearchParams({ cursor })}` : '';
  const endpoint = view === 'changes' ? 'changes' : 'snapshots';
  const response = await request(`${competitorUrl(id)}/${endpoint}${query}`, {
    signal,
  });
  const rows: Snapshot[] = await response.json();

  return { rows, nextCursor: response.headers.get('X-Next-Cursor') };
}
