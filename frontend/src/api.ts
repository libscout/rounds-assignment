export const competitorsUrl = '/api/competitors'

export function competitorUrl(id: string) {
  return `${competitorsUrl}/${encodeURIComponent(id)}`
}

export async function request(url: string, options?: RequestInit) {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(`Request failed (${response.status})`)
  return response
}
