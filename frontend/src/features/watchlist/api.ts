import { competitorUrl, request } from '../../api';
import { competitorsUrl } from '../../consts/api.const';

export interface Competitor {
  id: string;
  changedInLast24h: boolean | null;
}

/** Reads the tracked competitors and their recent-change indicators. */
export async function listCompetitors(signal: AbortSignal): Promise<Competitor[]> {
  const response = await request(competitorsUrl, { signal });

  return response.json();
}

/** Submits a competitor ID to start tracking its listing. */
export async function addCompetitor(id: string) {
  await request(competitorsUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

/** Removes a competitor ID from the active watchlist. */
export async function removeCompetitor(id: string) {
  await request(competitorUrl(id), { method: 'DELETE' });
}
