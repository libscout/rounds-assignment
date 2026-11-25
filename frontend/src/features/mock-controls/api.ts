interface Version {
  index: number;
  of: number;
}

/** Advances a mock listing by one version and returns null if the source reports a 404. */
export async function nextVersion(id: string): Promise<Version | null> {
  const response = await fetch('/dev/listing-source/advance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, steps: 1 }),
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Advance failed (${response.status})`);
  }
  const { versions }: { versions: Record<string, Version> } = await response.json();

  return versions[id];
}
