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

/** Waits for the application's reset of its saved progress and both local mocks. */
export async function resetDemo() {
  const response = await fetch('/api/dev/progress', { method: 'DELETE' });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.message ?? 'Could not confirm the reset. Try again.');
  }
}
