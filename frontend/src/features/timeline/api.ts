import { competitorUrl, request } from '../../api'

export type Field = 'title' | 'tagline' | 'price' | 'description'
type Outcome = 'complete' | 'partial' | 'missing' | 'rate_limited' | 'upstream_error'
  | 'timeout' | 'transport_error' | 'invalid_response' | 'interrupted'
type SummaryStatus = 'ready' | 'not_applicable' | 'pending' | 'timeout' | 'invalid_output'
  | 'failed' | 'budget_exhausted'

export interface Snapshot extends Record<Field, string | null> {
  pollId: string
  fetchedAt: string
  outcomeKind: Outcome
  changed: boolean
  changeKind: 'content_changed' | 'disappeared' | 'returned' | null
  changedFields: Partial<Record<Field, { from: string, to: string }>>
  summaryStatus: SummaryStatus
  summary: string | null
}

export type HistoryView = 'changes' | 'polls'

export async function loadPage(id: string, view: HistoryView, cursor: string | null, signal: AbortSignal) {
  const query = cursor ? `?${new URLSearchParams({ cursor })}` : ''
  const response = await request(`${competitorUrl(id)}/${view === 'changes' ? 'changes' : 'snapshots'}${query}`, { signal })
  const rows: Snapshot[] = await response.json()
  return { rows, nextCursor: response.headers.get('X-Next-Cursor') }
}
