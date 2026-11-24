import { competitorsUrl, competitorUrl, request } from '../../api'

export interface Competitor {
  id: string
  changedInLast24h: boolean
}

export async function listCompetitors(signal: AbortSignal): Promise<Competitor[]> {
  const response = await request(competitorsUrl, { signal })
  return response.json()
}

export async function addCompetitor(id: string) {
  await request(competitorsUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

export async function removeCompetitor(id: string) {
  await request(competitorUrl(id), { method: 'DELETE' })
}
