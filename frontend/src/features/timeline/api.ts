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

export interface FailedAttempt {
  at: string;
  kind: Exclude<Outcome, 'complete' | 'missing'>;
  httpStatus?: number;
}

export interface ComparisonError {
  pollId: string;
  trackingFinishedAt: string;
  status: 'error';
}

export interface Snapshot extends Record<Field, string | null> {
  pollId: string;
  fetchedAt: string;
  outcomeKind: Outcome;
  failedAttempts: FailedAttempt[];
  observationAvailable: boolean;
  comparisonStatus:
    'pending' | 'completed' | 'error' | 'unavailable' | 'not_applicable';
  changed: boolean;
  changeKind: 'content_changed' | 'disappeared' | 'returned' | null;
  changedFields: Partial<Record<Field, { from: string; to: string }>>;
  summaryStatus: SummaryStatus;
  summary: string | null;
}

export type HistoryView = 'changes' | 'polls';

interface RequestedPoll {
  pollId: string;
  created: boolean;
}

/** Requests a poll and returns the queued or existing poll, or null for an untracked ID. */
export async function requestPoll(
  id: string,
  signal: AbortSignal,
): Promise<RequestedPoll | null> {
  const response = await fetch(`${competitorUrl(id)}/polls`, {
    method: 'POST',
    signal,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Poll request failed (${response.status})`);
  }

  return response.json();
}

/** Reads the latest finished poll for a competitor, or undefined before the first check. */
export async function loadLatestPoll(
  id: string,
  signal: AbortSignal,
): Promise<Snapshot | undefined> {
  const response = await request(`${competitorUrl(id)}/snapshots?limit=1`, { signal });
  const rows: Snapshot[] = await response.json();

  return rows.at(0);
}

/** Waits for the requested poll to reach the selected view, up to one minute. */
export async function waitForPoll(
  id: string,
  pollId: string,
  view: HistoryView,
  signal: AbortSignal,
) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  for (;;) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    deadline.throwIfAborted();
    const latest = await loadLatestPoll(id, deadline);
    if (latest && latest.pollId >= pollId) {
      if (view === 'polls' || latest.comparisonStatus !== 'pending') {
        return;
      }
    }
  }
}

/** Reads the active comparison error for a competitor, including when its change feed is empty. */
export async function loadLatestComparisonError(
  id: string,
  signal: AbortSignal,
): Promise<ComparisonError | null> {
  const response = await request(`${competitorUrl(id)}/status`, { signal });
  const status: { latestComparisonError: ComparisonError | null } =
    await response.json();

  return status.latestComparisonError;
}

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
