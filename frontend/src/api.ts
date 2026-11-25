import { competitorsUrl } from './consts/api.const';

/** Builds a competitor API path with the listing ID encoded as a single segment. */
export function competitorUrl(id: string) {
  return `${competitorsUrl}/${encodeURIComponent(id)}`;
}

/** Fetches an API response and throws with the HTTP status on failure. */
export async function request(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }

  return response;
}
